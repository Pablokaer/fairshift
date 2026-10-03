-- Joining, order, persistence, leaving, pausing, removal, profession change, audit.
begin;
\ir _helpers.psql
select plan(36);

select tests.fixture(5, 2);
select tests.new_user('outsider');

-- Nobody is in a queue automatically.
select is(tests.state('d1'), 'not_joined', 'professionals start outside the queue');
select is(tests.total('d1'), 0, 'the doctors'' queue starts empty');

-- Order follows the server time of joining, not ids or names.
select tests.join('d3');
select tests.join('d1');
select tests.join('d2');
select is(tests.order_of(), 'd3,d1,d2', 'order follows server join order');
select is(tests.pos('d3'), 1, 'first joiner is #1');
select is(tests.pos('d2'), 3, 'third joiner is #3');
select is(tests.total('d2'), 3, '"of M" counts the doctors in the queue');
select ok((select bool_and(prev_joined <= joined_at and prev_seq < seq) from (
  select joined_at, seq, lag(joined_at) over (order by seq) prev_joined, lag(seq) over (order by seq) prev_seq
  from public.queue_entries where queue_id = tests.id('qd')) x where prev_seq is not null),
  'seq order equals joined_at order');
select throws_ok($$ select tests.join('d1') $$, 'P0001', 'queue.already_joined', 'at most one ticket per person');
select throws_ok($$ select tests.join('outsider') $$, 'P0001', 'auth.forbidden', 'non-members cannot join');
select throws_ok($$ select tests.join('n1', 'qd') $$, 'P0001', 'queue.not_eligible', 'nurses cannot join the doctors'' queue');
select tests.join('n1', 'qn');
select is(tests.total('n1'), 1, 'the nurses'' queue is separate');
select is(tests.total('d1'), 3, 'the doctors'' queue is unaffected by nurses');

-- Entries never expire.
update public.queue_entries set joined_at = joined_at - interval '400 days' where queue_id = tests.id('qd');
select tests.tick();
select is(tests.order_of(), 'd3,d1,d2', 'very old tickets are untouched by the scheduler');

-- Leaving loses the position; rejoining is at the end.
select tests.act('d1', 'select public.leave_queue($1)', tests.id('qd'));
select is(tests.order_of(), 'd3,d2', 'leaving removes the ticket');
select is(tests.state('d1'), 'not_joined', 'state is not_joined after leaving');
select is(tests.pos('d2'), 2, 'people behind move up');
select tests.join('d1');
select is(tests.order_of(), 'd3,d2,d1', 'rejoining puts you at the end');
select throws_ok($$ select tests.act('d4', 'select public.leave_queue($1)', tests.id('qd')) $$,
  'P0001', 'queue.not_joined', 'cannot leave a queue you are not in');

-- Pause keeps the place and counts in "#N of M".
select tests.act('d3', 'select public.pause_queue($1)', tests.id('qd'));
select is(tests.state('d3'), 'paused', 'paused');
select is(tests.pos('d3'), 1, 'a paused person keeps #1');
select is(tests.total('d2'), 3, 'paused people count in the total');
select tests.act('d3', 'select public.resume_queue($1)', tests.id('qd'));
select is(tests.order_of(), 'd3,d2,d1', 'resuming keeps the original place');

-- Managers remove with a written reason; nobody can reorder.
select throws_ok($$ select tests.act('admin', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('qd'), tests.id('d2')::text, '') $$,
  'P0001', 'removal.reason_required', 'removal needs a reason');
select throws_ok($$ select tests.act('d3', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('qd'), tests.id('d2')::text, 'Nope') $$,
  'P0001', 'auth.forbidden', 'staff cannot remove others');
select tests.act('admin', 'select public.admin_remove_entry($1, $2::uuid, $3)', tests.id('qd'), tests.id('d2')::text, 'Left the hospital');
select is(tests.order_of(), 'd3,d1', 'removed; everyone else keeps their order');
select is((select reason from public.audit_events where type = 'entry.removed' and subject_id = tests.id('d2')),
  'Left the hospital', 'the removal reason is audited');
select is(tests.notif_count('d2', 'removed_from_queue'), 1, 'the person is told');
select tests.join('d2');
select is(tests.order_of(), 'd3,d1,d2', 'a removed person may rejoin, at the end');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname ~ '^(reorder|move_|swap|set_position)'), 0,
  'there is no function that reorders a queue');

-- Changing the profession removes the person from their queue (audited).
select tests.join('d4');
select tests.act('admin', 'select public.set_member_profession($1, $2::uuid, ''nurse'', $3)', tests.id('org'), tests.id('d4')::text, 'Registered as nurse');
select is(tests.order_of(), 'd3,d1,d2', 'profession change removes the person from the old queue');
select is((select close_reason::text from public.queue_entries where user_id = tests.id('d4') order by seq desc limit 1),
  'profession_changed', 'the ticket is closed as profession_changed');
select is((select payload ->> 'to' from public.audit_events where type = 'member.profession_changed' and subject_id = tests.id('d4')),
  'nurse', 'the profession change is audited');
select lives_ok($$ select tests.join('d4', 'qn') $$, 'they join the other profession''s queue');

-- Audit log: every change, append-only.
select is(tests.audit_count('entry.joined'), 8, 'joins are logged');
select ok(tests.audit_count('entry.left', 'd1') = 1 and tests.audit_count('entry.paused', 'd3') = 1
  and tests.audit_count('entry.resumed', 'd3') = 1, 'leave/pause/resume are logged');
select throws_ok($$ update public.audit_events set reason = 'x' $$, '42501', null, 'audit rows cannot be updated');

select * from finish();
rollback;
