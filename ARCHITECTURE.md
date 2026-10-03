# FairShift architecture: how the queue stays fair and correct

FairShift replaces "first to reply on WhatsApp wins" with a persistent FIFO
queue per profession and hospital. The guarantees below are enforced by the
database, not by the apps: the iOS, Android and web clients only call RPCs and
render what Row Level Security (RLS) lets them read.

## 1. One place for the rules

All queue logic lives in Postgres functions (`supabase/migrations/*.sql`; the
current model is in the `20261003*` migrations):

| Concern | Function(s) |
|---|---|
| Sign-up with the hospital code | `public.hook_before_user_created` (Auth hook), `private.handle_new_user` (trigger), `join_hospital` |
| Hospital code | `admin_hospital_code`, `regenerate_join_code` |
| Professions and people | `set_member_profession`, `set_member_role`, `deactivate_member`, `reactivate_member`, `remove_member` |
| Join / leave / unavailable | `join_queue`, `leave_queue`, `pause_queue`, `resume_queue`, `set_queue_auto_rejoin` |
| Assignment engine | `private.fill_queue` (called by every change that can free a slot or a person) |
| Managers | `create_shifts`, `publish_shifts`, `update_shift`, `cancel_shift`, `complete_shift`, `mark_no_show`, `admin_remove_entry` |
| Professionals | `give_back_shift` |
| Time-based work | `private.process_queue` / `private.process_due` (pg_cron, every 15 s) |
| Operators | `private.provision_hospital`, `private.set_manager` |

Tables are read-only for clients (`revoke insert, update, delete`). Every write
goes through a `SECURITY DEFINER` function that checks the caller's role. There
is no function, and no table privilege, that can change a ticket's place in a
queue.

## 2. Hospitals, codes and professions

- Each hospital (`organizations`) has one permanent `join_code` (8 characters,
  no look-alike characters, compared case-insensitively). The column is not
  readable by clients; managers get it through `admin_hospital_code`.
  `regenerate_join_code` replaces it and writes `org.code_regenerated` to the
  audit log. The audit log never contains a code.
- Each hospital has exactly two permanent queues, created by a trigger when the
  hospital is created: `doctor` and `nurse` (`queues.profession`, unique per
  hospital). A trigger refuses to delete, archive or re-profession them.
- A member's `memberships.profession` decides which queue they may join
  (`private.is_eligible`). Managers may have no profession; if they have one
  they can be in that queue like anyone else.

**Sign-up requires a valid code, in two layers:**

1. The Auth hook **before user created** rejects a sign-up whose metadata has no
   valid `hospital_code` and `profession` *before* the account exists, with a
   stable error code (`hospital_code.required`, `hospital_code.invalid`,
   `profession.invalid`) that the app translates. Magic-link sign-in is
   configured with `shouldCreateUser: false`, so it cannot create accounts.
2. `handle_new_user`, the trigger on `auth.users`, links the new account to the
   hospital **in the same transaction** that creates it. It reads the
   organization with `FOR SHARE`. A concurrent `regenerate_join_code`
   (`FOR UPDATE`) is therefore serialized with it: if the code changed in
   between, the trigger raises and the account is not created. No account is
   ever left half-linked (tested by racing 20 sign-ups against a regeneration).

## 3. Position = a ticket number issued by the server

`queue_entries.seq` comes from a single global sequence. It is drawn inside
`join_queue`, while the transaction holds the queue's row lock, together with
`joined_at = clock_timestamp()`. Within a queue, therefore:

```
seq order  ==  joined_at order  ==  commit order of the joins
```

No client timestamp exists anywhere in the API. A person's position is
`1 + count(open waiting/unavailable tickets with a smaller seq)`. Tickets never
expire. A unique partial index `(queue_id, user_id) where closed_at is null`
makes "at most once per queue" a database invariant.

Being assigned a shift does not delete the ticket. It is marked `held` and
keeps its `seq`. A held ticket is not counted in positions or totals: for the
person and everyone else, they have left the line.

- **Manager cancels the shift**: every held ticket goes back to `waiting` with
  the same `seq`, i.e. the original position (decision c).
- **Shift completed / no-show / given back**: the ticket is closed. Rejoining
  issues a new `seq`, i.e. the end of the queue.

## 4. The assignment engine

`private.fill_queue(queue)` runs, under the queue lock, at the end of every
change that can free a slot or make a person available (publish, join, resume,
cancel, give back, completion, account deletion) and in every scheduler sweep.

For every **open** shift of the queue that has not started, in
**shift-start order** (`starts_at, created_at, id`), while it has free slots,
it takes the **lowest-seq** ticket that is:

- `waiting` (people who are unavailable keep their place but are skipped;
  people holding a shift are not waiting),
- an active member with the queue's profession,
- not someone who already had this shift (e.g. gave it back),
- without an overlapping active assignment anywhere (e.g. at another hospital).
  They are skipped **for this shift only** and keep their position.

Each chosen person gets an `assignments` row (with their position at that
moment), their ticket becomes `held`, and `shift.assigned` is audited (seq,
position, slot, waiting time, `assignee_is_manager`). They are notified (inbox,
push, e-mail fallback). When all slots are taken the shift becomes `filled`.
If the queue had fewer people than slots, the shift stays `open` and managers
are notified once. Later joins fill the remaining slots automatically
(decision a).

