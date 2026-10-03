-- After assignment: completion, auto-rejoin, cancellation, giving back,
-- no-show, member changes, and the audit trail of all of it.
begin;
\ir _helpers.psql
select plan(44);

select tests.fixture(6, 0);
select tests.join_range('d', 1, 6, 'qd');

select tests.shift('A', interval '2 days', 1, 'doctor');
select is(tests.assignees('A'), 'd1', 'd1 takes A');
select throws_ok($$ select tests.join('d1') $$, 'P0001', 'queue.holding_shift', 'cannot rejoin while holding a shift');
select throws_ok($$ select tests.act('d1', 'select public.leave_queue($1)', tests.id('qd')) $$,
  'P0001', 'queue.holding_shift', 'cannot leave while holding a shift');

-- Completion (automatic at the end time) -> rejoin, ALWAYS at the end.
select tests.shift_started('A', interval '13 hours');
select tests.tick();
select is(tests.shift_status('A'), 'completed', 'the scheduler completes a shift after its end');
select is((select status::text from public.assignments where shift_id = tests.id('A')), 'completed', 'assignment completed');
select is(tests.state('d1'), 'not_joined', 'after the shift the person is out of the queue');
select is(tests.notif_count('d1', 'eligible_to_rejoin'), 1, '"your shift is done, rejoin?" is sent');
select tests.join('d1');
select is(tests.order_of(), 'd2,d3,d4,d5,d6,d1', 'rejoining after a shift is at the end');

-- Auto-rejoin + completion by the manager.
select tests.act('d2', 'select public.set_queue_auto_rejoin($1, true)', tests.id('qd'));
select tests.shift('B', interval '2 days', 1, 'doctor');
select is(tests.assignees('B'), 'd2', 'd2 takes B');
select throws_ok($$ select tests.act('admin', 'select public.complete_shift($1)', tests.id('B')) $$,
  'P0001', 'shift.not_started', 'a shift cannot be completed before it starts');
select tests.shift_started('B', interval '1 hour');
select tests.act('admin', 'select public.complete_shift($1)', tests.id('B'));
select is(tests.shift_status('B'), 'completed', 'the manager can mark it completed');
select is(tests.order_of(), 'd3,d4,d5,d6,d1,d2', 'auto-rejoin puts d2 at the end');
select is(tests.notif_count('d2', 'auto_rejoined'), 1, 'd2 is told they rejoined');

-- Decision c: cancelling restores ORIGINAL positions.
select tests.shift('C', interval '3 days', 2, 'doctor');
select is(tests.assignees('C'), 'd3,d4', 'C takes d3 and d4');
select is(tests.order_of(), 'd5,d6,d1,d2', 'they left the count');
select tests.act('admin', 'select public.cancel_shift($1, $2)', tests.id('C'), 'Ward closed');
select is(tests.order_of(), 'd3,d4,d5,d6,d1,d2', 'cancelling puts them back at their original positions');
select is(tests.pos('d3'), 1, 'd3 is #1 again');
select is(tests.audit_count('entry.restored'), 2, 'restorations are audited');
select is(tests.notif_count('d3', 'shift_cancelled'), 1, 'assignees are told');
select is(tests.shift_status('C'), 'cancelled', 'the shift is cancelled');

-- Decision b: giving a shift back before it starts.
select tests.shift('D', interval '3 days', 1, 'doctor');
select is(tests.assignees('D'), 'd3', 'd3 takes D');
select tests.act('d3', 'select public.give_back_shift($1, $2)', tests.id('D'), 'Sick');
select is(tests.assignees('D'), 'd4', 'the slot goes at once to the person now first in line');
select is(tests.state('d3'), 'not_joined', 'the giver is out of the queue');
select is(tests.notif_count('admin', 'shift_given_back'), 1, 'the manager is notified');
select tests.join('d3');
select is(tests.order_of(), 'd5,d6,d1,d2,d3', 'the giver can rejoin only at the end');
select tests.shift('G', interval '7 days', 1, 'doctor');
select tests.shift_started('G', interval '1 hour');
select throws_ok($$ select tests.act('d5', 'select public.give_back_shift($1)', tests.id('G')) $$,
  'P0001', 'shift.already_started', 'a started shift cannot be given back');

