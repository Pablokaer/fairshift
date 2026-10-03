-- Hospital code, sign-up, professions and manager tools.
set check_function_bodies = off;

create or replace function private.org_by_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.organizations where join_code = private.normalize_code(p_code);
$$;

-- ---------------------------------------------------------------------------
-- Sign-up. Two layers, both required:
--   1. Auth hook "before user created" (supabase/config.toml): rejects a sign-up
--      without a valid hospital code and profession BEFORE the account exists,
--      with a clean error code the app translates.
--   2. handle_new_user (trigger on auth.users): links the account to the
--      hospital in the SAME transaction that creates it. If the code was
--      regenerated in between, it raises and the account is not created.
-- Accounts created directly in SQL (seed, operators, tests) skip the hook; they
-- are only linked when their metadata carries a hospital code.
-- ---------------------------------------------------------------------------
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
begin
  if coalesce(btrim(v_meta ->> 'hospital_code'), '') = '' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'hospital_code.required'));
  end if;
  if private.org_by_code(v_meta ->> 'hospital_code') is null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'hospital_code.invalid'));
  end if;
  if coalesce(v_meta ->> 'profession', '') not in ('doctor', 'nurse') then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'profession.invalid'));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_org uuid;
  v_profession public.profession;
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    left(coalesce(nullif(btrim(v_meta ->> 'display_name'), ''), split_part(new.email, '@', 1), ''), 80),
    case when v_meta ->> 'locale' = 'pt-BR' then 'pt-BR' else 'en' end
  )
  on conflict (id) do nothing;

  if coalesce(btrim(v_meta ->> 'hospital_code'), '') <> '' then
    -- FOR SHARE: waits for a concurrent regeneration, then sees the new code.
    select id into v_org from public.organizations
    where join_code = private.normalize_code(v_meta ->> 'hospital_code')
    for share;
    if v_org is null then
      raise exception 'hospital_code.invalid' using errcode = 'P0001';
    end if;
    if coalesce(v_meta ->> 'profession', '') not in ('doctor', 'nurse') then
      raise exception 'profession.invalid' using errcode = 'P0001';
    end if;
    v_profession := (v_meta ->> 'profession')::public.profession;
    insert into public.memberships (org_id, user_id, role, profession)
    values (v_org, new.id, 'staff', v_profession);
    perform private.audit(v_org, 'member.joined', p_subject => new.id,
      p_payload => jsonb_build_object('via', 'hospital_code', 'profession', v_profession));
  end if;
  return new;
end;
$$;

-- An existing account without a hospital (e.g. removed earlier, or a second
-- hospital) links itself with a hospital code.
create or replace function public.join_hospital(p_code text, p_profession public.profession)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_org uuid;
  v_existing public.memberships;
