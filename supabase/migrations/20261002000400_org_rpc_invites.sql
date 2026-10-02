-- Organization management and invites. Staff join an org ONLY via invite.
set check_function_bodies = off;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind public.invite_kind not null,
  email extensions.citext,                       -- email invites only
  token_hash bytea unique,                       -- email invites: sha256(token)
  code text unique,                              -- code invites: shareable code
  role public.member_role not null default 'staff' check (role <> 'owner'),
  queue_ids uuid[] not null default '{}',        -- pools granted on acceptance
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses between 1 and 1000),
  use_count int not null default 0,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((kind = 'email' and email is not null and token_hash is not null and code is null)
      or (kind = 'code' and code is not null and token_hash is null))
);
create index invites_org_idx on public.invites (org_id, created_at desc);

alter table public.invites enable row level security;
create policy invites_admin_select on public.invites
  for select to authenticated using (private.is_admin(org_id));
revoke all on public.invites from anon;
revoke insert, update, delete, truncate on public.invites from authenticated;
grant select on public.invites to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_org uuid;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    perform private.fail('org.invalid_name');
  end if;
  if not private.is_valid_timezone(p_timezone) then
    perform private.fail('org.invalid_timezone');
  end if;
  insert into public.organizations (name, timezone, created_by)
  values (btrim(p_name), p_timezone, v_uid)
  returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');
  perform private.audit(v_org, 'org.created', p_subject => v_uid,
    p_payload => jsonb_build_object('timezone', p_timezone));
  return v_org;
end;
$$;

create or replace function public.update_organization(
  p_org uuid,
  p_name text default null,
  p_timezone text default null,
  p_staff_can_see_names boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.organizations;
begin
  perform private.assert_owner(p_org);
  select * into v_before from public.organizations where id = p_org for update;
  if p_name is not null and char_length(btrim(p_name)) not between 1 and 120 then
    perform private.fail('org.invalid_name');
  end if;
  if p_timezone is not null and not private.is_valid_timezone(p_timezone) then
    perform private.fail('org.invalid_timezone');
  end if;
  update public.organizations set
    name = coalesce(btrim(p_name), name),
    timezone = coalesce(p_timezone, timezone),
    staff_can_see_names = coalesce(p_staff_can_see_names, staff_can_see_names)
  where id = p_org;
  perform private.audit(p_org, 'org.updated', p_payload => jsonb_build_object(
    'timezone', coalesce(p_timezone, v_before.timezone),
    'staff_can_see_names', coalesce(p_staff_can_see_names, v_before.staff_can_see_names)));
end;
$$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.member_role;
begin
  perform private.assert_owner(p_org);
  select role into v_current from public.memberships where org_id = p_org and user_id = p_user for update;
  if not found then
    perform private.fail('member.not_found');
  end if;
  if v_current = p_role then
    return;
  end if;
  if v_current = 'owner' and (
    select count(*) from public.memberships where org_id = p_org and role = 'owner' and status = 'active'
  ) <= 1 then
    perform private.fail('member.last_owner');
  end if;
  update public.memberships set role = p_role where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.role_changed', p_subject => p_user,
    p_payload => jsonb_build_object('from', v_current, 'to', p_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create or replace function private.random_code(p_len int default 8)
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(p_len);
  v_out text := '';
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- Returns the secret once. For email invites an e-mail with the link is queued.
create or replace function public.create_invite(
  p_org uuid,
  p_kind public.invite_kind,
  p_email text default null,
  p_role public.member_role default 'staff',
  p_queue_ids uuid[] default '{}',
  p_expires_in interval default interval '7 days',
  p_max_uses int default null
)
returns table (invite_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_token text;
  v_id uuid;
  v_org_name text;
begin
  perform private.assert_admin(p_org);
  if p_role = 'owner' then
    perform private.fail('invite.invalid_role');
  end if;
  if p_role = 'admin' and not private.is_owner(p_org) then
    perform private.fail('auth.forbidden');
  end if;
  if p_expires_in is null or p_expires_in < interval '1 hour' or p_expires_in > interval '90 days' then
    perform private.fail('invite.invalid_expiry');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_queue_ids, '{}')) qid
    where not exists (select 1 from public.queues q where q.id = qid and q.org_id = p_org and q.archived_at is null)
  ) then
    perform private.fail('invite.invalid_queue');
  end if;

  if p_kind = 'email' then
    if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      perform private.fail('invite.invalid_email');
    end if;
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.invites (org_id, kind, email, token_hash, role, queue_ids, expires_at, max_uses, created_by)
    values (p_org, 'email', lower(btrim(p_email)), extensions.digest(v_token, 'sha256'), p_role,
            coalesce(p_queue_ids, '{}'), now() + p_expires_in, 1, v_uid)
    returning id into v_id;

    select name into v_org_name from public.organizations where id = p_org;
    insert into public.notification_outbox (to_email, channel, template, payload)
    values (lower(btrim(p_email)), 'email', 'invite',
      jsonb_build_object('org_name', v_org_name, 'token', v_token, 'role', p_role));
  else
    loop
      v_token := private.random_code(8);
      exit when not exists (select 1 from public.invites where code = v_token);
    end loop;
    insert into public.invites (org_id, kind, code, role, queue_ids, expires_at, max_uses, created_by)
    values (p_org, 'code', v_token, p_role, coalesce(p_queue_ids, '{}'), now() + p_expires_in,
            coalesce(p_max_uses, 50), v_uid)
    returning id into v_id;
  end if;

  -- The audit log never stores the e-mail address or the secret.
  perform private.audit(p_org, 'invite.created', p_payload => jsonb_build_object(
    'invite_id', v_id, 'kind', p_kind, 'role', p_role, 'queue_ids', to_jsonb(coalesce(p_queue_ids, '{}'))));
  return query select v_id, v_token;
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invites where id = p_invite;
  if v_org is null then
    perform private.fail('invite.not_found');
  end if;
  perform private.assert_admin(v_org);
  update public.invites set revoked_at = now() where id = p_invite and revoked_at is null;
  perform private.audit(v_org, 'invite.revoked', p_payload => jsonb_build_object('invite_id', p_invite));
