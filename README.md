# FairShift

**A fair, transparent, persistent queue for extra hospital shifts.** It replaces
"whoever replies first in the WhatsApp group gets the shift".

Each pool (e.g. *ICU Nurses*) has a first-in-first-out queue:

- When an admin publishes a shift, it is offered to the first available person,
  who has a set time (default 30 min) to accept.
- Declining or timing out keeps your place (configurable).
- Once you have worked a shift, you rejoin at the end.
- Nobody, including admins, can reorder the queue, and every change is written
  to an append-only audit log.

One TypeScript codebase runs on **iOS, Android and web** (Expo + Expo Router).
The backend is **Supabase**: Postgres, Auth, Realtime, Edge Functions, RLS and
pg_cron.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for how fairness and correctness are
guaranteed under concurrency.

---

## Repository layout

```
app/                    Expo app (iOS, Android, web)
  src/app/              routes (Expo Router): (auth), (app)/(tabs), offer, queue, admin/*
  src/components/       accessible UI kit, confirmation dialog, countdown
  src/lib/              Supabase client, typed RPC hooks, realtime, push, time/tz utils
  src/i18n/locales/     en.json, pt-BR.json
  .maestro/             native E2E flows (Maestro)
  eas.json              EAS Build / Submit profiles
supabase/
  migrations/           schema, RLS, queue engine, scheduler, reports (all queue logic)
  functions/            Edge Functions: send-notifications, delete-account
  tests/                pgTAP tests for queue rules 1–14 and tenancy
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
   ├─ Postgres: tables + RLS (read-only for clients)
   │    └─ SECURITY DEFINER RPCs ── queue lock ── dispatcher ── audit log
   │                                         └── notification outbox ── pg_net ─┐
   ├─ pg_cron (every 15 s): offer timeouts, 25 % reminders,                      │
   │    auto-completion, unfilled shifts                                          │
   ├─ Realtime: content-free "queue changed" broadcasts → clients refetch        │
   └─ Edge Functions                                                             │
        ├─ send-notifications  (Expo push → e-mail fallback via Resend) ◄────────┘
        └─ delete-account      (GDPR/LGPD erasure)
```

## Local setup

### Prerequisites

- Node 22+ and pnpm 10 (`corepack enable`)
- Docker (for the local Supabase stack)
- Supabase CLI ≥ 2.x (`npm i -g supabase` or `brew install supabase/tap/supabase`)
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
Mailpit (http://127.0.0.1:54324) catches all auth e-mails locally. Without a
Resend key, the notification function logs e-mails instead of sending them
(`docker logs supabase_edge_runtime_fairshift`).

### Demo data

**Hospital Demo São Lucas** (timezone America/Sao_Paulo). All passwords are `Password123!`.

| Account | Role |
|---|---|
| `admin@demo.fairshift.app` | Owner / admin (scheduler) |
| `nurse01` … `nurse12@demo.fairshift.app` | *ICU Nurses* queue, in that order (nurse05 is paused) |
| `doctor01` … `doctor08@demo.fairshift.app` | *ER Doctors* queue (doctor08 worked a shift last week and auto-rejoined at the end) |

There are three draft shifts (2 ICU, 1 ER) ready to publish.

**Acceptance walkthrough**

1. Sign in as `admin`, go to **Admin → Shifts → Drafts**, select *ICU 2* and
   publish it.
2. On another simulator or browser, sign in as `nurse01`, tap **View offer**, then
   **Accept shift**.
3. Every other nurse's "You are #N of M" moves up live, with no refresh.

### Environment variables

| Where | Variable | Purpose |
|---|---|---|
| `app/.env` | `EXPO_PUBLIC_SUPABASE_URL` | Supabase API URL |
| | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `supabase/.env` (local) or function secrets (cloud) | `FAIRSHIFT_CRON_SECRET` → `CRON_SECRET` | shared secret between pg_net and `send-notifications` |
| | `FAIRSHIFT_APP_URL` → `APP_URL` | used in e-mail links (`/offer/<id>`, `/invite/<token>`) |
| | `RESEND_API_KEY`, `EMAIL_FROM` | optional: real e-mail delivery (otherwise logged) |
| | `EXPO_ACCESS_TOKEN` | optional: if enhanced push security is enabled in Expo |
| Vault (DB) | `fairshift_functions_url`, `fairshift_cron_secret` | lets pg_net call the function (seeded locally) |

## Tests

```bash
supabase start                  # once
pnpm test:db                    # pgTAP: rules 1–14, defaults F2–F9, RLS/tenancy, invites, regressions
pnpm test:concurrency           # 50 parallel joins, accept-vs-timeout races, concurrent publishing, ...
pnpm test:api                   # through Auth/PostgREST/Realtime/Edge Functions + the real pg_cron scheduler
pnpm test:app                   # i18n completeness, WCAG AA contrast, utils
pnpm build:web && pnpm test:e2e # Playwright: invite → join → offer → accept → complete → rejoin at end;
                                # admin publishes and positions update live for other users
pnpm test                       # everything except E2E
```

- First Playwright run: `pnpm --filter @fairshift/e2e exec playwright install chromium`.
- Native E2E uses [Maestro](https://maestro.mobile.dev) on a development build:
  `maestro test app/.maestro/admin_publish_shift.yaml`, then
  `staff_accept_offer.yaml` (and `staff_live_position.yaml` on a second
  device).

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

## Product decisions (confirmed defaults)

- **F1 opening-window lottery** and **F2 auto-pause after N timeouts**: available
  per queue, **off by default**, so the default behaviour matches rules 1–14
  exactly.
- **F3** Unfilled shifts stay open until they start. Newcomers and people
  resuming are offered them automatically, and admins can re-offer to everyone.
- **F4** After a withdrawal, the offer round restarts from the front
  (per-queue setting: *continue*).
- **F5** People are skipped for shifts that overlap one they already hold or
  have an open offer for. They keep their place.
- **F6** Paused people count in "#N of M".
- **F7** Removal can optionally revoke pool eligibility.
- **F8** A completed shift can be corrected to a no-show for up to 7 days.
- **F9** Disabling pausing leaves people who are already paused as they are.
- **Times**: shifts are stored in UTC and shown in the organization's timezone.
  The offer countdown follows the server clock, and Accept has no grace period.
- **Editing**: after publishing, only a shift's notes can change. Cancel it (the
  assignee keeps their place) and create a new one.
- **Web push**: none. Web relies on live updates, the inbox and e-mail.
