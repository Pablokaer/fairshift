-- Publishing a shift with N slots assigns it at once to the first N eligible
-- people of the right profession, in queue order. No offers.
begin;
\ir _helpers.psql
select plan(39);

select tests.fixture(20, 5);
select tests.join_range('d', 1, 20, 'qd');
select tests.join_range('n', 1, 3, 'qn');

-- A doctors' shift with 2 slots and 20 doctors in the queue takes #1 and #2.
select tests.shift('A', interval '2 days', 2, 'doctor');
select is(tests.assignees('A'), 'd1,d2', 'the first 2 doctors are assigned');
select is(tests.shift_status('A'), 'filled', 'all slots taken: the shift is filled');
select is((select string_agg(queue_position::text, ',' order by queue_position) from public.assignments
           where shift_id = tests.id('A')), '1,2', 'their positions at assignment are recorded');
select is(tests.state('d1'), 'assigned', 'assigned people see their shift');
select is(tests.pos('d1'), null::int, 'assigned people leave the count');
select is(tests.total('d3'), 18, 'the doctors'' queue now has 18 people');
select is(tests.pos('d3'), 1, '#3 becomes #1');
select is(tests.pos('d20'), 18, 'everyone moves up by 2');
select is(tests.order_of('qn'), 'n1,n2,n3', 'nurses are unaffected');
select is(tests.total('n1'), 3, 'nurses'' total is unaffected');
select is((select count(*)::int from public.assignments a join public.memberships m
           on m.user_id = a.user_id and m.org_id = a.org_id where a.shift_id = tests.id('A') and m.profession <> 'doctor'), 0,
  'nobody of another profession is assigned');
select is(tests.notif_count('d1', 'shift_assigned') + tests.notif_count('d2', 'shift_assigned'), 2,
  'both are notified in the inbox');
select is((select count(*)::int from public.notification_outbox where template = 'shift_assigned' and channel = 'email'
           and user_id in (tests.id('d1'), tests.id('d2'))), 2, 'with an e-mail fallback');
select is(tests.notif_count('d3', 'shift_assigned'), 0, 'nobody else is notified');
select is(tests.audit_count('shift.assigned'), 2, 'every assignment is audited');
select ok((select bool_and(payload ? 'seq' and payload ? 'position' and payload ? 'waited_seconds')
           from public.audit_events where type = 'shift.assigned'), 'assignment audit carries seq, position and wait');
select is(tests.val('d1', 'select count(*)::text from public.shifts')::int, 1, 'an assignee can read their shift');
select is(tests.val('d3', 'select count(*)::text from public.shifts')::int, 0, 'others cannot');

-- Shifts published together are processed in shift-start order.
select tests.shift('B', interval '3 days', 3, 'doctor', false);
select tests.shift('C', interval '2 days 6 hours', 1, 'doctor', false);
select tests.act('admin', 'select public.publish_shifts(array[$1, $2::uuid])', tests.id('B'), tests.id('C')::text);
select is(tests.assignees('C'), 'd3', 'the earlier shift takes the next person');
select is(tests.assignees('B'), 'd4,d5,d6', 'the later shift takes the following three');
select is(tests.pos('d7'), 1, 'd7 is now first');
select throws_ok($$ select tests.act('admin', 'select public.publish_shifts(array[$1])', tests.id('B')) $$,
  'P0001', 'shift.not_draft', 'a shift cannot be published twice');
select throws_ok($$ select tests.act('d7', 'select public.publish_shifts(array[$1])', tests.id('B')) $$,
  'P0001', 'auth.forbidden', 'staff cannot publish');
select throws_ok($$ select tests.shift('past', interval '-1 hour', 1, 'doctor') $$,
  'P0001', 'shift.in_past', 'a shift in the past cannot be published');
select throws_ok($$ select tests.shift('zero', interval '1 day', 0, 'doctor') $$,
  'P0001', 'shift.invalid_slots', 'slots must be at least 1');

-- Paused people keep their place but are skipped.
select tests.act('d7', 'select public.pause_queue($1)', tests.id('qd'));
select tests.shift('D', interval '4 days', 1, 'doctor');
select is(tests.assignees('D'), 'd8', 'a paused #1 is skipped');
select is(tests.pos('d7'), 1, 'and keeps #1');

-- Overlap: d9 also works at another hospital and holds a shift there.
select tests.fixture(0, 0, 'org2', 'x');
insert into public.memberships (org_id, user_id, role, profession) values (tests.id('org2'), tests.id('d9'), 'staff', 'doctor');
select tests.join('d9', 'xqd');
select tests.shift('X1', interval '5 days', 1, 'doctor', true, interval '12 hours', 'org2', 'xadmin');
select is(tests.assignees('X1'), 'd9', 'd9 holds a shift at the other hospital');
select is(tests.pos('d9'), 2, 'd9 is #2 here (behind the paused d7)');
select tests.shift('E', interval '5 days 2 hours', 1, 'doctor');
select is(tests.assignees('E'), 'd10', 'd9 is skipped for an overlapping shift');
select is(tests.pos('d9'), 2, 'the skipped person keeps their position');
select tests.shift('F', interval '6 days', 1, 'doctor');
select is(tests.assignees('F'), 'd9', 'and gets the next shift that does not overlap');

-- Fewer people than slots (decision a): assign everyone, keep the rest open.
select tests.shift('N1', interval '2 days', 5, 'nurse');
select is(tests.assignees('N1'), 'n1,n2,n3', 'all 3 waiting nurses are assigned');
select is(tests.shift_status('N1'), 'open', 'the shift stays open with 2 free slots');
select is(tests.total('n1'), 0, 'the nurses'' queue is empty');
select is(tests.notif_count('admin', 'shift_short'), 1, 'the manager is told the shift is short');
select tests.join('n4', 'qn');
select is(tests.state('n4'), 'assigned', 'a nurse who joins fills a free slot at once');
select tests.join('n5', 'qn');
select is(tests.assignees('N1'), 'n1,n2,n3,n4,n5', 'and the next one fills the last slot');
select is(tests.shift_status('N1'), 'filled', 'the shift is now filled');

select * from finish();
rollback;