end;
$$;

create or replace function private.find_invite(p_token text)
returns public.invites
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.invites;
  v_clean text := btrim(coalesce(p_token, ''));
begin
  if v_clean ~* '^[A-Z0-9]{6,12}$' then
    select * into v from public.invites where code = upper(v_clean);
  end if;
  if v.id is null and char_length(v_clean) >= 32 then
    select * into v from public.invites where token_hash = extensions.digest(v_clean, 'sha256');
  end if;
  return v;
end;
$$;

-- What the invite landing screen shows before the user accepts.
create or replace function public.get_invite_preview(p_token text)
returns table (org_name text, role public.member_role, valid boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.invites;
begin
  perform private.require_uid();
  v := private.find_invite(p_token);
  if v.id is null then
    return query select null::text, null::public.member_role, false, 'invite.not_found'::text;
    return;
  end if;
  return query
  select o.name, v.role,
    (v.revoked_at is null and v.expires_at > now() and v.use_count < v.max_uses),
    case
      when v.revoked_at is not null then 'invite.revoked'
      when v.expires_at <= now() then 'invite.expired'
      when v.use_count >= v.max_uses then 'invite.used_up'
      else null
    end
  from public.organizations o where o.id = v.org_id;
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v public.invites;
  v_email text;
  v_existing public.memberships;
  v_qid uuid;
begin
  v := private.find_invite(p_token);
  if v.id is null then
    perform private.fail('invite.not_found');
  end if;
  -- lock the invite row so use_count cannot be exceeded under concurrency
  select * into v from public.invites where id = v.id for update;
  if v.revoked_at is not null then perform private.fail('invite.revoked'); end if;
  if v.expires_at <= now() then perform private.fail('invite.expired'); end if;
  if v.use_count >= v.max_uses then perform private.fail('invite.used_up'); end if;

  if v.kind = 'email' then
    select lower(email) into v_email from auth.users where id = v_uid;
    if v_email is distinct from lower(v.email::text) then
      perform private.fail('invite.email_mismatch');
    end if;
  end if;

  select * into v_existing from public.memberships where org_id = v.org_id and user_id = v_uid;
  if found and v_existing.status = 'deactivated' then
    perform private.fail('invite.member_deactivated');
  end if;
  if not found then
    insert into public.memberships (org_id, user_id, role) values (v.org_id, v_uid, v.role);
    perform private.audit(v.org_id, 'member.joined', p_subject => v_uid,
      p_payload => jsonb_build_object('invite_id', v.id, 'role', v.role));
  elsif v_existing.role = 'staff' and v.role = 'admin' then
    update public.memberships set role = 'admin' where org_id = v.org_id and user_id = v_uid;
    perform private.audit(v.org_id, 'member.role_changed', p_subject => v_uid,
      p_payload => jsonb_build_object('from', 'staff', 'to', 'admin', 'invite_id', v.id));
  end if;

  foreach v_qid in array v.queue_ids loop
    if exists (select 1 from public.queues where id = v_qid and org_id = v.org_id and archived_at is null) then
      insert into public.queue_members (queue_id, org_id, user_id, added_by)
      values (v_qid, v.org_id, v_uid, v.created_by)
      on conflict do nothing;
      if found then
        perform private.audit(v.org_id, 'pool.member_added', p_queue => v_qid, p_subject => v_uid,
          p_payload => jsonb_build_object('invite_id', v.id));
      end if;
    end if;
  end loop;

  update public.invites set use_count = use_count + 1 where id = v.id;
  return v.org_id;
end;
$$;
