// API-level integration tests through the real Supabase stack (Auth + the
// before-user-created hook, PostgREST, Realtime, pg_cron, Edge Functions),
// using supabase-js exactly like the app does.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../lib/db';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const PASSWORD = 'Password123!';

const clients: SupabaseClient[] = [];

afterAll(async () => {
  for (const c of clients) await c.removeAllChannels();
  await pool.end();
});

const anonClient = () => {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  clients.push(c);
  return c;
};

const emailFor = (name: string) => `${name.toLowerCase()}.${randomUUID().slice(0, 8)}@api.test`;

async function hospital(name = 'API Hospital') {
  const [h] = await sql<{ org_id: string; join_code: string }>(
    `select * from private.provision_hospital($1, 'Europe/Dublin')`,
    [name],
  );
  const [q] = await sql<{ d: string; n: string }>(
    `select private.profession_queue($1, 'doctor') d, private.profession_queue($1, 'nurse') n`,
    [h.org_id],
  );
  return { orgId: h.org_id, code: h.join_code, doctors: q.d, nurses: q.n };
}

/** Sign up through Auth with the hospital code, like the app's sign-up screen. */
async function signUp(code: string, name: string, profession: 'doctor' | 'nurse' = 'doctor') {
  const client = anonClient();
  const email = emailFor(name);
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { display_name: name, hospital_code: code, profession } },
  });
  if (error) throw error;
  return { id: data.user!.id, email, client };
}

async function manager(h: Awaited<ReturnType<typeof hospital>>, name = 'Manager') {
  const m = await signUp(h.code, name);
  await sql(`select private.set_manager($1, $2, 'owner')`, [h.orgId, m.email]);
  return m;
}

function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const v = await fn();
        if (v !== undefined && v !== null) return resolve(v);
      } catch {
        /* retry */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const inDays = (d: number, hours = 8) => {
  const start = new Date(Date.now() + d * 86_400_000);
  return { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + hours * 3_600_000).toISOString() };
};

describe('sign-up with the hospital code', () => {
  it('is rejected without a code, with an invalid code or an invalid profession', async () => {
    const h = await hospital();
    const c = anonClient();
    const none = await c.auth.signUp({ email: emailFor('nocode'), password: PASSWORD, options: { data: { display_name: 'X' } } });
    expect(none.error?.message).toBe('hospital_code.required');
    const badEmail = emailFor('badcode');
    const bad = await c.auth.signUp({
      email: badEmail,
      password: PASSWORD,
      options: { data: { hospital_code: 'ZZZZ9999', profession: 'doctor' } },
    });
    expect(bad.error?.message).toBe('hospital_code.invalid');
    const prof = await c.auth.signUp({
      email: emailFor('badprof'),
      password: PASSWORD,
      options: { data: { hospital_code: h.code, profession: 'pharmacist' } },
    });
    expect(prof.error?.message).toBe('profession.invalid');
    expect(await sql(`select 1 from auth.users where email = $1`, [badEmail])).toHaveLength(0);
  });

  it('with a valid code creates a linked professional who is not in the queue yet', async () => {
    const h = await hospital();
    const u = await signUp(h.code.toLowerCase(), 'Newcomer', 'nurse');
    const { data: profile } = await u.client.from('profiles').select('display_name').single();
    expect(profile?.display_name).toBe('Newcomer');
    const { data: q } = await u.client.rpc('my_queue', { p_org: h.orgId });
    expect(q?.[0]).toMatchObject({ profession: 'nurse', state: 'not_joined', queue_total: 0 });
  });

  it('a regenerated code stops working for new sign-ups', async () => {
    const h = await hospital();
    const m = await manager(h);
    const { data: fresh, error } = await m.client.rpc('regenerate_join_code', { p_org: h.orgId });
    expect(error).toBeNull();
    await expect(signUp(h.code, 'TooLate')).rejects.toMatchObject({ message: 'hospital_code.invalid' });
    await expect(signUp(fresh as string, 'InTime')).resolves.toBeTruthy();
  });

  it('magic link: an existing user signs in with the 6-digit code; it never creates accounts', async () => {
    const h = await hospital();
    const u = await signUp(h.code, 'Magic');
    const c = anonClient();
    expect((await c.auth.signInWithOtp({ email: u.email, options: { shouldCreateUser: false } })).error).toBeNull();
    const code = await waitFor(async () => {
      const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${u.email}`)}`);
      const list = (await r.json()) as { messages: { ID: string }[] };
      if (!list.messages?.length) return undefined;
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
      return /\b(\d{6})\b/.exec(m.Text ?? m.HTML)?.[1];
    });
    const { data, error } = await c.auth.verifyOtp({ email: u.email, token: code, type: 'email' });
    expect(error).toBeNull();
    expect(data.session?.user.email).toBe(u.email);

    const stranger = await c.auth.signInWithOtp({ email: emailFor('stranger'), options: { shouldCreateUser: true } });
    expect(stranger.error?.message).toBe('hospital_code.required');
  });
});

