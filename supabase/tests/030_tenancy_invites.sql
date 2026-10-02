-- Multi-tenancy (RLS) and invites.
begin;
\ir _helpers.psql
select plan(29);

select tests.fixture(2);
select tests.join('s1');
select tests.shift('A', interval '2 days');

-- A second, unrelated hospital.
select tests.new_user('admin2', 'Other Admin');
select tests.remember('org2', (select tests.val('admin2', $$select public.create_organization('Other Hospital', 'Europe/Lisbon')::text$$)::uuid));
select tests.remember('q_other', tests.val('admin2', 'select public.create_queue($1, $2)::text', tests.id('org2'), 'ER')::uuid);

-- Cross-tenant isolation.
select is(tests.val('admin2', 'select count(*)::text from public.organizations')::int, 1, 'admin2 sees only their org');
select is(tests.val('admin2', 'select count(*)::text from public.queues where org_id = $1', tests.id('org'))::int, 0,
  'no queues of another org');
select is(tests.val('admin2', 'select count(*)::text from public.shifts')::int, 0, 'no shifts of another org');
select is(tests.val('admin2', 'select count(*)::text from public.audit_events where org_id = $1', tests.id('org'))::int, 0,
  'no audit events of another org');
select is(tests.val('admin2', 'select count(*)::text from public.queue_entries')::int, 0, 'no tickets of another org');
select is(tests.val('admin2', 'select count(*)::text from public.profiles where id = $1', tests.id('s1'))::int, 0,
  'no profiles of another org');
select throws_ok($$ select tests.val('admin2', 'select count(*)::text from public.queue_roster($1)', tests.id('q')) $$,
  'P0001', 'auth.forbidden', 'cannot read another org''s roster');
select throws_ok($$ select tests.act('admin2', 'select public.cancel_shift($1)', tests.id('A')) $$,
  'P0001', 'auth.forbidden', 'cannot act on another org''s shift');
select throws_ok($$ select tests.val('admin2', 'select count(*)::text from public.admin_audit($1)', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'cannot read another org''s audit log');

-- Staff visibility inside their own org.
select is(tests.val('s2', 'select count(*)::text from public.shifts')::int, 0, 'staff do not see shifts not offered to them');
select is(tests.val('s1', 'select count(*)::text from public.shifts')::int, 1, 'staff see the shift offered to them');
select is(tests.val('s1', 'select count(*)::text from public.audit_events')::int, 0, 'staff cannot read the audit log');
select is(tests.val('s2', 'select count(*)::text from public.offers')::int, 0, 'staff cannot see others'' offers');
select is(tests.val('s2', 'select count(*)::text from public.profiles')::int, 1, 'staff see only their own profile by default');
select throws_ok($$ select tests.act('s1', 'select public.create_queue($1, $2)', tests.id('org'), 'Hack') $$,
  'P0001', 'auth.forbidden', 'staff cannot create queues');
select throws_ok($$ select tests.act('s1', 'insert into public.memberships (org_id, user_id, role) values ($1, auth.uid(), ''admin'')', tests.id('org2')) $$,
  '42501', null, 'direct writes are refused');
select throws_ok($$ select tests.act('s1', 'select public.create_invite($1, ''code'')', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'staff cannot create invites');

-- Invites: e-mail invite must match the signed-in e-mail.
create temp table tok (token text);
grant all on tok to authenticated;
select tests.act('admin', $$insert into tok select token from public.create_invite($1, 'email', 'newnurse@test.local', 'staff', array[$2::uuid])$$,
  tests.id('org'), tests.id('q')::text);
select ok(exists (select 1 from public.notification_outbox where to_email = 'newnurse@test.local' and template = 'invite'),
  'invite e-mail queued');
select is((select count(*)::int from public.audit_events where type = 'invite.created' and payload::text like '%newnurse%'), 0,
  'audit log does not store the invitee e-mail');
select tests.new_user('wrongperson');
select throws_ok($$ select tests.act('wrongperson', 'select public.accept_invite($2)', null, (select token from tok)) $$,
  'P0001', 'invite.email_mismatch', 'e-mail invites are bound to the e-mail address');
select tests.new_user('newnurse');
select tests.act('newnurse', 'select public.accept_invite($2)', null, (select token from tok));
select is(tests.val('newnurse', 'select count(*)::text from public.organizations')::int, 1, 'invitee joined the org');
select is(tests.val('newnurse', 'select count(*)::text from public.my_queues()')::int, 1, 'invite granted pool eligibility');
select throws_ok($$ select tests.act('newnurse', 'select public.accept_invite($2)', null, (select token from tok)) $$,
  'P0001', 'invite.used_up', 'e-mail invites are single-use');

-- Code invites: usage limit, revoke, expiry.
delete from tok;
select tests.act('admin', $$insert into tok select token from public.create_invite($1, 'code', null, 'staff', '{}', interval '1 day', 1)$$, tests.id('org'));
select tests.new_user('c1'); select tests.new_user('c2');
select lives_ok($$ select tests.act('c1', 'select public.accept_invite($2)', null, lower((select token from tok))) $$,
  'code works (case-insensitive)');
select throws_ok($$ select tests.act('c2', 'select public.accept_invite($2)', null, (select token from tok)) $$,
  'P0001', 'invite.used_up', 'max uses enforced');
update public.invites set max_uses = 10 where code = (select token from tok);
update public.invites set expires_at = now() - interval '1 minute' where code = (select token from tok);
select throws_ok($$ select tests.act('c2', 'select public.accept_invite($2)', null, (select token from tok)) $$,
  'P0001', 'invite.expired', 'expired code refused');
update public.invites set expires_at = now() + interval '1 day' where code = (select token from tok);
select tests.act('admin', 'select public.revoke_invite($1)', (select id from public.invites where code = (select token from tok)));
select throws_ok($$ select tests.act('c2', 'select public.accept_invite($2)', null, (select token from tok)) $$,
  'P0001', 'invite.revoked', 'revoked code refused');

-- Only owners can invite admins.
update public.memberships set role = 'admin' where user_id = tests.id('c1');
select throws_ok($$ select tests.act('c1', 'select public.create_invite($1, ''code'', null, ''admin'')', tests.id('org')) $$,
  'P0001', 'auth.forbidden', 'admins cannot invite admins');

-- Deactivated members cannot use an invite to come back.
select tests.act('admin', 'select public.deactivate_member($1, $2::uuid, $3)', tests.id('org'), tests.id('newnurse')::text, 'Contract ended');
delete from tok;
select tests.act('admin', $$insert into tok select token from public.create_invite($1, 'code')$$, tests.id('org'));
select throws_ok($$ select tests.act('newnurse', 'select public.accept_invite($2)', null, (select token from tok)) $$,
  'P0001', 'invite.member_deactivated', 'deactivated member cannot rejoin via invite');

select * from finish();
rollback;
