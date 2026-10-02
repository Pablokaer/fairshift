-- Shifts, offers, assignments and the dispatcher.
set check_function_bodies = off;

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  queue_id uuid not null references public.queues (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unit text not null default '' check (char_length(unit) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  status public.shift_status not null default 'draft',
  -- An offer "round". People who declined/timed out in the current round are not
  -- asked again. A withdrawal with policy "restart" starts a new round.
  offer_round int not null default 1,
  batch_id uuid,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unfilled_notified_at timestamptz,
  ended_at timestamptz,
  cancelled_reason text,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '48 hours')
);
create index shifts_queue_status_idx on public.shifts (queue_id, status, starts_at);
create index shifts_org_starts_idx on public.shifts (org_id, starts_at);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  queue_id uuid not null references public.queues (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  entry_id uuid not null references public.queue_entries (id),
  round int not null,
  queue_position int,                 -- position of the person when the offer was made
  offered_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  reminder_sent_at timestamptz,
  outcome public.offer_outcome,
  outcome_reason text,
  responded_at timestamptz,
  check ((outcome is null) = (responded_at is null))
);
-- One open offer per shift; one open offer per person per queue (rule 6).
create unique index offers_one_open_per_shift on public.offers (shift_id) where outcome is null;
create unique index offers_one_open_per_user_queue on public.offers (queue_id, user_id) where outcome is null;
create index offers_open_expiry_idx on public.offers (expires_at) where outcome is null;
create index offers_shift_user_idx on public.offers (shift_id, user_id);
create index offers_user_open_idx on public.offers (user_id) where outcome is null;

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  queue_id uuid not null references public.queues (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  offer_id uuid not null references public.offers (id),
  entry_id uuid not null references public.queue_entries (id),
  status public.assignment_status not null default 'active',
  assigned_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id),
  reason text
);
create unique index assignments_one_active_per_shift on public.assignments (shift_id) where status = 'active';
create index assignments_user_idx on public.assignments (user_id, status);
create index assignments_queue_idx on public.assignments (queue_id, assigned_at);