describe('row level security over the REST API', () => {
  it('isolates hospitals and hides other people\'s tickets and the code', async () => {
    const h = await hospital();
    const d1 = await signUp(h.code, 'DocA1');
    const d2 = await signUp(h.code, 'DocA2');
    for (const d of [d1, d2]) expect((await d.client.rpc('join_queue', { p_queue: h.doctors })).error).toBeNull();
    const other = await hospital('Other Hospital');
    const outsider = await manager(other, 'OtherManager');

    const { data: mine } = await d1.client.from('queue_entries').select('user_id');
    expect(mine?.map((r) => r.user_id)).toEqual([d1.id]);
    const { data: q } = await d2.client.rpc('my_queue', { p_org: h.orgId });
    expect(q?.[0]).toMatchObject({ queue_position: 2, queue_total: 2, state: 'waiting', profession: 'doctor' });
    expect((await d1.client.from('organizations').select('join_code')).error).not.toBeNull();
    expect((await d1.client.rpc('admin_hospital_code', { p_org: h.orgId })).error?.message).toBe('auth.forbidden');
    expect((await d1.client.rpc('join_queue', { p_queue: h.nurses })).error?.message).toBe('queue.not_eligible');

    expect((await outsider.client.from('queues').select('id').eq('id', h.doctors)).data).toEqual([]);
    expect((await outsider.client.from('audit_events').select('id').eq('org_id', h.orgId)).data).toEqual([]);
    expect((await outsider.client.from('organizations').select('id')).data).toHaveLength(1);

    const ins = await d1.client.from('queue_entries').insert({
      queue_id: h.doctors, org_id: h.orgId, user_id: d1.id, seq: 1, joined_at: new Date().toISOString(),
    });
    expect(ins.error).not.toBeNull();
    const upd = await d1.client.from('queue_entries').update({ seq: 1 }).eq('queue_id', h.doctors).select();
    expect(upd.data ?? []).toEqual([]); // no UPDATE privilege: nothing changes
    expect((await anonClient().rpc('my_queue')).error).not.toBeNull();
  });
});

