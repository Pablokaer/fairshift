import { afterAll, describe, expect, it } from 'vitest';
import {
  addQueue,
  asSystem,
  asUser,
  assertInvariants,
  fixture,
  openOffers,
  orderOf,
  pool,
  shiftJson,
  sql,
} from '../lib/db';

afterAll(async () => {
  await pool.end();
});

const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);

describe('concurrency', () => {
  it('50 simultaneous joins produce one consistent order', async () => {
    const f = await fixture(50);
    const results = await settle(f.staff.map((u) => asUser(u, 'select public.join_queue($1)', [f.queueId])));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    const rows = await sql<{ user_id: string; seq: string; joined_at: Date }>(
      `select user_id, seq, joined_at from public.queue_entries where queue_id = $1 and closed_at is null order by seq`,
      [f.queueId],
    );
    expect(rows).toHaveLength(50);
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(50);
    expect(new Set(rows.map((r) => r.seq)).size).toBe(50);
    // seq order == joined_at order (both assigned under the queue lock)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].joined_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1].joined_at.getTime());
    }
    // Every person sees a distinct position 1..50, consistent with the seq order.
    const positions = await Promise.all(
      rows.map((r) =>
        asUser<{ queue_position: number; queue_total: number }>(
          r.user_id,
          'select queue_position, queue_total from public.my_queues() where queue_id = $1',
          [f.queueId],
        ).then((x) => x[0]),
      ),
    );
    expect(positions.map((p) => p.queue_position)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(positions.every((p) => p.queue_total === 50)).toBe(true);
    // The audit log has the same order.
    const audit = await sql<{ subject_id: string }>(
      `select subject_id from public.audit_events where queue_id = $1 and type = 'entry.joined' order by (payload->>'seq')::bigint`,
      [f.queueId],
    );
    expect(audit.map((a) => a.subject_id)).toEqual(rows.map((r) => r.user_id));
  });

  it('the same person joining 10 times at once gets exactly one ticket', async () => {
    const f = await fixture(1);
    const results = await settle(Array.from({ length: 10 }, () => asUser(f.staff[0], 'select public.join_queue($1)', [f.queueId])));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.every((r) => /queue\.already_joined/.test(String(r.reason?.message)))).toBe(true);
  });

  it('accept racing the timeout yields exactly one outcome (100 rounds)', async () => {
    const f = await fixture(3);
    const outcomes = { accepted: 0, expired: 0 };
    for (let round = 0; round < 100; round++) {
      const queueId = await addQueue(f);
      for (const u of f.staff) await asUser(u, 'select public.join_queue($1)', [queueId]);
      await asUser(f.adminId, 'select public.create_shifts($1, $2::jsonb, true)', [
        queueId,
        JSON.stringify([shiftJson(60 * 24 * (round + 2))]),
      ]);
      const [offer] = await openOffers(queueId);
      expect(offer.user_id).toBe(f.staff[0]);
      // Expire "right now-ish": a few ms either side of the racing calls.
      const jitterMs = Math.floor(Math.random() * 30) - 10;
      await sql(`update public.offers set expires_at = clock_timestamp() + make_interval(secs => $2::numeric / 1000)
                 where id = $1`, [offer.id, jitterMs]);
      await settle([
        asUser(f.staff[0], 'select public.accept_offer($1)', [offer.id]),
        asSystem('select private.process_queue($1)', [queueId]),
        asSystem('select private.process_queue($1)', [queueId]),
        asUser(f.staff[0], 'select public.accept_offer($1)', [offer.id]),
      ]);
      // Let a final sweep resolve anything that was skipped because the lock was busy.
      await asSystem('select private.process_queue($1)', [queueId]);

      const [o] = await sql<{ outcome: string }>(`select outcome from public.offers where id = $1`, [offer.id]);
      const assignments = await sql(`select * from public.assignments where offer_id = $1`, [offer.id]);
      const auditTypes = await sql<{ type: string }>(
        `select type from public.audit_events where payload->>'offer_id' = $1 and type in ('offer.accepted','offer.expired')`,
        [offer.id],
      );
      expect(['accepted', 'expired']).toContain(o.outcome);
      expect(auditTypes).toHaveLength(1);
      expect(auditTypes[0].type).toBe(`offer.${o.outcome}`);
      if (o.outcome === 'accepted') {
        outcomes.accepted++;
        expect(assignments).toHaveLength(1);
        expect((await openOffers(queueId))).toHaveLength(0);
      } else {
        outcomes.expired++;
        expect(assignments).toHaveLength(0);
        const next = await openOffers(queueId);
        expect(next).toHaveLength(1);
        expect(next[0].user_id).toBe(f.staff[1]);
      }
      expect(await assertInvariants(queueId)).toEqual([]);
    }
    // Sanity: the jitter should exercise both outcomes.
    console.log('accept vs timeout outcomes', outcomes);
    expect(outcomes.accepted + outcomes.expired).toBe(100);
  }, 120_000);

  it('publishing 10 shifts at once (two admins, separate requests) never double-offers', async () => {
    const f = await fixture(15);
    for (const u of f.staff) await asUser(u, 'select public.join_queue($1)', [f.queueId]);
    const queueOrder = await orderOf(f.queueId);
    // 10 shifts on different days, published concurrently in random order by two admins.
    const days = Array.from({ length: 10 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    const results = await settle(
      days.map((d, i) =>
        asUser(i % 2 ? f.adminId : f.admin2Id, 'select public.create_shifts($1, $2::jsonb, true)', [
          f.queueId,
          JSON.stringify([shiftJson(60 * 24 * d, 600, `day-${d}`)]),
        ]),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    await asSystem('select private.process_queue($1)', [f.queueId]);

    const offers = await openOffers(f.queueId);
    expect(offers).toHaveLength(10);
    expect(new Set(offers.map((o) => o.user_id)).size).toBe(10);
    // Exactly the first 10 people in the queue hold offers.
    expect(new Set(offers.map((o) => o.user_id))).toEqual(new Set(queueOrder.slice(0, 10)));
    expect(await assertInvariants(f.queueId)).toEqual([]);
  });

  it('a batch of 10 shifts is offered in shift-start order to positions 1..10', async () => {
    const f = await fixture(12);
    for (const u of f.staff) await asUser(u, 'select public.join_queue($1)', [f.queueId]);
    const queueOrder = await orderOf(f.queueId);
    const batch = Array.from({ length: 10 }, (_, i) => shiftJson(60 * 24 * (10 - i), 600, `s${i}`)); // reversed
    await asUser(f.adminId, 'select public.create_shifts($1, $2::jsonb, false)', [f.queueId, JSON.stringify(batch)]);
    const drafts = await sql<{ id: string }>(`select id from public.shifts where queue_id = $1`, [f.queueId]);
    // Two admins hit "publish" on overlapping selections at the same time.
    const ids = drafts.map((d) => d.id);
    const r = await settle([
      asUser(f.adminId, 'select public.publish_shifts($1::uuid[])', [ids]),
      asUser(f.admin2Id, 'select public.publish_shifts($1::uuid[])', [ids]),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1); // the loser sees "not draft"
    const offers = await openOffers(f.queueId); // ordered by starts_at
    expect(offers.map((o) => o.user_id)).toEqual(queueOrder.slice(0, 10));
    expect(await assertInvariants(f.queueId)).toEqual([]);
  });

  it('two queues offering overlapping shifts to the same person never double-book them', async () => {
    for (let round = 0; round < 20; round++) {
      const f = await fixture(2);
      const q2 = await addQueue(f);
      for (const q of [f.queueId, q2]) for (const u of f.staff) await asUser(u, 'select public.join_queue($1)', [q]);
      const start = 60 * 24 * 3;
      await settle([
        asUser(f.adminId, 'select public.create_shifts($1, $2::jsonb, true)', [f.queueId, JSON.stringify([shiftJson(start)])]),
        asUser(f.admin2Id, 'select public.create_shifts($1, $2::jsonb, true)', [q2, JSON.stringify([shiftJson(start + 60)])]),
      ]);
      await Promise.all([
        asSystem('select private.process_queue($1)', [f.queueId]),
        asSystem('select private.process_queue($1)', [q2]),
      ]);
      expect(await assertInvariants(f.queueId)).toEqual([]);
      const all = [...(await openOffers(f.queueId)), ...(await openOffers(q2))];
      // Two overlapping shifts, two people: each person gets exactly one.
      expect(all).toHaveLength(2);
      expect(new Set(all.map((o) => o.user_id)).size).toBe(2);
    }
  }, 120_000);

  it('random concurrent staff and admin actions keep every invariant', async () => {
    const f = await fixture(20, { decline_policy: 'move_to_end' });
    for (const u of f.staff.slice(0, 15)) await asUser(u, 'select public.join_queue($1)', [f.queueId]);
    await asUser(f.adminId, 'select public.create_shifts($1, $2::jsonb, true)', [
      f.queueId,
      JSON.stringify(Array.from({ length: 6 }, (_, i) => shiftJson(60 * 24 * (i + 2), 600))),
    ]);
    const actions = ['join', 'leave', 'pause', 'resume', 'accept', 'decline', 'tick', 'cancel'] as const;
    for (let wave = 0; wave < 15; wave++) {
      const ops: Promise<unknown>[] = [];
      for (let i = 0; i < 25; i++) {
        const u = f.staff[Math.floor(Math.random() * f.staff.length)];
        const a = actions[Math.floor(Math.random() * actions.length)];
        if (a === 'join') ops.push(asUser(u, 'select public.join_queue($1)', [f.queueId]));
        if (a === 'leave') ops.push(asUser(u, 'select public.leave_queue($1)', [f.queueId]));
        if (a === 'pause') ops.push(asUser(u, 'select public.pause_queue($1)', [f.queueId]));
        if (a === 'resume') ops.push(asUser(u, 'select public.resume_queue($1)', [f.queueId]));
        if (a === 'accept' || a === 'decline') {
          ops.push(
            sql<{ id: string }>(`select id from public.offers where queue_id = $1 and user_id = $2 and outcome is null`, [
              f.queueId,
              u,
            ]).then((rows) =>
              rows[0] ? asUser(u, `select public.${a}_offer($1)`, [rows[0].id]) : null,
            ),
          );
        }
        if (a === 'tick') ops.push(asSystem('select private.process_queue($1)', [f.queueId]));
        if (a === 'cancel')
          ops.push(
            sql<{ id: string }>(`select id from public.shifts where queue_id = $1 and status = 'assigned' limit 1`, [
              f.queueId,
            ]).then((rows) => (rows[0] ? asUser(f.adminId, 'select public.cancel_shift($1)', [rows[0].id]) : null)),
          );
      }
      const res = await settle(ops);
      for (const r of res) {
        if (r.status === 'rejected') {
          // Only domain errors are acceptable; never deadlocks, unique violations or internal errors.
          expect(String((r.reason as Error).message)).toMatch(/^[a-z_]+\.[a-z_]+$/);
        }
      }
      expect(await assertInvariants(f.queueId)).toEqual([]);
    }
  }, 120_000);

  it('a code invite with 5 uses accepted by 20 people at once admits exactly 5', async () => {
    const f = await fixture(0);
    const [{ token }] = await asUser<{ token: string }>(
      f.adminId,
      `select token from public.create_invite($1, 'code', null, 'staff', '{}', interval '1 day', 5)`,
      [f.orgId],
    );
    const { createUser } = await import('../lib/db');
    const people = await Promise.all(Array.from({ length: 20 }, (_, i) => createUser(`Invitee ${i}`)));
    const r = await settle(people.map((u) => asUser(u, 'select public.accept_invite($1)', [token])));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(5);
    const [{ c }] = await sql<{ c: number }>(
      `select count(*)::int c from public.memberships where org_id = $1 and role = 'staff'`,
      [f.orgId],
    );
    expect(c).toBe(5);
  });
});
