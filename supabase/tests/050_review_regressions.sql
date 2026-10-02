-- Regression tests for issues found in the independent review.
begin;
\ir _helpers.psql
select plan(14);

select tests.fixture(4, '{"auto_pause_after_timeouts": 1}');
select tests.join_range(1, 4);

-- Admin cannot cancel a shift that has already started (would restore the old place).
select tests.shift('A', interval '2 days');
select tests.accept('s1', 'A');
select tests.shift_started('A', interval '1 hour');
select throws_ok($$ select tests.act('admin', 'select public.cancel_shift($1)', tests.id('A')) $$,
  'P0001', 'shift.already_started', 'started assigned shift cannot be cancelled');
select lives_ok($$ select tests.act('admin', 'select public.complete_shift($1)', tests.id('A')) $$,
  'admin completes it instead');
select is(tests.state('s1'), 'not_joined', 'and the person rejoins only at the end');

-- A shortened window (shift starts soon) is not a penalised timeout.
select tests.shift('B', interval '5 minutes', interval '4 hours');
select is(tests.offered_to('B'), 's2', 'B offered to s2 with a short window');
update public.offers set expires_at = clock_timestamp() - interval '1 second' where shift_id = tests.id('B') and outcome is null;
select tests.tick();
select is(tests.state('s2'), 'waiting', 'no auto-pause for a shortened window');
select is((select consecutive_timeouts from public.queue_entries where user_id = tests.id('s2') and closed_at is null), 0,
  'timeout counter untouched');
-- ...but a full-length window does count (auto-pause after 1 here).
select tests.shift('C', interval '3 days');
select is(tests.offered_to('C'), 's2', 'C offered to s2');
select tests.timeout('C');
select is(tests.state('s2'), 'paused', 'full-window timeout counts');

-- Late decline is a timeout, not a decline.
select tests.act('s2', 'select public.resume_queue($1)', tests.id('q'));
select tests.shift('D', interval '4 days');
select tests.remember('d_user', tests.id(tests.offered_to('D')));
update public.offers set expires_at = clock_timestamp() - interval '1 second' where shift_id = tests.id('D') and outcome is null;
select throws_ok($$ select tests.decline(tests.key(tests.id('d_user')), 'D') $$, 'P0001', 'offer.expired', 'late decline rejected');

-- Admins are notified every time a shift becomes unfilled.
select tests.second_queue('q2', '{"reoffer_after_withdraw": "continue"}');
select tests.join('s4', 'q2');
select tests.shift('E', interval '6 days', interval '8 hours', true, 'q2');
select tests.decline('s4', 'E');
select is(tests.notif_count('admin', 'shift_unfilled'), 1, 'first unfilled notification');
select tests.join('s3', 'q2');
select tests.accept('s3', 'E');
select tests.act('s3', 'select public.withdraw_assignment($1)', tests.id('E'));
select is(tests.notif_count('admin', 'shift_unfilled'), 2, 'second unfilled (same round) also notifies');

-- Removal audit records the position the person had.
create temp table s3pos as select tests.pos('s3') as p;
select tests.act('admin', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('q'), tests.id('s3')::text, 'Testing position');
select is((select (payload->>'position')::int from public.audit_events where type = 'entry.removed' and subject_id = tests.id('s3')
           order by id desc limit 1), (select p from s3pos), 'removal records the position the person had');

-- Roster privacy for staff when names are enabled.
update public.organizations set staff_can_see_names = true where id = tests.id('org');
select is(tests.val('s4', $$select count(*)::text from public.queue_roster($1) where not is_me and (state <> 'waiting' or paused_at is not null or offer_expires_at is not null)$$, tests.id('q'))::int,
  0, 'staff see no pause/offer details of colleagues');

-- Auto-rejoin preference changes are audited.
select tests.act('s4', 'select public.set_queue_auto_rejoin($1, true)', tests.id('q'));
select is(tests.audit_count('entry.auto_rejoin_set', 's4'), 1, 'auto-rejoin preference is audited');

select * from finish();
rollback;
