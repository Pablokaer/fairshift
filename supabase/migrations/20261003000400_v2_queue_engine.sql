-- Profession queues, ticket actions and the multi-slot assignment engine.
set check_function_bodies = off;
--
-- CONCURRENCY CONTRACT (unchanged, see ARCHITECTURE.md):
--   * Every function that changes a queue first locks the queue row
--     (private.lock_queue -> SELECT ... FOR UPDATE). All changes to one queue
--     are serialized: two managers publishing at once, a person leaving while a
--     shift is published, two people joining at the same instant.
--   * Functions touching several queues lock them in ascending id order.
--   * Per-user advisory locks are only taken AFTER queue locks, and the engine
--     only TRIES them (never waits), so there is no lock cycle.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.profession_queue(p_org uuid, p_profession public.profession)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.queues where org_id = p_org and profession = p_profession and archived_at is null;
$$;

-- 1-based position among open waiting/paused tickets (paused people hold their place).
create or replace function private.entry_position(p_entry public.queue_entries)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_entry.id is null or p_entry.status = 'held' or p_entry.closed_at is not null then null
  else (
    select count(*)::int from public.queue_entries e
    where e.queue_id = p_entry.queue_id and e.closed_at is null
      and e.status in ('waiting', 'paused') and e.seq <= p_entry.seq
  ) end;
$$;

