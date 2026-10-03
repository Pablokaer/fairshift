# FairShift

**A fair, transparent, persistent queue for extra hospital shifts.** It replaces
"whoever replies first in the WhatsApp group gets the shift".

Each hospital has exactly **two permanent queues: doctors and nurses.** Your
profession decides which one you can join.

- People join their queue when they want to. Their position depends only on the
  server time they joined.
- When a manager publishes a shift with **N slots**, it is assigned **at once**
  to the first N available people of that profession's queue, in queue order.
  There is no offer, no acceptance window and nothing to accept or decline.
- The people assigned leave the line (everyone behind moves up, live). After
  their shift they can rejoin, **always at the end**.
- Nobody, including managers, can reorder a queue. Every change is written to
  an append-only audit log.
- Anyone can create an account, but only with their hospital's **hospital code**.

One TypeScript codebase runs on **iOS, Android and web** (Expo + Expo Router).
The backend is **Supabase**: Postgres, Auth (with a sign-up hook), Realtime,
Edge Functions, RLS and pg_cron.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for how fairness and correctness are
guaranteed under concurrency.

---

## Repository layout

```
app/                    Expo app (iOS, Android, web)
  src/app/              routes (Expo Router): (auth), (app)/(tabs), admin/*
  src/components/       accessible UI kit (Inter, light theme), dialogs, hospital code card
  src/lib/              Supabase client, typed RPC hooks, realtime, push, time/tz utils, theme
  src/i18n/locales/     en.json, pt-BR.json
  .maestro/             native E2E flows (Maestro)
  eas.json              EAS Build / Submit profiles
supabase/
  migrations/           schema, RLS, queue engine, scheduler, reports (all queue logic)
                        20261003* = v2: hospital code, professions, multi-slot assignment
  functions/            Edge Functions: send-notifications, delete-account
  tests/                pgTAP tests (sign-up, queues, assignment, lifecycle, tenancy)
  seed.sql              demo hospital (runs on `supabase db reset`)
  templates/            magic-link e-mail (EN + PT, link + 6-digit code)
tests/                  Vitest: concurrency tests (raw Postgres) + API tests (supabase-js)
e2e/                    Playwright web E2E tests
.github/workflows/ci.yml
```

## Architecture overview

```
 Expo app (iOS / Android / web)
   │  supabase-js: Auth, RPC calls, private Realtime channels
   ▼
 Supabase
   ├─ Auth ── before-user-created hook: no valid hospital code → no account
   ├─ Postgres: tables + RLS (read-only for clients)
   │    └─ SECURITY DEFINER RPCs ── queue lock ── assignment engine ── audit log
   │                                         └── notification outbox ── pg_net ─┐
   ├─ pg_cron (every 15 s): shift start/end, auto-completion, short-staffed alerts│
   ├─ Realtime: content-free "queue changed" broadcasts → clients refetch        │
   └─ Edge Functions                                                             │
        ├─ send-notifications  (Expo push → e-mail fallback via Resend) ◄────────┘
        └─ delete-account      (GDPR/LGPD erasure)
```

## Local setup

### Prerequisites

- Node 22+ and pnpm 10 (`corepack enable`)
- Docker (for the local Supabase stack)
- Supabase CLI ≥ 2.x (`npm i -g supabase`, `brew install supabase/tap/supabase`,
  or prefix the commands below with `npx`)
- For native apps:
  - iOS: Xcode with an iOS simulator.
  - Android: Android Studio with an emulator.
  - Or use Expo Go.

### Run it

```bash
pnpm install
cp supabase/.env.example supabase/.env      # local secrets for Edge Functions
cp app/.env.example app/.env                # Supabase URL + anon key for the app
supabase start                              # migrations + seed run automatically
pnpm web                                    # web on http://localhost:8081
pnpm ios                                    # iOS simulator (press i in the Expo CLI)
pnpm android                                # Android emulator (127.0.0.1 is rewritten to 10.0.2.2)
```

