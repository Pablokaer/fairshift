-- Queues (pools), pool eligibility, queue entries ("tickets"), staff queue actions.
set check_function_bodies = off;
--
-- CONCURRENCY CONTRACT (see ARCHITECTURE.md):
--   * Every function that changes a queue's state first locks the queue row
--     (private.lock_queue -> SELECT ... FOR UPDATE). All state changes of one
--     queue are therefore serialized.
--   * Functions touching several queues lock them in ascending id order.
--   * Per-user advisory locks are only ever taken AFTER queue locks.

create table public.queues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  -- policies
  acceptance_window interval not null default interval '30 minutes'
    check (acceptance_window between interval '1 minute' and interval '7 days'),
  decline_policy public.position_policy not null default 'keep',
  timeout_policy public.position_policy not null default 'keep',
  pausing_allowed boolean not null default true,
  withdraw_cooldown interval not null default interval '0'
    check (withdraw_cooldown between interval '0' and interval '90 days'),
  no_show_policy public.no_show_policy not null default 'rejoin_end',
  no_show_cooldown interval not null default interval '0'
    check (no_show_cooldown between interval '0' and interval '365 days'),
  -- Optional (off by default): auto-pause after N consecutive offer timeouts.
  auto_pause_after_timeouts int check (auto_pause_after_timeouts between 1 and 20),
  -- After a withdrawal: restart the offer round from the front (default) or continue.
  reoffer_after_withdraw public.reoffer_policy not null default 'restart',
  -- Optional (off by default): opening-window lottery. Everyone who joins before
  -- lottery_ends_at gets a random order at that moment; afterwards rule 2 applies.
  lottery_ends_at timestamptz,
  lottery_drawn_at timestamptz,
  version bigint not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index queues_org_idx on public.queues (org_id);

-- Pool eligibility, controlled by admins.
create table public.queue_members (
  queue_id uuid not null references public.queues (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  added_by uuid references public.profiles (id),
  added_at timestamptz not null default now(),
  primary key (queue_id, user_id)
);
create index queue_members_user_idx on public.queue_members (user_id);

-- Ticket numbers. Drawn while holding the queue lock, so within one queue the
-- sequence order equals the commit order equals joined_at order.
create sequence private.queue_entry_seq as bigint;

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.queues (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  seq bigint not null,
  joined_at timestamptz not null,
  status public.entry_status not null default 'waiting',
  paused_at timestamptz,
  held_assignment_id uuid,
  consecutive_timeouts int not null default 0,
  top3_notified_at timestamptz,
  closed_at timestamptz,
  close_reason public.entry_close_reason,
  closed_by uuid references public.profiles (id),
  constraint queue_entries_seq_key unique (seq) deferrable initially immediate,
  check ((closed_at is null) = (close_reason is null)),
  check ((status = 'held') = (held_assignment_id is not null))
);
-- Rule 4: at most one open ticket per person per queue (held tickets included).
create unique index queue_entries_one_open on public.queue_entries (queue_id, user_id) where closed_at is null;
create index queue_entries_open_order on public.queue_entries (queue_id, seq) where closed_at is null;
create index queue_entries_user_idx on public.queue_entries (user_id) where closed_at is null;

create table public.member_queue_prefs (
  queue_id uuid not null references public.queues (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  auto_rejoin boolean not null default false,
  cooldown_until timestamptz,
  rejoin_requires_approval boolean not null default false,
  primary key (queue_id, user_id)
);

-- ---------------------------------------------------------------------------
-- RLS: staff only ever read their OWN tickets. Positions are exposed through
-- my_queues(), which returns numbers, never other people's identities.
-- ---------------------------------------------------------------------------
create or replace function private.is_queue_member(p_queue uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.queue_members qm
    join public.memberships m on m.org_id = qm.org_id and m.user_id = qm.user_id and m.status = 'active'
    where qm.queue_id = p_queue and qm.user_id = auth.uid()
  );
$$;
grant execute on function private.is_queue_member(uuid) to authenticated, service_role;

alter table public.queues enable row level security;
alter table public.queue_members enable row level security;
alter table public.queue_entries enable row level security;
alter table public.member_queue_prefs enable row level security;

create policy queues_select on public.queues for select to authenticated
  using (private.is_admin(org_id) or private.is_queue_member(id));
create policy queue_members_select on public.queue_members for select to authenticated
  using (user_id = auth.uid() or private.is_admin(org_id));
create policy queue_entries_select on public.queue_entries for select to authenticated
  using (user_id = auth.uid() or private.is_admin(org_id));
create policy member_queue_prefs_select on public.member_queue_prefs for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.queues q where q.id = queue_id and private.is_admin(q.org_id)));