begin
  select id into v_org from public.organizations where join_code = private.normalize_code(p_code) for share;
  if v_org is null then perform private.fail('hospital_code.invalid'); end if;
  if p_profession is null then perform private.fail('profession.invalid'); end if;
  select * into v_existing from public.memberships where org_id = v_org and user_id = v_uid;
  if found then
    if v_existing.status = 'deactivated' then perform private.fail('hospital.member_deactivated'); end if;
    perform private.fail('hospital.already_member');
  end if;
  insert into public.memberships (org_id, user_id, role, profession) values (v_org, v_uid, 'staff', p_profession);
  perform private.audit(v_org, 'member.joined', p_subject => v_uid,
    p_payload => jsonb_build_object('via', 'hospital_code', 'profession', p_profession));
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hospital code (managers)
-- ---------------------------------------------------------------------------
create or replace function public.admin_hospital_code(p_org uuid)
returns table (join_code text, rotated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query select o.join_code, o.join_code_rotated_at from public.organizations o where o.id = p_org;
end;
$$;

-- The old code stops working at once; existing members are not affected.
-- The audit event never contains a code.
create or replace function public.regenerate_join_code(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text;
begin
  perform private.assert_admin(p_org);
  perform 1 from public.organizations where id = p_org for update;
  v := private.new_join_code();
  update public.organizations set join_code = v, join_code_rotated_at = now() where id = p_org;
  perform private.audit(p_org, 'org.code_regenerated');
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operators (decision h): hospitals are provisioned outside the app.
--   select * from private.provision_hospital('Hospital X', 'America/Sao_Paulo');
--   -- the first manager signs up with the returned code, then:
--   select private.set_manager('<hospital id>', 'manager@example.org');
-- ---------------------------------------------------------------------------
create or replace function private.provision_hospital(p_name text, p_timezone text, p_code text default null)
returns table (org_id uuid, join_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_code text := nullif(private.normalize_code(p_code), '');
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    perform private.fail('org.invalid_name');
  end if;
  if not private.is_valid_timezone(p_timezone) then
    perform private.fail('org.invalid_timezone');
  end if;
  insert into public.organizations (name, timezone, join_code)
  values (btrim(p_name), p_timezone, coalesce(v_code, private.new_join_code()))
  returning id into v_org;
  perform private.audit(v_org, 'org.created', p_payload => jsonb_build_object('timezone', p_timezone));
  return query select o.id, o.join_code from public.organizations o where o.id = v_org;
end;
$$;

create or replace function private.set_manager(p_org uuid, p_email text, p_role public.member_role default 'owner')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_before public.member_role;
begin
  if p_role = 'staff' then perform private.fail('member.invalid_role'); end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then perform private.fail('member.not_found'); end if;
  select role into v_before from public.memberships where org_id = p_org and user_id = v_user;
  insert into public.memberships (org_id, user_id, role) values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role, status = 'active', deactivated_at = null;
  perform private.audit(p_org, 'member.role_changed', p_subject => v_user,
    p_payload => jsonb_build_object('from', v_before, 'to', p_role, 'by', 'operator'));
end;
$$;

create or replace function public.update_organization(p_org uuid, p_name text default null, p_timezone text default null)
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
    timezone = coalesce(p_timezone, timezone)
  where id = p_org;
  perform private.audit(p_org, 'org.updated', p_payload => jsonb_build_object(
    'timezone', coalesce(p_timezone, v_before.timezone)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Professions (decision e): changing it removes the person from their current
-- queue (audited); they then join the other one. Not allowed while they hold
-- an upcoming shift: cancel it first. Managers may have no profession.
-- ---------------------------------------------------------------------------
create or replace function public.set_member_profession(
  p_org uuid,
  p_user uuid,
  p_profession public.profession,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.memberships;
  v_queues uuid[];
begin
  perform private.assert_admin(p_org);
  select * into v_target from public.memberships where org_id = p_org and user_id = p_user;
  if v_target.user_id is null then perform private.fail('member.not_found'); end if;
  if p_profession is null and v_target.role = 'staff' then perform private.fail('profession.invalid'); end if;
  if v_target.profession is not distinct from p_profession then return; end if;

  v_queues := private.close_user_entries(p_org, p_user, 'profession_changed');
  update public.memberships set profession = p_profession where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.profession_changed', p_subject => p_user, p_reason => p_reason,
    p_payload => jsonb_build_object('from', v_target.profession, 'to', p_profession));
  perform private.notify(p_user, p_org, 'profession_changed',
    jsonb_build_object('profession', p_profession, 'previous', v_target.profession));
  perform private.after_change(q) from unnest(v_queues) q;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_member(p_org uuid, p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.memberships;
  v_queues uuid[];
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

  v_queues := private.close_user_entries(p_org, p_user, 'deactivated');
  update public.memberships set status = 'deactivated', deactivated_at = now()
  where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.deactivated', p_subject => p_user, p_reason => p_reason);
  perform private.after_change(q) from unnest(v_queues) q;
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

  v_queues := private.close_user_entries(p_org, p_user, 'removed');
  delete from public.member_queue_prefs
  where user_id = p_user and queue_id in (select id from public.queues where org_id = p_org);
  delete from public.memberships where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.removed', p_subject => p_user, p_reason => p_reason);
  perform private.after_change(q) from unnest(v_queues) q;
end;
$$;

-- Managers' list of professionals (and managers) with their queue status.
create or replace function public.admin_professionals(p_org uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role public.member_role,
  status public.member_status,
  profession public.profession,
  queue_id uuid,
  queue_state text,          -- no_profession | not_joined | waiting | paused | assigned
  queue_position int,
  entry_joined_at timestamptz,
  member_since timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin(p_org);
  return query
  select m.user_id, p.display_name, u.email::text, m.role, m.status, m.profession, q.id,
    case when m.profession is null then 'no_profession'
         when e.id is null then 'not_joined'
         when e.status = 'held' then 'assigned'
         else e.status::text end,
    private.entry_position(e),
    e.joined_at,
    m.created_at
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join public.queues q on q.org_id = m.org_id and q.profession = m.profession and q.archived_at is null
  left join public.queue_entries e on e.queue_id = q.id and e.user_id = m.user_id and e.closed_at is null
  where m.org_id = p_org
  order by m.status, lower(p.display_name);
end;
$$;

grant execute on function
  public.join_hospital(text, public.profession),
  public.admin_hospital_code(uuid),
  public.regenerate_join_code(uuid),
  public.update_organization(uuid, text, text),
  public.set_member_profession(uuid, uuid, public.profession, text),
  public.deactivate_member(uuid, uuid, text),
  public.reactivate_member(uuid, uuid),
  public.remove_member(uuid, uuid, text),
  public.admin_professionals(uuid)
to authenticated;