**The fairness invariant.** When person P is assigned, every ticket ahead of P
is unavailable, holding a shift, had this shift before, or has an overlap.
Nobody is ever skipped for any other reason. The concurrency tests check this
invariant after every wave of random actions.

## 5. Concurrency: lock the queue, then (maybe) the person

1. **Every function that changes a queue starts with
   `SELECT … FROM queues WHERE id = $1 FOR UPDATE`.** All changes to one queue
   are therefore serialized, and races become impossible by construction:
   - **Two managers publishing at the same moment.** They are serialized. The
     second engine run sees the assignments of the first, so nobody is assigned
     twice and nobody is skipped. The loser of a duplicate publish gets
     `shift.not_draft`.
   - **A person leaving while a shift is published.** Exactly one of two
     outcomes: the leave commits first (the shift goes to the next person), or
     the publish commits first (the person holds the shift and the leave fails
     with `queue.holding_shift`).
   - **Two people joining at the same instant.** They get distinct, correctly
     ordered tickets.
2. **Functions that touch several queues** (publishing across professions,
   changing a profession, deactivating or removing a member, deleting an
   account) lock the queues in ascending id order, so they cannot deadlock with
   each other.
3. **Cross-hospital overlap checks** need a per-person lock
   (`pg_advisory_xact_lock` on the user id), taken **only after** queue locks.
   The engine only *tries* it (`pg_try_advisory_xact_lock`). If it is busy, the
   engine **stops** and leaves the rest to the next sweep (≤ 15 s). It never
   skips ahead to the next person, which would be unfair, and never lets a
   later shift take people out of shift-start order.
4. **The scheduler** (`private.process_due`, pg_cron every 15 s):
   - marks shifts that start (no more filling; managers are told if slots stayed
     free) and completes shifts whose end time has passed. People are told they
     can rejoin, or are put back at the end if they enabled auto-rejoin;
   - commits after each queue;
   - takes each queue lock with `SKIP LOCKED`, so it never blocks users;
   - is idempotent: `start_processed_at` flags started shifts, completion only
     touches `open`/`filled` shifts, and notifications are de-duplicated by key;
   - one failing queue cannot stop the others.

Tested in `tests/concurrency`:
- 50 simultaneous joins give a consistent order.
- The same person joining 10 times at once gets one ticket.
- Two managers publishing 8 multi-slot shifts at the same instant (10 rounds):
  nobody assigned twice, nobody skipped, the rest of the queue keeps its order,
  nurses unaffected.
- A batch publish clicked by two managers at once fills slots strictly in queue
  order and shift-start order.
- Leave vs publish (60 rounds): exactly one consistent outcome.
- The same person at two hospitals is never double-booked.
- Sign-ups racing a code regeneration: linked with a valid code, or not created.
- Random concurrent actions keep every invariant.

## 6. Side effects are transactional

- **Audit log**: `audit_events` is written in the same transaction as the
  change. Triggers reject `UPDATE`/`DELETE`/`TRUNCATE` and the table has no
  write grants. Rows store ids and values, never names, e-mails or codes. There
  is an event for every state change: joins, leaves, unavailability, removals,
  restorations, shift creation/publication/assignment/fill/cancellation/
  completion, no-shows, give-backs, profession and role changes, code
  regeneration, deactivation, removal and account deletion.
- **Notifications**: written to an inbox table plus a `notification_outbox` in
  the same transaction, so a rolled-back change never notifies anyone.
  `pg_net` kicks the `send-notifications` Edge Function after commit, and a
  cron job retries with backoff. The function sends Expo push first. Shift
  assignments also go by e-mail when push could not be delivered.
- **Realtime**: `private.after_change` sends a content-free `queue_changed`
  broadcast on the private topic `queue:<id>` (and `org:<id>:admin` for
  managers). Subscription is authorized by an RLS policy on
  `realtime.messages`: only members of that profession and managers. Clients
  react by refetching `my_queue()`, which returns only their own position and
  the queue size. Names never travel to professionals' devices.

## 7. Multi-tenancy and privacy

- Every table carries `org_id`. RLS helpers (`private.is_member`, `is_admin`,
  `is_eligible`) are `SECURITY DEFINER` to avoid policy recursion.
- Professionals can read only their own tickets, assignments and shifts, and
  only their own profile. Only managers see names (`queue_roster`,
  `admin_professionals`).
- Account deletion (`delete-account` Edge Function):
  1. Gives back upcoming shifts (the next person in line gets them).
  2. Closes tickets.
  3. Erases the profile's name.
  4. Deletes the auth user (e-mail, password).

  The append-only audit log keeps the user id, which now resolves to an
  anonymous tombstone.

## 8. Known limits

- The engine waits at most one sweep (15 s) when another transaction briefly
  holds the front person's user lock (only possible for people in two hospitals).
- Web browsers get live updates, the inbox and e-mail, but no push
  (Expo Notifications does not support web push).
- Audit-log reasons are free text written by managers. Managers should not put
  personal data in them, because they cannot be anonymized later.
- The sign-up hook must be enabled in the Supabase dashboard for hosted
  projects (`supabase/config.toml` enables it locally). Without it the trigger
  still refuses invalid codes (with a generic error message), but a sign-up with
  no code creates an unlinked account that can only use the app after linking
  itself with a valid code (`join_hospital`).