revoke all on public.queues, public.queue_members, public.queue_entries, public.member_queue_prefs from anon;
revoke insert, update, delete, truncate on public.queues, public.queue_members, public.queue_entries,
  public.member_queue_prefs from authenticated;
grant select on public.queues, public.queue_members, public.queue_entries, public.member_queue_prefs to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function private.lock_queue(p_queue uuid)
returns public.queues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queues;
begin
  select * into v from public.queues where id = p_queue for update;
  if not found then
    perform private.fail('queue.not_found');
  end if;
  return v;
end;
$$;

create or replace function private.lock_user(p_user uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(private.user_lock_key(p_user));
$$;

create or replace function private.open_entry(p_queue uuid, p_user uuid)
returns public.queue_entries
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.queue_entries
  where queue_id = p_queue and user_id = p_user and closed_at is null;
$$;

-- 1-based position among open waiting/paused tickets (paused people hold their place).
create or replace function private.entry_position(p_entry public.queue_entries)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_entry.status = 'held' or p_entry.closed_at is not null then null
  else (
    select count(*)::int from public.queue_entries e
    where e.queue_id = p_entry.queue_id and e.closed_at is null
      and e.status in ('waiting', 'paused') and e.seq <= p_entry.seq
  ) end;
$$;

-- Issue a new ticket at the END of the queue. Caller must hold the queue lock.
create or replace function private.insert_entry(
  p_queue public.queues,
  p_user uuid,
  p_status public.entry_status default 'waiting',
  p_consecutive_timeouts int default 0
)
returns public.queue_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queue_entries;
  v_pos int;
begin
  insert into public.queue_entries (queue_id, org_id, user_id, seq, joined_at, status, paused_at, consecutive_timeouts)
  values (p_queue.id, p_queue.org_id, p_user, nextval('private.queue_entry_seq'), clock_timestamp(),
          p_status, case when p_status = 'paused' then clock_timestamp() end, p_consecutive_timeouts)
  returning * into v;
  -- Someone who *joins* inside the top 3 did not "move into" it: no top-3 alert.
  v_pos := private.entry_position(v);
  if v_pos <= 3 then
    update public.queue_entries set top3_notified_at = now() where id = v.id returning * into v;
  end if;
  return v;
end;
$$;

create or replace function private.close_entry(
  p_entry_id uuid,
  p_reason public.entry_close_reason
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.queue_entries
  set closed_at = clock_timestamp(), close_reason = p_reason, closed_by = auth.uid(),
      status = case when status = 'held' then 'waiting'::public.entry_status else status end,
      held_assignment_id = null
  where id = p_entry_id and closed_at is null;
$$;

-- Decline/timeout policy "move_to_end": the old ticket is closed and a new one
-- is issued at the end (equivalent to leaving and rejoining).
create or replace function private.move_to_end(p_entry public.queue_entries, p_cause text)
returns public.queue_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  v_new public.queue_entries;
begin
  select * into v_queue from public.queues where id = p_entry.queue_id;
  perform private.close_entry(p_entry.id, 'moved_to_end');
  v_new := private.insert_entry(v_queue, p_entry.user_id, p_entry.status, p_entry.consecutive_timeouts);
  perform private.audit(v_queue.org_id, 'entry.moved_to_end', p_queue => v_queue.id, p_subject => p_entry.user_id,
    p_reason => p_cause,
    p_payload => jsonb_build_object('old_entry_id', p_entry.id, 'new_entry_id', v_new.id,
                                    'old_seq', p_entry.seq, 'new_seq', v_new.seq));
  return v_new;
end;
$$;

-- Opening-window lottery: permute the existing ticket numbers of everyone who
-- joined during the window. The SET of numbers is unchanged, so nobody who
-- joined after the window is affected.
create or replace function private.draw_lottery(p_queue uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  v_order jsonb;
begin
  select * into v_queue from public.queues where id = p_queue;
  if v_queue.lottery_ends_at is null or v_queue.lottery_drawn_at is not null then
    return;
  end if;
  set constraints public.queue_entries_seq_key deferred;
  with window_entries as (
    select id, seq from public.queue_entries
    where queue_id = p_queue and closed_at is null and joined_at < v_queue.lottery_ends_at
  ),
  seqs as (
    select seq, row_number() over (order by seq) rn from window_entries
  ),
  shuffled as (
    -- gen_random_uuid() is backed by a CSPRNG
    select id, row_number() over (order by gen_random_uuid()) rn from window_entries
  )
  update public.queue_entries e
  set seq = s.seq, top3_notified_at = null
  from shuffled sh join seqs s on s.rn = sh.rn
  where e.id = sh.id;
  set constraints public.queue_entries_seq_key immediate;

  select coalesce(jsonb_agg(id order by seq), '[]'::jsonb) into v_order
  from public.queue_entries
  where queue_id = p_queue and closed_at is null and joined_at < v_queue.lottery_ends_at;

  update public.queues set lottery_drawn_at = clock_timestamp() where id = p_queue;
  perform private.audit(v_queue.org_id, 'queue.lottery_drawn', p_queue => p_queue,
    p_payload => jsonb_build_object('entry_order', v_order));
end;
$$;

-- Called at the end of every state-changing operation on a queue:
-- bumps the version, sends "moved into top 3" alerts and broadcasts a
-- content-free change signal to subscribed clients.
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
  if v_queue.lottery_ends_at is null or v_queue.lottery_drawn_at is not null then
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
        jsonb_build_object('queue_id', p_queue, 'queue_name', v_queue.name, 'position', r.pos),
        'top3:' || r.id::text);
      update public.queue_entries set top3_notified_at = now() where id = r.id;
    end loop;
  end if;

  perform realtime.send(jsonb_build_object('queue_id', p_queue, 'version', v_queue.version),
    'queue_changed', 'queue:' || p_queue::text, true);
  perform realtime.send(jsonb_build_object('queue_id', p_queue, 'version', v_queue.version),
    'queue_changed', 'org:' || v_queue.org_id::text || ':admin', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: queue management
-- ---------------------------------------------------------------------------
-- Policy JSON keys (all optional):
--   acceptance_window_minutes, decline_policy, timeout_policy, pausing_allowed,
--   withdraw_cooldown_hours, no_show_policy, no_show_cooldown_hours,
--   auto_pause_after_timeouts (0/null = off), reoffer_after_withdraw, lottery_ends_at
create or replace function private.apply_queue_policy(p_base public.queues, p_policy jsonb)
returns public.queues
language plpgsql
stable
as $$
declare
  v public.queues := p_base;
  p jsonb := coalesce(p_policy, '{}'::jsonb);
begin
  if p ? 'acceptance_window_minutes' then
    v.acceptance_window := make_interval(mins => (p ->> 'acceptance_window_minutes')::int);
  end if;
  if p ? 'decline_policy' then v.decline_policy := (p ->> 'decline_policy')::public.position_policy; end if;
  if p ? 'timeout_policy' then v.timeout_policy := (p ->> 'timeout_policy')::public.position_policy; end if;
  if p ? 'pausing_allowed' then v.pausing_allowed := (p ->> 'pausing_allowed')::boolean; end if;
  if p ? 'withdraw_cooldown_hours' then
    v.withdraw_cooldown := make_interval(secs => (p ->> 'withdraw_cooldown_hours')::numeric * 3600);
  end if;
  if p ? 'no_show_policy' then v.no_show_policy := (p ->> 'no_show_policy')::public.no_show_policy; end if;
  if p ? 'no_show_cooldown_hours' then
    v.no_show_cooldown := make_interval(secs => (p ->> 'no_show_cooldown_hours')::numeric * 3600);
  end if;
  if p ? 'auto_pause_after_timeouts' then
    v.auto_pause_after_timeouts := nullif((p ->> 'auto_pause_after_timeouts')::int, 0);
  end if;
  if p ? 'reoffer_after_withdraw' then
    v.reoffer_after_withdraw := (p ->> 'reoffer_after_withdraw')::public.reoffer_policy;
  end if;
  if p ? 'lottery_ends_at' then
    v.lottery_ends_at := (p ->> 'lottery_ends_at')::timestamptz;
  end if;
  return v;
exception
  when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range
    or invalid_datetime_format or datetime_field_overflow then
    perform private.fail('queue.invalid_policy', sqlerrm);
    return null;
end;
$$;

create or replace function private.queue_policy_json(q public.queues)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'acceptance_window_minutes', extract(epoch from q.acceptance_window)::int / 60,
    'decline_policy', q.decline_policy,
    'timeout_policy', q.timeout_policy,
    'pausing_allowed', q.pausing_allowed,
    'withdraw_cooldown_hours', round(extract(epoch from q.withdraw_cooldown) / 3600, 2),
    'no_show_policy', q.no_show_policy,
    'no_show_cooldown_hours', round(extract(epoch from q.no_show_cooldown) / 3600, 2),
    'auto_pause_after_timeouts', q.auto_pause_after_timeouts,
    'reoffer_after_withdraw', q.reoffer_after_withdraw,
    'lottery_ends_at', q.lottery_ends_at);
$$;

create or replace function public.create_queue(
  p_org uuid,
  p_name text,
  p_description text default '',
  p_policy jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queues;
begin
  perform private.assert_admin(p_org);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    perform private.fail('queue.invalid_name');
  end if;
  v.org_id := p_org;
  v.name := btrim(p_name);
  v.description := coalesce(p_description, '');
  v.acceptance_window := interval '30 minutes';
  v.decline_policy := 'keep';
  v.timeout_policy := 'keep';
  v.pausing_allowed := true;
  v.withdraw_cooldown := interval '0';
  v.no_show_policy := 'rejoin_end';
  v.no_show_cooldown := interval '0';
  v.reoffer_after_withdraw := 'restart';
  v := private.apply_queue_policy(v, p_policy);
  if v.lottery_ends_at is not null and v.lottery_ends_at <= now() then
    perform private.fail('queue.invalid_policy', 'lottery_ends_at must be in the future');
  end if;

  begin
    insert into public.queues (org_id, name, description, acceptance_window, decline_policy, timeout_policy,
      pausing_allowed, withdraw_cooldown, no_show_policy, no_show_cooldown, auto_pause_after_timeouts,
      reoffer_after_withdraw, lottery_ends_at, created_by)
    values (v.org_id, v.name, v.description, v.acceptance_window, v.decline_policy, v.timeout_policy,
      v.pausing_allowed, v.withdraw_cooldown, v.no_show_policy, v.no_show_cooldown, v.auto_pause_after_timeouts,
      v.reoffer_after_withdraw, v.lottery_ends_at, auth.uid())
    returning * into v;
  exception when check_violation then
    perform private.fail('queue.invalid_policy', sqlerrm);
  end;

  perform private.audit(p_org, 'queue.created', p_queue => v.id,
    p_payload => jsonb_build_object('name', v.name, 'policy', private.queue_policy_json(v)));
  return v.id;
end;
$$;

create or replace function public.update_queue(
  p_queue uuid,
  p_name text default null,
  p_description text default null,
  p_policy jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.queues;
  v public.queues;
begin
  select * into v from public.queues where id = p_queue;
  if v.id is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v.org_id);
  v_before := private.lock_queue(p_queue);
  if v_before.archived_at is not null then perform private.fail('queue.archived'); end if;

  v := private.apply_queue_policy(v_before, p_policy);
  if p_name is not null then
    if char_length(btrim(p_name)) not between 1 and 80 then perform private.fail('queue.invalid_name'); end if;
    v.name := btrim(p_name);
  end if;
  if p_description is not null then v.description := p_description; end if;

  -- The lottery window can only be changed before it has been drawn.
  if v.lottery_ends_at is distinct from v_before.lottery_ends_at then
    if v_before.lottery_drawn_at is not null then
      perform private.fail('queue.lottery_already_drawn');
    end if;
    if v.lottery_ends_at is not null and v.lottery_ends_at <= now() then
      perform private.fail('queue.invalid_policy', 'lottery_ends_at must be in the future');
    end if;
    if v_before.lottery_ends_at is null and exists (
      select 1 from public.queue_entries where queue_id = p_queue
    ) then
      -- Turning a lottery on after people already joined would re-order them.
      perform private.fail('queue.lottery_after_joins');
    end if;
  end if;

  begin
    update public.queues set
      name = v.name, description = v.description,
      acceptance_window = v.acceptance_window, decline_policy = v.decline_policy,
      timeout_policy = v.timeout_policy, pausing_allowed = v.pausing_allowed,
      withdraw_cooldown = v.withdraw_cooldown, no_show_policy = v.no_show_policy,
      no_show_cooldown = v.no_show_cooldown, auto_pause_after_timeouts = v.auto_pause_after_timeouts,
      reoffer_after_withdraw = v.reoffer_after_withdraw, lottery_ends_at = v.lottery_ends_at
    where id = p_queue;
  exception when check_violation then
    perform private.fail('queue.invalid_policy', sqlerrm);
  end;

  perform private.audit(v.org_id, 'queue.updated', p_queue => p_queue, p_payload => jsonb_build_object(
    'name', v.name, 'before', private.queue_policy_json(v_before), 'after', private.queue_policy_json(v)));
  -- Policy changes never move anyone; dispatch in case e.g. a lottery was removed.
  perform private.dispatch(p_queue);
  perform private.after_change(p_queue);
end;
$$;

create or replace function public.archive_queue(p_queue uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queues;
  r record;
begin
  select * into v from public.queues where id = p_queue;
  if v.id is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v.org_id);
  v := private.lock_queue(p_queue);
  if v.archived_at is not null then return; end if;
  if exists (select 1 from public.shifts where queue_id = p_queue
             and status in ('published', 'offered', 'assigned', 'unfilled') and ends_at > now()) then
    perform private.fail('queue.has_open_shifts');
  end if;
  -- Shifts that already ended but were not auto-completed yet are completed first.
  for r in select id from public.shifts where queue_id = p_queue and status = 'assigned' and ends_at <= now() loop
    perform private.complete_shift_locked(r.id);
  end loop;
  for r in select id, user_id, seq from public.queue_entries where queue_id = p_queue and closed_at is null loop
    perform private.resolve_open_offer(p_queue, r.user_id, 'revoked', 'queue_archived');
    perform private.close_entry(r.id, 'queue_archived');
    perform private.audit(v.org_id, 'entry.removed', p_queue => p_queue, p_subject => r.user_id,
      p_reason => 'queue_archived', p_payload => jsonb_build_object('entry_id', r.id, 'seq', r.seq));
  end loop;
  update public.shifts set status = 'cancelled' where queue_id = p_queue and status = 'draft';
  update public.queues set archived_at = now() where id = p_queue;
  perform private.audit(v.org_id, 'queue.archived', p_queue => p_queue, p_reason => p_reason);
  perform private.after_change(p_queue);
end;
$$;

create or replace function public.add_queue_members(p_queue uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queues;
  v_uid uuid;
  v_count int := 0;
begin
  select * into v from public.queues where id = p_queue;
  if v.id is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v.org_id);
  v := private.lock_queue(p_queue);
  if v.archived_at is not null then perform private.fail('queue.archived'); end if;
  foreach v_uid in array coalesce(p_user_ids, '{}') loop
    if not exists (select 1 from public.memberships where org_id = v.org_id and user_id = v_uid and status = 'active') then
      perform private.fail('member.not_found');
    end if;
    insert into public.queue_members (queue_id, org_id, user_id, added_by)
    values (p_queue, v.org_id, v_uid, auth.uid())
    on conflict do nothing;
    if found then
      v_count := v_count + 1;
      perform private.audit(v.org_id, 'pool.member_added', p_queue => p_queue, p_subject => v_uid);
      perform private.notify(v_uid, v.org_id, 'pool_added',
        jsonb_build_object('queue_id', p_queue, 'queue_name', v.name));
    end if;
  end loop;
  return v_count;
end;
$$;

-- Revokes eligibility for the pool. Closes the person's ticket if any.
create or replace function public.remove_queue_member(p_queue uuid, p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queues;
  v_entry public.queue_entries;
begin
  select * into v from public.queues where id = p_queue;
  if v.id is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v.org_id);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    perform private.fail('removal.reason_required');
  end if;
  v := private.lock_queue(p_queue);
  v_entry := private.open_entry(p_queue, p_user);
  if v_entry.id is not null then
    if v_entry.status = 'held' then
      perform private.fail('queue.entry_held');
    end if;
    perform private.resolve_open_offer(p_queue, p_user, 'revoked', 'eligibility_revoked');
    perform private.close_entry(v_entry.id, 'eligibility_revoked');
    perform private.audit(v.org_id, 'entry.removed', p_queue => p_queue, p_subject => p_user,
      p_reason => p_reason, p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq));
  end if;
  delete from public.queue_members where queue_id = p_queue and user_id = p_user;
  if found then
    perform private.audit(v.org_id, 'pool.member_removed', p_queue => p_queue, p_subject => p_user, p_reason => p_reason);
    perform private.notify(p_user, v.org_id, 'pool_removed', jsonb_build_object('queue_id', p_queue, 'queue_name', v.name));
  end if;
  perform private.dispatch(p_queue);
  perform private.after_change(p_queue);
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
  v_prefs public.member_queue_prefs;
begin
  v := private.lock_queue(p_queue);
  if v.archived_at is not null then perform private.fail('queue.archived'); end if;
  if not exists (select 1 from public.memberships where org_id = v.org_id and user_id = v_uid and status = 'active') then
    perform private.fail('auth.forbidden');
  end if;
  if not exists (select 1 from public.queue_members where queue_id = p_queue and user_id = v_uid) then
    perform private.fail('queue.not_eligible');
  end if;

  v_entry := private.open_entry(p_queue, v_uid);
  if v_entry.id is not null then
    if v_entry.status = 'held' then perform private.fail('queue.holding_shift'); end if;
    perform private.fail('queue.already_joined');
  end if;
  -- Rule 4 (belt and braces): no unfinished assignment from this queue.
  if exists (select 1 from public.assignments where queue_id = p_queue and user_id = v_uid and status = 'active') then
    perform private.fail('queue.holding_shift');
  end if;

  select * into v_prefs from public.member_queue_prefs where queue_id = p_queue and user_id = v_uid;
  if v_prefs.rejoin_requires_approval then
    perform private.fail('queue.needs_approval');
  end if;
  if v_prefs.cooldown_until is not null and v_prefs.cooldown_until > now() then
    perform private.fail('queue.cooldown', v_prefs.cooldown_until::text);
  end if;

  v_entry := private.insert_entry(v, v_uid);
  perform private.audit(v.org_id, 'entry.joined', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq, 'joined_at', v_entry.joined_at));
  perform private.dispatch(p_queue);
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
  perform private.resolve_open_offer(p_queue, v_uid, 'declined', 'left_queue');
  perform private.close_entry(v_entry.id, 'left');
  perform private.audit(v.org_id, 'entry.left', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq));
  perform private.dispatch(p_queue);
  perform private.after_change(p_queue);
