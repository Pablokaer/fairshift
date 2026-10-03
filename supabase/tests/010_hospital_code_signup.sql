-- Sign-up with the hospital code, regeneration, professions and permanent queues.
begin;
\ir _helpers.psql
select plan(32);

select tests.fixture(1, 0);
create temp table codes as select join_code as old_code from public.organizations where id = tests.id('org');

-- Sign-up with a valid code (any case, dashes and spaces ignored) links the account.
select lives_ok(
  $$ select tests.new_user('signup_ok', 'New Doctor', jsonb_build_object(
       'hospital_code', lower(substr((select old_code from codes), 1, 4)) || '-' || substr((select old_code from codes), 5),
       'profession', 'doctor')) $$,
  'sign-up with a valid hospital code succeeds');
select is((select profession::text from public.memberships where user_id = tests.id('signup_ok')), 'doctor',
  'the profession chosen at sign-up is stored');
select is((select role::text || '/' || status::text from public.memberships where user_id = tests.id('signup_ok')),
  'staff/active', 'the new account is an active professional of that hospital');
select is(tests.audit_count('member.joined', 'signup_ok'), 1, 'joining through the code is audited');

-- Invalid code or profession: the account is not created at all.
select throws_ok(
  $$ select tests.new_user('bad_code', null, '{"hospital_code": "NOPE2345", "profession": "nurse"}') $$,
  'P0001', 'hospital_code.invalid', 'sign-up with an invalid code fails');
select throws_ok(
  format($$ select tests.new_user('bad_prof', null, '{"hospital_code": "%s", "profession": "surgeon"}') $$,
         (select old_code from codes)),
  'P0001', 'profession.invalid', 'sign-up with an invalid profession fails');
select is((select count(*)::int from auth.users where email in ('bad_code@test.local', 'bad_prof@test.local')), 0,
  'no account exists after a rejected sign-up');

-- The auth hook rejects before the account is created.
select is(public.hook_before_user_created('{"user": {"user_metadata": {}}}') -> 'error' ->> 'message',
  'hospital_code.required', 'hook: a code is required');
select is(public.hook_before_user_created('{"user": {"user_metadata": {"hospital_code": "NOPE2345", "profession": "doctor"}}}')
  -> 'error' ->> 'message', 'hospital_code.invalid', 'hook: invalid code rejected');
select is(public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('user_metadata',
  jsonb_build_object('hospital_code', (select old_code from codes))))) -> 'error' ->> 'message',
  'profession.invalid', 'hook: profession required');
select is(public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('user_metadata',
  jsonb_build_object('hospital_code', (select old_code from codes), 'profession', 'nurse')))),
  '{}'::jsonb, 'hook: valid code + profession allowed');

-- An account without a code exists but is not linked to any hospital.
select tests.new_user('loner');
select is(tests.val('loner', 'select count(*)::text from public.my_queue()')::int, 0,
  'an unlinked account has no hospital and no queue');

-- The code is only visible to managers.
select throws_ok($$ select tests.val('d1', 'select join_code from public.organizations limit 1') $$,
  '42501', null, 'staff cannot read the hospital code column');
select throws_ok($$ select tests.val('d1', 'select join_code from public.admin_hospital_code($1)', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'staff cannot call admin_hospital_code');
select is(tests.val('admin', 'select join_code from public.admin_hospital_code($1)', tests.id('org')),
  (select old_code from codes), 'managers read the code');

-- Regeneration.
select throws_ok($$ select tests.act('d1', 'select public.regenerate_join_code($1)', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'staff cannot regenerate the code');
select isnt(tests.val('admin', 'select public.regenerate_join_code($1)', tests.id('org')),
  (select old_code from codes), 'regenerating gives a new code');
select throws_ok(
  format($$ select tests.new_user('late', null, '{"hospital_code": "%s", "profession": "doctor"}') $$,
         (select old_code from codes)),
  'P0001', 'hospital_code.invalid', 'the old code stops working');
select is(public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('user_metadata',
  jsonb_build_object('hospital_code', (select old_code from codes), 'profession', 'doctor')))) -> 'error' ->> 'message',
  'hospital_code.invalid', 'hook: the old code is rejected');
select lives_ok(
  $$ select tests.new_user('fresh', null, jsonb_build_object('hospital_code',
       (select join_code from public.organizations where id = tests.id('org')), 'profession', 'nurse')) $$,
  'the new code works');
select is((select status::text from public.memberships where user_id = tests.id('signup_ok')), 'active',
  'existing members are not affected by regeneration');
select is(tests.audit_count('org.code_regenerated'), 1, 'regeneration is audited');
select ok((select payload::text from public.audit_events where type = 'org.code_regenerated')
  !~ (select old_code from codes), 'the audit event never contains a code');

-- Linking an existing account with the code.
select is(tests.val('loner', 'select public.join_hospital($2, $3::public.profession)::text',
  null, (select join_code from public.organizations where id = tests.id('org')), 'nurse')::uuid,
  tests.id('org'), 'an existing account can link itself with the code');
select throws_ok($$ select tests.act('loner', 'select public.join_hospital($2, ''nurse'')', null,
  (select join_code from public.organizations where id = tests.id('org'))) $$,
  'P0001', 'hospital.already_member', 'linking twice is rejected');
select throws_ok($$ select tests.act('loner', 'select public.join_hospital($2, ''nurse'')', null, 'ZZZZ9999') $$,
  'P0001', 'hospital_code.invalid', 'join_hospital rejects invalid codes');

-- The profession decides which queue someone can join.
select throws_ok($$ select tests.join('signup_ok', 'qn') $$, 'P0001', 'queue.not_eligible',
  'a doctor cannot join the nurses'' queue');
select lives_ok($$ select tests.join('signup_ok', 'qd') $$, 'a doctor joins the doctors'' queue');
select is(tests.state('admin'), 'no_profession', 'a manager without profession has no queue');
select throws_ok($$ select tests.act('admin', 'select public.set_member_profession($1, $2::uuid, null)',
  tests.id('org'), tests.id('d1')::text) $$, 'P0001', 'profession.invalid', 'professionals must keep a profession');

-- Exactly two permanent queues.
select is((select count(*)::int from public.queues where org_id = tests.id('org') and archived_at is null), 2,
  'a hospital has exactly two queues');
select throws_ok($$ delete from public.queues where id = tests.id('qd') $$, 'P0001', 'queue.permanent',
  'the profession queues cannot be deleted');

select * from finish();
rollback;
