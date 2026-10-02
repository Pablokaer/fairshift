// API-level integration tests through the real Supabase stack (Auth, PostgREST,
// Realtime, Edge Functions), using supabase-js exactly like the app does.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../lib/db';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const clients: SupabaseClient[] = [];

afterAll(async () => {
  for (const c of clients) await c.removeAllChannels();
  await pool.end();
});

async function newUser(name: string) {
  const email = `${name.toLowerCase()}.${randomUUID().slice(0, 8)}@api.test`;
  const password = 'Password123!';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  clients.push(client);
  return { id: data.user!.id, email, client };
}

async function orgWithQueue(owner: Awaited<ReturnType<typeof newUser>>, name = 'API Hospital') {
  const { data: orgId, error } = await owner.client.rpc('create_organization', { p_name: name, p_timezone: 'Europe/Dublin' });
  if (error) throw error;
  const { data: queueId, error: e2 } = await owner.client.rpc('create_queue', { p_org: orgId, p_name: 'Q' });
  if (e2) throw e2;
  return { orgId: orgId as string, queueId: queueId as string };
}

async function invite(owner: Awaited<ReturnType<typeof newUser>>, orgId: string, queueId: string) {
  const { data, error } = await owner.client.rpc('create_invite', {
    p_org: orgId,
    p_kind: 'code',
    p_queue_ids: [queueId],
  });
  if (error) throw error;
  return (data as { token: string }[])[0].token;
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

describe('auth', () => {
  it('magic link e-mail contains a 6-digit code that signs the user in', async () => {
    const email = `magic.${randomUUID().slice(0, 8)}@api.test`;
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    expect(error).toBeNull();
    const code = await waitFor(async () => {
      const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
      const list = (await r.json()) as { messages: { ID: string }[] };
      if (!list.messages?.length) return undefined;
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
      return /\b(\d{6})\b/.exec(m.Text ?? m.HTML)?.[1];
    });
    const { data, error: e2 } = await c.auth.verifyOtp({ email, token: code, type: 'email' });
    expect(e2).toBeNull();
    expect(data.session?.user.email).toBe(email);
  });

  it('a new user gets a profile with their display name', async () => {
    const u = await newUser('Profiled');
    const { data } = await u.client.from('profiles').select('display_name').single();
    expect(data?.display_name).toBe('Profiled');
  });
});

describe('row level security over the REST API', () => {
  it('isolates organizations and hides other people\'s tickets', async () => {
    const owner = await newUser('OwnerA');
    const { orgId, queueId } = await orgWithQueue(owner);
    const s1 = await newUser('StaffA1');
    const s2 = await newUser('StaffA2');
    const code = await invite(owner, orgId, queueId);
    for (const s of [s1, s2]) {
      expect((await s.client.rpc('accept_invite', { p_token: code })).error).toBeNull();
      expect((await s.client.rpc('join_queue', { p_queue: queueId })).error).toBeNull();
    }
    const other = await newUser('OtherOrg');
    await orgWithQueue(other, 'Other Hospital');

    const { data: mine } = await s1.client.from('queue_entries').select('user_id');
    expect(mine?.map((r) => r.user_id)).toEqual([s1.id]);
    const { data: q } = await s2.client.rpc('my_queues');
    expect(q?.[0]).toMatchObject({ queue_position: 2, queue_total: 2, state: 'waiting' });

    expect((await other.client.from('queues').select('id').eq('id', queueId)).data).toEqual([]);
    expect((await other.client.from('audit_events').select('id').eq('org_id', orgId)).data).toEqual([]);
    expect((await other.client.from('organizations').select('id')).data).toHaveLength(1);

    const ins = await s1.client.from('queue_entries').insert({
      queue_id: queueId, org_id: orgId, user_id: s1.id, seq: 1, joined_at: new Date().toISOString(),
    });
    expect(ins.error).not.toBeNull();
    const upd = await owner.client.from('queue_entries').update({ seq: 1 }).eq('queue_id', queueId).select();
    expect(upd.data ?? []).toEqual([]); // no UPDATE privilege: nothing changes
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc('my_queues')).error).not.toBeNull();
  });
});