end;
$$;

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
  if not v.pausing_allowed then perform private.fail('queue.pausing_disabled'); end if;
  v_entry := private.open_entry(p_queue, v_uid);
  if v_entry.id is null then perform private.fail('queue.not_joined'); end if;
  if v_entry.status = 'held' then perform private.fail('queue.holding_shift'); end if;
  if v_entry.status = 'paused' then return; end if;

  -- Pausing while holding an open offer counts as declining it (decline policy applies).
  if private.resolve_open_offer(p_queue, v_uid, 'declined', 'paused') and v.decline_policy = 'move_to_end' then
    v_entry := private.move_to_end(v_entry, 'declined');
  end if;

  update public.queue_entries set status = 'paused', paused_at = clock_timestamp()
  where id = v_entry.id;
  perform private.audit(v.org_id, 'entry.paused', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id));
  perform private.dispatch(p_queue);
  perform private.after_change(p_queue);
end;
$$;

-- Resuming is always allowed, even if pausing was disabled after the person paused.
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
  update public.queue_entries set status = 'waiting', paused_at = null, consecutive_timeouts = 0
  where id = v_entry.id;
  perform private.audit(v.org_id, 'entry.resumed', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('entry_id', v_entry.id));
  perform private.dispatch(p_queue);
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
  if not private.is_queue_member(p_queue) then perform private.fail('queue.not_eligible'); end if;
  v := private.lock_queue(p_queue);
  insert into public.member_queue_prefs (queue_id, user_id, auto_rejoin)
  values (p_queue, v_uid, p_enabled)
  on conflict (queue_id, user_id) do update set auto_rejoin = excluded.auto_rejoin;
  perform private.audit(v.org_id, 'entry.auto_rejoin_set', p_queue => p_queue, p_subject => v_uid,
    p_payload => jsonb_build_object('enabled', p_enabled));
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: remove a ticket (rule 13). There is intentionally no way to reorder.
-- ---------------------------------------------------------------------------
create or replace function public.admin_remove_entry(
  p_queue uuid,
  p_user uuid,
  p_reason text,
  p_revoke_eligibility boolean default false
)
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
  perform private.resolve_open_offer(p_queue, p_user, 'revoked', 'removed_by_admin');
  perform private.close_entry(v_entry.id, 'removed');
  perform private.audit(v.org_id, 'entry.removed', p_queue => p_queue, p_subject => p_user,
    p_reason => p_reason,
    p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq,
      'position', v_position, 'revoke_eligibility', p_revoke_eligibility));
  perform private.notify(p_user, v.org_id, 'removed_from_queue',
    jsonb_build_object('queue_id', p_queue, 'queue_name', v.name, 'reason', btrim(p_reason)));

  if p_revoke_eligibility then
    delete from public.queue_members where queue_id = p_queue and user_id = p_user;
    perform private.audit(v.org_id, 'pool.member_removed', p_queue => p_queue, p_subject => p_user,
      p_reason => p_reason);
  end if;
  perform private.dispatch(p_queue);
  perform private.after_change(p_queue);
