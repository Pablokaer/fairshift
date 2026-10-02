-- Rules 5 and 6: offers, decline/timeout policies, unfilled, multiple shifts, overlaps.
begin;
\ir _helpers.psql
select plan(40);

select tests.fixture(6);
select tests.join_range(1, 4);

-- Rule 5: offered to the first person, with the configured window (default 30 min).
select tests.shift('A', interval '3 days');
select is(tests.offered_to('A'), 's1', 'rule 5: offered to #1');
select is((select status::text from public.shifts where id = tests.id('A')), 'offered', 'shift status offered');
select is((select expires_at - offered_at from public.offers where shift_id = tests.id('A')),
  interval '30 minutes', 'rule 5: default acceptance window is 30 minutes');
select is(tests.state('s1'), 'offered', 'staff state shows offered');
select is(tests.notif_count('s1', 'offer_received'), 1, 'offer notification created');
select ok(exists (select 1 from public.notification_outbox where user_id = tests.id('s1') and template = 'offer_received'
                  and channel = 'email' and is_fallback), 'e-mail fallback is queued for offers');

-- Someone else cannot accept it; nor can a second accept succeed.
select throws_ok($$ select tests.accept('s2', 'A') $$, 'P0001', 'offer.not_found', 'cannot accept someone else''s offer');

-- Decline (policy keep): offer moves on, decliner keeps position.
select tests.decline('s1', 'A');
select is(tests.offered_to('A'), 's2', 'rule 5: decline -> offered to next');
select is(tests.pos('s1'), 1, 'rule 5: decliner keeps #1 (policy keep)');

-- Timeout (policy keep): offer moves on, timed-out person keeps position.
select tests.timeout('A');
select is(tests.offered_to('A'), 's3', 'rule 5: timeout -> offered to next');
select is(tests.pos('s2'), 2, 'rule 5: timed-out person keeps #2');
select is((select outcome::text from public.offers where shift_id = tests.id('A') and user_id = tests.id('s2')),
  'expired', 'offer recorded as expired');

-- Accept -> assigned, user leaves queue.
select tests.accept('s3', 'A');
select is((select status::text from public.shifts where id = tests.id('A')), 'assigned', 'rule 5: accept -> assigned');
select is(tests.order_of(), 's1,s2,s4', 'rule 5: acceptor leaves the queue');
select throws_ok(
  format('select tests.act(%L, %L, %L::uuid)', 's3', 'select public.accept_offer($1)',
         (select id from public.offers where shift_id = tests.id('A') and user_id = tests.id('s3'))),
  'P0001', 'offer.not_open', 'second accept is rejected');

