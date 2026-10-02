-- Profiles, organizations, memberships.

-- profiles.id equals auth.users.id. There is deliberately NO foreign key to
-- auth.users: when an account is deleted the auth user (with the e-mail) is
-- removed, but the profile row stays as an anonymous tombstone so that the
-- append-only audit log keeps referring to a stable, now anonymous, id.
create table public.profiles (
  id uuid primary key,
  display_name text not null default '' check (char_length(display_name) <= 80),
  locale text not null default 'en' check (locale in ('en', 'pt-BR')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  timezone text not null default 'UTC',
  -- Privacy: by default staff never see other people's names in a queue.
  staff_can_see_names boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  role public.member_role not null default 'staff',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Create a profile for every new auth user.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), ''), 80),
    case when new.raw_user_meta_data ->> 'locale' = 'pt-BR' then 'pt-BR' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER so they bypass RLS and cannot recurse).
-- ---------------------------------------------------------------------------
create or replace function private.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function private.is_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin')
  );
$$;

create or replace function private.is_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and status = 'active' and role = 'owner'
  );
$$;

-- Can the current user see the display name of p_user?
-- Yes for: self; admins of an org p_user belongs to; members of an org that
-- has opted in to showing names to staff.
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
    join public.organizations o on o.id = viewer.org_id
    where viewer.user_id = auth.uid()
      and viewer.status = 'active'
      and target.user_id = p_user
      and (viewer.role in ('owner', 'admin') or o.staff_can_see_names)
  );
$$;

grant execute on function private.is_member(uuid), private.is_admin(uuid), private.is_owner(uuid),
  private.can_see_profile(uuid) to authenticated, service_role;

create or replace function private.assert_admin(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if not private.is_admin(p_org) then
    perform private.fail('auth.forbidden');
  end if;
end;
$$;

create or replace function private.assert_owner(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if not private.is_owner(p_org) then
    perform private.fail('auth.forbidden');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (private.can_see_profile(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and deleted_at is null)
  with check (id = auth.uid());

create policy organizations_select on public.organizations
  for select to authenticated
  using (private.is_member(id));

create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin(org_id));

-- Writes go exclusively through SECURITY DEFINER functions, except a user
-- editing their own display name / locale.
revoke all on public.profiles, public.organizations, public.memberships from anon;
revoke insert, update, delete, truncate on public.profiles, public.organizations, public.memberships from authenticated;
grant select on public.profiles, public.organizations, public.memberships to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;
