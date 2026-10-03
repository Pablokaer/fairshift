-- Demo data: one hospital, its two profession queues, one manager, 10 doctors,
-- 10 nurses and a few draft shifts. Runs automatically on `supabase db reset`.
-- All passwords: Password123!     Hospital code: SAOLUCAS
--
--   manager@demo.fairshift.app              Manager (owner), no clinical profession
--   doctor01..doctor10@demo.fairshift.app   Doctors. 01..08 are in the doctors' queue; doctor01
--                                           worked a shift last week and auto-rejoined at the end,
--                                           so the order is 02..08, 01. 09 and 10 have not joined.
--   nurse01..nurse10@demo.fairshift.app     Nurses. 01..08 are in the nurses' queue in that order
--                                           (nurse05 is paused). 09 and 10 have not joined.

-- Local secrets for pg_net -> send-notifications (see supabase/.env.example).
select vault.create_secret('http://kong:8000/functions/v1', 'fairshift_functions_url', 'Edge Functions base URL (local)');
select vault.create_secret('local-dev-cron-secret', 'fairshift_cron_secret', 'Shared secret for send-notifications (local)');

-- Creates a confirmed e-mail/password user. With a hospital code in the
-- metadata, the sign-up trigger links them to the hospital (the real path).
create or replace function pg_temp.demo_user(p_email text, p_name text, p_locale text, p_meta jsonb default '{}')
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
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('display_name', p_name, 'locale', p_locale) || p_meta,
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

create or replace function pg_temp.uid(p_email text)
returns uuid
language sql
as $$ select id from auth.users where email = p_email; $$;

do $$
declare
  v_org uuid;
  v_doctors uuid;
  v_nurses uuid;
  v_manager uuid;
  v_shift uuid;
  v_doctor_names text[] := array['Dra. Paula Freitas', 'Dr. Rafael Costa', 'Dra. Sofia Barros', 'Dr. Tiago Moreira',
    'Dra. Úrsula Pires', 'Dr. Vitor Cardoso', 'Dra. Yasmin Duarte', 'Dr. Wagner Lopes', 'Dra. Beatriz Lima',
    'Dr. Caio Nogueira'];
  v_nurse_names text[] := array['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Elisa Castro',
    'Fábio Nunes', 'Gabriela Alves', 'Heitor Ramos', 'Isabela Prado', 'João Martins'];
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  d text;
begin
  select org_id into v_org from private.provision_hospital('Hospital Demo São Lucas', 'America/Sao_Paulo', 'SAOLUCAS');
  v_doctors := private.profession_queue(v_org, 'doctor');
  v_nurses := private.profession_queue(v_org, 'nurse');

  v_manager := pg_temp.demo_user('manager@demo.fairshift.app', 'Gestora (Escala)', 'pt-BR');
  perform private.set_manager(v_org, 'manager@demo.fairshift.app', 'owner');

  for i in 1 .. 10 loop
    perform pg_temp.demo_user(format('doctor%s@demo.fairshift.app', lpad(i::text, 2, '0')), v_doctor_names[i],
      case when i % 4 = 0 then 'en' else 'pt-BR' end,
      jsonb_build_object('hospital_code', 'SAOLUCAS', 'profession', 'doctor'));
    perform pg_temp.demo_user(format('nurse%s@demo.fairshift.app', lpad(i::text, 2, '0')), v_nurse_names[i],
      case when i % 4 = 0 then 'en' else 'pt-BR' end,
      jsonb_build_object('hospital_code', 'SAOLUCAS', 'profession', 'nurse'));
  end loop;

  -- 01..08 of each profession join in numeric order, through the real RPC.
  for i in 1 .. 8 loop
    perform pg_temp.as_user(pg_temp.uid(format('doctor%s@demo.fairshift.app', lpad(i::text, 2, '0'))));
    perform public.join_queue(v_doctors);
    perform pg_temp.as_user(pg_temp.uid(format('nurse%s@demo.fairshift.app', lpad(i::text, 2, '0'))));
    perform public.join_queue(v_nurses);
  end loop;
  -- nurse05 is on holiday (paused: keeps the position, skipped for shifts).
  perform pg_temp.as_user(pg_temp.uid('nurse05@demo.fairshift.app'));
  perform public.pause_queue(v_nurses);

  -- History for the fairness dashboard: doctor01 (auto-rejoin on) took a
  -- 1-slot shift; it is moved into last week and completed by the scheduler.
  perform pg_temp.as_user(pg_temp.uid('doctor01@demo.fairshift.app'));
  perform public.set_queue_auto_rejoin(v_doctors, true);
  perform pg_temp.as_user(v_manager);
  d := to_char(v_today + 1, 'YYYY-MM-DD');
  select x into v_shift from public.create_shifts(v_org, 'doctor', jsonb_build_array(jsonb_build_object(
    'start_local', d || 'T19:00', 'end_local', d || 'T23:00', 'unit', 'Emergency Room', 'notes', 'Night cover',
    'slots', 1)), true) x;
  update public.shifts set starts_at = now() - interval '7 days', ends_at = now() - interval '7 days' + interval '12 hours'
  where id = v_shift;
  perform set_config('request.jwt.claims', '', true);
  perform private.process_queue(v_doctors);

  -- Draft shifts ready to publish (local times, hospital timezone): 1, 2 and 3 slots per profession.
  perform pg_temp.as_user(v_manager);
  perform public.create_shifts(v_org, 'doctor', jsonb_build_array(
    jsonb_build_object('start_local', to_char(v_today + 3, 'YYYY-MM-DD') || 'T07:00', 'end_local', to_char(v_today + 3, 'YYYY-MM-DD') || 'T19:00',
                       'unit', 'Emergency Room', 'notes', 'Day shift, 12 h', 'slots', 2),
    jsonb_build_object('start_local', to_char(v_today + 4, 'YYYY-MM-DD') || 'T19:00', 'end_local', to_char(v_today + 5, 'YYYY-MM-DD') || 'T07:00',
                       'unit', 'Emergency Room', 'notes', 'Night shift, 12 h', 'slots', 1),
    jsonb_build_object('start_local', to_char(v_today + 6, 'YYYY-MM-DD') || 'T07:00', 'end_local', to_char(v_today + 6, 'YYYY-MM-DD') || 'T13:00',
                       'unit', 'Outpatient clinic', 'notes', 'Weekend cover', 'slots', 3)), false);
  perform public.create_shifts(v_org, 'nurse', jsonb_build_array(
    jsonb_build_object('start_local', to_char(v_today + 3, 'YYYY-MM-DD') || 'T07:00', 'end_local', to_char(v_today + 3, 'YYYY-MM-DD') || 'T19:00',
                       'unit', 'ICU 2', 'notes', 'Day shift, 12 h', 'slots', 2),
    jsonb_build_object('start_local', to_char(v_today + 4, 'YYYY-MM-DD') || 'T19:00', 'end_local', to_char(v_today + 5, 'YYYY-MM-DD') || 'T07:00',
                       'unit', 'ICU 1', 'notes', 'Night shift, 12 h', 'slots', 1),
    jsonb_build_object('start_local', to_char(v_today + 5, 'YYYY-MM-DD') || 'T13:00', 'end_local', to_char(v_today + 5, 'YYYY-MM-DD') || 'T19:00',
                       'unit', 'Ward 3B', 'notes', '', 'slots', 3)), false);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