describe('realtime', () => {
  it('members receive content-free change signals; other orgs cannot subscribe', async () => {
    const owner = await newUser('OwnerRT');
    const { orgId, queueId } = await orgWithQueue(owner, 'RT Hospital');
    const watcher = await newUser('Watcher');
    const joiner = await newUser('Joiner');
    const code = await invite(owner, orgId, queueId);
    await watcher.client.rpc('accept_invite', { p_token: code });
    await joiner.client.rpc('accept_invite', { p_token: code });
    const outsider = await newUser('Outsider');

    const received: unknown[] = [];
    await watcher.client.realtime.setAuth((await watcher.client.auth.getSession()).data.session!.access_token);
    const status = await new Promise<string>((resolve) => {
      watcher.client
        .channel(`queue:${queueId}`, { config: { private: true } })
        .on('broadcast', { event: 'queue_changed' }, (m) => received.push(m.payload))
        .subscribe((s) => (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' ? resolve(s) : undefined));
    });
    expect(status).toBe('SUBSCRIBED');

    await outsider.client.realtime.setAuth((await outsider.client.auth.getSession()).data.session!.access_token);
    const denied = await new Promise<string>((resolve) => {
      outsider.client
        .channel(`queue:${queueId}`, { config: { private: true } })
        .subscribe((s) => (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' ? resolve(s) : undefined));
    });
    expect(denied).toBe('CHANNEL_ERROR');

    expect((await joiner.client.rpc('join_queue', { p_queue: queueId })).error).toBeNull();
    const payload = (await waitFor(async () => received[0])) as Record<string, unknown>;
    // No names, no positions: only the queue id and a version counter (+ Realtime's message id).
    expect(Object.keys(payload).filter((k) => !['id', 'queue_id', 'version'].includes(k))).toEqual([]);
  });
});

describe('scheduler (pg_cron)', () => {
  it('times out an offer and moves it to the next person without any client involvement', async () => {
    const owner = await newUser('OwnerCron');
    const { orgId, queueId } = await orgWithQueue(owner, 'Cron Hospital');
    const first = await newUser('First');
    const second = await newUser('Second');
    const code = await invite(owner, orgId, queueId);
    for (const u of [first, second]) {
      await u.client.rpc('accept_invite', { p_token: code });
      await u.client.rpc('join_queue', { p_queue: queueId });
    }
    const start = new Date(Date.now() + 2 * 86_400_000);
    await owner.client.rpc('create_shifts', {
      p_queue: queueId,
      p_publish: true,
      p_shifts: [{ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 8 * 3_600_000).toISOString() }],
    });
    // Simulate the 30-minute window running out.
    await sql(`update public.offers set offered_at = now() - interval '30 minutes', expires_at = now()
               where queue_id = $1 and outcome is null`, [queueId]);
    const state = await waitFor(async () => {
      const { data } = await second.client.rpc('my_queues');
      return data?.[0].state === 'offered' ? 'offered' : undefined;
    }, 40_000);
    expect(state).toBe('offered');
    const { data: f } = await first.client.rpc('my_queues');
    expect(f?.[0]).toMatchObject({ state: 'waiting', queue_position: 1 }); // kept their place
  }, 60_000);
});

describe('edge functions', () => {
  it('send-notifications rejects calls without the cron secret', async () => {
    const r = await fetch(`${URL}/functions/v1/send-notifications`, { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    expect(r.status).toBe(401);
  });

  it('send-notifications drains the outbox (push skipped without devices, e-mail logged)', async () => {
    const owner = await newUser('OwnerN');
    const { orgId, queueId } = await orgWithQueue(owner, 'Notify Hospital');
    const s = await newUser('Notified');
    await s.client.rpc('accept_invite', { p_token: await invite(owner, orgId, queueId) });
    await s.client.rpc('join_queue', { p_queue: queueId });
    const start = new Date(Date.now() + 3 * 86_400_000);
    await owner.client.rpc('create_shifts', {
      p_queue: queueId,
      p_publish: true,
      p_shifts: [{ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 8 * 3_600_000).toISOString() }],
    });
    const r = await fetch(`${URL}/functions/v1/send-notifications`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FAIRSHIFT_CRON_SECRET ?? 'local-dev-cron-secret'}` },
    });
    expect(r.status).toBe(200);
    const rows = await waitFor(async () => {
      const x = await sql<{ channel: string; status: string }>(
        `select channel, status from public.notification_outbox where user_id = $1 and template = 'offer_received'`,
        [s.id],
      );
      return x.every((y) => y.status !== 'pending') && x.length === 2 ? x : undefined;
    });
    expect(rows.find((x) => x.channel === 'push')?.status).toBe('skipped');
    expect(rows.find((x) => x.channel === 'email')?.status).toBe('sent');
  });

  it('delete-account anonymizes the user, re-offers their shift and removes the auth user', async () => {
    const owner = await newUser('OwnerD');
    const { orgId, queueId } = await orgWithQueue(owner, 'Delete Hospital');
    const leaving = await newUser('Leaving');
    const next = await newUser('NextInLine');
    const code = await invite(owner, orgId, queueId);
    for (const u of [leaving, next]) {
      await u.client.rpc('accept_invite', { p_token: code });
      await u.client.rpc('join_queue', { p_queue: queueId });
    }
    const start = new Date(Date.now() + 5 * 86_400_000);
    await owner.client.rpc('create_shifts', {
      p_queue: queueId,
      p_publish: true,
      p_shifts: [{ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 8 * 3_600_000).toISOString() }],
    });
    const { data: q } = await leaving.client.rpc('my_queues');
    expect((await leaving.client.rpc('accept_offer', { p_offer: q![0].offer_id })).error).toBeNull();

    const { error } = await leaving.client.functions.invoke('delete-account', { method: 'POST' });
    expect(error).toBeNull();

    const [profile] = await sql(`select display_name, deleted_at from public.profiles where id = $1`, [leaving.id]);
    expect(profile.display_name).toBe('');
    expect(profile.deleted_at).not.toBeNull();
    expect(await sql(`select 1 from auth.users where id = $1`, [leaving.id])).toHaveLength(0);
    expect((await sql(`select 1 from public.audit_events where subject_id = $1`, [leaving.id])).length).toBeGreaterThan(0);
    const { data: nq } = await next.client.rpc('my_queues');
    expect(nq?.[0].state).toBe('offered'); // the shift was re-offered to the next person
  });
});
