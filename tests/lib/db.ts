// Direct-to-Postgres helpers for concurrency tests. Each "actor" call opens
// its own connection and transaction, exactly like separate API requests.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const pool = new pg.Pool({ connectionString: DB_URL, max: 70 });

export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

/** Run `text` as the given user (role authenticated + JWT claims), in its own transaction. */
export async function asUser<T = any>(userId: string, text: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    const r = await client.query(text, params);
    await client.query('commit');
    return r.rows as T[];
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Run as the scheduler (no JWT, as postgres), in its own transaction. */
export async function asSystem<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query(text, params);
    await client.query('commit');
    return r.rows as T[];
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await sql(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(),
       jsonb_build_object('display_name', $3::text), now(), now())`,
    [id, `${name.toLowerCase().replace(/\W+/g, '.')}.${id.slice(0, 8)}@test.local`, name],
  );
  return id;
}

export interface Fixture {
  orgId: string;
  queueId: string;
  adminId: string;
  admin2Id: string;
  staff: string[];
}

/** A fresh org with two admins and `n` staff, all eligible for one queue. */
export async function fixture(n: number, policy: Record<string, unknown> = {}): Promise<Fixture> {
  const adminId = await createUser('Admin');
  const admin2Id = await createUser('Admin Two');
  const [{ id: orgId }] = await asUser(adminId, `select public.create_organization('Test Hospital', 'Europe/Dublin') as id`);
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [orgId, admin2Id]);
  const [{ id: queueId }] = await asUser(adminId, `select public.create_queue($1, 'Q', '', $2::jsonb) as id`, [
    orgId,
    JSON.stringify(policy),
  ]);
  const staff: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = await createUser(`Staff ${i + 1}`);
    staff.push(u);
  }
  await sql(
    `insert into public.memberships (org_id, user_id, role) select $1, unnest($2::uuid[]), 'staff'`,
    [orgId, staff],
  );
  await sql(
    `insert into public.queue_members (queue_id, org_id, user_id) select $1, $2, unnest($3::uuid[])`,
    [queueId, orgId, staff],
  );
  return { orgId, queueId, adminId, admin2Id, staff };
}

export async function addQueue(f: Fixture, policy: Record<string, unknown> = {}): Promise<string> {
  const [{ id }] = await asUser(f.adminId, `select public.create_queue($1, 'Q2', '', $2::jsonb) as id`, [
    f.orgId,
    JSON.stringify(policy),
  ]);
  await sql(`insert into public.queue_members (queue_id, org_id, user_id) select $1, $2, unnest($3::uuid[])`, [
    id,
    f.orgId,
    f.staff,
  ]);
  return id;
}

export function shiftJson(startOffsetMinutes: number, durationMinutes = 720, unit = '') {
  const start = new Date(Date.now() + startOffsetMinutes * 60_000);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString(), unit };
}

export async function openOffers(queueId: string) {
  return sql<{ id: string; user_id: string; shift_id: string; starts_at: Date; queue_position: number }>(
    `select o.id, o.user_id, o.shift_id, s.starts_at, o.queue_position
     from public.offers o join public.shifts s on s.id = o.shift_id
     where o.queue_id = $1 and o.outcome is null order by s.starts_at`,
    [queueId],
  );
}

export async function orderOf(queueId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }>(
    `select user_id from public.queue_entries
     where queue_id = $1 and closed_at is null and status in ('waiting','paused') order by seq`,
    [queueId],
  );
  return rows.map((r) => r.user_id);
}

/** Global invariants that must hold at every moment. */
export async function assertInvariants(queueId: string) {
  const problems = await sql<{ problem: string }>(
    `select 'two open tickets for one person' as problem from public.queue_entries
       where queue_id = $1 and closed_at is null group by user_id having count(*) > 1
     union all
     select 'person holds two open offers in one queue' from public.offers
       where queue_id = $1 and outcome is null group by user_id having count(*) > 1
     union all
     select 'shift has two open offers' from public.offers
       where queue_id = $1 and outcome is null group by shift_id having count(*) > 1
     union all
     select 'shift has two active assignments' from public.assignments
       where queue_id = $1 and status = 'active' group by shift_id having count(*) > 1
     union all
     select 'open offer to a paused/held/closed ticket' from public.offers o
       join public.queue_entries e on e.id = o.entry_id
       where o.queue_id = $1 and o.outcome is null and (e.closed_at is not null or e.status <> 'waiting')
     union all
     select 'assigned shift without exactly one active assignment' from public.shifts s
       where s.queue_id = $1 and s.status = 'assigned'
         and (select count(*) from public.assignments a where a.shift_id = s.id and a.status = 'active') <> 1
     union all
     select 'active assignment without a held ticket' from public.assignments a
       left join public.queue_entries e on e.id = a.entry_id
       where a.queue_id = $1 and a.status = 'active'
         and (e.id is null or e.status <> 'held' or e.held_assignment_id <> a.id or e.closed_at is not null)
     union all
     select 'overlapping open offers/assignments for a person' from (
       select o.user_id, s.starts_at, s.ends_at, s.id from public.offers o join public.shifts s on s.id = o.shift_id
         where o.outcome is null
       union all
       select a.user_id, s.starts_at, s.ends_at, s.id from public.assignments a join public.shifts s on s.id = a.shift_id
         where a.status = 'active') x
       join (
       select o.user_id, s.starts_at, s.ends_at, s.id from public.offers o join public.shifts s on s.id = o.shift_id
         where o.outcome is null
       union all
       select a.user_id, s.starts_at, s.ends_at, s.id from public.assignments a join public.shifts s on s.id = a.shift_id
         where a.status = 'active') y
       on x.user_id = y.user_id and x.id < y.id and x.starts_at < y.ends_at and x.ends_at > y.starts_at`,
    [queueId],
  );
  return problems.map((p) => p.problem);
}
