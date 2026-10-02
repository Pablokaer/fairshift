-- Scheduler (timeouts, reminders, auto-completion), notification outbox access
-- for the sender Edge Function, and Realtime authorization.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Per-queue maintenance. Idempotent: running it twice, or concurrently with
-- user actions, is safe because it takes the same queue lock (SKIP LOCKED: if a
-- user action holds the lock right now, this queue is simply handled on the
-- next sweep).
-- ---------------------------------------------------------------------------
create or replace function private.process_queue(p_queue uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.queues;
  r record;
  s public.shifts;
  v_changes int := 0;
begin
  select * into v_queue from public.queues where id = p_queue for update skip locked;
  if v_queue.id is null then
    return false;
  end if;

  -- 1. "Offer about to expire" reminders at 25 % of the window remaining.
  for r in
    select o.* from public.offers o
    where o.queue_id = p_queue and o.outcome is null and o.reminder_sent_at is null
      and o.expires_at > clock_timestamp()
      and clock_timestamp() >= o.expires_at - (o.expires_at - o.offered_at) * 0.25
  loop
    update public.offers set reminder_sent_at = now() where id = r.id;
    select * into s from public.shifts where id = r.shift_id;
    perform private.notify(r.user_id, r.org_id, 'offer_expiring',
      private.shift_payload(s) || jsonb_build_object('offer_id', r.id, 'expires_at', r.expires_at),
      'offer_expiring:' || r.id::text);
  end loop;

  -- 2. Timeouts.
  for r in
    select id from public.offers
    where queue_id = p_queue and outcome is null and expires_at <= clock_timestamp()
    order by expires_at
  loop
    perform private.expire_offer(r.id);
    v_changes := v_changes + 1;
  end loop;

  -- 3. Shifts that started without being filled become (final) unfilled.
  for s in
    select * from public.shifts
    where queue_id = p_queue and starts_at <= clock_timestamp()
      and (status in ('published', 'offered') or (status = 'unfilled' and unfilled_notified_at is null))
  loop
    update public.offers set outcome = 'expired', outcome_reason = 'shift_started', responded_at = clock_timestamp()
    where shift_id = s.id and outcome is null;
    update public.shifts set status = 'unfilled', unfilled_notified_at = coalesce(unfilled_notified_at, now())
    where id = s.id;
    if s.unfilled_notified_at is null then
      perform private.audit(s.org_id, 'shift.unfilled', p_queue => p_queue, p_shift => s.id,
        p_payload => jsonb_build_object('round', s.offer_round, 'reason', 'shift_started'));
      perform private.notify_admins(s.org_id, 'shift_unfilled', private.shift_payload(s),
        'unfilled:' || s.id::text || ':' || s.offer_round::text);
    end if;
    v_changes := v_changes + 1;
  end loop;

  -- 4. Assigned shifts past their end time are completed automatically (rule 7).
  for r in
    select id from public.shifts
    where queue_id = p_queue and status = 'assigned' and ends_at <= clock_timestamp()
    order by ends_at
  loop
    perform private.complete_shift_locked(r.id);
    v_changes := v_changes + 1;
  end loop;

  -- 5. Offer anything that can be offered (also catches cross-queue frees).
  v_changes := v_changes + private.dispatch(p_queue);

  if v_changes > 0 then
    perform private.after_change(p_queue);
  end if;
  return true;
end;
$$;

-- Sweeps all queues that may need work, committing after each queue.
create or replace procedure private.process_due()
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select q.id from public.queues q
    where q.archived_at is null and (
      exists (select 1 from public.offers o where o.queue_id = q.id and o.outcome is null)
      or exists (
        select 1 from public.shifts s where s.queue_id = q.id and (
          s.status in ('published', 'offered')
          or (s.status = 'unfilled' and (s.unfilled_notified_at is null or s.starts_at > now()))
          or (s.status = 'assigned' and s.ends_at <= now())))
      or (q.lottery_ends_at <= now() and q.lottery_drawn_at is null)
    )
    order by q.id
  loop
    perform private.process_queue(r.id);
    commit;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification sender plumbing
-- ---------------------------------------------------------------------------
-- Secrets live in Supabase Vault:
--   fairshift_functions_url  e.g. http://host.docker.internal:54321/functions/v1 (local)
--                                 https://<ref>.supabase.co/functions/v1         (hosted)
--   fairshift_cron_secret    shared secret, also set as CRON_SECRET for the functions
create or replace function private.vault_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

create or replace function private.kick_notification_sender()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := private.vault_secret('fairshift_functions_url');
  v_secret text := private.vault_secret('fairshift_cron_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (
    select 1 from public.notification_outbox where status = 'pending' and next_attempt_at <= now()
  ) then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- Kick the sender as soon as a transaction that queued notifications commits
-- (pg_net requests are only sent after commit).
create or replace function private.outbox_kick_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.kick_notification_sender();
  return null;
end;
$$;

create trigger notification_outbox_kick
  after insert on public.notification_outbox
  for each statement execute function private.outbox_kick_trigger();

-- Called by the Edge Function (service role only): claim a batch of due rows.
create or replace function public.claim_notification_outbox(p_limit int default 50)
returns table (
  id bigint, channel text, template text, payload jsonb, is_fallback boolean, attempts int,
  notification_id uuid, user_id uuid, to_email text, user_email text, locale text,
  push_tokens text[], push_already_sent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    update public.notification_outbox ob
    set attempts = ob.attempts + 1,
        next_attempt_at = now() + make_interval(secs => least(3600, 15 * power(2, ob.attempts)))
    where ob.id in (
      select x.id from public.notification_outbox x
      where x.status = 'pending' and x.next_attempt_at <= now()
      order by (x.channel = 'email'), x.id     -- push first, so e-mail fallbacks can see push results
      limit p_limit
      for update skip locked
    )
    returning ob.*
  )
  select c.id, c.channel, c.template, c.payload, c.is_fallback, c.attempts, c.notification_id, c.user_id,
         c.to_email::text,
         (select u.email::text from auth.users u where u.id = c.user_id),
         coalesce((select p.locale from public.profiles p where p.id = c.user_id), 'en'),
         coalesce((select array_agg(t.token) from public.notification_tokens t where t.user_id = c.user_id), '{}'),
         exists (select 1 from public.notification_outbox s
                 where s.notification_id = c.notification_id and s.channel = 'push' and s.status = 'sent')
  from claimed c
  order by (c.channel = 'email'), c.id;
end;
$$;

create or replace function public.complete_notification_outbox(
  p_id bigint, p_status text, p_error text default null, p_invalid_tokens text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox
  set status = case when p_status = 'retry' and attempts >= 5 then 'failed'
                    when p_status = 'retry' then 'pending'
                    else p_status end,
      last_error = p_error,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id;
  delete from public.notification_tokens where token = any (coalesce(p_invalid_tokens, '{}'));
end;
$$;

revoke execute on function public.claim_notification_outbox(int) from public, anon, authenticated;
revoke execute on function public.complete_notification_outbox(bigint, text, text, text[]) from public, anon, authenticated;
grant execute on function public.claim_notification_outbox(int) to service_role;
grant execute on function public.complete_notification_outbox(bigint, text, text, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime authorization (private broadcast channels).
--   queue:<id>        - "something changed in this queue" (no content); members + admins
--   org:<id>:admin    - admin dashboard updates; admins only
--   user:<id>         - personal inbox signal; that user only
-- ---------------------------------------------------------------------------
create or replace function private.can_subscribe(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
begin
  if p_topic ~ '^queue:[0-9a-f-]{36}$' then
    v_id := substr(p_topic, 7)::uuid;
    select org_id into v_org from public.queues where id = v_id;
    return v_org is not null and (private.is_admin(v_org) or private.is_queue_member(v_id));
  elsif p_topic ~ '^org:[0-9a-f-]{36}:admin$' then
    v_id := substr(p_topic, 5, 36)::uuid;
    return private.is_admin(v_id);
  elsif p_topic ~ '^user:[0-9a-f-]{36}$' then
    return substr(p_topic, 6)::uuid = auth.uid();
  end if;
  return false;
end;
$$;
grant execute on function private.can_subscribe(text) to authenticated;

create policy fairshift_broadcast_read on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and private.can_subscribe((select realtime.topic())));

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
select cron.schedule('fairshift-process-due', '15 seconds', 'call private.process_due()');
select cron.schedule('fairshift-notify-sender', '20 seconds', 'select private.kick_notification_sender()');
select cron.schedule('fairshift-outbox-cleanup', '17 3 * * *',
  $$delete from public.notification_outbox where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '30 days'$$);
