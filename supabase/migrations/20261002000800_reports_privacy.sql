-- Fairness dashboard, audit log read/export, GDPR/LGPD (export + account deletion).
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Fairness dashboard
-- ---------------------------------------------------------------------------
create or replace function public.fairness_report(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_queue uuid default null
)
returns table (
  user_id uuid,
  display_name text,
  shifts_assigned int,
  shifts_completed int,
  no_shows int,
  withdrawals int,
  offers_declined int,
  offers_expired int,
  avg_wait_hours numeric,
  in_queue boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  with people as (
    select m.user_id from public.memberships m
    where m.org_id = p_org and m.status = 'active'
      and (p_queue is null or exists (select 1 from public.queue_members qm where qm.queue_id = p_queue and qm.user_id = m.user_id))
  ),
  a as (
    select a.user_id, a.status, a.assigned_at, e.joined_at
    from public.assignments a
    join public.queue_entries e on e.id = a.entry_id
    where a.org_id = p_org and (p_queue is null or a.queue_id = p_queue)
      and a.assigned_at >= p_from and a.assigned_at < p_to
  ),
  o as (
    select o.user_id, o.outcome from public.offers o
    where o.org_id = p_org and (p_queue is null or o.queue_id = p_queue)
      and o.offered_at >= p_from and o.offered_at < p_to
  )
  select p.user_id, pr.display_name,
    (select count(*)::int from a where a.user_id = p.user_id and a.status in ('active', 'completed', 'no_show')),
    (select count(*)::int from a where a.user_id = p.user_id and a.status = 'completed'),
    (select count(*)::int from a where a.user_id = p.user_id and a.status = 'no_show'),
    (select count(*)::int from a where a.user_id = p.user_id and a.status = 'withdrawn'),
    (select count(*)::int from o where o.user_id = p.user_id and o.outcome = 'declined'),
    (select count(*)::int from o where o.user_id = p.user_id and o.outcome = 'expired'),
    (select round(avg(extract(epoch from a.assigned_at - a.joined_at)) / 3600, 1) from a
      where a.user_id = p.user_id and a.status in ('active', 'completed', 'no_show')),
    exists (select 1 from public.queue_entries e where e.user_id = p.user_id and e.org_id = p_org
            and e.closed_at is null and (p_queue is null or e.queue_id = p_queue))
  from people p join public.profiles pr on pr.id = p.user_id
  order by 3 desc, lower(pr.display_name);
end;
$$;

create or replace function public.queue_stats(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  queue_id uuid, queue_name text, queue_size int, paused int,
  shifts_published int, shifts_filled int, shifts_unfilled int,
  avg_wait_hours numeric, avg_time_to_fill_minutes numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  select q.id, q.name,
    (select count(*)::int from public.queue_entries e where e.queue_id = q.id and e.closed_at is null and e.status in ('waiting', 'paused')),
    (select count(*)::int from public.queue_entries e where e.queue_id = q.id and e.closed_at is null and e.status = 'paused'),
    (select count(*)::int from public.shifts s where s.queue_id = q.id and s.published_at >= p_from and s.published_at < p_to),
    (select count(*)::int from public.shifts s where s.queue_id = q.id and s.published_at >= p_from and s.published_at < p_to
       and s.status in ('assigned', 'completed', 'no_show')),
    (select count(*)::int from public.shifts s where s.queue_id = q.id and s.published_at >= p_from and s.published_at < p_to
       and s.status = 'unfilled'),
    (select round(avg(extract(epoch from a.assigned_at - e.joined_at)) / 3600, 1)
       from public.assignments a join public.queue_entries e on e.id = a.entry_id
       where a.queue_id = q.id and a.assigned_at >= p_from and a.assigned_at < p_to),
    (select round(avg(extract(epoch from a.assigned_at - s.published_at)) / 60, 1)
       from public.assignments a join public.shifts s on s.id = a.shift_id
       where a.queue_id = q.id and a.assigned_at >= p_from and a.assigned_at < p_to)
  from public.queues q
  where q.org_id = p_org and q.archived_at is null
  order by q.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create or replace function public.admin_audit(
  p_org uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_types text[] default null,
  p_queue uuid default null,
  p_subject uuid default null,
  p_before_id bigint default null,
  p_limit int default 100
)
returns table (
  id bigint, created_at timestamptz, type text, queue_id uuid, queue_name text, shift_id uuid,
  actor_id uuid, actor_name text, subject_id uuid, subject_name text, reason text, payload jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  select ev.id, ev.created_at, ev.type, ev.queue_id, q.name, ev.shift_id,
         ev.actor_id, case when ev.actor_id is null then null when ap.deleted_at is not null then '' else ap.display_name end,
         ev.subject_id, case when sp.deleted_at is not null then '' else sp.display_name end,
         ev.reason, ev.payload
  from public.audit_events ev
  left join public.queues q on q.id = ev.queue_id
  left join public.profiles ap on ap.id = ev.actor_id
  left join public.profiles sp on sp.id = ev.subject_id
  where ev.org_id = p_org
    and (p_from is null or ev.created_at >= p_from)
    and (p_to is null or ev.created_at < p_to)
    and (p_types is null or ev.type = any (p_types) or split_part(ev.type, '.', 1) = any (p_types))
    and (p_queue is null or ev.queue_id = p_queue)
    and (p_subject is null or ev.subject_id = p_subject or ev.actor_id = p_subject)
    and (p_before_id is null or ev.id < p_before_id)
  order by ev.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

create or replace function private.csv_cell(p text)
returns text
language sql
immutable
as $$
  -- Quote, escape quotes, and neutralize spreadsheet formula injection.
  select '"' || replace(
    case when p ~ '^[=+\-@\t\r]' then '''' || p else coalesce(p, '') end,
    '"', '""') || '"';
$$;

create or replace function public.export_audit_csv(
  p_org uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_types text[] default null,
  p_queue uuid default null,
  p_subject uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out text;
begin
  perform private.assert_admin(p_org);
  select 'id,created_at_utc,type,queue,shift_id,actor,subject,reason,payload' || E'\n' ||
    coalesce(string_agg(
      concat_ws(',',
        r.id::text,
        private.csv_cell(to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        private.csv_cell(r.type),
        private.csv_cell(r.queue_name),
        private.csv_cell(r.shift_id::text),
        private.csv_cell(case when r.actor_id is null then 'system' when r.actor_name = '' then 'deleted user' else r.actor_name end),
        private.csv_cell(case when r.subject_id is null then '' when r.subject_name = '' then 'deleted user' else r.subject_name end),
        private.csv_cell(r.reason),
        private.csv_cell(r.payload::text)),
      E'\n' order by r.id), '')
  into v_out
  from public.admin_audit(p_org, p_from, p_to, p_types, p_queue, p_subject, null, 1000000) r;
  perform private.audit(p_org, 'audit.exported', p_payload => jsonb_build_object(
    'from', p_from, 'to', p_to, 'types', to_jsonb(p_types), 'queue_id', p_queue));
  return v_out;
end;
$$;
-- export_audit_csv writes an audit event, so it cannot be STABLE.
alter function public.export_audit_csv(uuid, timestamptz, timestamptz, text[], uuid, uuid) volatile;

-- ---------------------------------------------------------------------------
-- GDPR / LGPD
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.memberships m where m.user_id = auth.uid()),
    'queue_entries', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.queue_entries e where e.user_id = auth.uid()),
    'offers', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.offers o where o.user_id = auth.uid()),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.assignments a where a.user_id = auth.uid()),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]') from public.notifications n where n.user_id = auth.uid()),
    'notification_prefs', (select coalesce(jsonb_agg(to_jsonb(n)), '[]') from public.notification_prefs n where n.user_id = auth.uid()),
    'exported_at', now());
$$;

-- Anonymizes the caller. Audit rows are NOT modified (append-only): they only
-- reference the user id, whose profile becomes an anonymous tombstone. The
-- delete-account Edge Function then removes the auth user (e-mail, password).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_queues uuid[];
  v_qid uuid;
  v_queue public.queues;
  a public.assignments;
  s public.shifts;
  v_entry public.queue_entries;
  v_email text;
  r record;
begin
  if exists (
    select 1 from public.memberships m
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active'
      and not exists (select 1 from public.memberships o where o.org_id = m.org_id and o.user_id <> v_uid
                      and o.role = 'owner' and o.status = 'active')
      and exists (select 1 from public.memberships o where o.org_id = m.org_id and o.user_id <> v_uid and o.status = 'active')
  ) then
    perform private.fail('account.sole_owner');
  end if;

  select coalesce(array_agg(distinct queue_id order by queue_id), '{}') into v_queues from (
    select queue_id from public.queue_entries where user_id = v_uid and closed_at is null
    union select queue_id from public.offers where user_id = v_uid and outcome is null
    union select queue_id from public.assignments where user_id = v_uid and status = 'active'
  ) x;
  foreach v_qid in array v_queues loop
    perform private.lock_queue(v_qid);
  end loop;
  perform private.lock_user(v_uid);

  -- From here on no notifications are generated for this user.
  update public.profiles set deleted_at = now() where id = v_uid;

  for a in select * from public.assignments where user_id = v_uid and status = 'active' loop
    select * into s from public.shifts where id = a.shift_id;
    select * into v_queue from public.queues where id = a.queue_id;
    if s.starts_at > now() then
      perform private.withdraw_locked(a, v_queue, 'account_deleted');
    else
      -- Shift already in progress: it happened, record it as completed.
      update public.assignments set status = 'completed', ended_at = clock_timestamp() where id = a.id;
      update public.shifts set status = 'completed', ended_at = clock_timestamp() where id = s.id;
      perform private.close_entry(a.entry_id, 'account_deleted');
      perform private.audit(s.org_id, 'shift.completed', p_queue => s.queue_id, p_shift => s.id,
        p_subject => v_uid, p_payload => jsonb_build_object('assignment_id', a.id, 'reason', 'account_deleted'));
    end if;
  end loop;

  foreach v_qid in array v_queues loop
    perform private.resolve_open_offer(v_qid, v_uid, 'revoked', 'account_deleted');
    v_entry := private.open_entry(v_qid, v_uid);
    if v_entry.id is not null then
      perform private.close_entry(v_entry.id, 'account_deleted');
    end if;
  end loop;

  for r in select org_id from public.memberships where user_id = v_uid loop
    perform private.audit(r.org_id, 'account.deleted', p_subject => v_uid);
  end loop;

  select lower(email) into v_email from auth.users where id = v_uid;
  delete from public.invites where kind = 'email' and email = v_email;
  delete from public.queue_members where user_id = v_uid;
  delete from public.member_queue_prefs where user_id = v_uid;
  delete from public.notification_tokens where user_id = v_uid;
  delete from public.notification_prefs where user_id = v_uid;
  delete from public.notification_outbox where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.memberships where user_id = v_uid;
  update public.profiles set display_name = '', locale = 'en' where id = v_uid;

  foreach v_qid in array v_queues loop
    perform private.dispatch(v_qid);
    perform private.after_change(v_qid);
  end loop;
end;
$$;