describe('realtime', () => {
  it('members receive content-free change signals; others cannot subscribe', async () => {
    const h = await hospital('RT Hospital');
    const watcher = await signUp(h.code, 'Watcher');
    const joiner = await signUp(h.code, 'Joiner');
    const nurse = await signUp(h.code, 'NurseRT', 'nurse');

    const received: unknown[] = [];
    await watcher.client.realtime.setAuth((await watcher.client.auth.getSession()).data.session!.access_token);
    const status = await new Promise<string>((resolve) => {
      watcher.client
        .channel(`queue:${h.doctors}`, { config: { private: true } })
        .on('broadcast', { event: 'queue_changed' }, (m) => received.push(m.payload))
        .subscribe((s) => (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' ? resolve(s) : undefined));
    });
    expect(status).toBe('SUBSCRIBED');

    await nurse.client.realtime.setAuth((await nurse.client.auth.getSession()).data.session!.access_token);
    const denied = await new Promise<string>((resolve) => {
      nurse.client
        .channel(`queue:${h.doctors}`, { config: { private: true } })
        .subscribe((s) => (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' ? resolve(s) : undefined));
    });
    expect(denied).toBe('CHANNEL_ERROR');

    expect((await joiner.client.rpc('join_queue', { p_queue: h.doctors })).error).toBeNull();
    const payload = (await waitFor(async () => received[0])) as Record<string, unknown>;
    // No names, no positions: only the queue id and a version counter (+ Realtime's message id).
    expect(Object.keys(payload).filter((k) => !['id', 'queue_id', 'version'].includes(k))).toEqual([]);
  });
});

describe('scheduler (pg_cron)', () => {
  it('completes a shift after its end time and invites the person to rejoin, with no client involvement', async () => {
    const h = await hospital('Cron Hospital');
    const m = await manager(h);
    const first = await signUp(h.code, 'First');
    const second = await signUp(h.code, 'Second');
    for (const u of [first, second]) await u.client.rpc('join_queue', { p_queue: h.doctors });
    const { data: ids, error } = await m.client.rpc('create_shifts', {
      p_org: h.orgId, p_profession: 'doctor', p_publish: true, p_shifts: [{ ...inDays(2), slots: 1 }],
    });
    expect(error).toBeNull();
    const { data: assigned } = await first.client.rpc('my_queue', { p_org: h.orgId });
    expect(assigned?.[0]).toMatchObject({ state: 'assigned' });

    // The shift ends: move it into the past and let pg_cron (every 15 s) complete it.
    await sql(`update public.shifts set starts_at = now() - interval '9 hours', ends_at = now() - interval '1 hour' where id = $1`, [
      (ids as string[])[0],
    ]);
    const state = await waitFor(async () => {
      const { data } = await first.client.rpc('my_queue', { p_org: h.orgId });
      return data?.[0].state === 'not_joined' ? 'not_joined' : undefined;
    }, 40_000);
    expect(state).toBe('not_joined');
    const [s] = await sql<{ status: string }>(`select status from public.shifts where id = $1`, [(ids as string[])[0]]);
    expect(s.status).toBe('completed');
    const { data: inbox } = await first.client.from('notifications').select('type');
    expect(inbox?.map((n) => n.type)).toContain('eligible_to_rejoin');
    const { data: q2 } = await second.client.rpc('my_queue', { p_org: h.orgId });
    expect(q2?.[0]).toMatchObject({ state: 'waiting', queue_position: 1 });
  }, 60_000);
});

describe('edge functions', () => {
  it('send-notifications rejects calls without the cron secret', async () => {
    const r = await fetch(`${URL}/functions/v1/send-notifications`, { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    expect(r.status).toBe(401);
  });

  it('send-notifications drains the outbox (push skipped without devices, e-mail fallback sent)', async () => {
    const h = await hospital('Notify Hospital');
    const m = await manager(h);
    const s = await signUp(h.code, 'Notified');
    await s.client.rpc('join_queue', { p_queue: h.doctors });
    await m.client.rpc('create_shifts', { p_org: h.orgId, p_profession: 'doctor', p_publish: true, p_shifts: [inDays(3)] });
    const r = await fetch(`${URL}/functions/v1/send-notifications`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FAIRSHIFT_CRON_SECRET ?? 'local-dev-cron-secret'}` },
    });
    expect(r.status).toBe(200);
    const rows = await waitFor(async () => {
      const x = await sql<{ channel: string; status: string }>(
        `select channel, status from public.notification_outbox where user_id = $1 and template = 'shift_assigned'`,
        [s.id],
      );
      return x.every((y) => y.status !== 'pending') && x.length === 2 ? x : undefined;
    });
    expect(rows.find((x) => x.channel === 'push')?.status).toBe('skipped');
    expect(rows.find((x) => x.channel === 'email')?.status).toBe('sent');
  });

  it('delete-account anonymizes the user, gives their shift to the next person and removes the auth user', async () => {
    const h = await hospital('Delete Hospital');
    const m = await manager(h);
    const leaving = await signUp(h.code, 'Leaving');
    const next = await signUp(h.code, 'NextInLine');
    for (const u of [leaving, next]) await u.client.rpc('join_queue', { p_queue: h.doctors });
    await m.client.rpc('create_shifts', { p_org: h.orgId, p_profession: 'doctor', p_publish: true, p_shifts: [inDays(5)] });
    const { data: q } = await leaving.client.rpc('my_queue', { p_org: h.orgId });
    expect(q?.[0].state).toBe('assigned');

    const { error } = await leaving.client.functions.invoke('delete-account', { method: 'POST' });
    expect(error).toBeNull();

    const [profile] = await sql(`select display_name, deleted_at from public.profiles where id = $1`, [leaving.id]);
    expect(profile.display_name).toBe('');
    expect(profile.deleted_at).not.toBeNull();
    expect(await sql(`select 1 from auth.users where id = $1`, [leaving.id])).toHaveLength(0);
    expect((await sql(`select 1 from public.audit_events where subject_id = $1`, [leaving.id])).length).toBeGreaterThan(0);
    const { data: nq } = await next.client.rpc('my_queue', { p_org: h.orgId });
    expect(nq?.[0].state).toBe('assigned'); // the shift went to the next person in line
  });
});
