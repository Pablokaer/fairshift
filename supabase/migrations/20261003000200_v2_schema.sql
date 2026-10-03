-- FairShift v2 schema.
--   * Each hospital (organization) has ONE permanent hospital code and exactly
--     TWO permanent queues: doctors and nurses. A member's profession decides
--     which queue they can join (no manager-created queues, no pools).
--   * Publishing a shift with N slots assigns it at once to the first N
--     eligible people of that profession's queue (no offers, no acceptance).
--   * E-mail invites and per-invite codes are replaced by the hospital code.
--
-- Existing data (decision i): legacy queues are archived and their open
-- tickets closed (audited), unfinished legacy shifts are cancelled (or
-- completed if they already ended), staff keep their membership without a
-- profession until a manager sets it.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Functions that are removed, or whose signature/return type changes.
-- ---------------------------------------------------------------------------
drop function if exists public.create_organization(text, text);
drop function if exists public.update_organization(uuid, text, text, boolean);
drop function if exists public.create_invite(uuid, public.invite_kind, text, public.member_role, uuid[], interval, int);
drop function if exists public.revoke_invite(uuid);
drop function if exists public.get_invite_preview(text);
drop function if exists public.accept_invite(text);
drop function if exists private.find_invite(text);
drop function if exists public.create_queue(uuid, text, text, jsonb);
drop function if exists public.update_queue(uuid, text, text, jsonb);
drop function if exists public.archive_queue(uuid, text);
drop function if exists public.add_queue_members(uuid, uuid[]);
drop function if exists public.remove_queue_member(uuid, uuid, text);
drop function if exists public.admin_remove_entry(uuid, uuid, text, boolean);
drop function if exists public.allow_rejoin(uuid, uuid, text);
drop function if exists public.my_queues(uuid);
drop function if exists public.queue_roster(uuid);
drop function if exists public.admin_members(uuid);
drop function if exists public.accept_offer(uuid);
drop function if exists public.decline_offer(uuid);
drop function if exists public.withdraw_assignment(uuid, text);
drop function if exists public.get_offer(uuid);
drop function if exists public.my_shifts(text, uuid);
drop function if exists public.admin_shifts(uuid, timestamptz, timestamptz, uuid);
drop function if exists public.shift_offer_history(uuid);
drop function if exists public.reoffer_shift(uuid);
drop function if exists public.mark_no_show(uuid, text);
drop function if exists public.create_shifts(uuid, jsonb, boolean);
drop function if exists public.fairness_report(uuid, timestamptz, timestamptz, uuid);
drop function if exists public.queue_stats(uuid, timestamptz, timestamptz);
drop function if exists public.admin_audit(uuid, timestamptz, timestamptz, text[], uuid, uuid, bigint, int);
drop function if exists public.export_audit_csv(uuid, timestamptz, timestamptz, text[], uuid, uuid);
drop function if exists private.apply_queue_policy(public.queues, jsonb);
drop function if exists private.queue_policy_json(public.queues);
drop function if exists private.move_to_end(public.queue_entries, text);
drop function if exists private.draw_lottery(uuid);
drop function if exists private.dispatch(uuid);
drop function if exists private.expire_offer(uuid);
drop function if exists private.already_tried(public.shifts, uuid);
drop function if exists private.has_overlapping_offer(uuid, timestamptz, timestamptz, uuid);
drop function if exists private.resolve_open_offer(uuid, uuid, public.offer_outcome, text);
drop function if exists private.upsert_prefs(uuid, uuid, timestamptz, boolean);
drop function if exists private.withdraw_locked(public.assignments, public.queues, text);
drop function if exists private.insert_entry(public.queues, uuid, public.entry_status, int);