-- Decision e: profession cannot change while holding an upcoming shift.
select throws_ok($$ select tests.act('admin', 'select public.set_member_profession($1, $2::uuid, ''nurse'')', tests.id('org'), tests.id('d4')::text) $$,
  'P0001', 'member.has_assignments', 'profession change is blocked while holding a shift');
select throws_ok($$ select tests.act('admin', 'select public.cancel_shift($1)', tests.id('G')) $$,
  'P0001', 'shift.already_started', 'a started shift cannot be cancelled');

-- Decision g: no-show = same as completed, recorded per person.
select tests.shift('E', interval '4 days', 1, 'doctor');
select is(tests.assignees('E'), 'd6', 'd6 takes E (d5 holds G)');
select throws_ok($$ select tests.act('admin', 'select public.mark_no_show($1)', tests.assignment_id('E', 'd6')) $$,
  'P0001', 'shift.not_started', 'no-show only after the start');
select tests.shift_started('E', interval '1 hour');
select tests.act('admin', 'select public.mark_no_show($1, $2)', tests.assignment_id('E', 'd6'), 'Did not come');
select is((select status::text from public.assignments where id = tests.assignment_id('E', 'd6')), 'no_show', 'recorded');
select is(tests.state('d6'), 'not_joined', 'they may rejoin (at the end), as after a completed shift');
select tests.shift_started('E', interval '13 hours');
select tests.tick();
select is(tests.shift_status('E'), 'completed', 'the shift still completes');
select tests.act('admin', 'select public.mark_no_show($1)', tests.assignment_id('A', 'd1'));
select is((select payload ->> 'correction' from public.audit_events where type = 'assignment.no_show'
           and subject_id = tests.id('d1')), 'true', 'a completed shift can be corrected to a no-show');
select is(tests.pos('d1'), 1, 'a correction does not move anyone');

-- Deactivation and removal.
select throws_ok($$ select tests.act('admin', 'select public.deactivate_member($1, $2::uuid, $3)', tests.id('org'), tests.id('d4')::text, 'Leaving') $$,
  'P0001', 'member.has_assignments', 'cannot deactivate someone holding an upcoming shift');
select tests.act('admin', 'select public.deactivate_member($1, $2::uuid, $3)', tests.id('org'), tests.id('d2')::text, 'On leave');
select is(tests.order_of(), 'd1,d3', 'deactivating removes the ticket');
select throws_ok($$ select tests.join('d2') $$, 'P0001', 'auth.forbidden', 'a deactivated member cannot join');
select tests.act('admin', 'select public.remove_member($1, $2::uuid, $3)', tests.id('org'), tests.id('d3')::text, 'Contract ended');
select is(tests.order_of(), 'd1', 'removing a member closes their ticket');
select is((select count(*)::int from public.memberships where user_id = tests.id('d3')), 0, 'and their membership');

-- Decision f: a manager with a profession can be in the queue; flagged in the audit log.
select tests.act('admin', 'select public.set_member_profession($1, $2::uuid, ''doctor'')', tests.id('org'), tests.id('admin')::text);
select tests.join('admin');
select tests.shift('M', interval '5 days', 2, 'doctor');
select is(tests.assignees('M'), 'd1,admin', 'the manager is assigned in queue order like anyone else');
select is((select payload ->> 'assignee_is_manager' from public.audit_events where type = 'shift.assigned'
           and shift_id = tests.id('M') and subject_id = tests.id('admin')), 'true', 'and flagged in the audit log');

-- Every state change is in the audit log.
select ok(tests.audit_count('shift.created') >= 7 and tests.audit_count('shift.published') >= 7
  and tests.audit_count('shift.cancelled') = 1 and tests.audit_count('shift.completed') >= 2
  and tests.audit_count('assignment.given_back') = 1 and tests.audit_count('assignment.no_show') = 2
  and tests.audit_count('member.deactivated') = 1 and tests.audit_count('member.removed') = 1
  and tests.audit_count('member.profession_changed') = 1,
  'shift and member events are audited');
select throws_ok($$ delete from public.audit_events $$, '42501', null, 'audit rows cannot be deleted');

select * from finish();
rollback;
