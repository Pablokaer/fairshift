-- Rules 1-4: pools, ordering, persistence, uniqueness.
begin;
\ir _helpers.psql
select plan(22);

select tests.fixture(5);
select tests.new_user('outsider');
insert into public.memberships (org_id, user_id, role) values (tests.id('org'), tests.id('outsider'), 'staff');

-- Rule 1: only pool members can join.
select throws_ok(
  $$ select tests.join('outsider') $$, 'P0001', 'queue.not_eligible',
  'rule 1: a member of the org who is not in the pool cannot join');

select tests.new_user('stranger');
select throws_ok(
  $$ select tests.join('stranger') $$, 'P0001', 'auth.forbidden',
  'rule 1: someone outside the org cannot join');

-- Rule 2: position is by server join order.
select tests.join('s3');
select tests.join('s1');
select tests.join('s2');
select is(tests.order_of(), 's3,s1,s2', 'rule 2: order follows server join order, not user ids');
select is(tests.pos('s3'), 1, 'rule 2: first joiner is #1');
select is(tests.pos('s2'), 3, 'rule 2: third joiner is #3');
select is(
  (select bool_and(ok) from (
    select joined_at >= lag(joined_at) over (order by seq) or lag(joined_at) over (order by seq) is null as ok
    from public.queue_entries where queue_id = tests.id('q')) x),
  true, 'rule 2: seq order and joined_at order agree');
select is(
  tests.val('s1', 'select queue_total::text from public.my_queues() where queue_id = $1', tests.id('q'))::int,
  3, 'staff sees total queue size');

-- Rule 2: there is no client-supplied time anywhere in the API.
select is(
  (select count(*)::int from information_schema.parameters
   where specific_schema = 'public' and specific_name like 'join_queue%' and data_type like 'timestamp%'),
  0, 'rule 2: join_queue accepts no timestamp from the client');

-- Rule 3: entries never expire. Make the tickets very old and run the scheduler.
update public.queue_entries set joined_at = joined_at - interval '400 days' where queue_id = tests.id('q');
select tests.tick();
select is(tests.order_of(), 's3,s1,s2', 'rule 3: very old tickets are untouched by the scheduler');

-- Rule 4: at most once per queue.
select throws_ok($$ select tests.join('s1') $$, 'P0001', 'queue.already_joined',
  'rule 4: cannot join the same queue twice');
select throws_ok(
  $$ insert into public.queue_entries (queue_id, org_id, user_id, seq, joined_at)
     values (tests.id('q'), tests.id('org'), tests.id('s1'), 999999, now()) $$,
  '23505', null, 'rule 4: unique index enforces it at the table level too');

-- Rule 4: cannot be in the queue while holding an unfinished assignment from it.
select tests.shift('A', interval '2 days');
select is(tests.offered_to('A'), 's3', 'first in line gets the offer');
select tests.accept('s3', 'A');
select is(tests.state('s3'), 'assigned', 'accepted -> assigned');
select is(tests.pos('s3'), null::int, 'assigned person is no longer counted in the queue');
select is(tests.pos('s1'), 1, 'everyone behind moves up');
select throws_ok($$ select tests.join('s3') $$, 'P0001', 'queue.holding_shift',
  'rule 4: cannot rejoin while holding an unfinished shift from this queue');

-- But they can join a different queue in the meantime.
select tests.second_queue('q2');
select lives_ok($$ select tests.join('s3', 'q2') $$, 'can be in another queue while holding a shift');

-- Staff cannot read other people's tickets (privacy).
select is(
  tests.val('s1', 'select count(*)::text from public.queue_entries where queue_id = $1', tests.id('q'))::int,
  1, 'staff only see their own ticket rows');
select throws_ok(
  $$ select tests.val('s1', 'select count(*)::text from public.queue_roster($1)', tests.id('q')) $$,
  'P0001', 'auth.forbidden', 'staff cannot see the roster by default');
update public.organizations set staff_can_see_names = true where id = tests.id('org');
select is(
  tests.val('s1', 'select count(*)::text from public.queue_roster($1) where user_id is null', tests.id('q'))::int,
  3, 'with names enabled, staff see the roster but never user ids');

-- There is no reorder RPC at all (rule 13).
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '^(reorder|move|swap|set_position|set_seq|bump)'),
  0, 'rule 13: no function to reorder exists');
select throws_ok(
  $$ select tests.act('admin', 'update public.queue_entries set seq = 1 where queue_id = $1', tests.id('q')) $$,
  '42501', null, 'rule 13: admins cannot update tickets directly');

select * from finish();
rollback;
