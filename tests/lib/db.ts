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


export type Profession = 'doctor' | 'nurse';

/** A user created directly in auth.users. `meta` may carry hospital_code + profession (sign-up trigger). */
export async function createUser(name: string, meta: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await sql(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(),
       jsonb_build_object('display_name', $3::text) || $4::jsonb, now(), now())`,
    [id, `${name.toLowerCase().replace(/\W+/g, '.')}.${id.slice(0, 8)}@test.local`, name, JSON.stringify(meta)],
  );
  return id;
}

export interface Fixture {
  orgId: string;
  code: string;
  doctorsQueue: string;
  nursesQueue: string;
  adminId: string;
  admin2Id: string;
  doctors: string[];
  nurses: string[];
}

/** A fresh hospital with two managers, `doctors` doctors and `nurses` nurses (nobody in a queue). */
export async function fixture(doctors: number, nurses = 0): Promise<Fixture> {
  const [{ org_id: orgId, join_code: code }] = await sql<{ org_id: string; join_code: string }>(
    `select * from private.provision_hospital('Test Hospital', 'Europe/Dublin')`,
  );
  const [{ d, n }] = await sql<{ d: string; n: string }>(
    `select private.profession_queue($1, 'doctor') d, private.profession_queue($1, 'nurse') n`,
    [orgId],
  );
  const adminId = await createUser('Manager');
  const admin2Id = await createUser('Manager Two');
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'admin')`, [
    orgId,
    adminId,
    admin2Id,
  ]);
  const make = async (count: number, profession: Profession) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(await createUser(`${profession} ${i + 1}`));
    if (ids.length) {
      await sql(
        `insert into public.memberships (org_id, user_id, role, profession) select $1, unnest($2::uuid[]), 'staff', $3::public.profession`,
        [orgId, ids, profession],
      );
    }
    return ids;
  };
  return {
    orgId,
    code,
    doctorsQueue: d,
    nursesQueue: n,
    adminId,
    admin2Id,
    doctors: await make(doctors, 'doctor'),
    nurses: await make(nurses, 'nurse'),
  };
}

export async function joinAll(queueId: string, users: string[]) {
  for (const u of users) await asUser(u, 'select public.join_queue($1)', [queueId]);
}

export function shiftJson(startOffsetMinutes: number, slots = 1, durationMinutes = 720, unit = '') {
  const start = new Date(Date.now() + startOffsetMinutes * 60_000);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString(), unit, slots };
}

/** Active assignments of a queue: shift start order, then position. */
export async function activeAssignments(queueId: string) {
  return sql<{ shift_id: string; user_id: string; starts_at: Date; queue_position: number; slots: number }>(
    `select a.shift_id, a.user_id, s.starts_at, a.queue_position, s.slots
     from public.assignments a join public.shifts s on s.id = a.shift_id
     where a.queue_id = $1 and a.status = 'active' order by s.starts_at, s.created_at, s.id, a.assigned_at`,
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

/** Invariants that must hold at every moment (after the scheduler has had its sweep). */
export async function assertInvariants(queueId: string) {
  const problems = await sql<{ problem: string }>(
    `select 'two open tickets for one person' as problem from public.queue_entries
       where queue_id = $1 and closed_at is null group by user_id having count(*) > 1
     union all
     select 'person assigned twice to one shift' from public.assignments
       where queue_id = $1 and status = 'active' group by shift_id, user_id having count(*) > 1
     union all
     select 'more active assignments than slots' from public.shifts s
       where s.queue_id = $1 and (select count(*) from public.assignments a where a.shift_id = s.id and a.status = 'active') > s.slots
     union all
     select 'filled shift with a free slot' from public.shifts s
       where s.queue_id = $1 and s.status = 'filled'
         and (select count(*) from public.assignments a where a.shift_id = s.id and a.status = 'active') < s.slots
     union all
     select 'active assignment without a held ticket' from public.assignments a
       left join public.queue_entries e on e.id = a.entry_id
       where a.queue_id = $1 and a.status = 'active'
         and (e.id is null or e.status <> 'held' or e.held_assignment_id <> a.id or e.closed_at is not null)
     union all
     select 'held ticket without an active assignment' from public.queue_entries e
       left join public.assignments a on a.id = e.held_assignment_id
       where e.queue_id = $1 and e.closed_at is null and e.status = 'held' and (a.id is null or a.status <> 'active')
     union all
     select 'a person holds two active shifts in one queue' from public.assignments
       where queue_id = $1 and status = 'active' group by user_id having count(*) > 1
     union all
     select 'someone was skipped: open shift with a free slot and an eligible waiting person' from public.shifts s
       join public.queues q on q.id = s.queue_id
       where s.queue_id = $1 and s.status = 'open' and s.starts_at > now()
         and (select count(*) from public.assignments a where a.shift_id = s.id and a.status = 'active') < s.slots
         and exists (
           select 1 from public.queue_entries e
           join public.memberships m on m.org_id = e.org_id and m.user_id = e.user_id and m.status = 'active'
             and m.profession = q.profession
           where e.queue_id = $1 and e.closed_at is null and e.status = 'waiting'
             and not exists (select 1 from public.assignments x where x.shift_id = s.id and x.user_id = e.user_id)
             and not private.has_overlapping_assignment(e.user_id, s.starts_at, s.ends_at, s.id))
     union all
     select 'overlapping active assignments for a person' from public.assignments a
       join public.shifts s on s.id = a.shift_id
       join public.assignments b on b.user_id = a.user_id and b.status = 'active' and b.id <> a.id
       join public.shifts t on t.id = b.shift_id
       where a.queue_id = $1 and a.status = 'active' and s.starts_at < t.ends_at and s.ends_at > t.starts_at`,
    [queueId],
  );
  return problems.map((p) => p.problem);
}
