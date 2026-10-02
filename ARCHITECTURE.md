# FairShift architecture: how the queue stays fair and correct

FairShift replaces "first to reply on WhatsApp wins" with a persistent FIFO
queue per pool. The guarantees below are enforced by the database, not by the
apps: the iOS, Android and web clients only call RPCs and render what Row
Level Security (RLS) lets them read.

## 1. One place for the rules

All queue logic lives in Postgres functions (`supabase/migrations/*.sql`):

| Concern | Function(s) |
|---|---|
| Join / leave / pause / resume | `join_queue`, `leave_queue`, `pause_queue`, `resume_queue` |
| Offer engine | `private.dispatch` (called at the end of every mutation) |
| Responses | `accept_offer`, `decline_offer`, `withdraw_assignment` |
| Admin actions | `create_shifts`, `publish_shifts`, `cancel_shift`, `complete_shift`, `mark_no_show`, `reoffer_shift`, `admin_remove_entry` |
| Time-based work | `private.process_queue` / `private.process_due` (pg_cron, every 15 s) |

Tables are read-only for clients (`revoke insert, update, delete`). Every write
goes through a `SECURITY DEFINER` function that checks the caller's role. There
is no function, and no table privilege, that can change a ticket's place in
the queue (rule 13).

## 2. Position = a ticket number issued by the server

`queue_entries.seq` comes from a single global sequence. It is drawn inside
`join_queue`, while the transaction holds the queue's row lock, together with
`joined_at = clock_timestamp()`. Within a queue, therefore:

```
seq order  ==  joined_at order  ==  commit order of the joins
```

No client timestamp exists anywhere in the API (rule 2). A person's position
is `1 + count(open waiting/paused tickets with a smaller seq)`. Tickets have no
expiry (rule 3). A unique partial index `(queue_id, user_id) where closed_at is
null` makes "at most once per queue" a database invariant (rule 4).

Accepting a shift does not delete the ticket. It is marked `held` and keeps its
`seq`:

- **Admin cancels** the assignment: the ticket goes back to `waiting` with the
  same `seq`, i.e. the original position (rule 8).
- **Shift completed / no-show / withdrawn**: the ticket is closed. Rejoining
  issues a new `seq`, i.e. the end of the queue (rules 7, 9, 12).

"Move to end" decline/timeout policies are implemented the same way: close the
ticket and issue a new one.

## 3. The dispatcher

`private.dispatch(queue)` runs at the end of every state change of that queue,
and in every scheduler sweep. For each open shift without an open offer, in
**shift-start order**, it offers the shift to the **lowest-seq** ticket that
meets all of these:

- `waiting` (not paused, not holding a shift), and the person's membership is active
- no open offer in this queue (one offer per person at a time, rule 6; also a
  unique index)
- not already asked for this shift in the current offer round
- no overlapping assignment or open offer anywhere (agreed default F5)

If nobody is free right now but someone *could* still take it (they are busy
with another offer), the shift waits in `published`. If nobody could take it,
it becomes `unfilled` and admins are notified (rule 5). It stays offerable to
newcomers or people who resume until it starts (F3).

**The fairness invariant.** When an offer is created for person P, every ticket
ahead of P is paused, holding a shift, busy with another offer, already asked
in this round, or blocked by an overlap. Nobody is ever skipped for any other
reason.

## 4. Concurrency: lock the queue, then (maybe) the person

1. **Every function that changes a queue starts with
   `SELECT … FROM queues WHERE id = $1 FOR UPDATE`.** All changes to one queue
   are therefore serialized. Queues change a few times per hour, so the
   contention cost is negligible, and races become impossible by construction:
   - **Accept vs. timeout.** Both take the queue lock. Whichever runs second sees
     `outcome IS NOT NULL` and does nothing (scheduler) or fails cleanly
     (`offer.not_open` / `offer.expired`). The server clock decides: an Accept
     that arrives after `expires_at` loses, even if the scheduler has not run
     yet.
   - **Two admins publishing at once.** They are serialized. Each dispatch sees
     the offers the other one created, so nobody is double-offered. The loser of
     a duplicate publish gets `shift.not_draft`.
   - **Two users acting at the same instant.** Their joins get distinct,
     correctly ordered tickets.
2. **Functions that touch several queues** (deactivating a member, deleting an
   account, publishing a batch across queues) lock the queues in ascending id
   order, so they cannot deadlock with each other.
3. **Cross-queue overlap checks** need a per-person lock (`pg_advisory_xact_lock`
   on the user id), taken **only after** queue locks:
   - `accept_offer` waits for it.
   - The dispatcher only uses `pg_try_advisory_xact_lock`. If it is busy, the
     dispatcher stops for that shift and leaves it for the next sweep (≤ 15 s).
     It never skips ahead to the next person, which would be unfair.

   Because nobody waits for a queue lock while holding a user lock, there is no
   lock cycle.
4. **The scheduler** (`private.process_due`, pg_cron every 15 s):
   - It commits after each queue.
   - It takes each queue lock with `SKIP LOCKED`, so it never blocks users; a
     busy queue is handled on the next sweep.
   - It is idempotent: expiry only updates offers whose `outcome IS NULL AND
     expires_at <= clock_timestamp()`, reminders are flagged by
     `reminder_sent_at`, and notifications are de-duplicated by key.
   - One failing queue cannot stop the others.

Tested in `tests/concurrency`:
- 50 simultaneous joins give a consistent order.
- 100 accept-vs-timeout races each give exactly one outcome.
- 10 shifts published concurrently by two admins never double-offer anyone,
  and offers follow start order.
- Overlapping shifts in two queues are never double-booked.
- Random concurrent actions keep every invariant.
- Invite usage limits hold under concurrency.

## 5. Side effects are transactional

- **Audit log** (rule 14): `audit_events` is written in the same transaction as
  the change. Triggers reject `UPDATE`/`DELETE`/`TRUNCATE` and the table has no
  write grants. Rows store ids and policy values only, never names or e-mails.
- **Notifications**: written to an inbox table plus a `notification_outbox` in
  the same transaction, so a rolled-back change never notifies anyone.
  `pg_net` kicks the `send-notifications` Edge Function after commit, and a
  cron job retries with backoff. The function sends Expo push first. For
  offers, it e-mails as a fallback when push could not be delivered.
- **Realtime**: `private.after_change` sends a content-free `queue_changed`
  broadcast on the private topic `queue:<id>`. Subscription is authorized by an
  RLS policy on `realtime.messages`. Clients react by refetching
  `my_queues()`, which returns only their own position and the queue size.
  Names never travel to staff devices unless the organization enables it.

## 6. Multi-tenancy and privacy

- Every table carries `org_id`. RLS helpers (`private.is_member`, `is_admin`,
  `is_queue_member`) are `SECURITY DEFINER` to avoid policy recursion.
- Staff can read only their own tickets, offers and assignments.
- Account deletion (`delete-account` Edge Function):
  1. Withdraws future shifts (they are re-offered fairly).
  2. Closes tickets.
  3. Erases the profile's name.
  4. Deletes the auth user (e-mail, password).

  The append-only audit log keeps the user id, which now resolves to an
  anonymous tombstone.

## 7. Known limits

- The dispatcher waits at most one sweep (15 s) when another transaction
  briefly holds the front person's user lock, or when a person is freed by an
  action in another queue.
- Web browsers get live updates, the inbox and e-mail, but no push
  (Expo Notifications does not support web push).
- Audit-log reasons are free text written by admins. Admins should not put
  personal data in them, because they cannot be anonymized later.
