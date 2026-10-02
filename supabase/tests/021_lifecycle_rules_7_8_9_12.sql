-- Rules 7 (completion & rejoin), 8 (admin cancel restores), 9 (withdrawal), 12 (no-show).
begin;
\ir _helpers.psql
select plan(35);

select tests.fixture(6);
select tests.join_range(1, 5);

-- Rule 8: cancel after assignment -> back at ORIGINAL position.
select tests.shift('A', interval '2 days');
select tests.decline('s1', 'A');
select tests.accept('s2', 'A');
select is(tests.order_of(), 's1,s3,s4,s5', 'setup: s2 assigned and out of the queue');
select tests.join('s6');
select tests.act('s3', 'select public.leave_queue($1)', tests.id('q'));   -- someone ahead leaves meanwhile
select tests.act('admin', 'select public.cancel_shift($1, $2)', tests.id('A'), 'Ward closed');
select is(tests.order_of(), 's1,s2,s4,s5,s6', 'rule 8: s2 is back at the original place (behind s1, ahead of later joiners)');
select is(tests.pos('s2'), 2, 'rule 8: #2');
select is(tests.notif_count('s2', 'shift_cancelled'), 1, 'rule 8: cancellation notification');
select is((select status::text from public.assignments where shift_id = tests.id('A')), 'cancelled', 'assignment cancelled');
select is(tests.audit_count('entry.restored', 's2'), 1, 'restore is audited');

-- Cancel while an offer is open: offered person is unaffected.
select tests.shift('B', interval '3 days');
select is(tests.offered_to('B'), 's1', 'B offered to s1');
select tests.act('admin', 'select public.cancel_shift($1, $2)', tests.id('B'), null);
select is(tests.offered_to('B'), null, 'cancel revokes the open offer');
select is(tests.pos('s1'), 1, 'offered person keeps their position');

-- Rule 7: completion -> eligible to rejoin, at the END.
select tests.shift('C', interval '4 days');
select tests.accept('s1', 'C');
select throws_ok($$ select tests.act('admin', 'select public.complete_shift($1)', tests.id('C')) $$,
  'P0001', 'shift.not_started', 'cannot complete before the shift starts');
select tests.shift_started('C', interval '13 hours');   -- started 13 h ago, 12 h long -> ended
select tests.tick();
select is((select status::text from public.shifts where id = tests.id('C')), 'completed',
  'rule 7: shift completes automatically after its end time');
select is(tests.notif_count('s1', 'eligible_to_rejoin'), 1, 'rule 7: "your shift is done, rejoin?" notification');
select is(tests.state('s1'), 'not_joined', 'rule 7: not automatically back without auto-rejoin');
select tests.join('s1');
select is(tests.order_of(), 's2,s4,s5,s6,s1', 'rule 7: rejoining is always at the end');

-- Rule 7: auto-rejoin setting.
select tests.act('s2', 'select public.set_queue_auto_rejoin($1, true)', tests.id('q'));
select tests.shift('D', interval '5 days');
select tests.accept('s2', 'D');
select tests.shift_started('D', interval '1 hour');
select tests.act('admin', 'select public.complete_shift($1)', tests.id('D'));
select is(tests.order_of(), 's4,s5,s6,s1,s2', 'rule 7: auto-rejoin puts them at the end automatically');
select is(tests.notif_count('s2', 'auto_rejoined'), 1, 'auto-rejoin notification');

-- Rule 9: withdraw after accepting -> re-offered; withdrawer is out (rejoin at end).
select tests.shift('E', interval '6 days');
select tests.decline('s4', 'E');
select tests.accept('s5', 'E');
select tests.act('s5', 'select public.withdraw_assignment($1, $2)', tests.id('E'), 'Family emergency');
select is(tests.state('s5'), 'not_joined', 'rule 9: withdrawer is not restored');
select is(tests.offered_to('E'), 's4', 'F4 (restart): new round starts from the front, so s4 is asked again');
select is(tests.notif_count('admin', 'withdrawal'), 1, 'rule 9: admins notified of the withdrawal');
select tests.join('s5');
select is(tests.pos('s5'), 5, 'rule 9: withdrawer can rejoin only at the end');
select tests.accept('s4', 'E');
select tests.shift_started('E', interval '1 hour');
select throws_ok($$ select tests.act('s4', 'select public.withdraw_assignment($1)', tests.id('E')) $$,
  'P0001', 'shift.already_started', 'cannot withdraw after the shift started');