create or replace function private.queue_size(p_queue uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.queue_entries
  where queue_id = p_queue and closed_at is null and status in ('waiting', 'paused');
$$;

-- Issue a new ticket at the END of the queue. Caller holds the queue lock.
create or replace function private.insert_entry(p_queue public.queues, p_user uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queue_entries;
begin
  insert into public.queue_entries (queue_id, org_id, user_id, seq, joined_at, status)
  values (p_queue.id, p_queue.org_id, p_user, nextval('private.queue_entry_seq'), clock_timestamp(), 'waiting')
  returning * into v;
  -- Someone who *joins* inside the top 3 did not "move into" it: no top-3 alert.
  if private.entry_position(v) <= 3 then
    update public.queue_entries set top3_notified_at = now() where id = v.id returning * into v;
  end if;
  return v;
end;
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
    'profession', (select profession from public.queues where id = p_shift.queue_id),
    'org_timezone', (select timezone from public.organizations where id = p_shift.org_id),
    'starts_at', p_shift.starts_at, 'ends_at', p_shift.ends_at, 'unit', p_shift.unit,
    'notes', p_shift.notes, 'slots', p_shift.slots);
$$;

create or replace function private.active_assignments(p_shift uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.assignments where shift_id = p_shift and status = 'active';
$$;

-- Called at the end of every state change of a queue: bump the version, send
-- "moved into the top 3" alerts and a content-free change broadcast.
create or replace function private.after_change(p_queue uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  r record;
begin
  update public.queues set version = version + 1 where id = p_queue returning * into v_queue;
  if v_queue.id is null then
    return;
  end if;
  for r in
    with ranked as (
      select e.id, e.user_id, e.status, e.top3_notified_at,
             row_number() over (order by e.seq) as pos
      from public.queue_entries e
      where e.queue_id = p_queue and e.closed_at is null and e.status in ('waiting', 'paused')
    )
    select * from ranked where pos <= 3 and status = 'waiting' and top3_notified_at is null
  loop
    perform private.notify(r.user_id, v_queue.org_id, 'moved_top3',
      jsonb_build_object('queue_id', p_queue, 'profession', v_queue.profession, 'position', r.pos),
      'top3:' || r.id::text);
    update public.queue_entries set top3_notified_at = now() where id = r.id;
  end loop;

  perform realtime.send(jsonb_build_object('queue_id', p_queue, 'version', v_queue.version),
    'queue_changed', 'queue:' || p_queue::text, true);
  perform realtime.send(jsonb_build_object('queue_id', p_queue, 'version', v_queue.version),
    'queue_changed', 'org:' || v_queue.org_id::text || ':admin', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- THE ASSIGNMENT ENGINE. Caller must hold the queue lock.
--
-- For every open shift of the queue that has not started, in shift-start
-- order, while it has free slots: take the FIRST ticket (lowest seq) that is
--   * waiting (paused people keep their place but are skipped; people holding
--     a shift are not waiting),
--   * an active member of the queue's profession,
--   * not someone who already had this shift (e.g. gave it back),
--   * without an overlapping active assignment anywhere (skipped for THIS
--     shift only: they keep their position).
-- The person's ticket becomes "held": it leaves the count but keeps its seq,
-- so a cancellation can restore the original position.
--
-- Fairness invariant: when person P is assigned, everyone ahead of P is
-- paused, holding a shift, had this shift before, or has an overlap.
--
-- If a candidate's user lock is momentarily held by another transaction (a
-- cross-hospital overlap check), the engine does NOT skip ahead to the next
-- person (that would be unfair): it stops and the scheduler finishes the job
-- on its next sweep (<= 15 s).
-- ---------------------------------------------------------------------------
create or replace function private.fill_queue(p_queue uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  s public.shifts;
  c record;
  v_need int;
  v_taken int;
  v_assignment uuid;
  v_position int;
  v_changes int := 0;
  v_manager boolean;
begin
  select * into v_queue from public.queues where id = p_queue;
  if v_queue.id is null or v_queue.archived_at is not null then
    return 0;
  end if;

  for s in
    select sh.* from public.shifts sh
    where sh.queue_id = p_queue and sh.status = 'open' and sh.starts_at > clock_timestamp()
    order by sh.starts_at, sh.created_at, sh.id
  loop
    v_need := s.slots - private.active_assignments(s.id);
    v_taken := 0;

    if v_need > 0 then
      for c in
        select e.id as entry_id, e.user_id, e.seq, e.joined_at, m.role
        from public.queue_entries e
        join public.memberships m on m.org_id = e.org_id and m.user_id = e.user_id
          and m.status = 'active' and m.profession = v_queue.profession
        where e.queue_id = p_queue and e.closed_at is null and e.status = 'waiting'
          and not exists (select 1 from public.assignments a where a.shift_id = s.id and a.user_id = e.user_id)
        order by e.seq
      loop
        if not pg_try_advisory_xact_lock(private.user_lock_key(c.user_id)) then
          -- Stop the whole pass, not just this shift: a later shift must not
          -- take this person (or the next one) out of shift-start order.
          return v_changes;
        end if;
        if private.has_overlapping_assignment(c.user_id, s.starts_at, s.ends_at, s.id) then
          continue;
        end if;

        -- Position at the moment of assignment (people assigned just before in
        -- this pass were ahead and have already left the count).
        v_position := v_taken + (
          select count(*)::int from public.queue_entries x
          where x.queue_id = p_queue and x.closed_at is null and x.status in ('waiting', 'paused') and x.seq <= c.seq);
        v_manager := c.role in ('owner', 'admin');

        insert into public.assignments (shift_id, org_id, queue_id, user_id, entry_id, queue_position)
        values (s.id, s.org_id, p_queue, c.user_id, c.entry_id, v_position)
        returning id into v_assignment;
        update public.queue_entries set status = 'held', held_assignment_id = v_assignment where id = c.entry_id;

        perform private.audit(s.org_id, 'shift.assigned', p_queue => p_queue, p_shift => s.id, p_subject => c.user_id,
          p_payload => jsonb_build_object('assignment_id', v_assignment, 'entry_id', c.entry_id, 'seq', c.seq,
            'position', v_position, 'slot', s.slots - v_need + 1, 'slots', s.slots,
            'waited_seconds', extract(epoch from clock_timestamp() - c.joined_at)::bigint,
            'assignee_is_manager', v_manager));
        perform private.notify(c.user_id, s.org_id, 'shift_assigned',
          private.shift_payload(s) || jsonb_build_object('assignment_id', v_assignment),
          'assigned:' || v_assignment::text);

        v_need := v_need - 1;
        v_taken := v_taken + 1;
        v_changes := v_changes + 1;
        exit when v_need = 0;
      end loop;
    end if;

    if v_need <= 0 then
      update public.shifts set status = 'filled' where id = s.id;
      perform private.audit(s.org_id, 'shift.filled', p_queue => p_queue, p_shift => s.id,
        p_payload => jsonb_build_object('slots', s.slots));
      v_changes := v_changes + 1;
    end if;
  end loop;
  return v_changes;
end;
$$;

-- Decision a: fewer people than slots -> the shift stays open and managers are told once.
create or replace function private.notify_if_short(p_shift uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  v_filled int;
begin
  select * into s from public.shifts where id = p_shift;
  if s.status <> 'open' then
    return;
  end if;
  v_filled := private.active_assignments(s.id);
  perform private.notify_admins(s.org_id, 'shift_short',
    private.shift_payload(s) || jsonb_build_object('filled', v_filled), 'short:' || s.id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: join / leave / pause / resume
-- ---------------------------------------------------------------------------
create or replace function public.join_queue(p_queue uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v public.queues;
  v_entry public.queue_entries;
begin
  v := private.lock_queue(p_queue);
  if v.archived_at is not null then perform private.fail('queue.archived'); end if;
  if not exists (select 1 from public.memberships where org_id = v.org_id and user_id = v_uid and status = 'active') then
    perform private.fail('auth.forbidden');
  end if;
  if not private.is_eligible(p_queue, v_uid) then
    perform private.fail('queue.not_eligible');
  end if;

  v_entry := private.open_entry(p_queue, v_uid);
  if v_entry.id is not null then
    if v_entry.status = 'held' then perform private.fail('queue.holding_shift'); end if;
    perform private.fail('queue.already_joined');
  end if;
  if exists (select 1 from public.assignments where queue_id = p_queue and user_id = v_uid and status = 'active') then
    perform private.fail('queue.holding_shift');
  end if;

  v_entry := private.insert_entry(v, v_uid);
  perform private.audit(v.org_id, 'entry.joined', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq, 'joined_at', v_entry.joined_at,
      'position', private.entry_position(v_entry)));
  -- Open shifts with free slots are filled as soon as people join (decision a).
  perform private.fill_queue(p_queue);
  perform private.after_change(p_queue);
  return v_entry.id;
end;
$$;

create or replace function public.leave_queue(p_queue uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v public.queues;
  v_entry public.queue_entries;
begin
  v := private.lock_queue(p_queue);
  v_entry := private.open_entry(p_queue, v_uid);
  if v_entry.id is null then perform private.fail('queue.not_joined'); end if;
  if v_entry.status = 'held' then perform private.fail('queue.holding_shift'); end if;
  perform private.close_entry(v_entry.id, 'left');
  perform private.audit(v.org_id, 'entry.left', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq,
      'position', private.entry_position(v_entry)));
  perform private.after_change(p_queue);
end;
$$;

-- Decision d: "unavailable" keeps the position but skips the person for shifts.
create or replace function public.pause_queue(p_queue uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v public.queues;
  v_entry public.queue_entries;
begin
  v := private.lock_queue(p_queue);
  v_entry := private.open_entry(p_queue, v_uid);
  if v_entry.id is null then perform private.fail('queue.not_joined'); end if;
  if v_entry.status = 'held' then perform private.fail('queue.holding_shift'); end if;
  if v_entry.status = 'paused' then return; end if;
  update public.queue_entries set status = 'paused', paused_at = clock_timestamp() where id = v_entry.id;
  perform private.audit(v.org_id, 'entry.paused', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id));
  perform private.after_change(p_queue);
end;
$$;

create or replace function public.resume_queue(p_queue uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v public.queues;
  v_entry public.queue_entries;
begin
  v := private.lock_queue(p_queue);
  v_entry := private.open_entry(p_queue, v_uid);
  if v_entry.id is null then perform private.fail('queue.not_joined'); end if;
  if v_entry.status <> 'paused' then return; end if;
  update public.queue_entries set status = 'waiting', paused_at = null where id = v_entry.id;
  perform private.audit(v.org_id, 'entry.resumed', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id));
  perform private.fill_queue(p_queue);
  perform private.after_change(p_queue);
end;
$$;

create or replace function public.set_queue_auto_rejoin(p_queue uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v public.queues;
begin
  if not private.is_eligible(p_queue, v_uid) then perform private.fail('queue.not_eligible'); end if;
  v := private.lock_queue(p_queue);
  insert into public.member_queue_prefs (queue_id, user_id, auto_rejoin)
  values (p_queue, v_uid, p_enabled)
  on conflict (queue_id, user_id) do update set auto_rejoin = excluded.auto_rejoin;
  perform private.audit(v.org_id, 'entry.auto_rejoin_set', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('enabled', p_enabled));
end;
$$;

-- Managers remove a ticket (with a reason). There is intentionally no way to reorder.
create or replace function public.admin_remove_entry(p_queue uuid, p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queues;
  v_entry public.queue_entries;
  v_position int;
begin
  select * into v from public.queues where id = p_queue;
  if v.id is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v.org_id);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    perform private.fail('removal.reason_required');
  end if;
  v := private.lock_queue(p_queue);
  v_entry := private.open_entry(p_queue, p_user);
  if v_entry.id is null then perform private.fail('queue.not_joined'); end if;
  if v_entry.status = 'held' then perform private.fail('queue.entry_held'); end if;

  v_position := private.entry_position(v_entry);
  perform private.close_entry(v_entry.id, 'removed');
  perform private.audit(v.org_id, 'entry.removed', p_queue => p_queue, p_subject => p_user, p_reason => p_reason,
    p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq, 'position', v_position));
  perform private.notify(p_user, v.org_id, 'removed_from_queue',
    jsonb_build_object('queue_id', p_queue, 'profession', v.profession, 'reason', btrim(p_reason)));
  perform private.after_change(p_queue);
end;
$$;

-- Close all of a user's tickets in a hospital (locks the queues in id order).
-- Fails if the person holds an upcoming shift.
create or replace function private.close_user_entries(
  p_org uuid,
  p_user uuid,
  p_reason public.entry_close_reason
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queues uuid[];
  v_closed uuid[] := '{}';
  v_qid uuid;
  v_entry public.queue_entries;
begin
  select coalesce(array_agg(id order by id), '{}') into v_queues
  from public.queues where org_id = p_org and archived_at is null;
  foreach v_qid in array v_queues loop
    perform private.lock_queue(v_qid);
  end loop;
  if exists (
    select 1 from public.assignments a join public.shifts s on s.id = a.shift_id
    where a.org_id = p_org and a.user_id = p_user and a.status = 'active' and s.ends_at > now()
  ) then
    perform private.fail('member.has_assignments');
  end if;
  foreach v_qid in array v_queues loop
    v_entry := private.open_entry(v_qid, p_user);
    if v_entry.id is not null then
      if v_entry.status = 'held' then
        perform private.fail('member.has_assignments');
      end if;
      perform private.close_entry(v_entry.id, p_reason);
      perform private.audit(p_org, 'entry.removed', p_queue => v_qid, p_subject => p_user,
        p_reason => p_reason::text,
        p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq,
          'position', private.entry_position(v_entry)));
      v_closed := v_closed || v_qid;
    end if;
  end loop;
  return v_closed;
end;
$$;

-- ---------------------------------------------------------------------------
-- After a shift: the person may rejoin, ALWAYS at the end (auto-rejoin optional).
-- ---------------------------------------------------------------------------
create or replace function private.after_shift_end(p_queue public.queues, p_user uuid, p_shift public.shifts)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.queue_entries;
begin
  if coalesce((select auto_rejoin from public.member_queue_prefs where queue_id = p_queue.id and user_id = p_user), false)
     and private.is_eligible(p_queue.id, p_user)
     and private.open_entry(p_queue.id, p_user) is not distinct from null
  then
    v_entry := private.insert_entry(p_queue, p_user);
    perform private.audit(p_queue.org_id, 'entry.joined', p_queue => p_queue.id, p_subject => p_user,
      p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq, 'auto_rejoin', true,
        'position', private.entry_position(v_entry)));
    perform private.notify(p_user, p_queue.org_id, 'auto_rejoined',
      private.shift_payload(p_shift) || jsonb_build_object('position', private.entry_position(v_entry)));
  else
    perform private.notify(p_user, p_queue.org_id, 'eligible_to_rejoin', private.shift_payload(p_shift),
      'rejoin:' || p_shift.id::text || ':' || p_user::text);
  end if;
end;
$$;

-- Complete a shift whose time has come. Caller holds the queue lock.
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
  v_people int;
begin
  select * into s from public.shifts where id = p_shift;
  if s.status not in ('open', 'filled') then
    return;
  end if;
  select * into v_queue from public.queues where id = s.queue_id;
  for a in select * from public.assignments where shift_id = p_shift and status = 'active' loop
    update public.assignments set status = 'completed', ended_at = clock_timestamp(), ended_by = auth.uid()
    where id = a.id;
    perform private.close_entry(a.entry_id, 'completed');
    perform private.audit(s.org_id, 'shift.completed', p_queue => s.queue_id, p_shift => s.id, p_subject => a.user_id,
      p_payload => jsonb_build_object('assignment_id', a.id, 'automatic', auth.uid() is null));
    perform private.after_shift_end(v_queue, a.user_id, s);
  end loop;

  select count(*)::int into v_people from public.assignments
  where shift_id = p_shift and status in ('completed', 'no_show');
  if v_people > 0 then
    update public.shifts set status = 'completed', ended_at = clock_timestamp() where id = p_shift;
  else
    -- Nobody was ever assigned: nothing happened.
    update public.shifts set status = 'cancelled', cancelled_reason = 'unfilled', ended_at = clock_timestamp()
    where id = p_shift;
    perform private.audit(s.org_id, 'shift.unfilled', p_queue => s.queue_id, p_shift => s.id,
      p_payload => jsonb_build_object('slots', s.slots));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Managers: shifts
-- ---------------------------------------------------------------------------
-- p_shifts: [{ "start_local": "2026-10-10T07:00", "end_local": "2026-10-10T19:00",
--              "unit": "ICU 3", "notes": "", "slots": 2 }]   -- local times in the hospital timezone
--   (or "starts_at"/"ends_at" as ISO-8601 instants). An end time earlier than
--   the start means the shift ends the next day.
create or replace function public.create_shifts(
  p_org uuid,
  p_profession public.profession,
  p_shifts jsonb,
  p_publish boolean default false
)
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
  v_slots int;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  perform private.assert_admin(p_org);
  if p_profession is null then perform private.fail('profession.invalid'); end if;
  v_queue := private.lock_queue(private.profession_queue(p_org, p_profession));
  if jsonb_typeof(p_shifts) <> 'array' or jsonb_array_length(p_shifts) = 0 or jsonb_array_length(p_shifts) > 200 then
    perform private.fail('shift.invalid_batch');
  end if;
  select timezone into v_tz from public.organizations where id = p_org;

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
      v_slots := coalesce((v_item ->> 'slots')::int, 1);
    exception when others then
      perform private.fail('shift.invalid_time', sqlerrm);
    end;
    if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '48 hours' then
      perform private.fail('shift.invalid_time');
    end if;
    if v_slots not between 1 and 50 then
      perform private.fail('shift.invalid_slots');
    end if;
    if p_publish and v_start <= now() then
      perform private.fail('shift.in_past');
    end if;
    insert into public.shifts (org_id, queue_id, starts_at, ends_at, unit, notes, slots, batch_id, created_by)
    values (p_org, v_queue.id, v_start, v_end,
            left(coalesce(v_item ->> 'unit', ''), 120), left(coalesce(v_item ->> 'notes', ''), 2000),
            v_slots, v_batch, auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;
    perform private.audit(p_org, 'shift.created', p_queue => v_queue.id, p_shift => v_id,
      p_payload => jsonb_build_object('starts_at', v_start, 'ends_at', v_end, 'slots', v_slots,
        'profession', p_profession, 'batch_id', v_batch));
  end loop;

  if p_publish then
    update public.shifts set status = 'open', published_at = now() where id = any (v_ids);
    perform private.audit(p_org, 'shift.published', p_queue => v_queue.id, p_shift => x,
      p_payload => jsonb_build_object('batch_id', v_batch))
    from unnest(v_ids) x;
    perform private.fill_queue(v_queue.id);
    perform private.notify_if_short(x) from unnest(v_ids) x;
    perform private.after_change(v_queue.id);
  end if;
  return query select unnest(v_ids);
end;
$$;

-- Publishing assigns at once (no offers). Shifts published together are
-- processed in shift-start order, each taking the next people in line.
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
  for s in select * from public.shifts where id = any (p_shift_ids) order by starts_at, created_at, id loop
    if s.status <> 'draft' then perform private.fail('shift.not_draft'); end if;
    if s.starts_at <= now() then perform private.fail('shift.in_past'); end if;
    update public.shifts set status = 'open', published_at = now() where id = s.id;
    perform private.audit(s.org_id, 'shift.published', p_queue => s.queue_id, p_shift => s.id,
      p_payload => jsonb_build_object('slots', s.slots));
  end loop;
  foreach v_qid in array v_queues loop
    perform private.fill_queue(v_qid);
  end loop;
  perform private.notify_if_short(x) from unnest(p_shift_ids) x;
  foreach v_qid in array v_queues loop
    perform private.after_change(v_qid);
  end loop;
end;
$$;

-- Drafts: everything editable except the profession. After publishing only
-- the notes can change; to change anything else, cancel and create a new one.
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
  r record;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  perform private.lock_queue(s.queue_id);
  select * into s from public.shifts where id = p_shift;
  if s.status in ('completed', 'cancelled') then perform private.fail('shift.final'); end if;

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
  if p_patch ? 'slots' then
    begin
      s.slots := (p_patch ->> 'slots')::int;
    exception when others then
      perform private.fail('shift.invalid_slots');
    end;
    if s.slots is null or s.slots not between 1 and 50 then perform private.fail('shift.invalid_slots'); end if;
  end if;

  update public.shifts set starts_at = s.starts_at, ends_at = s.ends_at, unit = s.unit, notes = s.notes, slots = s.slots
  where id = p_shift;
  perform private.audit(s.org_id, 'shift.updated', p_queue => s.queue_id, p_shift => s.id,
    p_payload => jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k)));

  for r in select user_id from public.assignments where shift_id = p_shift and status = 'active' loop
    perform private.notify(r.user_id, s.org_id, 'shift_updated', private.shift_payload(s));
  end loop;
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

-- Decision c: cancelling puts every assignee back at their ORIGINAL position
-- (their ticket kept its seq while it was held). A shift that has started
-- cannot be cancelled: mark it completed or record a no-show instead.
create or replace function public.cancel_shift(p_shift uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
  a public.assignments;
  v_entry public.queue_entries;
begin
  select * into s from public.shifts where id = p_shift;
  if s.id is null then perform private.fail('shift.not_found'); end if;
  perform private.assert_admin(s.org_id);
  perform private.lock_queue(s.queue_id);
  select * into s from public.shifts where id = p_shift;
  if s.status = 'draft' then perform private.fail('shift.is_draft'); end if;
  if s.status in ('completed', 'cancelled') then perform private.fail('shift.final'); end if;
  if s.starts_at <= now() then perform private.fail('shift.already_started'); end if;

  for a in select * from public.assignments where shift_id = p_shift and status = 'active' loop
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
  end loop;

  update public.shifts set status = 'cancelled', cancelled_reason = p_reason, ended_at = clock_timestamp()
  where id = p_shift;
  perform private.audit(s.org_id, 'shift.cancelled', p_queue => s.queue_id, p_shift => s.id, p_reason => p_reason,
    p_payload => jsonb_build_object('previous_status', s.status));
  -- Restored people are back in line, so they may take another open shift.
  perform private.fill_queue(s.queue_id);
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
  if s.status not in ('open', 'filled') then perform private.fail('shift.invalid_state'); end if;
  if s.starts_at > now() then perform private.fail('shift.not_started'); end if;
  perform private.complete_shift_locked(p_shift);
  perform private.fill_queue(s.queue_id);
  perform private.after_change(s.queue_id);
end;
$$;

-- Decision g: a no-show is recorded per person and has the same consequence as
-- a completed shift (rejoin at the end). It can also correct a completed
-- assignment up to 7 days after the shift ended (record only).
create or replace function public.mark_no_show(p_assignment uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.assignments;
  s public.shifts;
  v_queue public.queues;
  v_correction boolean;
begin
  select * into a from public.assignments where id = p_assignment;
  if a.id is null then perform private.fail('assignment.not_found'); end if;
  perform private.assert_admin(a.org_id);
  v_queue := private.lock_queue(a.queue_id);
  select * into a from public.assignments where id = p_assignment;
  select * into s from public.shifts where id = a.shift_id;

  if a.status = 'active' then
    if s.starts_at > now() then perform private.fail('shift.not_started'); end if;
    v_correction := false;
  elsif a.status = 'completed' then
    if coalesce(a.ended_at, s.ends_at) < now() - interval '7 days' then
      perform private.fail('shift.correction_window_passed');
    end if;
    v_correction := true;
  else
    perform private.fail('shift.invalid_state');
  end if;

  update public.assignments set status = 'no_show', ended_at = coalesce(ended_at, clock_timestamp()),
    ended_by = auth.uid(), reason = p_reason
  where id = a.id;
  perform private.audit(a.org_id, 'assignment.no_show', p_queue => a.queue_id, p_shift => a.shift_id,
    p_subject => a.user_id, p_reason => p_reason,
    p_payload => jsonb_build_object('assignment_id', a.id, 'correction', v_correction));
  if not v_correction then
    perform private.close_entry(a.entry_id, 'no_show');
    perform private.after_shift_end(v_queue, a.user_id, s);
  end if;
  perform private.after_change(a.queue_id);
end;
$$;

-- Decision b: give a shift back before it starts. The slot goes at once to the
-- person now first in line; the giver can rejoin, only at the end.
create or replace function public.give_back_shift(p_shift uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  a public.assignments;
  s public.shifts;
begin
  select * into a from public.assignments where shift_id = p_shift and user_id = v_uid and status = 'active';
  if a.id is null then perform private.fail('assignment.not_found'); end if;
  perform private.lock_queue(a.queue_id);
  select * into a from public.assignments where id = a.id;
  if a.status <> 'active' then perform private.fail('assignment.not_found'); end if;
  select * into s from public.shifts where id = p_shift;
  if s.starts_at <= clock_timestamp() then perform private.fail('shift.already_started'); end if;

  update public.assignments set status = 'withdrawn', ended_at = clock_timestamp(), ended_by = v_uid,
    reason = p_reason
  where id = a.id;
  perform private.close_entry(a.entry_id, 'withdrew');
  update public.shifts set status = 'open' where id = p_shift and status = 'filled';
  perform private.audit(a.org_id, 'assignment.given_back', p_queue => a.queue_id, p_shift => p_shift,
    p_subject => v_uid, p_reason => p_reason, p_payload => jsonb_build_object('assignment_id', a.id));
  perform private.notify_admins(a.org_id, 'shift_given_back', private.shift_payload(s));
  perform private.fill_queue(a.queue_id);
  perform private.after_change(a.queue_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
-- Staff home screen: one row per hospital. Only the caller's own position and
-- the queue size; never anyone else's identity.
create or replace function public.my_queue(p_org uuid default null)
returns table (
  org_id uuid,
  org_timezone text,
  profession public.profession,
  queue_id uuid,
  state text,                -- no_profession | not_joined | waiting | paused | assigned
  queue_position int,
  queue_total int,
  joined_at timestamptz,
  auto_rejoin boolean,
  shift_id uuid,
  shift_starts_at timestamptz,
  shift_ends_at timestamptz,
  shift_unit text,
  shift_notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, o.timezone, m.profession, q.id,
    case when q.id is null then 'no_profession'
         when e.id is null then 'not_joined'
         when e.status = 'held' then 'assigned'
         else e.status::text end,
    private.entry_position(e),
    case when q.id is not null then private.queue_size(q.id) end,
    e.joined_at,
    coalesce(p.auto_rejoin, false),
    s.id, s.starts_at, s.ends_at, s.unit, s.notes
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  left join public.queues q on q.org_id = m.org_id and q.profession = m.profession and q.archived_at is null
  left join public.queue_entries e on e.queue_id = q.id and e.user_id = m.user_id and e.closed_at is null
  left join public.assignments a on a.id = e.held_assignment_id
  left join public.shifts s on s.id = a.shift_id
  left join public.member_queue_prefs p on p.queue_id = q.id and p.user_id = m.user_id
  where m.user_id = auth.uid() and m.status = 'active' and (p_org is null or m.org_id = p_org)
  order by o.name;
$$;

create or replace function public.my_shifts(p_scope text default 'upcoming', p_org uuid default null)
returns table (
  assignment_id uuid, shift_id uuid, queue_id uuid, profession public.profession, org_id uuid, org_timezone text,
  starts_at timestamptz, ends_at timestamptz, unit text, notes text, slots int,
  assignment_status public.assignment_status, shift_status public.shift_status, assigned_at timestamptz,
  queue_position int
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, s.id, q.id, q.profession, s.org_id, org.timezone, s.starts_at, s.ends_at, s.unit, s.notes, s.slots,
         a.status, s.status, a.assigned_at, a.queue_position
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

-- Managers: the two queues with live counts.
create or replace function public.admin_queue_overview(p_org uuid)
returns table (
  queue_id uuid, profession public.profession, waiting int, paused int, assigned int,
  open_shifts int, open_slots int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  select q.id, q.profession,
    (select count(*)::int from public.queue_entries e where e.queue_id = q.id and e.closed_at is null and e.status = 'waiting'),
    (select count(*)::int from public.queue_entries e where e.queue_id = q.id and e.closed_at is null and e.status = 'paused'),
    (select count(*)::int from public.queue_entries e where e.queue_id = q.id and e.closed_at is null and e.status = 'held'),
    (select count(*)::int from public.shifts s where s.queue_id = q.id and s.status = 'open' and s.starts_at > now()),
    (select coalesce(sum(s.slots - private.active_assignments(s.id)), 0)::int from public.shifts s
      where s.queue_id = q.id and s.status = 'open' and s.starts_at > now())
  from public.queues q
  where q.org_id = p_org and q.archived_at is null
  order by q.profession;
end;
$$;

-- Managers: live queue view. Position, name, joined at. No reordering, ever.
create or replace function public.queue_roster(p_queue uuid)
returns table (
  queue_position int,
  user_id uuid,
  display_name text,
  state text,                -- waiting | paused | assigned
  joined_at timestamptz,
  paused_at timestamptz,
  assigned_shift_id uuid,
  assigned_shift_starts_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.queues where id = p_queue;
  if v_org is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v_org);
  return query
  select private.entry_position(e), e.user_id,
    case when pr.deleted_at is not null then '' else pr.display_name end,
    case when e.status = 'held' then 'assigned' else e.status::text end,
    e.joined_at, e.paused_at, s.id, s.starts_at
  from public.queue_entries e
  join public.profiles pr on pr.id = e.user_id
  left join public.assignments a on a.id = e.held_assignment_id
  left join public.shifts s on s.id = a.shift_id
  where e.queue_id = p_queue and e.closed_at is null
  order by (e.status = 'held'), e.seq;
end;
$$;

-- Managers: shift lists.
--   drafts  : not published yet
--   open    : published, free slots, not started
--   history : fully assigned, started, completed or cancelled (filter by period)
create or replace function public.admin_shifts(
  p_org uuid,
  p_scope text default 'open',
  p_profession public.profession default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_shift uuid default null
)
returns table (
  shift_id uuid, queue_id uuid, profession public.profession, starts_at timestamptz, ends_at timestamptz,
  unit text, notes text, status public.shift_status, slots int, filled int, published_at timestamptz,
  cancelled_reason text, assignees jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  select s.id, s.queue_id, q.profession, s.starts_at, s.ends_at, s.unit, s.notes, s.status, s.slots,
    private.active_assignments(s.id) + (select count(*)::int from public.assignments x
      where x.shift_id = s.id and x.status in ('completed', 'no_show')),
    s.published_at, s.cancelled_reason,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id, 'user_id', a.user_id,
        'display_name', case when p.deleted_at is not null then '' else p.display_name end,
        'status', a.status, 'position', a.queue_position, 'assigned_at', a.assigned_at,
        'reason', a.reason) order by a.assigned_at, a.queue_position)
      from public.assignments a join public.profiles p on p.id = a.user_id
      where a.shift_id = s.id
    ), '[]'::jsonb)
  from public.shifts s
  join public.queues q on q.id = s.queue_id
  where s.org_id = p_org
    and (p_shift is null or s.id = p_shift)
    and (p_profession is null or q.profession = p_profession)
    and (p_shift is not null
      or (p_scope = 'drafts' and s.status = 'draft')
      or (p_scope = 'open' and s.status = 'open' and s.starts_at > now())
      or (p_scope = 'history' and s.status <> 'draft' and not (s.status = 'open' and s.starts_at > now())
          and (p_from is null or s.starts_at >= p_from) and (p_to is null or s.starts_at < p_to)))
  order by case when p_scope = 'history' and p_shift is null then s.starts_at end desc,
           s.starts_at asc
  limit 500;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler (pg_cron, every 15 s). Idempotent; SKIP LOCKED never blocks users.
-- ---------------------------------------------------------------------------
create or replace function private.process_queue(p_queue uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  s public.shifts;
  v_changes int := 0;
  v_filled int;
begin
  select * into v_queue from public.queues where id = p_queue for update skip locked;
  if v_queue.id is null then
    return false;
  end if;

  -- 1. Shifts that start now: no more filling. Tell managers if slots stayed free.
  for s in
    select * from public.shifts
    where queue_id = p_queue and status in ('open', 'filled') and starts_at <= clock_timestamp()
      and start_processed_at is null
  loop
    update public.shifts set start_processed_at = clock_timestamp() where id = s.id;
    select count(*)::int into v_filled from public.assignments
    where shift_id = s.id and status in ('active', 'completed', 'no_show');
    if v_filled < s.slots then
      perform private.audit(s.org_id, 'shift.started_short', p_queue => p_queue, p_shift => s.id,
        p_payload => jsonb_build_object('filled', v_filled, 'slots', s.slots));
      perform private.notify_admins(s.org_id, 'shift_started_short',
        private.shift_payload(s) || jsonb_build_object('filled', v_filled), 'started_short:' || s.id::text);
    end if;
    v_changes := v_changes + 1;
  end loop;

  -- 2. Shifts past their end time are completed automatically.
  for s in
    select * from public.shifts
    where queue_id = p_queue and status in ('open', 'filled') and ends_at <= clock_timestamp()
    order by ends_at
  loop
    perform private.complete_shift_locked(s.id);
    v_changes := v_changes + 1;
  end loop;

  -- 3. Fill whatever can be filled (e.g. a user lock was busy last time).
  v_changes := v_changes + private.fill_queue(p_queue);

  if v_changes > 0 then
    perform private.after_change(p_queue);
  end if;
  return true;
end;
$$;

-- Sweeps the queues that may need work, committing after each queue.
-- NOTE: no SECURITY DEFINER / SET clause here: Postgres forbids COMMIT inside
-- such procedures. It runs as the pg_cron job owner and is fully schema-qualified.
create or replace procedure private.process_due()
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select q.id from public.queues q
    where q.archived_at is null
      and exists (select 1 from public.shifts s where s.queue_id = q.id and s.status in ('open', 'filled'))
    order by q.id
  loop
    begin
      perform private.process_queue(r.id);
    exception when others then
      -- One broken queue must never stop the others.
      raise warning 'process_queue(%) failed: %', r.id, sqlerrm;
    end;
    commit;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: staff see the shifts they are assigned to.
-- ---------------------------------------------------------------------------
create or replace function private.can_see_shift(p_shift uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.assignments where shift_id = p_shift and user_id = auth.uid());
$$;

grant execute on function
  public.join_queue(uuid),
  public.leave_queue(uuid),
  public.pause_queue(uuid),
  public.resume_queue(uuid),
  public.set_queue_auto_rejoin(uuid, boolean),
  public.admin_remove_entry(uuid, uuid, text),
  public.create_shifts(uuid, public.profession, jsonb, boolean),
  public.publish_shifts(uuid[]),
  public.update_shift(uuid, jsonb),
  public.delete_draft_shift(uuid),
  public.cancel_shift(uuid, text),
  public.complete_shift(uuid),
  public.mark_no_show(uuid, text),
  public.give_back_shift(uuid, text),
  public.my_queue(uuid),
  public.my_shifts(text, uuid),
  public.admin_queue_overview(uuid),
  public.queue_roster(uuid),
  public.admin_shifts(uuid, text, public.profession, timestamptz, timestamptz, uuid)
to authenticated;
