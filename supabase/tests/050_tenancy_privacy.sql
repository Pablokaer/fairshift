-- Tenant isolation, what staff can see, Realtime authorization, GDPR/LGPD.
begin;
\ir _helpers.psql
select plan(33);

select tests.fixture(3, 1);
select tests.fixture(1, 0, 'org2', 'x');
select tests.join_range('d', 1, 3, 'qd');
select tests.join('n1', 'qn');
select tests.shift('A', interval '2 days', 1, 'doctor');

-- Hospitals never see each other's data.
select is(tests.val('xadmin', 'select count(*)::text from public.organizations')::int, 1, 'a manager sees only their hospital');
select is(tests.val('xadmin', 'select count(*)::text from public.queues where org_id = $1', tests.id('org'))::int, 0,
  'no queues of another hospital');
select is(tests.val('xadmin', 'select count(*)::text from public.shifts')::int, 0, 'no shifts of another hospital');
select is(tests.val('xadmin', 'select count(*)::text from public.audit_events where org_id = $1', tests.id('org'))::int, 0,
  'no audit events of another hospital');
select is(tests.val('xadmin', 'select count(*)::text from public.queue_entries')::int, 0, 'no tickets of another hospital');
select is(tests.val('xadmin', 'select count(*)::text from public.profiles where id = $1', tests.id('d1'))::int, 0,
  'no profiles of another hospital');
select throws_ok($$ select tests.val('xadmin', 'select count(*)::text from public.queue_roster($1)', tests.id('qd')) $$,
  'P0001', 'auth.forbidden', 'cannot read another hospital''s queue');
select throws_ok($$ select tests.act('xadmin', 'select public.cancel_shift($1)', tests.id('A')) $$,
  'P0001', 'auth.forbidden', 'cannot act on another hospital''s shift');
select throws_ok($$ select tests.val('xadmin', 'select count(*)::text from public.admin_professionals($1)', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'cannot list another hospital''s professionals');
select throws_ok($$ select tests.val('xadmin', 'select count(*)::text from public.admin_audit($1)', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'cannot read another hospital''s audit log');
select throws_ok($$ select tests.val('xadmin', 'select join_code from public.admin_hospital_code($1)', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'cannot read another hospital''s code');
select throws_ok($$ select tests.act('xadmin', 'select public.create_shifts($1, ''doctor'', ''[{"starts_at": "2030-01-01T10:00:00Z", "ends_at": "2030-01-01T18:00:00Z"}]'')', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'cannot create shifts in another hospital');
select throws_ok($$ select tests.join('xd1', 'qd') $$, 'P0001', 'auth.forbidden', 'cannot join another hospital''s queue');

-- Staff see only their own entries, position and totals. Never names.
select is(tests.val('d2', 'select count(*)::text from public.queue_entries')::int, 1, 'staff see only their own ticket');
select is(tests.val('d2', 'select count(*)::text from public.profiles')::int, 1, 'staff see only their own profile');
select is(tests.val('d2', 'select count(*)::text from public.assignments')::int, 0, 'staff do not see others'' assignments');
select is(tests.val('d2', 'select count(*)::text from public.shifts')::int, 0, 'staff do not see shifts that are not theirs');
select is(tests.val('d2', 'select count(*)::text from public.audit_events')::int, 0, 'staff cannot read the audit log');
select is(tests.val('d2', 'select count(*)::text from public.memberships')::int, 1, 'staff see only their own membership');
select throws_ok($$ select tests.val('d2', 'select count(*)::text from public.queue_roster($1)', tests.id('qd')) $$,
  'P0001', 'auth.forbidden', 'staff cannot see the roster (names)');
select throws_ok($$ select tests.act('d2', 'insert into public.memberships (org_id, user_id, role) values ($1, auth.uid(), ''admin'')', tests.id('org2')) $$,
  '42501', null, 'staff cannot write memberships directly');
select throws_ok($$ select tests.act('d2', 'update public.queue_entries set seq = 1') $$,
  '42501', null, 'nobody can rewrite a ticket number');

-- Realtime: private topics.
select is(tests.val('d2', 'select private.can_subscribe($2)::text', null, 'queue:' || tests.id('qd')), 'true',
  'a doctor may subscribe to the doctors'' queue');
select is(tests.val('d2', 'select private.can_subscribe($2)::text', null, 'queue:' || tests.id('qn')), 'false',
  'but not to the nurses'' queue');
select is(tests.val('d2', 'select private.can_subscribe($2)::text', null, 'user:' || tests.id('d1')), 'false',
  'nor to someone else''s inbox');
select is(tests.val('xadmin', 'select private.can_subscribe($2)::text', null, 'org:' || tests.id('org') || ':admin'), 'false',
  'nor to another hospital''s manager channel');
select is(tests.val('admin', 'select private.can_subscribe($2)::text', null, 'queue:' || tests.id('qn')), 'true',
  'managers may subscribe to both queues');

-- GDPR/LGPD: export and anonymizing account deletion.
select ok(tests.val('d1', 'select (public.export_my_data() -> ''memberships'' -> 0 ->> ''profession'')') = 'doctor',
  'the data export includes the profession');
select tests.act('d1', 'select public.delete_my_account()');
select is(tests.assignees('A'), 'd2', 'their upcoming shift goes to the next person in line');
select is((select display_name || '|' || (deleted_at is not null)::text from public.profiles where id = tests.id('d1')),
  '|true', 'the profile becomes an anonymous tombstone');
select is((select count(*)::int from public.memberships where user_id = tests.id('d1')), 0, 'memberships are deleted');
select ok(tests.audit_count('shift.assigned', 'd1') = 1 and tests.audit_count('account.deleted', 'd1') = 1,
  'the audit log keeps its rows (by id only)');
select is(tests.order_of(), 'd3', 'the queue is consistent afterwards');

select * from finish();
rollback;