-- Rule 9: per-queue cooldown, and "continue" re-offer policy.
select tests.second_queue('q2', '{"withdraw_cooldown_hours": 48, "reoffer_after_withdraw": "continue"}');
select tests.join('s1', 'q2'); select tests.join('s3', 'q2'); select tests.join('s6', 'q2');
select tests.shift('F', interval '7 days', interval '12 hours', true, 'q2');
select tests.decline('s1', 'F');
select tests.accept('s3', 'F');
select tests.act('s3', 'select public.withdraw_assignment($1)', tests.id('F'));
select is(tests.offered_to('F'), 's6', 'policy continue: earlier decliners are not asked again');
select throws_ok($$ select tests.join('s3', 'q2') $$, 'P0001', 'queue.cooldown', 'rule 9: cooldown blocks rejoining');
select tests.act('admin', 'select public.allow_rejoin($1, $2::uuid)', tests.id('q2'), tests.id('s3')::text);
select lives_ok($$ select tests.join('s3', 'q2') $$, 'admin can lift a cooldown');

-- Rule 12: no-show, default policy = same as completed.
select tests.shift('G', interval '8 days');
select is(tests.offered_to('G'), 's6', 'G offered to the first free person (s6)');
select tests.accept('s6', 'G');
select tests.shift_started('G', interval '2 hours');
select tests.act('admin', 'select public.mark_no_show($1, $2)', tests.id('G'), 'Did not show up');
select is((select status::text from public.shifts where id = tests.id('G')), 'no_show', 'rule 12: marked no-show');
select lives_ok($$ select tests.join('s6') $$, 'rule 12 default: can rejoin at the end like after completion');

-- Rule 12: cooldown policy, applied as a correction after auto-completion (F8).
select tests.second_queue('q3', '{"no_show_policy": "cooldown", "no_show_cooldown_hours": 72}');
select tests.join('s2', 'q3');
select tests.act('s2', 'select public.set_queue_auto_rejoin($1, true)', tests.id('q3'));
select tests.shift('H', interval '9 days', interval '12 hours', true, 'q3');
select tests.accept('s2', 'H');
select tests.shift_started('H', interval '13 hours');
select tests.tick('q3');
select is(tests.state('s2', 'q3'), 'waiting', 'auto-completed and auto-rejoined');
select tests.act('admin', 'select public.mark_no_show($1, $2)', tests.id('H'), 'Correction');
select is(tests.state('s2', 'q3'), 'not_joined', 'F8: correction closes the auto-rejoined ticket under cooldown policy');
select throws_ok($$ select tests.join('s2', 'q3') $$, 'P0001', 'queue.cooldown', 'rule 12: cooldown applies');

-- Rule 12: admin-approval policy.
select tests.second_queue('q4', '{"no_show_policy": "admin_approval"}');
select tests.join('s5', 'q4');
select tests.shift('I', interval '10 days', interval '12 hours', true, 'q4');
select tests.accept('s5', 'I');
select tests.shift_started('I', interval '1 hour');
select tests.act('admin', 'select public.mark_no_show($1)', tests.id('I'));
select throws_ok($$ select tests.join('s5', 'q4') $$, 'P0001', 'queue.needs_approval', 'rule 12: rejoin needs approval');
select tests.act('admin', 'select public.allow_rejoin($1, $2::uuid)', tests.id('q4'), tests.id('s5')::text);
select lives_ok($$ select tests.join('s5', 'q4') $$, 'approved -> can rejoin');

-- F8: correction window is 7 days.
update public.shifts set ended_at = now() - interval '8 days' where id = tests.id('D');
select throws_ok($$ select tests.act('admin', 'select public.mark_no_show($1)', tests.id('D')) $$,
  'P0001', 'shift.correction_window_passed', 'F8: no-show correction only within 7 days');

-- Lifecycle is audited.
select ok(tests.audit_count('shift.assigned') >= 7 and tests.audit_count('shift.cancelled') = 2
  and tests.audit_count('shift.completed') >= 3 and tests.audit_count('shift.no_show') = 3
  and tests.audit_count('assignment.withdrawn') = 2, 'rule 14: assign/cancel/complete/no-show/withdraw are audited');
select is((select reason from public.audit_events where type = 'assignment.withdrawn' and subject_id = tests.id('s5')),
  'Family emergency', 'withdraw reason recorded');

select * from finish();
rollback;
