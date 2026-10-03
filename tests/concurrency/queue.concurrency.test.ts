import { afterAll, describe, expect, it } from 'vitest';
import {
  activeAssignments,
  asSystem,
  asUser,
  assertInvariants,
  createUser,
  fixture,
  joinAll,
  orderOf,
  pool,
  shiftJson,
  sql,
} from '../lib/db';

afterAll(async () => {
  await pool.end();
});

const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
const DAY = 60 * 24;
const domainError = /^[a-z_]+\.[a-z_]+$/;

describe('concurrency', () => {
  it('50 simultaneous joins produce one consistent order', async () => {
    const f = await fixture(50);
    const results = await settle(f.doctors.map((u) => asUser(u, 'select public.join_queue($1)', [f.doctorsQueue])));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    const rows = await sql<{ user_id: string; seq: string; joined_at: Date }>(
      `select user_id, seq, joined_at from public.queue_entries where queue_id = $1 and closed_at is null order by seq`,
      [f.doctorsQueue],
    );
    expect(rows).toHaveLength(50);
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(50);
    expect(new Set(rows.map((r) => r.seq)).size).toBe(50);
    // seq order == joined_at order (both drawn under the queue lock)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].joined_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1].joined_at.getTime());
    }
    // Every person sees a distinct position 1..50, consistent with the seq order.
    const positions = await Promise.all(
      rows.map((r) =>
        asUser<{ queue_position: number; queue_total: number }>(
          r.user_id,
          'select queue_position, queue_total from public.my_queue($1)',
          [f.orgId],
        ).then((x) => x[0]),
      ),
    );
    expect(positions.map((p) => p.queue_position)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(positions.every((p) => p.queue_total === 50)).toBe(true);
    // The audit log has the same order.
    const audit = await sql<{ subject_id: string }>(
      `select subject_id from public.audit_events where queue_id = $1 and type = 'entry.joined' order by (payload->>'seq')::bigint`,
      [f.doctorsQueue],
    );
    expect(audit.map((a) => a.subject_id)).toEqual(rows.map((r) => r.user_id));
  });

  it('the same person joining 10 times at once gets exactly one ticket', async () => {
    const f = await fixture(1);
    const results = await settle(
      Array.from({ length: 10 }, () => asUser(f.doctors[0], 'select public.join_queue($1)', [f.doctorsQueue])),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.every((r) => /queue\.already_joined/.test(String(r.reason?.message)))).toBe(true);
  });

  it('two managers publishing several multi-slot shifts at the same instant: nobody twice, nobody skipped', async () => {
    for (let round = 0; round < 10; round++) {
      const f = await fixture(40, 5);
      await joinAll(f.doctorsQueue, f.doctors);
      await joinAll(f.nursesQueue, f.nurses);
      const before = await orderOf(f.doctorsQueue);
      // 8 shifts with 1-3 slots on different days, each published in its own request,
      // half by each manager, all at once.
      const specs = Array.from({ length: 8 }, (_, i) => ({ day: i + 1, slots: 1 + Math.floor(Math.random() * 3) })).sort(
        () => Math.random() - 0.5,
      );
      const results = await settle(
        specs.map((s, i) =>
          asUser(i % 2 ? f.adminId : f.admin2Id, `select public.create_shifts($1, 'doctor', $2::jsonb, true)`, [
            f.orgId,
            JSON.stringify([shiftJson(s.day * DAY, s.slots, 600, `day-${s.day}`)]),
          ]),
        ),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const totalSlots = specs.reduce((n, s) => n + s.slots, 0);

      const assigned = await activeAssignments(f.doctorsQueue);
      expect(assigned).toHaveLength(totalSlots);
      // No person assigned twice.
      expect(new Set(assigned.map((a) => a.user_id)).size).toBe(totalSlots);
      // No one skipped: exactly the first `totalSlots` people of the queue were taken.
      expect(new Set(assigned.map((a) => a.user_id))).toEqual(new Set(before.slice(0, totalSlots)));
      // ...and everyone else kept their relative order.
      expect(await orderOf(f.doctorsQueue)).toEqual(before.slice(totalSlots));
      // Nurses are unaffected.
      expect(await orderOf(f.nursesQueue)).toEqual(f.nurses);
      expect(await assertInvariants(f.doctorsQueue)).toEqual([]);
    }
  }, 180_000);

  it('a batch publish fills slots strictly in queue order and shift-start order, even when two managers click at once', async () => {
    const f = await fixture(20);
    await joinAll(f.doctorsQueue, f.doctors);
    const before = await orderOf(f.doctorsQueue);
    // Created in REVERSE start order, with 1-3 slots each.
    const batch = Array.from({ length: 6 }, (_, i) => shiftJson((6 - i) * DAY, (i % 3) + 1, 600, `s${i}`));
    await asUser(f.adminId, `select public.create_shifts($1, 'doctor', $2::jsonb, false)`, [f.orgId, JSON.stringify(batch)]);
    const ids = (await sql<{ id: string }>(`select id from public.shifts where queue_id = $1`, [f.doctorsQueue])).map((d) => d.id);
    const r = await settle([
      asUser(f.adminId, 'select public.publish_shifts($1::uuid[])', [ids]),
      asUser(f.admin2Id, 'select public.publish_shifts($1::uuid[])', [ids]),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const loser = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(loser.reason?.message)).toBe('shift.not_draft');

    const assigned = await activeAssignments(f.doctorsQueue); // shift-start order, then position
    const totalSlots = batch.reduce((n, s) => n + s.slots, 0);
    expect(assigned.map((a) => a.user_id)).toEqual(before.slice(0, totalSlots));
    expect(await assertInvariants(f.doctorsQueue)).toEqual([]);
  });

  it('a person leaving while a shift is being published: exactly one consistent outcome (60 rounds)', async () => {
    const outcomes = { leftFirst: 0, assignedFirst: 0 };
    for (let round = 0; round < 60; round++) {
      const f = await fixture(3);
      await joinAll(f.doctorsQueue, f.doctors);
      const [first, second] = f.doctors;
      const [leave, publish] = await settle([
        asUser(first, 'select public.leave_queue($1)', [f.doctorsQueue]),
        asUser(f.adminId, `select public.create_shifts($1, 'doctor', $2::jsonb, true)`, [
          f.orgId,
          JSON.stringify([shiftJson(2 * DAY, 1)]),
        ]),
      ]);
      expect(publish.status).toBe('fulfilled');
      const assigned = await activeAssignments(f.doctorsQueue);
      expect(assigned).toHaveLength(1);
      if (leave.status === 'fulfilled') {
        // Leave committed first: the shift went to the next person.
        outcomes.leftFirst++;
        expect(assigned[0].user_id).toBe(second);
        expect(await orderOf(f.doctorsQueue)).toEqual([f.doctors[2]]);
      } else {
        // Publish committed first: the first person holds the shift and could not leave.
        outcomes.assignedFirst++;
        expect(String(leave.reason?.message)).toBe('queue.holding_shift');
        expect(assigned[0].user_id).toBe(first);
        expect(await orderOf(f.doctorsQueue)).toEqual([second, f.doctors[2]]);
      }
      expect(await assertInvariants(f.doctorsQueue)).toEqual([]);
    }
    console.log('leave vs publish outcomes', outcomes);
    expect(outcomes.leftFirst + outcomes.assignedFirst).toBe(60);
  }, 180_000);

  it('the same person at two hospitals is never double-booked by simultaneous publishes', async () => {
    for (let round = 0; round < 20; round++) {
      const a = await fixture(1);
      const b = await fixture(1);
      const shared = await createUser('Shared doctor');
      await sql(`insert into public.memberships (org_id, user_id, role, profession) values ($1, $3, 'staff', 'doctor'), ($2, $3, 'staff', 'doctor')`, [
        a.orgId,
        b.orgId,
        shared,
      ]);
      await joinAll(a.doctorsQueue, [shared, a.doctors[0]]);
      await joinAll(b.doctorsQueue, [shared, b.doctors[0]]);
      await settle([
        asUser(a.adminId, `select public.create_shifts($1, 'doctor', $2::jsonb, true)`, [a.orgId, JSON.stringify([shiftJson(3 * DAY)])]),
        asUser(b.adminId, `select public.create_shifts($1, 'doctor', $2::jsonb, true)`, [b.orgId, JSON.stringify([shiftJson(3 * DAY + 60)])]),
      ]);
      // A busy user lock makes the engine stop instead of skipping; the scheduler finishes.
      await Promise.all([
        asSystem('select private.process_queue($1)', [a.doctorsQueue]),
        asSystem('select private.process_queue($1)', [b.doctorsQueue]),
      ]);
      const all = [...(await activeAssignments(a.doctorsQueue)), ...(await activeAssignments(b.doctorsQueue))];
      expect(all).toHaveLength(2);
      expect(all.filter((x) => x.user_id === shared)).toHaveLength(1);
      expect(await assertInvariants(a.doctorsQueue)).toEqual([]);
      expect(await assertInvariants(b.doctorsQueue)).toEqual([]);
    }
  }, 180_000);

  it('sign-ups racing a code regeneration: each one is linked with a valid code or not created at all', async () => {
    const f = await fixture(0);
    const signups = Array.from({ length: 20 }, (_, i) =>
      createUser(`Newcomer ${i}`, { hospital_code: f.code, profession: i % 2 ? 'doctor' : 'nurse' }),
    );
    const regen = asUser<{ code: string }>(f.adminId, 'select public.regenerate_join_code($1) as code', [f.orgId]);
    const [results, regenResult] = await Promise.all([settle(signups), settle([regen])]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(regenResult[0].status).toBe('fulfilled');
    expect(failed.every((r) => String(r.reason?.message) === 'hospital_code.invalid')).toBe(true);
    const [{ c }] = await sql<{ c: number }>(`select count(*)::int c from public.memberships where org_id = $1 and role = 'staff'`, [f.orgId]);
    expect(c).toBe(ok.length);
    const orphans = await sql(
      `select 1 from auth.users u where u.raw_user_meta_data->>'hospital_code' = $1
         and not exists (select 1 from public.memberships m where m.user_id = u.id)`,
      [f.code],
    );
    expect(orphans).toHaveLength(0);
  });

  it('random concurrent staff and manager actions keep every invariant', async () => {
    const f = await fixture(25);
    await joinAll(f.doctorsQueue, f.doctors.slice(0, 18));
    await asUser(f.adminId, `select public.create_shifts($1, 'doctor', $2::jsonb, true)`, [
      f.orgId,
      JSON.stringify(Array.from({ length: 4 }, (_, i) => shiftJson((i + 2) * DAY, 1 + (i % 3), 600))),
    ]);
    const actions = ['join', 'leave', 'pause', 'resume', 'give_back', 'publish', 'cancel', 'tick'] as const;
    let day = 10;
    for (let wave = 0; wave < 15; wave++) {
      const ops: Promise<unknown>[] = [];
      for (let i = 0; i < 25; i++) {
        const u = f.doctors[Math.floor(Math.random() * f.doctors.length)];
        const a = actions[Math.floor(Math.random() * actions.length)];
        if (a === 'join') ops.push(asUser(u, 'select public.join_queue($1)', [f.doctorsQueue]));
        if (a === 'leave') ops.push(asUser(u, 'select public.leave_queue($1)', [f.doctorsQueue]));
        if (a === 'pause') ops.push(asUser(u, 'select public.pause_queue($1)', [f.doctorsQueue]));
        if (a === 'resume') ops.push(asUser(u, 'select public.resume_queue($1)', [f.doctorsQueue]));
        if (a === 'give_back') {
          ops.push(
            sql<{ shift_id: string }>(`select shift_id from public.assignments where user_id = $1 and status = 'active' limit 1`, [u]).then(
              (rows) => (rows[0] ? asUser(u, 'select public.give_back_shift($1)', [rows[0].shift_id]) : null),
            ),
          );
        }
        if (a === 'publish') {
          day += 1;
          ops.push(
            asUser(Math.random() < 0.5 ? f.adminId : f.admin2Id, `select public.create_shifts($1, 'doctor', $2::jsonb, true)`, [
              f.orgId,
              JSON.stringify([shiftJson(day * DAY, 1 + Math.floor(Math.random() * 3), 600)]),
            ]),
          );
        }
        if (a === 'cancel') {
          ops.push(
            sql<{ id: string }>(`select id from public.shifts where queue_id = $1 and status in ('open', 'filled') limit 1`, [
              f.doctorsQueue,
            ]).then((rows) => (rows[0] ? asUser(f.adminId, 'select public.cancel_shift($1)', [rows[0].id]) : null)),
          );
        }
        if (a === 'tick') ops.push(asSystem('select private.process_queue($1)', [f.doctorsQueue]));
      }
      const res = await settle(ops);
      for (const r of res) {
        if (r.status === 'rejected') {
          // Only domain errors are acceptable; never deadlocks, unique violations or internal errors.
          expect(String((r.reason as Error).message)).toMatch(domainError);
        }
      }
      await asSystem('select private.process_queue($1)', [f.doctorsQueue]);
      expect(await assertInvariants(f.doctorsQueue)).toEqual([]);
    }
  }, 180_000);
});