-- ---------------------------------------------------------------------------
-- 2. Legacy data: finish or cancel assignments, close tickets, archive queues.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select a.id, a.org_id, a.queue_id, a.shift_id, a.user_id, s.ends_at <= now() as ended
    from public.assignments a join public.shifts s on s.id = a.shift_id
    where a.status = 'active'
  loop
    update public.assignments
    set status = (case when r.ended then 'completed' else 'cancelled' end)::public.assignment_status,
        ended_at = clock_timestamp(),
        reason = case when r.ended then reason else 'v2_migration' end
    where id = r.id;
    perform private.audit(r.org_id, case when r.ended then 'shift.completed' else 'shift.cancelled' end,
      r.queue_id, r.shift_id, r.user_id, 'v2_migration', jsonb_build_object('assignment_id', r.id));
  end loop;

  for r in select id, org_id, queue_id, user_id, seq from public.queue_entries where closed_at is null loop
    update public.queue_entries
    set closed_at = clock_timestamp(), close_reason = 'queue_archived',
        status = case when status = 'held' then 'waiting'::public.entry_status else status end,
        held_assignment_id = null
    where id = r.id;
    perform private.audit(r.org_id, 'entry.removed', r.queue_id, null, r.user_id, 'v2_migration',
      jsonb_build_object('entry_id', r.id, 'seq', r.seq));
  end loop;

  for r in select id, org_id from public.queues where archived_at is null loop
    update public.queues set archived_at = now() where id = r.id;
    perform private.audit(r.org_id, 'queue.archived', r.id, null, null, 'v2_migration');
  end loop;

  update public.shifts
  set cancelled_reason = coalesce(cancelled_reason, 'v2_migration'), ended_at = coalesce(ended_at, now())
  where status not in ('completed', 'no_show', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Offers, invites and pools are gone.
-- ---------------------------------------------------------------------------
alter table public.assignments drop column offer_id;
drop table public.offers;
drop table public.invites;
drop table public.queue_members;
drop type public.offer_outcome;
drop type public.invite_kind;

-- ---------------------------------------------------------------------------
-- 4. Organizations: one permanent hospital code. Staff never see names.
-- ---------------------------------------------------------------------------
-- 8 characters from an alphabet without look-alikes (no 0/O, 1/I).
create or replace function private.new_join_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v text;
begin
  loop
    v := private.random_code(8);
    exit when not exists (select 1 from public.organizations where join_code = v);
  end loop;
  return v;
end;
$$;

-- Codes are compared case-insensitively and ignoring spaces/dashes.
create or replace function private.normalize_code(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

alter table public.organizations add column join_code text;
alter table public.organizations add column join_code_rotated_at timestamptz;
do $$
declare
  r record;
begin
  for r in select id from public.organizations where join_code is null loop
    update public.organizations set join_code = private.new_join_code() where id = r.id;
  end loop;
end;
$$;
alter table public.organizations alter column join_code set not null;
alter table public.organizations alter column join_code set default private.new_join_code();
alter table public.organizations add constraint organizations_join_code_key unique (join_code);
alter table public.organizations add constraint organizations_join_code_format
  check (join_code ~ '^[A-Z0-9]{6,12}$');

-- Managers (owner/admin) see the names of their hospital's people; staff only see themselves.
create or replace function private.can_see_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = auth.uid() or exists (
    select 1
    from public.memberships viewer
    join public.memberships target on target.org_id = viewer.org_id
    where viewer.user_id = auth.uid()
      and viewer.status = 'active'
      and viewer.role in ('owner', 'admin')
      and target.user_id = p_user
  );
$$;
alter table public.organizations drop column staff_can_see_names;

-- The code is only readable through admin_hospital_code(): column-level grants.
revoke select on public.organizations from authenticated;
grant select (id, name, timezone, created_by, created_at) on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Memberships: exactly one profession per professional.
--    Nullable only for managers without a clinical role and legacy members.
-- ---------------------------------------------------------------------------
alter table public.memberships add column profession public.profession;
create index memberships_org_profession_idx on public.memberships (org_id, profession) where status = 'active';

-- ---------------------------------------------------------------------------
-- 6. Queues: two permanent queues per hospital, no per-queue policies.
-- ---------------------------------------------------------------------------
alter table public.queues
  drop column acceptance_window,
  drop column decline_policy,
  drop column timeout_policy,
  drop column pausing_allowed,
  drop column withdraw_cooldown,
  drop column no_show_policy,
  drop column no_show_cooldown,
  drop column auto_pause_after_timeouts,
  drop column reoffer_after_withdraw,
  drop column lottery_ends_at,
  drop column lottery_drawn_at,
  add column profession public.profession;
alter table public.queues add constraint queues_active_has_profession
  check (archived_at is not null or profession is not null);
create unique index queues_one_per_profession on public.queues (org_id, profession) where archived_at is null;
drop type public.position_policy;
drop type public.no_show_policy;
drop type public.reoffer_policy;

alter table public.queue_entries drop column consecutive_timeouts;
alter table public.member_queue_prefs drop column cooldown_until, drop column rejoin_requires_approval;

create or replace function private.create_profession_queues(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  p public.profession;
begin
  foreach p in array array['doctor', 'nurse']::public.profession[] loop
    if not exists (select 1 from public.queues where org_id = p_org and profession = p and archived_at is null) then
      insert into public.queues (org_id, name, profession)
      values (p_org, case p when 'doctor' then 'Doctors' else 'Nurses' end, p)
      returning id into v;
      perform private.audit(p_org, 'queue.created', p_queue => v, p_payload => jsonb_build_object('profession', p));
    end if;
  end loop;
end;
$$;

create or replace function private.organizations_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_profession_queues(new.id);
  return new;
end;
$$;

create trigger organizations_create_queues
  after insert on public.organizations
  for each row execute function private.organizations_after_insert();

do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform private.create_profession_queues(r.id);
  end loop;
end;
$$;

-- The profession queues are permanent: they cannot be deleted, archived or
-- switched to another profession (only removed together with their hospital).
create or replace function private.queues_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.profession is not null and old.archived_at is null
       and exists (select 1 from public.organizations where id = old.org_id) then
      raise exception 'queue.permanent' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.profession is not null and (new.profession is distinct from old.profession or new.archived_at is not null) then
    raise exception 'queue.permanent' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger queues_permanent
  before update or delete on public.queues
  for each row execute function private.queues_guard();

-- Eligibility = active member whose profession is the queue's profession.
create or replace function private.is_eligible(p_queue uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.queues q
    join public.memberships m on m.org_id = q.org_id and m.user_id = p_user
      and m.status = 'active' and m.profession = q.profession
    where q.id = p_queue and q.archived_at is null
  );
$$;

create or replace function private.is_queue_member(p_queue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_eligible(p_queue, auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 7. Shifts: profession queue + number of slots. New status set.
--    draft -> open (free slots) -> filled (all slots taken) -> completed
--                                                            \-> cancelled
-- ---------------------------------------------------------------------------
alter type public.shift_status rename to shift_status_v1;
create type public.shift_status as enum ('draft', 'open', 'filled', 'completed', 'cancelled');
alter table public.shifts alter column status drop default;
alter table public.shifts alter column status type public.shift_status
  using (case when status::text in ('completed', 'no_show') then 'completed'
              when status::text = 'draft' then 'draft'
              else 'cancelled' end)::public.shift_status;
alter table public.shifts alter column status set default 'draft';
drop type public.shift_status_v1;

alter table public.shifts
  drop column offer_round,
  drop column unfilled_notified_at,
  add column slots int not null default 1,
  add column start_processed_at timestamptz;
alter table public.shifts add constraint shifts_slots_range check (slots between 1 and 50);

-- ---------------------------------------------------------------------------
-- 8. Assignments: N per shift, one per person per shift.
-- ---------------------------------------------------------------------------
drop index if exists public.assignments_one_active_per_shift;
alter table public.assignments add column queue_position int;
create unique index assignments_one_active_per_person on public.assignments (shift_id, user_id) where status = 'active';
create index assignments_shift_idx on public.assignments (shift_id, status);
