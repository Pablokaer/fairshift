-- Demo data: one hospital, two queues, one admin (owner), 20 staff, a few shifts.
-- Runs automatically on `supabase db reset`. All passwords: Password123!
--
--   admin@demo.fairshift.app        Owner / admin
--   nurse01..nurse12@demo.fairshift.app   ICU Nurses queue (nurse01 is #1)
--   doctor01..doctor08@demo.fairshift.app ER Doctors queue (doctor01 is #1)

-- Local secrets for pg_net -> send-notifications (see supabase/.env.example).
select vault.create_secret('http://kong:8000/functions/v1', 'fairshift_functions_url', 'Edge Functions base URL (local)');
select vault.create_secret('local-dev-cron-secret', 'fairshift_cron_secret', 'Shared secret for send-notifications (local)');

create or replace function pg_temp.demo_user(p_email text, p_name text, p_locale text default 'pt-BR')
returns uuid
language plpgsql
as $$
declare
  v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', p_name, 'locale', p_locale),
    now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v, v::text, jsonb_build_object('sub', v::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now());
  return v;
end;
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void
language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true); $$;

do $$
declare
  v_admin uuid;
  v_org uuid;
  v_icu uuid;
  v_er uuid;
  v_user uuid;
  v_nurse_names text[] := array['Ana Souza','Bruno Lima','Carla Mendes','Diego Rocha','Elisa Castro','Fábio Nunes',
    'Gabriela Alves','Heitor Ramos','Isabela Prado','João Martins','Larissa Gomes','Marcos Teixeira'];
  v_doctor_names text[] := array['Dra. Paula Freitas','Dr. Rafael Costa','Dra. Sofia Barros','Dr. Tiago Moreira',
    'Dra. Úrsula Pires','Dr. Vitor Cardoso','Dra. Yasmin Duarte','Dr. Wagner Lopes'];
  v_shift uuid;
  v_offer uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  v_admin := pg_temp.demo_user('admin@demo.fairshift.app', 'Admin (Escala)', 'pt-BR');
  perform pg_temp.as_user(v_admin);
  v_org := public.create_organization('Hospital Demo São Lucas', 'America/Sao_Paulo');
  v_icu := public.create_queue(v_org, 'ICU Nurses', 'Extra shifts for the adult ICU nursing team.',
    '{"acceptance_window_minutes": 30}');
  v_er := public.create_queue(v_org, 'ER Doctors', 'Extra shifts in the emergency room.',
    '{"acceptance_window_minutes": 30, "withdraw_cooldown_hours": 24}');

  for i in 1 .. 12 loop
    v_user := pg_temp.demo_user(format('nurse%s@demo.fairshift.app', lpad(i::text, 2, '0')), v_nurse_names[i],
      case when i % 4 = 0 then 'en' else 'pt-BR' end);
    insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'staff');
    insert into public.queue_members (queue_id, org_id, user_id, added_by) values (v_icu, v_org, v_user, v_admin);
  end loop;
  for i in 1 .. 8 loop
    v_user := pg_temp.demo_user(format('doctor%s@demo.fairshift.app', lpad(i::text, 2, '0')), v_doctor_names[i],
      case when i % 4 = 0 then 'en' else 'pt-BR' end);
    insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'staff');
    insert into public.queue_members (queue_id, org_id, user_id, added_by) values (v_er, v_org, v_user, v_admin);
  end loop;

  -- Everyone joins their queue in numeric order (nurse01 first, ...), through the real RPC.
  for v_user in
    select u.id from auth.users u where u.email like 'nurse%@demo.fairshift.app' order by u.email
  loop
    perform pg_temp.as_user(v_user);
    perform public.join_queue(v_icu);
  end loop;
  for v_user in
    select u.id from auth.users u where u.email like 'doctor%@demo.fairshift.app' order by u.email
  loop
    perform pg_temp.as_user(v_user);
    perform public.join_queue(v_er);
  end loop;
  -- nurse05 is on holiday (paused, keeps position).
  perform pg_temp.as_user((select id from auth.users where email = 'nurse05@demo.fairshift.app'));
  perform public.pause_queue(v_icu);

  perform pg_temp.as_user(v_admin);
  -- History for the fairness dashboard: doctor08 worked an ER shift last week (then rejoined at the end).
  select x into v_shift from public.create_shifts(v_er, jsonb_build_array(jsonb_build_object(
    'start_local', to_char(v_today + 10, 'YYYY-MM-DD') || 'T19:00', 'end_local', to_char(v_today + 11, 'YYYY-MM-DD') || 'T07:00',
    'unit', 'Emergency Room', 'notes', 'Night cover')), true) x;
  -- doctors 01..07 decline, doctor08 accepts
  for v_user in select u.id from auth.users u where u.email like 'doctor%@demo.fairshift.app' order by u.email loop
    select id into v_offer from public.offers where shift_id = v_shift and outcome is null;
    perform pg_temp.as_user(v_user);
    if (select email from auth.users where id = v_user) = 'doctor08@demo.fairshift.app' then
      perform public.accept_offer(v_offer);
    else
      perform public.decline_offer(v_offer);
    end if;
  end loop;
  -- Move it into the past and let the scheduler complete it (doctor08 had auto-rejoin on).
  insert into public.member_queue_prefs (queue_id, user_id, auto_rejoin)
  values (v_er, (select id from auth.users where email = 'doctor08@demo.fairshift.app'), true);
  update public.shifts set starts_at = now() - interval '7 days', ends_at = now() - interval '7 days' + interval '12 hours'
  where id = v_shift;
  perform private.process_queue(v_er);

  -- Draft shifts ready to publish in the demo (local times, org timezone).
  perform pg_temp.as_user(v_admin);
  perform public.create_shifts(v_icu, jsonb_build_array(
    jsonb_build_object('start_local', to_char(v_today + 3, 'YYYY-MM-DD') || 'T07:00', 'end_local', to_char(v_today + 3, 'YYYY-MM-DD') || 'T19:00',
                       'unit', 'ICU 2', 'notes', 'Day shift, 12 h'),
    jsonb_build_object('start_local', to_char(v_today + 4, 'YYYY-MM-DD') || 'T19:00', 'end_local', to_char(v_today + 5, 'YYYY-MM-DD') || 'T07:00',
                       'unit', 'ICU 1', 'notes', 'Night shift, 12 h')), false);
  perform public.create_shifts(v_er, jsonb_build_array(
    jsonb_build_object('start_local', to_char(v_today + 5, 'YYYY-MM-DD') || 'T13:00', 'end_local', to_char(v_today + 5, 'YYYY-MM-DD') || 'T19:00',
                       'unit', 'ER triage', 'notes', '')), false);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