-- Next shift goes to the decliner first (they kept #1).
select tests.shift('B', interval '4 days');
select is(tests.offered_to('B'), 's1', 'decliner of A is first for B');

-- Queue exhausted -> unfilled + admins notified.
select tests.decline('s1', 'B');
select tests.decline('s2', 'B');
select tests.timeout('B');
select is(tests.offered_to('B'), null, 'nobody left to offer');
select is((select status::text from public.shifts where id = tests.id('B')), 'unfilled', 'rule 5: shift becomes unfilled');
select is(tests.notif_count('admin', 'shift_unfilled'), 1, 'rule 5: admin notified once');
select is(tests.audit_count('shift.unfilled'), 1, 'unfilled is audited');
select is((select count(*)::int from public.offers where shift_id = tests.id('B') and user_id = tests.id('s1')), 1,
  'a decliner is never asked twice for the same shift in a round');

-- F3: an unfilled shift stays open; a newcomer is offered it.
select tests.join('s5');
select is(tests.offered_to('B'), 's5', 'F3: newcomer gets the unfilled shift');
select tests.decline('s5', 'B');
select tests.tick();
select is(tests.notif_count('admin', 'shift_unfilled'), 1, 'F3: admin is not notified again in the same round');

-- Admin re-offer starts a fresh round from the front.
select tests.act('admin', 'select public.reoffer_shift($1)', tests.id('B'));
select is(tests.offered_to('B'), 's1', 'reoffer: new round starts at #1');

-- Late accept: the server clock decides even if the scheduler has not run.
update public.offers set expires_at = clock_timestamp() - interval '1 second' where shift_id = tests.id('B') and outcome is null;
select throws_ok($$ select tests.accept('s1', 'B') $$, 'P0001', 'offer.expired', 'late accept is rejected');
select tests.tick();
select is(tests.offered_to('B'), 's2', 'scheduler then moves the offer on');

-- Window is capped at shift start.
select tests.second_queue('q2', '{"acceptance_window_minutes": 10}');
select tests.join('s6', 'q2');
select tests.shift('C', interval '5 minutes', interval '4 hours', true, 'q2');
select ok((select expires_at from public.offers where shift_id = tests.id('C')) =
          (select starts_at from public.shifts where id = tests.id('C')), 'offer expiry capped at shift start');
select tests.shift('C2', interval '6 days', interval '4 hours', true, 'q2');
select tests.decline('s6', 'C');
select is((select expires_at - offered_at from public.offers where shift_id = tests.id('C2') and outcome is null),
  interval '10 minutes', 'per-queue acceptance window (10 min)');

-- Rule 6: several shifts at once are offered in start order, one offer per person.
select tests.fixture(0) where false; -- (no-op; keep same org)
select tests.second_queue('q3');
select tests.join('s1', 'q3'); select tests.join('s2', 'q3'); select tests.join('s4', 'q3'); select tests.join('s5', 'q3');
select tests.act('admin', $sql$
  select public.create_shifts($1, jsonb_build_array(
    jsonb_build_object('starts_at', now() + interval '12 days', 'ends_at', now() + interval '12 days 8 hours', 'unit', 'Z'),
    jsonb_build_object('starts_at', now() + interval '10 days', 'ends_at', now() + interval '10 days 8 hours', 'unit', 'X'),
    jsonb_build_object('starts_at', now() + interval '11 days', 'ends_at', now() + interval '11 days 8 hours', 'unit', 'Y')),
    true)
$sql$, tests.id('q3'));
select tests.remember('X', (select id from public.shifts where queue_id = tests.id('q3') and unit = 'X'));
select tests.remember('Y', (select id from public.shifts where queue_id = tests.id('q3') and unit = 'Y'));
select tests.remember('Z', (select id from public.shifts where queue_id = tests.id('q3') and unit = 'Z'));
select is(tests.offered_to('X') || ',' || tests.offered_to('Y') || ',' || tests.offered_to('Z'), 's1,s2,s4',
  'rule 6: earliest shift to #1, next to #2, next to #3');
select is((select max(c)::int from (select count(*) c from public.offers where queue_id = tests.id('q3') and outcome is null
           group by user_id) x), 1, 'rule 6: nobody holds two offers from the same queue');
select tests.decline('s1', 'X');
select is(tests.offered_to('X'), 's5', 'rule 6: declined earliest shift goes to next FREE person (#4)');
select tests.decline('s2', 'Y');
select is(tests.offered_to('Y'), 's1', 'rule 6: freed #1 is offered the next shift they have not declined');
select throws_ok(
  $$ insert into public.offers (shift_id, queue_id, org_id, user_id, entry_id, round, expires_at)
     select tests.id('Z'), tests.id('q3'), tests.id('org'), tests.id('s5'), e.id, 1, now() + interval '1 hour'
     from public.queue_entries e where e.queue_id = tests.id('q3') and e.user_id = tests.id('s5') and e.closed_at is null $$,
  '23505', null, 'rule 6: database refuses a second open offer for the same person/queue');

-- F5: overlapping shifts are skipped, the person keeps their place.
-- s1 holds offer Y (day 11) in q3. Give s1 an assignment overlapping a new q shift.
select tests.accept('s1', 'Y');
select tests.shift('D', interval '11 days 2 hours', interval '4 hours');      -- overlaps Y
select is(tests.offered_to('D'), 's4', 'F5: #1 (s1) is skipped for an overlapping shift (s2 is busy with B)');
select is(tests.pos('s1'), 1, 'F5: and keeps #1');
select tests.shift('E', interval '20 days');
select is(tests.offered_to('E'), 's1', 'F5: non-overlapping shift goes to s1');

-- Decline policy move_to_end.
select tests.second_queue('q4', '{"decline_policy": "move_to_end", "timeout_policy": "move_to_end"}');
select tests.join('s4', 'q4'); select tests.join('s5', 'q4'); select tests.join('s6', 'q4');
select tests.shift('F', interval '30 days', interval '6 hours', true, 'q4');
select tests.decline('s4', 'F');
select is(tests.order_of('q4'), 's5,s6,s4', 'decline policy move_to_end puts decliner at the end');
select tests.timeout('F');
select is(tests.order_of('q4'), 's6,s4,s5', 'timeout policy move_to_end puts timed-out person at the end');
select is(tests.offered_to('F'), 's6', 'and the offer continued to the next person');
select is(tests.audit_count('entry.moved_to_end'), 2, 'moves to end are audited');

select * from finish();
rollback;