alter table public.queue_entries
  add constraint queue_entries_held_assignment_fk
  foreign key (held_assignment_id) references public.assignments (id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create or replace function private.can_see_shift(p_shift uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.offers where shift_id = p_shift and user_id = auth.uid())
      or exists (select 1 from public.assignments where shift_id = p_shift and user_id = auth.uid());
$$;
grant execute on function private.can_see_shift(uuid) to authenticated, service_role;

alter table public.shifts enable row level security;
alter table public.offers enable row level security;
alter table public.assignments enable row level security;

create policy shifts_select on public.shifts for select to authenticated
  using (private.is_admin(org_id) or private.can_see_shift(id));
create policy offers_select on public.offers for select to authenticated
  using (user_id = auth.uid() or private.is_admin(org_id));
create policy assignments_select on public.assignments for select to authenticated
  using (user_id = auth.uid() or private.is_admin(org_id));

revoke all on public.shifts, public.offers, public.assignments from anon;
revoke insert, update, delete, truncate on public.shifts, public.offers, public.assignments from authenticated;
grant select on public.shifts, public.offers, public.assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.has_overlapping_assignment(
  p_user uuid, p_starts timestamptz, p_ends timestamptz, p_exclude_shift uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a join public.shifts s on s.id = a.shift_id
    where a.user_id = p_user and a.status = 'active' and s.id <> p_exclude_shift
      and s.starts_at < p_ends and s.ends_at > p_starts
  );
$$;

create or replace function private.has_overlapping_offer(
  p_user uuid, p_starts timestamptz, p_ends timestamptz, p_exclude_shift uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.offers o join public.shifts s on s.id = o.shift_id
    where o.user_id = p_user and o.outcome is null and s.id <> p_exclude_shift
      and s.starts_at < p_ends and s.ends_at > p_starts
  );
$$;

-- Has p_user already been asked for this shift (in the current round), or
-- did they take it before (and withdraw)?
create or replace function private.already_tried(p_shift public.shifts, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.offers o
    where o.shift_id = p_shift.id and o.user_id = p_user
      and ((o.round = p_shift.offer_round and o.outcome in ('declined', 'expired'))
           or o.outcome = 'accepted')
  );
$$;

create or replace function private.shift_payload(p_shift public.shifts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shift_id', p_shift.id, 'queue_id', p_shift.queue_id,
    'queue_name', (select name from public.queues where id = p_shift.queue_id),
    'org_timezone', (select timezone from public.organizations where id = p_shift.org_id),
    'starts_at', p_shift.starts_at, 'ends_at', p_shift.ends_at, 'unit', p_shift.unit);
$$;

-- Close a person's open offer in a queue (if any). Returns true if one existed.
-- Caller holds the queue lock. The dispatcher re-offers the shift afterwards.
create or replace function private.resolve_open_offer(
  p_queue uuid, p_user uuid, p_outcome public.offer_outcome, p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  s public.shifts;
begin
  update public.offers
  set outcome = p_outcome, outcome_reason = p_reason, responded_at = clock_timestamp()
  where queue_id = p_queue and user_id = p_user and outcome is null
  returning * into o;
  if o.id is null then
    return false;
  end if;
  update public.shifts set status = 'published' where id = o.shift_id and status = 'offered'
  returning * into s;
  perform private.audit(o.org_id, 'offer.' || p_outcome::text, p_queue => p_queue, p_shift => o.shift_id,
    p_subject => p_user, p_reason => p_reason, p_payload => jsonb_build_object('offer_id', o.id));
  if p_outcome = 'revoked' then
    select * into s from public.shifts where id = o.shift_id;
    perform private.notify(p_user, o.org_id, 'offer_revoked',
      private.shift_payload(s) || jsonb_build_object('offer_id', o.id, 'reason', p_reason));
  end if;
  return true;
end;
$$;

create or replace function private.upsert_prefs(
  p_queue uuid, p_user uuid,
  p_cooldown_until timestamptz default null,
  p_requires_approval boolean default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.member_queue_prefs (queue_id, user_id, cooldown_until, rejoin_requires_approval)
  values (p_queue, p_user, p_cooldown_until, coalesce(p_requires_approval, false))
  on conflict (queue_id, user_id) do update set
    cooldown_until = case
      when excluded.cooldown_until is null then public.member_queue_prefs.cooldown_until
      else greatest(coalesce(public.member_queue_prefs.cooldown_until, excluded.cooldown_until), excluded.cooldown_until)
    end,
    rejoin_requires_approval = coalesce(p_requires_approval, public.member_queue_prefs.rejoin_requires_approval);
$$;

-- ---------------------------------------------------------------------------
-- THE DISPATCHER. Caller must hold the queue lock.
--
-- For every open shift of the queue that has no open offer, in shift-start
-- order, offer it to the FIRST ticket (lowest seq) that is:
--   waiting (not paused/held), an active member, without an open offer in this
--   queue, not already tried for this shift in this round, and without an
--   overlapping assignment or open offer elsewhere.
-- If that person's user lock is momentarily held by another transaction we do
-- NOT skip to the next person (that would be unfair): the shift waits for the
-- next scheduler sweep (<= 15 s).
-- ---------------------------------------------------------------------------
create or replace function private.dispatch(p_queue uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes int := 0;
  v_queue public.queues;
  s public.shifts;
  c record;
  v_offer public.offers;
  v_offered boolean;
  v_blocked boolean;
  v_now timestamptz;
begin
  select * into v_queue from public.queues where id = p_queue;
  if v_queue.id is null or v_queue.archived_at is not null then
    return 0;
  end if;

  if v_queue.lottery_ends_at is not null and v_queue.lottery_drawn_at is null then
    if clock_timestamp() < v_queue.lottery_ends_at then
      return 0; -- no offers until the opening order is drawn
    end if;
    perform private.draw_lottery(p_queue);
    v_changes := v_changes + 1;
  end if;

  for s in
    select sh.* from public.shifts sh
    where sh.queue_id = p_queue
      and sh.status in ('published', 'offered', 'unfilled')
      and sh.starts_at > clock_timestamp()
      and not exists (select 1 from public.offers o where o.shift_id = sh.id and o.outcome is null)
    order by sh.starts_at, sh.created_at, sh.id
  loop
    v_offered := false;
    v_blocked := false;

    for c in
      select e.id as entry_id, e.user_id, e.seq
      from public.queue_entries e
      join public.memberships m on m.org_id = e.org_id and m.user_id = e.user_id and m.status = 'active'
      where e.queue_id = p_queue and e.closed_at is null and e.status = 'waiting'
        and not exists (select 1 from public.offers o
                        where o.queue_id = p_queue and o.user_id = e.user_id and o.outcome is null)
        and not private.already_tried(s, e.user_id)
        and not private.has_overlapping_assignment(e.user_id, s.starts_at, s.ends_at, s.id)
        and not private.has_overlapping_offer(e.user_id, s.starts_at, s.ends_at, s.id)
      order by e.seq
    loop
      if not pg_try_advisory_xact_lock(private.user_lock_key(c.user_id)) then
        v_blocked := true;
        exit;
      end if;
      -- Re-check under the user lock (another queue may just have committed).
      if private.has_overlapping_assignment(c.user_id, s.starts_at, s.ends_at, s.id)
         or private.has_overlapping_offer(c.user_id, s.starts_at, s.ends_at, s.id) then
        continue;
      end if;

      v_now := clock_timestamp();
      insert into public.offers (shift_id, queue_id, org_id, user_id, entry_id, round, queue_position,
                                 offered_at, expires_at)
      values (s.id, p_queue, s.org_id, c.user_id, c.entry_id, s.offer_round,
              (select count(*)::int from public.queue_entries x
                where x.queue_id = p_queue and x.closed_at is null and x.status in ('waiting', 'paused')
                  and x.seq <= c.seq),
              v_now, least(v_now + v_queue.acceptance_window, s.starts_at))
      returning * into v_offer;
      update public.shifts set status = 'offered' where id = s.id;
      if s.status = 'unfilled' then
        perform private.audit(s.org_id, 'shift.reopened', p_queue => p_queue, p_shift => s.id);
      end if;
      perform private.audit(s.org_id, 'offer.created', p_queue => p_queue, p_shift => s.id, p_subject => c.user_id,
        p_payload => jsonb_build_object('offer_id', v_offer.id, 'entry_id', c.entry_id, 'seq', c.seq,
          'position', v_offer.queue_position, 'round', s.offer_round, 'expires_at', v_offer.expires_at));
      perform private.notify(c.user_id, s.org_id, 'offer_received',
        private.shift_payload(s) || jsonb_build_object('offer_id', v_offer.id, 'expires_at', v_offer.expires_at),
        'offer:' || v_offer.id::text);
      v_offered := true;
      v_changes := v_changes + 1;
      exit;
    end loop;

    if v_offered or v_blocked then
      continue;
    end if;

    -- Nobody free right now. Is anyone still *potentially* able to take it
    -- (busy with another offer)? Then wait; otherwise the shift is unfilled.
    if exists (
      select 1 from public.queue_entries e
      join public.memberships m on m.org_id = e.org_id and m.user_id = e.user_id and m.status = 'active'
      where e.queue_id = p_queue and e.closed_at is null and e.status = 'waiting'
        and not private.already_tried(s, e.user_id)
        and not private.has_overlapping_assignment(e.user_id, s.starts_at, s.ends_at, s.id)
    ) then
      if s.status <> 'published' then
        update public.shifts set status = 'published' where id = s.id;
        if s.status = 'unfilled' then
          perform private.audit(s.org_id, 'shift.reopened', p_queue => p_queue, p_shift => s.id);
        end if;
        v_changes := v_changes + 1;
      end if;
    else
      if s.status <> 'unfilled' then
        update public.shifts set status = 'unfilled' where id = s.id;
        v_changes := v_changes + 1;
      end if;
      if s.unfilled_notified_at is null then
        update public.shifts set unfilled_notified_at = now() where id = s.id;
        perform private.audit(s.org_id, 'shift.unfilled', p_queue => p_queue, p_shift => s.id,
          p_payload => jsonb_build_object('round', s.offer_round));
        perform private.notify_admins(s.org_id, 'shift_unfilled', private.shift_payload(s),
          'unfilled:' || s.id::text || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text);
      end if;
    end if;
  end loop;
  return v_changes;
end;
$$;

-- Timeout of one offer. Caller holds the queue lock. Idempotent.
create or replace function private.expire_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  v_queue public.queues;
  v_entry public.queue_entries;
  s public.shifts;
begin
  update public.offers
  set outcome = 'expired', responded_at = clock_timestamp()
  where id = p_offer and outcome is null and expires_at <= clock_timestamp()
  returning * into o;
  if o.id is null then
    return;
  end if;
  select * into v_queue from public.queues where id = o.queue_id;
  update public.shifts set status = 'published' where id = o.shift_id and status = 'offered';
  select * into s from public.shifts where id = o.shift_id;
  perform private.audit(o.org_id, 'offer.expired', p_queue => o.queue_id, p_shift => o.shift_id,
    p_subject => o.user_id, p_payload => jsonb_build_object('offer_id', o.id));
  perform private.notify(o.user_id, o.org_id, 'offer_expired',
    private.shift_payload(s) || jsonb_build_object('offer_id', o.id), 'offer_expired:' || o.id::text);

  v_entry := private.open_entry(o.queue_id, o.user_id);
  if v_entry.id is null or v_entry.status <> 'waiting' then
    return;
  end if;
  -- The window was cut short because the shift starts soon: not a fair chance
  -- to respond, so no timeout consequences (they keep their place).
  if o.expires_at - o.offered_at < v_queue.acceptance_window - interval '1 second' then
    return;
  end if;
  update public.queue_entries set consecutive_timeouts = consecutive_timeouts + 1
  where id = v_entry.id returning * into v_entry;

  if v_queue.timeout_policy = 'move_to_end' then
    v_entry := private.move_to_end(v_entry, 'timeout');
  end if;

  if v_queue.auto_pause_after_timeouts is not null and v_queue.pausing_allowed
     and v_entry.consecutive_timeouts >= v_queue.auto_pause_after_timeouts then
    update public.queue_entries set status = 'paused', paused_at = clock_timestamp()
    where id = v_entry.id;
    perform private.audit(o.org_id, 'entry.auto_paused', p_queue => o.queue_id, p_subject => o.user_id,
      p_payload => jsonb_build_object('entry_id', v_entry.id, 'consecutive_timeouts', v_entry.consecutive_timeouts));
    perform private.notify(o.user_id, o.org_id, 'auto_paused',
      jsonb_build_object('queue_id', o.queue_id, 'queue_name', v_queue.name));
  end if;
end;
$$;

-- What happens to a person's queue membership when their shift ends normally.
create or replace function private.after_shift_end(p_queue public.queues, p_user uuid, p_shift public.shifts)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefs public.member_queue_prefs;
  v_entry public.queue_entries;
begin
  select * into v_prefs from public.member_queue_prefs where queue_id = p_queue.id and user_id = p_user;
  if coalesce(v_prefs.auto_rejoin, false)
     and not coalesce(v_prefs.rejoin_requires_approval, false)
     and (v_prefs.cooldown_until is null or v_prefs.cooldown_until <= now())
     and p_queue.archived_at is null
     and exists (select 1 from public.queue_members where queue_id = p_queue.id and user_id = p_user)
     and exists (select 1 from public.memberships where org_id = p_queue.org_id and user_id = p_user and status = 'active')
     and private.open_entry(p_queue.id, p_user) is not distinct from null
  then
    v_entry := private.insert_entry(p_queue, p_user);
    perform private.audit(p_queue.org_id, 'entry.joined', p_queue => p_queue.id, p_subject => p_user,
      p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq, 'auto_rejoin', true));
    perform private.notify(p_user, p_queue.org_id, 'auto_rejoined',
      private.shift_payload(p_shift) || jsonb_build_object('position', private.entry_position(v_entry)));
  else
    perform private.notify(p_user, p_queue.org_id, 'eligible_to_rejoin', private.shift_payload(p_shift),
      'rejoin:' || p_shift.id::text);
  end if;
end;
$$;

-- Complete an assigned shift. Caller holds the queue lock.
create or replace function private.complete_shift_locked(p_shift uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  a public.assignments;
  v_queue public.queues;
begin
  select * into s from public.shifts where id = p_shift;
  if s.status <> 'assigned' then
    return;
  end if;
  select * into a from public.assignments where shift_id = p_shift and status = 'active';
  select * into v_queue from public.queues where id = s.queue_id;
  update public.assignments set status = 'completed', ended_at = clock_timestamp(), ended_by = auth.uid()
  where id = a.id;
  update public.shifts set status = 'completed', ended_at = clock_timestamp() where id = p_shift
  returning * into s;
  perform private.close_entry(a.entry_id, 'completed');
  perform private.audit(s.org_id, 'shift.completed', p_queue => s.queue_id, p_shift => s.id,
    p_subject => a.user_id, p_payload => jsonb_build_object('assignment_id', a.id, 'automatic', auth.uid() is null));
  perform private.after_shift_end(v_queue, a.user_id, s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: shifts
-- ---------------------------------------------------------------------------
-- p_shifts: [{ "start_local": "2026-10-10T07:00", "end_local": "2026-10-10T19:00",
--              "unit": "ICU 3", "notes": "" }]   -- local times in the org timezone
--   (or "starts_at"/"ends_at" as ISO-8601 instants). An end time earlier than the
--   start means the shift ends the next day.
create or replace function public.create_shifts(p_queue uuid, p_shifts jsonb, p_publish boolean default false)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  v_tz text;
  v_batch uuid := gen_random_uuid();
  v_item jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_start_local timestamp;
  v_end_local timestamp;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  select * into v_queue from public.queues where id = p_queue;
  if v_queue.id is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v_queue.org_id);
  v_queue := private.lock_queue(p_queue);
  if v_queue.archived_at is not null then perform private.fail('queue.archived'); end if;
  if jsonb_typeof(p_shifts) <> 'array' or jsonb_array_length(p_shifts) = 0 or jsonb_array_length(p_shifts) > 200 then
    perform private.fail('shift.invalid_batch');
  end if;
  select timezone into v_tz from public.organizations where id = v_queue.org_id;

  for v_item in select * from jsonb_array_elements(p_shifts) loop
    begin
      if v_item ? 'start_local' then
        v_start_local := (v_item ->> 'start_local')::timestamp;
        v_end_local := (v_item ->> 'end_local')::timestamp;
        if v_end_local <= v_start_local then
          v_end_local := v_end_local + interval '1 day';
        end if;
        v_start := v_start_local at time zone v_tz;
        v_end := v_end_local at time zone v_tz;
      else
        v_start := (v_item ->> 'starts_at')::timestamptz;
        v_end := (v_item ->> 'ends_at')::timestamptz;
      end if;
    exception when others then
      perform private.fail('shift.invalid_time', sqlerrm);
    end;
    if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '48 hours' then
      perform private.fail('shift.invalid_time');
    end if;
    if p_publish and v_start <= now() then
      perform private.fail('shift.in_past');
    end if;
    insert into public.shifts (org_id, queue_id, starts_at, ends_at, unit, notes, batch_id, created_by)
    values (v_queue.org_id, p_queue, v_start, v_end,
            left(coalesce(v_item ->> 'unit', ''), 120), left(coalesce(v_item ->> 'notes', ''), 2000),
            v_batch, auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;
    perform private.audit(v_queue.org_id, 'shift.created', p_queue => p_queue, p_shift => v_id,
      p_payload => jsonb_build_object('starts_at', v_start, 'ends_at', v_end, 'batch_id', v_batch));
  end loop;

  if p_publish then
    update public.shifts set status = 'published', published_at = now() where id = any (v_ids);
    perform private.audit(v_queue.org_id, 'shift.published', p_queue => p_queue, p_shift => x,
      p_payload => jsonb_build_object('batch_id', v_batch))
    from unnest(v_ids) x;
    perform private.dispatch(p_queue);
    perform private.after_change(p_queue);
  end if;
  return query select unnest(v_ids);
end;
$$;

create or replace function public.publish_shifts(p_shift_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queues uuid[];
  v_qid uuid;
  s public.shifts;
begin
  perform private.require_uid();
  select coalesce(array_agg(distinct queue_id order by queue_id), '{}') into v_queues
  from public.shifts where id = any (p_shift_ids);
  if cardinality(v_queues) = 0 then perform private.fail('shift.not_found'); end if;
  foreach v_qid in array v_queues loop
    perform private.assert_admin((select org_id from public.queues where id = v_qid));
    perform private.lock_queue(v_qid);
  end loop;
  for s in select * from public.shifts where id = any (p_shift_ids) order by starts_at for update loop
    if s.status <> 'draft' then perform private.fail('shift.not_draft'); end if;
    if s.starts_at <= now() then perform private.fail('shift.in_past'); end if;
    if (select archived_at from public.queues where id = s.queue_id) is not null then
      perform private.fail('queue.archived');
    end if;
    update public.shifts set status = 'published', published_at = now() where id = s.id;
    perform private.audit(s.org_id, 'shift.published', p_queue => s.queue_id, p_shift => s.id);
  end loop;
  foreach v_qid in array v_queues loop
    perform private.dispatch(v_qid);
    perform private.after_change(v_qid);
  end loop;
end;
$$;

-- Drafts: everything editable. After publishing only the notes can change;
-- to change time/unit, cancel the shift (assignee keeps their place) and create a new one.
create or replace function public.update_shift(p_shift uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  v_tz text;
  v_start_local timestamp;
  v_end_local timestamp;
  v_user uuid;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  perform private.lock_queue(s.queue_id);
  select * into s from public.shifts where id = p_shift;
  if s.status in ('completed', 'no_show', 'cancelled') then perform private.fail('shift.final'); end if;

  if s.status <> 'draft' and exists (
    select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k <> 'notes'
  ) then
    perform private.fail('shift.locked_fields');
  end if;

  if p_patch ? 'start_local' or p_patch ? 'end_local' then
    select timezone into v_tz from public.organizations where id = s.org_id;
    begin
      v_start_local := coalesce((p_patch ->> 'start_local')::timestamp, (s.starts_at at time zone v_tz));
      v_end_local := coalesce((p_patch ->> 'end_local')::timestamp, (s.ends_at at time zone v_tz));
    exception when others then
      perform private.fail('shift.invalid_time', sqlerrm);
    end;
    if v_end_local <= v_start_local then v_end_local := v_end_local + interval '1 day'; end if;
    if v_end_local - v_start_local > interval '48 hours' then perform private.fail('shift.invalid_time'); end if;
    s.starts_at := v_start_local at time zone v_tz;
    s.ends_at := v_end_local at time zone v_tz;
  end if;
  if p_patch ? 'unit' then s.unit := left(coalesce(p_patch ->> 'unit', ''), 120); end if;
  if p_patch ? 'notes' then s.notes := left(coalesce(p_patch ->> 'notes', ''), 2000); end if;

  update public.shifts set starts_at = s.starts_at, ends_at = s.ends_at, unit = s.unit, notes = s.notes
  where id = p_shift;
  perform private.audit(s.org_id, 'shift.updated', p_queue => s.queue_id, p_shift => s.id,
    p_payload => jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k)));

  if s.status <> 'draft' then
    select user_id into v_user from public.offers where shift_id = p_shift and outcome is null;
    if v_user is null then
      select user_id into v_user from public.assignments where shift_id = p_shift and status = 'active';
    end if;
    perform private.notify(v_user, s.org_id, 'shift_updated', private.shift_payload(s));
  end if;
  perform private.after_change(s.queue_id);
end;
$$;

create or replace function public.delete_draft_shift(p_shift uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  perform private.lock_queue(s.queue_id);
  delete from public.shifts where id = p_shift and status = 'draft';
  if not found then perform private.fail('shift.not_draft'); end if;
  perform private.audit(s.org_id, 'shift.deleted', p_queue => s.queue_id, p_shift => s.id);
end;
$$;

-- Rule 8: cancelling after assignment puts the assignee back at their ORIGINAL position.
create or replace function public.cancel_shift(p_shift uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  a public.assignments;
  o public.offers;
  v_entry public.queue_entries;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  perform private.lock_queue(s.queue_id);
  select * into s from public.shifts where id = p_shift;
  if s.status = 'draft' then perform private.fail('shift.is_draft'); end if;
  if s.status in ('completed', 'no_show', 'cancelled') then perform private.fail('shift.final'); end if;
  -- A shift that has started was (being) worked: mark it completed or no-show
  -- instead. Restoring the original position here would let admins reorder.
  if s.status = 'assigned' and s.starts_at <= now() then perform private.fail('shift.already_started'); end if;

  select * into o from public.offers where shift_id = p_shift and outcome is null;
  if o.id is not null then
    perform private.resolve_open_offer(s.queue_id, o.user_id, 'revoked', 'shift_cancelled');
  end if;

  select * into a from public.assignments where shift_id = p_shift and status = 'active';
  if a.id is not null then
    update public.assignments set status = 'cancelled', ended_at = clock_timestamp(), ended_by = auth.uid(),
      reason = p_reason
    where id = a.id;
    update public.queue_entries set status = 'waiting', held_assignment_id = null
    where id = a.entry_id and closed_at is null and status = 'held'
    returning * into v_entry;
    if v_entry.id is not null then
      perform private.audit(s.org_id, 'entry.restored', p_queue => s.queue_id, p_shift => s.id,
        p_subject => a.user_id, p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq,
          'position', private.entry_position(v_entry)));
    end if;
    perform private.notify(a.user_id, s.org_id, 'shift_cancelled',
      private.shift_payload(s) || jsonb_build_object('restored', v_entry.id is not null,
        'position', private.entry_position(v_entry), 'reason', p_reason));
  end if;

  update public.shifts set status = 'cancelled', cancelled_reason = p_reason, ended_at = clock_timestamp()
  where id = p_shift;
  perform private.audit(s.org_id, 'shift.cancelled', p_queue => s.queue_id, p_shift => s.id,
    p_subject => a.user_id, p_reason => p_reason, p_payload => jsonb_build_object('previous_status', s.status));
  perform private.dispatch(s.queue_id);
  perform private.after_change(s.queue_id);
end;
$$;

create or replace function public.complete_shift(p_shift uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  perform private.lock_queue(s.queue_id);
  select * into s from public.shifts where id = p_shift;
  if s.status <> 'assigned' then perform private.fail('shift.not_assigned'); end if;
  if s.starts_at > now() then perform private.fail('shift.not_started'); end if;
  perform private.complete_shift_locked(p_shift);
  perform private.dispatch(s.queue_id);
  perform private.after_change(s.queue_id);
end;
$$;

-- Rule 12. Works on an assigned shift that has started, or as a correction on
-- a completed shift up to 7 days after it ended.
create or replace function public.mark_no_show(p_shift uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  a public.assignments;
  v_queue public.queues;
  v_entry public.queue_entries;
  v_correction boolean;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  v_queue := private.lock_queue(s.queue_id);
  select * into s from public.shifts where id = p_shift;

  if s.status = 'assigned' then
    if s.starts_at > now() then perform private.fail('shift.not_started'); end if;
    v_correction := false;
    select * into a from public.assignments where shift_id = p_shift and status = 'active';
  elsif s.status = 'completed' then
    if s.ended_at < now() - interval '7 days' then perform private.fail('shift.correction_window_passed'); end if;
    v_correction := true;
    select * into a from public.assignments where shift_id = p_shift and status = 'completed'
    order by assigned_at desc limit 1;
  else
    perform private.fail('shift.invalid_state');
  end if;

  update public.assignments set status = 'no_show', ended_at = coalesce(ended_at, clock_timestamp()),
    ended_by = auth.uid(), reason = p_reason
  where id = a.id;
  update public.shifts set status = 'no_show', ended_at = coalesce(ended_at, clock_timestamp())
  where id = p_shift returning * into s;
  if not v_correction then
    perform private.close_entry(a.entry_id, 'no_show');
  end if;

  perform private.audit(s.org_id, 'shift.no_show', p_queue => s.queue_id, p_shift => s.id,
    p_subject => a.user_id, p_reason => p_reason,
    p_payload => jsonb_build_object('policy', v_queue.no_show_policy, 'correction', v_correction));

  if v_queue.no_show_policy = 'rejoin_end' then
    if not v_correction then
      perform private.after_shift_end(v_queue, a.user_id, s);
    end if;
    -- correction with "same as completed": nothing changes for the person.
  else
    if v_queue.no_show_policy = 'cooldown' then
      perform private.upsert_prefs(s.queue_id, a.user_id, p_cooldown_until => now() + v_queue.no_show_cooldown);
    else
      perform private.upsert_prefs(s.queue_id, a.user_id, p_requires_approval => true);
    end if;
    if v_correction then
      -- They may already have (auto-)rejoined: the consequence applies to that ticket.
      v_entry := private.open_entry(s.queue_id, a.user_id);
      if v_entry.id is not null and v_entry.status in ('waiting', 'paused') then
        perform private.resolve_open_offer(s.queue_id, a.user_id, 'revoked', 'no_show');
        perform private.close_entry(v_entry.id, 'no_show');
        perform private.audit(s.org_id, 'entry.removed', p_queue => s.queue_id, p_subject => a.user_id,
          p_reason => 'no_show', p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq));
      end if;
    end if;
    perform private.notify(a.user_id, s.org_id, 'no_show_recorded',
      private.shift_payload(s) || jsonb_build_object('policy', v_queue.no_show_policy));
  end if;
  perform private.dispatch(s.queue_id);
  perform private.after_change(s.queue_id);
end;
$$;

-- Unfilled shift: start a fresh offer round (everyone may be asked again).
create or replace function public.reoffer_shift(p_shift uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  perform private.lock_queue(s.queue_id);
  select * into s from public.shifts where id = p_shift;
  if s.status <> 'unfilled' then perform private.fail('shift.invalid_state'); end if;
  if s.starts_at <= now() then perform private.fail('shift.in_past'); end if;
  update public.shifts set status = 'published', offer_round = offer_round + 1, unfilled_notified_at = null
  where id = p_shift;
  perform private.audit(s.org_id, 'shift.reoffered', p_queue => s.queue_id, p_shift => s.id,
    p_payload => jsonb_build_object('round', s.offer_round + 1));
  perform private.dispatch(s.queue_id);
  perform private.after_change(s.queue_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: respond to offers, withdraw
-- ---------------------------------------------------------------------------
create or replace function public.accept_offer(p_offer uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  o public.offers;
  s public.shifts;
  v_entry public.queue_entries;
  v_assignment uuid;
  v_queue uuid;
begin
  select queue_id into v_queue from public.offers where id = p_offer and user_id = v_uid;
  if v_queue is null then perform private.fail('offer.not_found'); end if;
  perform private.lock_queue(v_queue);
  select * into o from public.offers where id = p_offer for update;
  if o.outcome is not null then
    perform private.fail('offer.not_open', o.outcome::text);
  end if;
  -- Server clock decides. A tap that arrives after expires_at loses, even if the
  -- scheduler has not processed the timeout yet.
  if clock_timestamp() >= o.expires_at then
    perform private.fail('offer.expired');
  end if;
  select * into s from public.shifts where id = o.shift_id;
  perform private.lock_user(v_uid);
  if private.has_overlapping_assignment(v_uid, s.starts_at, s.ends_at, s.id) then
    perform private.fail('offer.overlaps_assignment');
  end if;
  v_entry := private.open_entry(o.queue_id, v_uid);
  if v_entry.id is null or v_entry.status <> 'waiting' then
    perform private.fail('offer.not_open');
  end if;

  update public.offers set outcome = 'accepted', responded_at = clock_timestamp() where id = o.id;
  insert into public.assignments (shift_id, org_id, queue_id, user_id, offer_id, entry_id)
  values (s.id, s.org_id, s.queue_id, v_uid, o.id, v_entry.id)
  returning id into v_assignment;
  update public.queue_entries
  set status = 'held', held_assignment_id = v_assignment, consecutive_timeouts = 0
  where id = v_entry.id;
  update public.shifts set status = 'assigned' where id = s.id;

  perform private.audit(s.org_id, 'offer.accepted', p_queue => s.queue_id, p_shift => s.id, p_subject => v_uid,
    p_payload => jsonb_build_object('offer_id', o.id));
  perform private.audit(s.org_id, 'shift.assigned', p_queue => s.queue_id, p_shift => s.id, p_subject => v_uid,
    p_payload => jsonb_build_object('assignment_id', v_assignment, 'entry_id', v_entry.id, 'seq', v_entry.seq,
      'waited_seconds', extract(epoch from clock_timestamp() - v_entry.joined_at)::bigint));
  perform private.notify(v_uid, s.org_id, 'shift_assigned', private.shift_payload(s));
  perform private.dispatch(s.queue_id);
  perform private.after_change(s.queue_id);
  return v_assignment;
end;
$$;

create or replace function public.decline_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  o public.offers;
  v_queue public.queues;
  v_entry public.queue_entries;
begin
  select * into o from public.offers where id = p_offer and user_id = v_uid;
  if o.id is null then perform private.fail('offer.not_found'); end if;
  v_queue := private.lock_queue(o.queue_id);
  select * into o from public.offers where id = p_offer for update;
  if o.outcome is not null then perform private.fail('offer.not_open', o.outcome::text); end if;
  -- Too late: it is a timeout (the scheduler records it), not a decline.
  if clock_timestamp() >= o.expires_at then perform private.fail('offer.expired'); end if;

  perform private.resolve_open_offer(o.queue_id, v_uid, 'declined', 'declined');
  v_entry := private.open_entry(o.queue_id, v_uid);
  if v_entry.id is not null then
    update public.queue_entries set consecutive_timeouts = 0 where id = v_entry.id returning * into v_entry;
    if v_queue.decline_policy = 'move_to_end' then
      perform private.move_to_end(v_entry, 'declined');
    end if;
  end if;
  perform private.dispatch(o.queue_id);
  perform private.after_change(o.queue_id);
end;
$$;

-- Rule 9: withdrawing after accepting. The ticket is NOT restored.
create or replace function public.withdraw_assignment(p_shift uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s public.shifts;
  a public.assignments;
  v_queue public.queues;
begin
  select * into a from public.assignments where shift_id = p_shift and user_id = v_uid and status = 'active';
  if a.id is null then perform private.fail('assignment.not_found'); end if;
  v_queue := private.lock_queue(a.queue_id);
  select * into a from public.assignments where id = a.id;
  if a.status <> 'active' then perform private.fail('assignment.not_found'); end if;
  select * into s from public.shifts where id = p_shift;
  if s.starts_at <= clock_timestamp() then perform private.fail('shift.already_started'); end if;

  perform private.withdraw_locked(a, v_queue, p_reason);
  perform private.dispatch(a.queue_id);
  perform private.after_change(a.queue_id);
end;
$$;

create or replace function private.withdraw_locked(a public.assignments, p_queue public.queues, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
begin
  update public.assignments set status = 'withdrawn', ended_at = clock_timestamp(), ended_by = auth.uid(),
    reason = p_reason
  where id = a.id;
  perform private.close_entry(a.entry_id, 'withdrew');
  if p_queue.withdraw_cooldown > interval '0' then
    perform private.upsert_prefs(p_queue.id, a.user_id, p_cooldown_until => now() + p_queue.withdraw_cooldown);
  end if;
  update public.shifts set
    status = 'published',
    offer_round = case when p_queue.reoffer_after_withdraw = 'restart' then offer_round + 1 else offer_round end,
    unfilled_notified_at = null
  where id = a.shift_id
  returning * into s;
  perform private.audit(a.org_id, 'assignment.withdrawn', p_queue => a.queue_id, p_shift => a.shift_id,
    p_subject => a.user_id, p_reason => p_reason,
    p_payload => jsonb_build_object('assignment_id', a.id, 'reoffer', p_queue.reoffer_after_withdraw,
      'round', s.offer_round, 'cooldown_hours', round(extract(epoch from p_queue.withdraw_cooldown) / 3600, 2)));
  perform private.notify_admins(a.org_id, 'withdrawal', private.shift_payload(s));
end;
$$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
create or replace function public.server_time()
returns timestamptz
language sql
volatile
as $$ select clock_timestamp(); $$;

create or replace function public.get_offer(p_offer uuid)
returns table (
  offer_id uuid, shift_id uuid, queue_id uuid, queue_name text, org_id uuid, org_name text, org_timezone text,
  starts_at timestamptz, ends_at timestamptz, unit text, notes text,
  offered_at timestamptz, expires_at timestamptz, outcome public.offer_outcome, server_now timestamptz,
  decline_policy public.position_policy
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, s.id, q.id, q.name, org.id, org.name, org.timezone, s.starts_at, s.ends_at, s.unit, s.notes,
         o.offered_at, o.expires_at, o.outcome, clock_timestamp(), q.decline_policy
  from public.offers o
  join public.shifts s on s.id = o.shift_id
  join public.queues q on q.id = o.queue_id
  join public.organizations org on org.id = o.org_id
  where o.id = p_offer and o.user_id = auth.uid();
$$;

-- Staff shift history.
create or replace function public.my_shifts(p_scope text default 'upcoming', p_org uuid default null)
returns table (
  assignment_id uuid, shift_id uuid, queue_id uuid, queue_name text, org_id uuid, org_timezone text,
  starts_at timestamptz, ends_at timestamptz, unit text, notes text,
  assignment_status public.assignment_status, shift_status public.shift_status, assigned_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, s.id, q.id, q.name, s.org_id, org.timezone, s.starts_at, s.ends_at, s.unit, s.notes,
         a.status, s.status, a.assigned_at
  from public.assignments a
  join public.shifts s on s.id = a.shift_id
  join public.queues q on q.id = s.queue_id
  join public.organizations org on org.id = s.org_id
  where a.user_id = auth.uid()
    and (p_org is null or s.org_id = p_org)
    and case when p_scope = 'upcoming'
             then a.status = 'active' and s.ends_at > now()
             else not (a.status = 'active' and s.ends_at > now()) end
  order by case when p_scope = 'upcoming' then s.starts_at end asc,
           case when p_scope <> 'upcoming' then s.starts_at end desc
  limit 200;
$$;

-- Admin shift list with live offer progress.
create or replace function public.admin_shifts(
  p_org uuid,
  p_from timestamptz default now() - interval '7 days',
  p_to timestamptz default now() + interval '60 days',
  p_queue uuid default null
)
returns table (
  shift_id uuid, queue_id uuid, queue_name text, starts_at timestamptz, ends_at timestamptz,
  unit text, notes text, status public.shift_status, offer_round int, published_at timestamptz,
  current_offer_user uuid, current_offer_name text, current_offer_position int, current_offer_expires_at timestamptz,
  assignee_id uuid, assignee_name text, declined_count int, expired_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  select s.id, s.queue_id, q.name, s.starts_at, s.ends_at, s.unit, s.notes, s.status, s.offer_round, s.published_at,
         o.user_id, op.display_name, o.queue_position, o.expires_at,
         a.user_id, ap.display_name,
         (select count(*)::int from public.offers x where x.shift_id = s.id and x.outcome = 'declined'),
         (select count(*)::int from public.offers x where x.shift_id = s.id and x.outcome = 'expired')
  from public.shifts s
  join public.queues q on q.id = s.queue_id
  left join public.offers o on o.shift_id = s.id and o.outcome is null
  left join public.profiles op on op.id = o.user_id
  left join lateral (
    select * from public.assignments aa where aa.shift_id = s.id
    order by (aa.status = 'active') desc, aa.assigned_at desc limit 1
  ) a on s.status in ('assigned', 'completed', 'no_show')
  left join public.profiles ap on ap.id = a.user_id
  where s.org_id = p_org
    and (p_queue is null or s.queue_id = p_queue)
    and (s.status = 'draft' or (s.starts_at >= p_from and s.starts_at <= p_to))
  order by s.starts_at;
end;
$$;

create or replace function public.shift_offer_history(p_shift uuid)
returns table (
  offer_id uuid, user_id uuid, display_name text, queue_position int, round int,
  offered_at timestamptz, expires_at timestamptz, outcome public.offer_outcome, outcome_reason text,
  responded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.shifts where id = p_shift;
  if v_org is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(v_org);
  return query
  select o.id, o.user_id, p.display_name, o.queue_position, o.round, o.offered_at, o.expires_at,
         o.outcome, o.outcome_reason, o.responded_at
  from public.offers o join public.profiles p on p.id = o.user_id
  where o.shift_id = p_shift
  order by o.offered_at;
end;
$$;
