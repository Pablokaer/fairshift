-- Optional policies (auto-pause, lottery), notifications, GDPR/LGPD.
begin;
\ir _helpers.psql
select plan(28);

select tests.fixture(6, '{"auto_pause_after_timeouts": 2}');
select tests.join_range(1, 6);

-- "Moved into the top 3" alert: joiners inside the top 3 are not alerted.
select is(tests.notif_count('s1', 'moved_top3') + tests.notif_count('s3', 'moved_top3'), 0,
  'joining inside the top 3 is not "moving into" it');
select tests.act('s1', 'select public.leave_queue($1)', tests.id('q'));
select is(tests.notif_count('s4', 'moved_top3'), 1, 's4 moved into the top 3 and is notified');
select tests.join('s1');
select tests.act('s2', 'select public.leave_queue($1)', tests.id('q'));
select is(tests.notif_count('s4', 'moved_top3'), 1, 'top-3 alert is sent once per ticket');

-- F2 (optional, here enabled): auto-pause after 2 consecutive timeouts.
select tests.shift('A', interval '2 days');
select is(tests.offered_to('A'), 's3', 'A offered to s3');
select tests.timeout('A');
select is(tests.state('s3'), 'waiting', 'one timeout: still waiting');
select tests.shift('B', interval '3 days');
select is(tests.offered_to('B'), 's3', 'B offered to s3 (kept #1)');
select tests.timeout('B');
select is(tests.state('s3'), 'paused', 'F2: second consecutive timeout auto-pauses');
select is(tests.pos('s3'), 1, 'F2: auto-paused person keeps position');
select is(tests.notif_count('s3', 'auto_paused'), 1, 'auto-pause notification');
select tests.act('s3', 'select public.resume_queue($1)', tests.id('q'));
select is((select consecutive_timeouts from public.queue_entries where user_id = tests.id('s3') and closed_at is null), 0,
  'resuming resets the timeout counter');

-- Offer-expiring reminder at 25 % of the window remaining (once).
select tests.shift('C', interval '4 days');
select tests.remember('cuser', tests.id(tests.offered_to('C')));
update public.offers set offered_at = clock_timestamp() - interval '23 minutes',
                         expires_at = clock_timestamp() + interval '7 minutes'
where shift_id = tests.id('C') and outcome is null;
select tests.tick();
select tests.tick();
select is((select count(*)::int from public.notifications where user_id = tests.id('cuser') and type = 'offer_expiring'), 1,
  'reminder sent exactly once at <= 25 % remaining');
update public.offers set offered_at = clock_timestamp(), expires_at = clock_timestamp() + interval '30 minutes',
  reminder_sent_at = null where shift_id = tests.id('C') and outcome is null;
delete from public.notifications where type = 'offer_expiring';
select tests.tick();
select is((select count(*)::int from public.notifications where type = 'offer_expiring'), 0, 'no reminder early in the window');

-- Inbox: user can read & mark own notifications only.
select is(tests.val('s4', 'select count(*)::text from public.notifications where user_id <> auth.uid()')::int, 0,
  'inbox is private');
select tests.act('s4', 'select public.mark_notifications_read()');
select is((select count(*)::int from public.notifications where user_id = tests.id('s4') and read_at is null), 0, 'mark read');

-- Notification preferences: push off -> no push outbox row (inbox still written).
select tests.act('s5', $$insert into public.notification_prefs (user_id, type, push, email) values (auth.uid(), 'shift_assigned', false, false)$$);
select private.notify(tests.id('s5'), tests.id('org'), 'shift_assigned', '{}');
select ok(exists (select 1 from public.notifications where user_id = tests.id('s5') and type = 'shift_assigned')
  and not exists (select 1 from public.notification_outbox where user_id = tests.id('s5') and template = 'shift_assigned'),
  'push disabled by preference: inbox only, no push');

-- Lottery (optional opening window).
select tests.second_queue('lq');
update public.queues set lottery_ends_at = now() + interval '1 hour' where id = tests.id('lq');
select tests.join('s1', 'lq'); select tests.join('s2', 'lq'); select tests.join('s3', 'lq'); select tests.join('s4', 'lq');
select is(tests.val('s1', 'select lottery_pending::text from public.my_queues() where queue_id = $1', tests.id('lq')), 'true',
  'lottery pending is visible');
select tests.shift('L', interval '5 days', interval '8 hours', true, 'lq');
select is(tests.offered_to('L'), null, 'no offers before the opening draw');
create temp table seqs_before as select array_agg(seq order by seq) s from public.queue_entries where queue_id = tests.id('lq') and closed_at is null;
update public.queues set lottery_ends_at = now() - interval '1 second' where id = tests.id('lq');
select tests.tick('lq');
select ok((select lottery_drawn_at from public.queues where id = tests.id('lq')) is not null, 'lottery drawn by the scheduler');
select is((select array_agg(seq order by seq) from public.queue_entries where queue_id = tests.id('lq') and closed_at is null),
  (select s from seqs_before), 'lottery permutes the existing ticket numbers (same set)');
select is(tests.audit_count('queue.lottery_drawn'), 1, 'draw is audited');
select isnt(tests.offered_to('L'), null, 'offers start after the draw');
select throws_ok(
  $$ select tests.act('admin', 'select public.update_queue($1, null, null, $2::jsonb)', tests.id('q'),
       json_build_object('lottery_ends_at', now() + interval '1 day')::text) $$,
  'P0001', 'queue.lottery_after_joins', 'cannot turn on a lottery after people joined');

-- GDPR/LGPD: export and account deletion.
select ok((tests.val('s6', 'select public.export_my_data()::text')::jsonb ->> 'email') = 's6@test.local', 'data export works');
select tests.remember('s6_entry', (select id from public.queue_entries where user_id = tests.id('s6') and closed_at is null));
create temp table audit_before as select count(*) c from public.audit_events where subject_id = tests.id('s6');
select tests.act('s6', 'select public.delete_my_account()');
select is((select display_name from public.profiles where id = tests.id('s6')), '', 'profile anonymized');
select is((select count(*)::int from public.queue_entries where user_id = tests.id('s6') and closed_at is null), 0,
  'tickets closed');
select ok((select count(*) from public.audit_events where subject_id = tests.id('s6')) > (select c from audit_before),
  'audit rows kept (append-only) and deletion recorded');
select is(
  tests.val('admin', $$select string_agg(distinct subject_name, ',') from public.admin_audit($1) where subject_id = $2::uuid$$,
    tests.id('org'), tests.id('s6')::text), '',
  'audit log shows the deleted user anonymously');
select throws_ok($$ select tests.act('admin', 'select public.delete_my_account()') $$,
  'P0001', 'account.sole_owner', 'sole owner of an org with members must transfer ownership first');

select * from finish();
rollback;
