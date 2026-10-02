-- FairShift foundation: extensions, private schema, enums, error helper.
-- All timestamps are timestamptz (stored in UTC).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- "private" holds internal functions/tables. It is NOT exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon;
-- authenticated needs USAGE so RLS policies can call the small set of helper
-- functions that are explicitly granted below / in later migrations.
grant usage on schema private to authenticated, service_role;

-- Functions are executable by PUBLIC by default in Postgres. Turn that off for
-- everything created from now on; each RPC is granted explicitly.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.member_status as enum ('active', 'deactivated');
create type public.invite_kind as enum ('email', 'code');
create type public.position_policy as enum ('keep', 'move_to_end');
create type public.no_show_policy as enum ('rejoin_end', 'cooldown', 'admin_approval');
create type public.reoffer_policy as enum ('restart', 'continue');
create type public.entry_status as enum ('waiting', 'paused', 'held');
create type public.entry_close_reason as enum (
  'completed', 'no_show', 'withdrew', 'left', 'removed', 'moved_to_end',
  'deactivated', 'account_deleted', 'eligibility_revoked', 'queue_archived'
);
create type public.shift_status as enum (
  'draft', 'published', 'offered', 'assigned', 'completed', 'no_show', 'cancelled', 'unfilled'
);
create type public.offer_outcome as enum ('accepted', 'declined', 'expired', 'revoked');
create type public.assignment_status as enum ('active', 'completed', 'no_show', 'cancelled', 'withdrawn');

-- Raise a domain error. The message is a stable machine-readable code that the
-- client maps to a translated string (see app/src/i18n/locales/*/errors).
create or replace function private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = coalesce(p_detail, '');
end;
$$;

-- Current user or error.
create or replace function private.require_uid()
returns uuid
language plpgsql
stable
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    perform private.fail('auth.required');
  end if;
  return v;
end;
$$;

create or replace function private.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

-- Lock key for per-user advisory locks (always acquired AFTER queue row locks).
create or replace function private.user_lock_key(p_user uuid)
returns bigint
language sql
immutable
as $$
  select ('x' || substr(md5(p_user::text), 1, 15))::bit(60)::bigint;
$$;
