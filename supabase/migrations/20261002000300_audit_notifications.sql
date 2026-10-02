-- Append-only audit log, notification inbox/outbox, realtime broadcast helpers.

-- ---------------------------------------------------------------------------
-- Audit log (rule 14)
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id),
  queue_id uuid,
  shift_id uuid,
  actor_id uuid references public.profiles (id),      -- null = system (scheduler)
  subject_id uuid references public.profiles (id),    -- the staff member affected, if any
  type text not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,         -- ids and policy values only, never PII
  created_at timestamptz not null default clock_timestamp()
);
create index audit_events_org_created_idx on public.audit_events (org_id, created_at desc);
create index audit_events_org_type_idx on public.audit_events (org_id, type);
create index audit_events_queue_idx on public.audit_events (queue_id, created_at desc);
create index audit_events_subject_idx on public.audit_events (subject_id);
create index audit_events_shift_idx on public.audit_events (shift_id);

create or replace function private.audit_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end;
$$;

create trigger audit_events_no_update
  before update or delete on public.audit_events
  for each row execute function private.audit_events_immutable();
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function private.audit_events_immutable();

alter table public.audit_events enable row level security;
create policy audit_events_admin_select on public.audit_events
  for select to authenticated
  using (private.is_admin(org_id));
revoke all on public.audit_events from anon;
revoke insert, update, delete, truncate on public.audit_events from authenticated, service_role;
grant select on public.audit_events to authenticated;

create or replace function private.audit(
  p_org uuid,
  p_type text,
  p_queue uuid default null,
  p_shift uuid default null,
  p_subject uuid default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (org_id, queue_id, shift_id, actor_id, subject_id, type, reason, payload)
  values (p_org, p_queue, p_shift, auth.uid(), p_subject, p_type, nullif(btrim(p_reason), ''), coalesce(p_payload, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
-- In-app inbox (always written; push/e-mail are best-effort extra channels).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_prefs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  push boolean not null default true,
  -- For offers, e-mail is always sent as a fallback when no push device is
  -- registered or push delivery fails. email = true means "always e-mail too".
  email boolean not null default false,
  primary key (user_id, type)
);

create table public.notification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index notification_tokens_user_idx on public.notification_tokens (user_id);

-- Transactional outbox: rows are written in the same transaction as the state
-- change, so a rolled-back change never notifies anyone. The send-notifications
-- Edge Function drains it.
create table public.notification_outbox (
  id bigint generated always as identity primary key,
  notification_id uuid references public.notifications (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  to_email extensions.citext,
  channel text not null check (channel in ('push', 'email')),
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  is_fallback boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_pending_idx on public.notification_outbox (next_attempt_at) where status = 'pending';

alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notification_tokens enable row level security;
alter table public.notification_outbox enable row level security; -- no policies: service role only

create policy notifications_own on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notification_prefs_own_select on public.notification_prefs
  for select to authenticated using (user_id = auth.uid());
create policy notification_prefs_own_insert on public.notification_prefs
  for insert to authenticated with check (user_id = auth.uid());
create policy notification_prefs_own_update on public.notification_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_tokens_own on public.notification_tokens
  for select to authenticated using (user_id = auth.uid());

revoke all on public.notifications, public.notification_prefs, public.notification_tokens, public.notification_outbox from anon;
revoke all on public.notification_outbox from authenticated;
revoke insert, update, delete, truncate on public.notifications, public.notification_tokens from authenticated;
grant select on public.notifications, public.notification_tokens to authenticated;
grant select, insert, update on public.notification_prefs to authenticated;

-- Types that get an e-mail fallback when push is not available.
create or replace function private.email_fallback_types()
returns text[]
language sql
immutable
as $$ select array['offer_received', 'offer_expiring']::text[]; $$;

-- Write an inbox notification plus outbox rows. Idempotent per dedupe key.
create or replace function private.notify(
  p_user uuid,
  p_org uuid,
  p_type text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_push boolean := true;
  v_email boolean := false;
begin
  if p_user is null then
    return;
  end if;
  if exists (select 1 from public.profiles where id = p_user and deleted_at is not null) then
    return;
  end if;

  insert into public.notifications (user_id, org_id, type, payload, dedupe_key)
  values (p_user, p_org, p_type, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    return; -- already notified
  end if;

  select np.push, np.email into v_push, v_email
  from public.notification_prefs np
  where np.user_id = p_user and np.type = p_type;
  v_push := coalesce(v_push, true);
  v_email := coalesce(v_email, false);

  if v_push then
    insert into public.notification_outbox (notification_id, user_id, channel, template, payload)
    values (v_id, p_user, 'push', p_type, coalesce(p_payload, '{}'::jsonb));
  end if;

  if v_email or p_type = any (private.email_fallback_types()) then
    insert into public.notification_outbox (notification_id, user_id, channel, template, payload, is_fallback)
    values (v_id, p_user, 'email', p_type, coalesce(p_payload, '{}'::jsonb), not v_email);
  end if;

  perform realtime.send(
    jsonb_build_object('type', p_type),
    'notification',
    'user:' || p_user::text,
    true
  );
end;
$$;

-- Notify every active admin/owner of an org.
create or replace function private.notify_admins(
  p_org uuid,
  p_type text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select user_id from public.memberships
    where org_id = p_org and status = 'active' and role in ('owner', 'admin')
  loop
    perform private.notify(r.user_id, p_org, p_type, p_payload,
      case when p_dedupe is null then null else p_dedupe || ':' || r.user_id::text end);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbox RPCs
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  update public.notifications
  set read_at = now()
  where user_id = v_uid and read_at is null and (p_ids is null or id = any (p_ids));
end;
$$;

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_token is null or char_length(p_token) not between 10 and 500 then
    perform private.fail('push.invalid_token');
  end if;
  insert into public.notification_tokens (user_id, token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notification_tokens where token = p_token and user_id = auth.uid();
$$;

grant execute on function public.mark_notifications_read(uuid[]), public.register_push_token(text, text),
  public.unregister_push_token(text) to authenticated;