end;
$$;

-- Clears a no-show "admin approval" block or a cooldown.
create or replace function public.allow_rejoin(p_queue uuid, p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.queues;
begin
  select * into v from public.queues where id = p_queue;
  if v.id is null then perform private.fail('queue.not_found'); end if;
  perform private.assert_admin(v.org_id);
  v := private.lock_queue(p_queue);
  update public.member_queue_prefs
  set rejoin_requires_approval = false, cooldown_until = null
  where queue_id = p_queue and user_id = p_user;
  perform private.audit(v.org_id, 'rejoin.approved', p_queue => p_queue, p_subject => p_user, p_reason => p_reason);
  perform private.notify(p_user, v.org_id, 'rejoin_allowed', jsonb_build_object('queue_id', p_queue, 'queue_name', v.name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
-- Staff home screen: one row per queue the caller is eligible for.
-- Never exposes other people's identities.
create or replace function public.my_queues(p_org uuid default null)
returns table (
  queue_id uuid,
  org_id uuid,
  queue_name text,
  description text,
  state text,                -- not_joined | waiting | paused | offered | assigned
  queue_position int,
  queue_total int,
  filled_30d int,
  pausing_allowed boolean,
  auto_rejoin boolean,
  cooldown_until timestamptz,
  needs_approval boolean,
  offer_id uuid,
  offer_expires_at timestamptz,
  assigned_shift_id uuid,
  joined_at timestamptz,
  lottery_ends_at timestamptz,
  lottery_pending boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    q.id, q.org_id, q.name, q.description,
    case
      when e.id is null then 'not_joined'
      when e.status = 'held' then 'assigned'
      when o.id is not null then 'offered'
      else e.status::text
    end,
    case when e.id is not null and e.status <> 'held' then (
      select count(*)::int from public.queue_entries x
      where x.queue_id = q.id and x.closed_at is null and x.status in ('waiting', 'paused') and x.seq <= e.seq
    ) end,
    (select count(*)::int from public.queue_entries x
      where x.queue_id = q.id and x.closed_at is null and x.status in ('waiting', 'paused')),
    (select count(*)::int from public.assignments a
      where a.queue_id = q.id and a.assigned_at >= now() - interval '30 days'
        and a.status in ('active', 'completed', 'no_show')),
    q.pausing_allowed,
    coalesce(p.auto_rejoin, false),
    case when p.cooldown_until > now() then p.cooldown_until end,
    coalesce(p.rejoin_requires_approval, false),
    o.id, o.expires_at,
    (select a.shift_id from public.assignments a where a.id = e.held_assignment_id),
    e.joined_at,
    q.lottery_ends_at,
    (q.lottery_ends_at is not null and q.lottery_drawn_at is null)
  from public.queue_members qm
  join public.queues q on q.id = qm.queue_id and q.archived_at is null
  join public.memberships m on m.org_id = q.org_id and m.user_id = qm.user_id and m.status = 'active'
  left join public.queue_entries e on e.queue_id = q.id and e.user_id = qm.user_id and e.closed_at is null
  left join public.offers o on o.queue_id = q.id and o.user_id = qm.user_id and o.outcome is null
  left join public.member_queue_prefs p on p.queue_id = q.id and p.user_id = qm.user_id
  where qm.user_id = auth.uid() and (p_org is null or q.org_id = p_org)
  order by q.name;
$$;

-- Live queue view. Admins see everyone with ids; staff may call it only if
-- the organization enabled staff_can_see_names, and then get names without ids.
create or replace function public.queue_roster(p_queue uuid)
returns table (
  queue_position int,
  user_id uuid,
  display_name text,
  state text,
  joined_at timestamptz,
  paused_at timestamptz,
  offer_expires_at timestamptz,
  assigned_shift_id uuid,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  v_admin boolean;
begin
  perform private.require_uid();
  select * into v_queue from public.queues where id = p_queue;
  if v_queue.id is null then perform private.fail('queue.not_found'); end if;
  v_admin := private.is_admin(v_queue.org_id);
  if not v_admin and not (
    private.is_queue_member(p_queue)
    and (select staff_can_see_names from public.organizations where id = v_queue.org_id)
  ) then
    perform private.fail('auth.forbidden');
  end if;
  -- Staff (when names are enabled) see only names and positions of colleagues:
  -- no offer, pause or assignment details except for their own row.
  return query
  select
    case when e.status = 'held' then null
      else (row_number() over (partition by (e.status = 'held') order by e.seq))::int end,
    case when v_admin then e.user_id end,
    case when pr.deleted_at is not null then '' else pr.display_name end,
    case when not v_admin and e.user_id <> auth.uid() then 'waiting'
         when e.status = 'held' then 'assigned'
         when o.id is not null then 'offered'
         else e.status::text end,
    e.joined_at,
    case when v_admin or e.user_id = auth.uid() then e.paused_at end,
    case when v_admin or e.user_id = auth.uid() then o.expires_at end,
    case when v_admin or e.user_id = auth.uid() then
      (select a.shift_id from public.assignments a where a.id = e.held_assignment_id) end,
    e.user_id = auth.uid()
  from public.queue_entries e
  join public.profiles pr on pr.id = e.user_id
  left join public.offers o on o.queue_id = e.queue_id and o.user_id = e.user_id and o.outcome is null
  where e.queue_id = p_queue and e.closed_at is null
    and (v_admin or e.status <> 'held' or e.user_id = auth.uid())
  order by (e.status = 'held'), e.seq;
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership lifecycle that touches queues
-- ---------------------------------------------------------------------------
-- Close all of a user's tickets in an org (locks queues in id order).
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
  v_qid uuid;
  v_entry public.queue_entries;
begin
  -- Lock every queue the user could act in (pool membership included), so a
  -- concurrent join_queue waits and then sees the changed membership.
  select coalesce(array_agg(distinct queue_id order by queue_id), '{}') into v_queues
  from (
    select queue_id from public.queue_entries where org_id = p_org and user_id = p_user and closed_at is null
    union
    select queue_id from public.offers where org_id = p_org and user_id = p_user and outcome is null
    union
    select queue_id from public.queue_members where org_id = p_org and user_id = p_user
  ) x;
  foreach v_qid in array v_queues loop
    perform private.lock_queue(v_qid);
  end loop;
  foreach v_qid in array v_queues loop
    perform private.resolve_open_offer(v_qid, p_user, 'revoked', p_reason::text);
    v_entry := private.open_entry(v_qid, p_user);
    if v_entry.id is not null then
      if v_entry.status = 'held' then
        perform private.fail('member.has_assignments');
      end if;
      perform private.close_entry(v_entry.id, p_reason);
      perform private.audit(p_org, 'entry.removed', p_queue => v_qid, p_subject => p_user,
        p_reason => p_reason::text, p_payload => jsonb_build_object('entry_id', v_entry.id, 'seq', v_entry.seq));
    end if;
  end loop;
  return v_queues;
end;
$$;

create or replace function public.deactivate_member(p_org uuid, p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.memberships;
  v_queues uuid[];
  v_qid uuid;
begin
  perform private.assert_admin(p_org);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    perform private.fail('removal.reason_required');
  end if;
  if p_user = auth.uid() then perform private.fail('member.cannot_target_self'); end if;
  select * into v_target from public.memberships where org_id = p_org and user_id = p_user;
  if v_target.user_id is null then perform private.fail('member.not_found'); end if;
  if v_target.role <> 'staff' and not private.is_owner(p_org) then perform private.fail('auth.forbidden'); end if;
  if v_target.role = 'owner' then perform private.fail('member.last_owner'); end if;
  if v_target.status = 'deactivated' then return; end if;
  if exists (
    select 1 from public.assignments a join public.shifts s on s.id = a.shift_id
    where a.org_id = p_org and a.user_id = p_user and a.status = 'active' and s.ends_at > now()
  ) then
    perform private.fail('member.has_assignments');
  end if;

  v_queues := private.close_user_entries(p_org, p_user, 'deactivated');
  update public.memberships set status = 'deactivated', deactivated_at = now()
  where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.deactivated', p_subject => p_user, p_reason => p_reason);
  foreach v_qid in array v_queues loop
    perform private.dispatch(v_qid);
    perform private.after_change(v_qid);
  end loop;
end;
$$;

create or replace function public.reactivate_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  update public.memberships set status = 'active', deactivated_at = null
  where org_id = p_org and user_id = p_user and status = 'deactivated';
  if found then
    perform private.audit(p_org, 'member.reactivated', p_subject => p_user);
  end if;
end;
$$;

create or replace function public.remove_member(p_org uuid, p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.memberships;
  v_queues uuid[];
  v_qid uuid;
begin
  perform private.assert_admin(p_org);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    perform private.fail('removal.reason_required');
  end if;
  if p_user = auth.uid() then perform private.fail('member.cannot_target_self'); end if;
  select * into v_target from public.memberships where org_id = p_org and user_id = p_user;
  if v_target.user_id is null then perform private.fail('member.not_found'); end if;
  if v_target.role = 'owner' then perform private.fail('member.last_owner'); end if;
  if v_target.role = 'admin' and not private.is_owner(p_org) then perform private.fail('auth.forbidden'); end if;
  if exists (
    select 1 from public.assignments a join public.shifts s on s.id = a.shift_id
    where a.org_id = p_org and a.user_id = p_user and a.status = 'active' and s.ends_at > now()
  ) then
    perform private.fail('member.has_assignments');
  end if;

  v_queues := private.close_user_entries(p_org, p_user, 'removed');
  delete from public.queue_members where org_id = p_org and user_id = p_user;
  delete from public.memberships where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.removed', p_subject => p_user, p_reason => p_reason);
  foreach v_qid in array v_queues loop
    perform private.dispatch(v_qid);
    perform private.after_change(v_qid);
  end loop;
end;
$$;

-- Admin member list (with e-mail, which only admins may see).
create or replace function public.admin_members(p_org uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role public.member_role,
  status public.member_status,
  joined_at timestamptz,
  queue_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  select m.user_id, p.display_name, u.email::text, m.role, m.status, m.created_at,
    coalesce((select array_agg(qm.queue_id) from public.queue_members qm
              where qm.org_id = p_org and qm.user_id = m.user_id), '{}')
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.org_id = p_org
  order by m.status, lower(p.display_name);
end;
$$;