`supabase db reset` re-creates the database and the demo data at any time.
After changing `supabase/config.toml` (e.g. the auth hook), restart the stack
with `supabase stop && supabase start`. Mailpit (http://127.0.0.1:54324)
catches all auth e-mails locally. Without a Resend key, the notification
function logs e-mails instead of sending them
(`docker logs supabase_edge_runtime_fairshift`).

### Demo data

**Hospital Demo São Lucas** (timezone America/Sao_Paulo).
**Hospital code: `SAOLUCAS`**. All passwords are `Password123!`.

| Account | Role |
|---|---|
| `manager@demo.fairshift.app` | Manager (owner), no clinical profession |
| `doctor01` … `doctor10@demo.fairshift.app` | Doctors. 01–08 are in the doctors' queue: doctor01 worked a shift last week and auto-rejoined at the end, so the order is 02…08, 01. 09 and 10 have not joined. |
| `nurse01` … `nurse10@demo.fairshift.app` | Nurses. 01–08 are in the nurses' queue in that order (nurse05 is unavailable). 09 and 10 have not joined. |

There are six draft shifts, three per profession, with 1, 2 and 3 slots.

**Developer account switcher.** In development (`pnpm web` / `expo start`) with
`EXPO_PUBLIC_DEV_ACCOUNT_SWITCHER=1` in `app/.env` (the default in
`.env.example`), the home screen shows a dropdown listing every demo account.
Picking one signs in as that person immediately. It is never rendered in
production builds (`__DEV__` is false).

**Acceptance walkthrough**

1. Sign in as `doctor04`: the home screen shows **#3 of 8**.
2. In another browser, sign in as `manager`, open **Manage → New shift**, choose
   *Doctors*, 2 slots, *Publish now*. The shift screen shows doctor02 (#1) and
   doctor03 (#2) assigned.
3. Without refreshing, doctor04 now shows **#1 of 6**. The nurses' queue is unchanged.
4. Create an account at `/sign-up?code=SAOLUCAS` as a nurse and tap **Join the queue**.

### Creating a hospital (operators)

Hospitals are provisioned by the operator, not in the app:

```sql
select * from private.provision_hospital('Hospital X', 'America/Sao_Paulo');  -- returns the hospital code
-- The first manager signs up in the app with that code, then:
select private.set_manager('<hospital id>', 'manager@example.org');           -- owner by default
```

Managers can then promote other managers from **Manage → Professionals**.

### Environment variables

| Where | Variable | Purpose |
|---|---|---|
| `app/.env` | `EXPO_PUBLIC_SUPABASE_URL` | Supabase API URL |
| | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| | `EXPO_PUBLIC_DEV_ACCOUNT_SWITCHER` | `1` shows the demo account switcher in development |
| `supabase/.env` (local) or function secrets (cloud) | `FAIRSHIFT_CRON_SECRET` → `CRON_SECRET` | shared secret between pg_net and `send-notifications` |
| | `FAIRSHIFT_APP_URL` → `APP_URL` | used in e-mail links (`/shifts`, `/admin/shifts/<id>`) |
| | `RESEND_API_KEY`, `EMAIL_FROM` | optional: real e-mail delivery (otherwise logged) |
| | `EXPO_ACCESS_TOKEN` | optional: if enhanced push security is enabled in Expo |
| Vault (DB) | `fairshift_functions_url`, `fairshift_cron_secret` | lets pg_net call the function (seeded locally) |

## Tests

```bash
supabase start                  # once
pnpm test:db                    # pgTAP: hospital code + sign-up, professions, join order, multi-slot
                                # assignment, overlap skip, cancel/give back/no-show, audit, tenancy
pnpm test:concurrency           # 50 parallel joins, two managers publishing multi-slot shifts at once,
                                # leave-vs-publish races, cross-hospital overlaps, code regeneration races
pnpm test:api                   # through Auth (+ sign-up hook)/PostgREST/Realtime/Edge Functions + pg_cron
pnpm test:app                   # i18n completeness (en, pt-BR), WCAG AA contrast, utils
pnpm build:web && pnpm test:e2e # Playwright: sign up with the code → join → "#N of M" → 2-slot shift →
                                # first 2 assigned, others drop by 2 live, nurses unaffected → rejoin at end
pnpm test                       # everything except E2E
```

- First Playwright run: `pnpm --filter @fairshift/e2e exec playwright install chromium`.
- The E2E serves `app/dist` on port 8081. If that port is busy, serve it
  yourself and set `E2E_BASE_URL` (e.g. `npx serve -s app/dist -l 8083` and
  `E2E_BASE_URL=http://localhost:8083 pnpm test:e2e`).
- Native E2E uses [Maestro](https://maestro.mobile.dev) on a development build:
  `maestro test app/.maestro/admin_publish_shift.yaml`, then
  `staff_sees_assignment.yaml` (and `staff_live_position.yaml` on a second
  device at the same time).

## Deploy

### 1. Supabase (cloud)

```bash
supabase link --project-ref <ref>
supabase db push                                  # schema, RLS, pg_cron jobs
supabase functions deploy send-notifications --no-verify-jwt
supabase functions deploy delete-account
supabase secrets set CRON_SECRET=<long-random> APP_URL=https://app.example.org \
  RESEND_API_KEY=<key> EMAIL_FROM="FairShift <no-reply@example.org>"
```

Then in the SQL editor (do not use the seed in production):

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'fairshift_functions_url');
select vault.create_secret('<same long-random CRON_SECRET>', 'fairshift_cron_secret');
```

In the dashboard:
- **Authentication → Hooks**: enable **Before User Created** with the Postgres
  function `public.hook_before_user_created`. Without it, an invalid code is still
  refused by the database trigger (with a generic error), but a sign-up with no
  code at all creates an account that is not linked to any hospital and can only
  link itself later with a valid code.
- **Authentication → URL configuration**: set the Site URL to your web app and
  add the redirect URLs `https://app.example.org/**` and `fairshift://**`.
- **Authentication → Emails**: configure custom SMTP and paste
  `supabase/templates/magic_link.html` into the Magic Link template (it includes
  the 6-digit code).
- Enable the `pg_cron` and `pg_net` extensions if they aren't already enabled
  (the migrations create them).

### 2. Web hosting

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon> pnpm build:web
```

Deploy `app/dist` to any static host (Vercel, Netlify, Cloudflare Pages, S3 +
CloudFront) with an SPA fallback that rewrites every path to `/index.html`.

### 3. iOS & Android (EAS)

```bash
cd app
npx eas-cli@latest init                       # creates the project and fills extra.eas.projectId
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon>
npx eas-cli@latest credentials                # APNs key (iOS) + FCM v1 service account (Android) for push
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform all
```

- Use `--profile development-simulator` for a simulator dev build with working
  push.
- Push notifications need a development or production build. Expo Go on
  Android has no remote push; the app falls back to the inbox and e-mail.
- Bundle ids are `app.fairshift.mobile` (change in `app/app.json`).

## Product decisions (confirmed)

- **a. Fewer people than slots**: everyone available is assigned; the shift stays
  open and the remaining slots are filled automatically as people join, until it
  starts. Managers are told when it is published short and again if it starts short.
- **b. Giving a shift back**: allowed before it starts. The slot goes at once to
  the person now first in line; the person who gave it back can rejoin only at
  the end. Managers are notified. They are never re-assigned the same shift.
- **c. Cancelling a shift**: the people assigned go back to their ORIGINAL
  positions (their ticket keeps its number while they hold a shift). A started
  shift can't be cancelled: mark it completed or record a no-show.
- **d. Unavailable (pause)**: keeps your position, counts in "#N of M", but you
  are skipped for shifts.
- **e. Profession**: chosen at sign-up, editable by managers. Changing it removes
  the person from their current queue (audited); not possible while they hold an
  upcoming shift.
- **f. Managers in a queue**: allowed when they have a profession. Their
  assignments are flagged (`assignee_is_manager`) in the audit log.
- **g. No-show**: recorded per person by a manager after the start; same
  consequence as a completed shift (rejoin at the end). A completed shift can be
  corrected to a no-show for up to 7 days.
- **h. Hospitals** are provisioned by the operator (see above), never in the app.
- **i. Existing data** (migrating a v1 database): old pools/queues are archived and
  their tickets closed (audited); unfinished old shifts are cancelled or
  completed; staff keep their membership without a profession until a manager sets it.
- **Overlaps**: a person is skipped (for that shift only, keeping their place)
  when they already hold an overlapping shift, e.g. at another hospital.
- **Times**: shifts are stored in UTC and shown in the hospital's timezone.
- **Editing**: after publishing, only a shift's notes can change. Cancel it and
  create a new one.
- **Privacy**: colleagues never see each other's names; only managers do.
- **Web push**: none. Web relies on live updates, the inbox and e-mail.
