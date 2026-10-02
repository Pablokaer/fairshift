-- Rules 10 (leave), 11 (pause), 13 (removal), 14 (audit log).
begin;
\ir _helpers.psql
select plan(30);

select tests.fixture(5);
select tests.join_range(1, 5);
select is(tests.order_of(), 's1,s2,s3,s4,s5', 'setup');

-- Rule 10: leaving loses the position; rejoining is at the end.
select tests.act('s2', 'select public.leave_queue($1)', tests.id('q'));
select is(tests.order_of(), 's1,s3,s4,s5', 'rule 10: leaving removes the ticket');
select is(tests.state('s2'), 'not_joined', 'rule 10: state is not_joined after leaving');
select tests.join('s2');
select is(tests.order_of(), 's1,s3,s4,s5,s2', 'rule 10: rejoining puts you at the end');
select is(tests.pos('s2'), 5, 'rule 10: rejoined as #5');

-- Rule 11: pause keeps the position, paused people are skipped for offers.
select tests.act('s1', 'select public.pause_queue($1)', tests.id('q'));
select is(tests.state('s1'), 'paused', 'rule 11: paused');
select is(tests.pos('s1'), 1, 'rule 11: paused person keeps #1 (counted in positions)');
select tests.shift('A', interval '1 day');
select is(tests.offered_to('A'), 's3', 'rule 11: paused #1 is skipped, #2 gets the offer');
select tests.act('s1', 'select public.resume_queue($1)', tests.id('q'));
select is(tests.order_of(), 's1,s3,s4,s5,s2', 'rule 11: resuming keeps the original place');
select tests.shift('B', interval '2 days');
select is(tests.offered_to('B'), 's1', 'rule 11: after resuming, #1 gets the next shift');

-- Pausing while holding an offer counts as declining it.
select tests.act('s1', 'select public.pause_queue($1)', tests.id('q'));
select is(tests.offered_to('B'), 's4', 'pausing with an open offer declines it; offer moves on');
select is((select outcome::text from public.offers where shift_id = tests.id('B') and user_id = tests.id('s1')),
  'declined', 'the offer is recorded as declined');
select is(tests.pos('s1'), 1, 'decline policy "keep": still #1 while paused');

-- Rule 11: admins can turn pausing off; people already paused stay paused (F9).
select tests.act('admin', 'select public.update_queue($1, null, null, $2::jsonb)', tests.id('q'), '{"pausing_allowed": false}');
select is(tests.state('s1'), 'paused', 'F9: existing pauses survive when pausing is disabled');
select throws_ok($$ select tests.act('s5', 'select public.pause_queue($1)', tests.id('q')) $$,
  'P0001', 'queue.pausing_disabled', 'rule 11: pausing can be disabled per queue');
select lives_ok($$ select tests.act('s1', 'select public.resume_queue($1)', tests.id('q')) $$,
  'resuming is always possible');

-- Rule 13: removal requires a written reason.
select throws_ok(
  $$ select tests.act('admin', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('q'), tests.id('s5')::text, '  ') $$,
  'P0001', 'removal.reason_required', 'rule 13: removal without a reason is rejected');
select throws_ok(
  $$ select tests.act('s1', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('q'), tests.id('s5')::text, 'because') $$,
  'P0001', 'auth.forbidden', 'rule 13: staff cannot remove people');
select tests.act('admin', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('q'), tests.id('s5')::text, 'Left the hospital');
select is(tests.order_of(), 's1,s3,s4,s2', 'rule 13: s5 removed, everyone else keeps their order');

select is((select reason from public.audit_events where type = 'entry.removed' and subject_id = tests.id('s5')),
  'Left the hospital', 'rule 13: reason is in the audit log');
-- F7: removal without revoking eligibility lets them rejoin at the end.
select lives_ok($$ select tests.join('s5') $$, 'F7: removed person may rejoin (at the end) by default');
select tests.act('admin', 'select public.admin_remove_entry($1, $2::uuid, $3, true)', tests.id('q'), tests.id('s5')::text, 'Repeated misconduct');
select throws_ok($$ select tests.join('s5') $$, 'P0001', 'queue.not_eligible',
  'F7: removal with "revoke eligibility" blocks rejoining');

-- Removing someone with an open offer revokes it and moves the offer on.
select is(tests.offered_to('B'), 's4', 's4 still has the offer for B');
select tests.act('admin', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('q'), tests.id('s4')::text, 'Test removal');
select isnt(tests.offered_to('B'), 's4', 'removal revokes the open offer');
select is((select outcome::text from public.offers where shift_id = tests.id('B') and user_id = tests.id('s4')),
  'revoked', 'offer marked revoked');

-- Rule 14: every state change is in the append-only audit log with actor + time.
select ok(tests.audit_count('entry.joined') >= 7, 'rule 14: joins are logged');
select ok(tests.audit_count('entry.left', 's2') = 1 and tests.audit_count('entry.paused', 's1') = 2
          and tests.audit_count('entry.resumed', 's1') = 2 and tests.audit_count('offer.created') >= 3
          and tests.audit_count('offer.declined', 's1') = 1 and tests.audit_count('offer.revoked', 's4') = 1,
  'rule 14: leave/pause/resume/offer/decline/revoke are logged');
select is((select actor_id from public.audit_events where type = 'entry.left'), tests.id('s2'),
  'rule 14: the actor is recorded');
select throws_ok($$ update public.audit_events set reason = 'x' $$, '42501', null, 'rule 14: audit rows cannot be updated');
select throws_ok($$ delete from public.audit_events $$, '42501', null, 'rule 14: audit rows cannot be deleted');

select * from finish();
rollback;
