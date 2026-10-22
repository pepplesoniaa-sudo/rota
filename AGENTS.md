# AGENTS.md: Rota

You are the coding agent building Rota inside Antigravity. This file tells you how to behave while you build. The PRD tells you what to build. Read this whole file before every task, and read the PRD sections a task touches before you write code for it.

Rule ids (`L-`, `B-`, `A-`, `S-`) exist so you can cite them in your end-of-task report. PRD references look like `FR-23` or `PRD 7.5`.

---

## 1. What is this project?

**What it does.** Rota is a mobile shift scheduling app for clinics and other shift-based teams such as restaurants. Owners pay for the team. Managers build the schedule as a draft, publish it, invite staff and approve swaps. Staff see their shifts across all their teams, set weekly availability, request swaps, read their schedule offline and get push notifications that respect their quiet hours.

**Who it is for.** Small clinics (10 to 60 staff) and independent restaurants (8 to 40 staff). It is also Rox's portfolio project. The backend must prove connection pooling, read replicas with read-your-own-writes, sharding by team, background jobs, an append-only billing ledger and k6 load tests. Those proofs are part of the product, not extras.

**Which version you are building.** Version 1 (the MVP and portfolio demo) as defined in the PRD v1.1 dated 2026-10-21. It is built in the phases in PRD section 13, in order:

| Phase                      | Scope                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0 Foundations              | Repo, Compose stack, data layer, `withApi`, tenant scopes, outbox, migrations, CI, Flutterwave spike |
| 1 Auth and teams           | FR-01 to FR-13, FR-44                                                                                |
| 2 Scheduling               | FR-15, FR-15a, FR-15b, FR-15c, FR-16 to FR-24, FR-26, FR-31                                          |
| 3 Mobile state and offline | FR-32, FR-33, FR-08 (UI)                                                                             |
| 4 Notifications and jobs   | FR-25, FR-27, FR-28, FR-29, FR-30                                                                    |
| 5 Billing                  | FR-34 to FR-42                                                                                       |
| 6 Scale proof              | PRD 7.4, 7.5, 11                                                                                     |
| 7 Polish and demo          | FR-14, FR-28a, FR-45, FR-46, PRD 7.11                                                                |

It ships as EAS development builds only, with Flutterwave in test mode only. There is no store release and no live money.

**Source of truth.** `docs/Rota-PRD-v1.1.md` is the only source of truth for what to build. Follow this order when sources disagree:

1. A written instruction from Rox in the current session.
2. `docs/decisions.md` (decisions Rox made after PRD v1.1).
3. The PRD v1.1.
4. This file.
5. Existing code.

If two of these conflict and the higher one does not clearly settle it, stop and ask (section 7). Never edit the PRD.

**Rules files.** `.agents/rules/` holds six files that add detail to this file for one area each: `coding-standards.md` (`CS-`), `database-schema.md` (`DB-`), `git-conventions.md` (`GIT-`), `security.md` (`SEC-`), `money-and-billing.md` (`MB-`) and `uploads-and-storage.md` (`UP-`). Read the ones a task touches before you start. They rank with this file, never relax it, and every numbered rule in them is a failure rule like section 3.

**Open decision you must respect.** Rox has not decided on an Apple Developer Program membership. Until `docs/decisions.md` says otherwise, push is shown on Android only, and iOS runs in the Simulator. Do not set up APNs credentials, iOS push entitlements or physical-iPhone builds (PRD 14.2).

**Rota is not Matinee.** Rox has a second app called Matinee. Never copy code, schema, names, config or requirements from Matinee into Rota, and never put the two in one repo.

---

## 2. What is locked?

Everything in this section is decided. Never change, swap, upgrade a major version of, "improve" or add an alternative to any of it. If you believe a locked choice is wrong, say so in your report and keep using it.

### 2.1 Locked tools

| Id   | Area                    | Locked choice                                                                                                                                                                                                                                                                              | Never use instead                                                                           |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| L-1  | Language                | TypeScript everywhere, on Node 22 LTS                                                                                                                                                                                                                                                      | Plain JavaScript source files, other Node versions                                          |
| L-2  | Mobile                  | React Native with Expo SDK, EAS development builds, iOS and Android. `ios.supportsTablet: true`, phone layout on tablets with 720-point max content width                                                                                                                                  | Expo Go as the target, bare React Native, Flutter, a web client, a split-view tablet layout |
| L-3  | Mobile server data      | TanStack Query, with the TanStack Query persister on AsyncStorage for offline data                                                                                                                                                                                                         | Redux, MobX, SWR, React Context as a data cache, SQLite, MMKV                               |
| L-4  | Mobile app-only state   | Zustand                                                                                                                                                                                                                                                                                    | Redux, Jotai, Context stores                                                                |
| L-5  | Mobile secrets          | expo-secure-store, for the refresh token only                                                                                                                                                                                                                                              | AsyncStorage or any other store for tokens                                                  |
| L-6  | Mobile platform modules | Expo Notifications, expo-localization, expo-web-browser (hosted checkout)                                                                                                                                                                                                                  | Firebase SDKs, OneSignal, react-native-webview for checkout                                 |
| L-7  | API                     | One Next.js app (App Router) with route handlers under `app/v1/**/route.ts`, run with `next start` from a `next build` with `output: 'standalone'`. The major version is pinned in `package.json`                                                                                          | Hono, Express, Fastify, NestJS, the Pages Router `pages/api`, Server Actions, tRPC, GraphQL |
| L-8  | Validation              | Zod, with `.strict()` on every body                                                                                                                                                                                                                                                        | Yup, Joi, class-validator, hand-written checks                                              |
| L-9  | ORM                     | Prisma 6 (Prisma 6 syntax), with `@prisma/extension-read-replicas`                                                                                                                                                                                                                         | Prisma 7, Drizzle, TypeORM, Kysely, Knex, raw `pg` clients                                  |
| L-10 | Database                | PostgreSQL 16. Two shards, each with one primary and one streaming replica: four Postgres containers                                                                                                                                                                                       | MySQL, SQLite, MongoDB, Supabase, Neon, Citus, a single database                            |
| L-11 | Pooling                 | One PgBouncer in transaction mode in front of all four Postgres servers                                                                                                                                                                                                                    | Prisma Accelerate, pgcat, no pooler                                                         |
| L-12 | Cache and queues        | Redis 7 in the Compose stack, locally and on the demo host. BullMQ for jobs                                                                                                                                                                                                                | Upstash, Memcached, any hosted Redis, Agenda, pg-boss, cron in the API                      |
| L-13 | Worker                  | A separate Node process, `tsx worker/index.ts`, in the same repo, importing the same `lib/` code                                                                                                                                                                                           | Jobs inside Next.js, Vercel cron, serverless functions                                      |
| L-14 | Time                    | Luxon for every time zone and local-time calculation, on server and mobile. IANA zones validated with `Intl.supportedValuesOf('timeZone')`                                                                                                                                                 | moment, date-fns-tz, dayjs, manual offset math                                              |
| L-15 | Passwords and tokens    | Argon2id (memory 19 MiB, 2 iterations, parallelism 1). Access tokens are JWT HS256 with a `kid` header                                                                                                                                                                                     | bcrypt, scrypt, PBKDF2, sessions, cookies, RS256                                            |
| L-16 | Payments                | Flutterwave v3 in test mode: hosted checkout for the first payment, tokenized card charges for renewals and proration, webhooks for results                                                                                                                                                | Stripe, Paystack, PayPal, live Flutterwave keys                                             |
| L-17 | Push                    | Expo push service                                                                                                                                                                                                                                                                          | Direct FCM or APNs calls                                                                    |
| L-18 | Email                   | Mailpit locally, Resend on the demo host                                                                                                                                                                                                                                                   | Any other provider, SMTP from the API process                                               |
| L-19 | Hosting                 | Docker Compose with services `caddy`, `api`, `worker`, `pgbouncer`, `pg-s0-primary`, `pg-s0-replica`, `pg-s1-primary`, `pg-s1-replica`, `redis`, `mailpit`, `bull-board`. Caddy in front. The demo host is one low-cost VPS running the same Compose file minus `mailpit` and `bull-board` | Kubernetes, Vercel, Railway, Fly, any managed database                                      |
| L-20 | Tests                   | Vitest and fast-check (API, worker, shared), Supertest against `next start`, Jest with React Native Testing Library (mobile), k6 (load)                                                                                                                                                    | Mocha, Cypress, Playwright for the API, Artillery, Locust                                   |

### 2.2 Chosen by this file

The PRD does not name these. They are now locked in the same way as 2.1, so the agent never picks its own.

| Id   | Area                     | Choice                                                                                                                                         |
| ---- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| L-21 | Package manager and repo | pnpm workspaces in one monorepo (layout in section 4). Commit `pnpm-lock.yaml`                                                                 |
| L-22 | Mobile navigation        | Expo Router (file-based routes in `apps/mobile/app/`)                                                                                          |
| L-23 | Lint and format          | ESLint flat config with typescript-eslint, plus Prettier                                                                                       |
| L-24 | Server libraries         | `ioredis` (Redis client, required by BullMQ), `jose` (JWT), `argon2` (hashing), `uuid` (UUID v7), `pino` (logging), `@bull-board` (local only) |

### 2.3 Locked database design

- **L-25.** Implement the Prisma schema in PRD section 10 exactly: every model, field, type, `@map`, index, unique key and enum. Columns are snake_case through `@map`. Do not rename, merge, split, drop or add models or fields unless the PRD or `docs/decisions.md` says so.
- **L-26.** Apply the raw SQL migrations in PRD section 10 on both shards, after the Prisma migrations, as `rota_owner`: the deferrable `shift_no_overlap` exclusion constraint, `shift_duration`, `swap_one_open_per_shift`, `availability_range`, `membership_one_owner`, `invite_role_not_owner`, the ledger append-only triggers and the grants. Never write a migration that drops or weakens any of them. Running `prisma migrate dev` twice on a clean database must create no migration that drops them.
- **L-27.** Global models (users, tokens, settings, push tokens, teams, memberships, invites, subscriptions, payment methods, charges, charge attempts, ledger, webhook events, notifications, email messages) live only on shard 0. Shard models (shifts, swaps, availability blocks, activity events, team daily stats, member weekly stats) live on the team's shard. `Outbox` lives on every database. One `schema.prisma` serves both shards (PRD 7.6).
- **L-28.** Ids are UUID v7. Team ids are generated in the API before any write, so the shard is known at creation.
- **L-29.** Cursor columns (`activity_event.created_at`, `notification.created_at`, `ledger_entry.created_at`) are `timestamptz(3)`. Other timestamps are `timestamptz(6)`.
- **L-30.** Two database roles: `rota_owner` owns tables and runs migrations through `directUrl`. `rota_app` is used by the API and worker through PgBouncer, and has only SELECT and INSERT on `ledger_entry`.

### 2.4 Locked numbers

Use these values exactly. Never tune, round or "improve" them.

- **L-31. Pooling (PRD 7.4):** PgBouncer `pool_mode=transaction`, `max_client_conn=1000`, `default_pool_size=20`, `reserve_pool_size=5`, `reserve_pool_timeout=3`, `server_idle_timeout=60`, `query_wait_timeout=10`. Postgres `max_connections=100`. Prisma URL `?pgbouncer=true&connection_limit=15&pool_timeout=10`. Migrations use `directUrl` to each primary.
- **L-32. Caching (PRD 7.3):** `perm:{userId}:{teamId}` 60 s; `team:{teamId}` 300 s; `idem:{userId}:{key}` 60 s in progress then 24 h; `ryow:{userId}` 5 s; feed first page never cached. TanStack Query `staleTime`: feed 30 s, my shifts 60 s, team schedule 60 s, swaps 15 s, settings 300 s, billing 0 s.
- **L-33. Tokens (PRD 7.9):** access 15 min; refresh 30 days, rotated on every use, reuse window 30 s; invite 7 days single use; reset 30 min single use; all random tokens are 32 bytes base64url with only the SHA-256 hash stored.
- **L-34. Rate limits (PRD 7.10):** login 5 per 15 min per email and IP; reset request 3 per hour per email; general 120 per minute per user; webhook 300 per minute per IP.
- **L-35. Jobs (PRD 6.2):** queue names, job names, triggers, retry policies, `jobId` idempotency keys, `removeOnComplete: { age: 86400 }` and `removeOnFail: { age: 604800 }` exactly as in the job table.
- **L-36. Limits:** body 100 KB, webhook body 1 MB; schedule range 31 days; feed and list pages 20 (limit 1 to 50); shift 15 min to 16 hours; 28 availability blocks; swap note 280 characters.

---

## 3. What must never happen

**Breaking any rule in this section means the task failed, even if the code builds, the tests pass and the feature works.** If a task seems to need you to break one, stop and ask (section 7).

### 3.1 Money and billing

- **B-1.** Store every amount as a whole number of USD cents in an integer column or `BigInt`. Never use floats, `Decimal`, `toFixed` on money, or any fractional number for money. Anywhere. Ever. (PRD 8.1, 7.10)
- **B-2.** Parse the provider's amount as a decimal string straight into integer cents. Never pass it through `parseFloat` or `Number`. Format cents for Flutterwave as `amountCents / 100` with exactly 2 decimals using integer and string math. (PRD 7.10)
- **B-3.** Use USD only. Never add currencies, exchange rates or locale-based pricing. (PRD 3.2)
- **B-4.** Define plan prices in one server module only: Starter 2000 base, 5 seats included, no extra seats, cap 5. Team 5000 base, 15 included, 300 per extra seat. Business 12000 base, 40 included, 200 per extra seat. `monthlyPrice = base + max(0, seats - included) * extraSeatPrice`. Never hardcode a price anywhere else, including the mobile app. (PRD 8.1)
- **B-5.** Compute proration exactly as PRD 8.2: integer seconds, milliseconds truncated, `BigInt` product, `floor`, and 0 when the delta is not positive. Create one proration charge per seat-add event or plan change. A proration under 100 cents still gets its ledger entry but is collected with the next renewal. Keep the 3 worked examples in PRD 8.3 as golden tests and the 10,000-case property test against a reference implementation. (G5, FR-36, FR-38)
- **B-6.** Classify a plan change by price at the current `paidSeats`, never by tier name. Apply upgrades at once with proration. Schedule downgrades for period end with no credit or refund. Reject a Starter downgrade while active seats are above 5 (`409 SEAT_LIMIT_REACHED`), and cancel a scheduled Starter downgrade at renewal if seats are still above 5. (PRD 8.4, FR-36, FR-37)
- **B-7.** Treat `paidSeats` as this period's high-water mark of active seats, owner included. Never refund or credit a removed seat. Bill active seats at renewal. Never let a Starter team reach a sixth active seat: block invites at 5 active plus pending, and re-check inside the acceptance transaction. (PRD 8.4, FR-09, FR-38)
- **B-8.** Start each new team on Starter with its first charge due 14 days after creation. Do not build any other trial logic. (FR-07)
- **B-9.** Mark a charge `PAID` and write `PAYMENT_CONFIRMED` only inside `billing.webhook`, and only after a verified webhook and a server-side `GET /v3/transactions/{id}/verify` that matches `tx_ref`, amount in cents, currency `USD` and status `successful`. Never mark a charge paid from the app, a route handler, `billing.reconcile`, a script or a test helper that ships. (FR-42, PRD 8.5)
- **B-10.** Compare `verif-hash` to `FLW_SECRET_HASH` in constant time. On a mismatch return `401 WEBHOOK_SIGNATURE_INVALID` and store nothing except a log line. On a match, store the event, return `200` within 2 seconds and process it in a job. Duplicate or replayed webhooks must produce exactly one ledger entry. (FR-42, G8)
- **B-11.** Create a new `ChargeAttempt` with `txRef = {chargeId}-{attemptNo}` for every payment try, checkout or retry. Never reuse a `tx_ref`. Never retry `billing.charge` after the provider accepted the request. Set `PAID` with a conditional update on `status <> 'PAID'`. Record a second successful payment as `PAYMENT_CONFIRMED` and log `DOUBLE_PAYMENT`. (PRD 8.5)
- **B-12.** Never UPDATE, DELETE or TRUNCATE `ledger_entry`, and never grant `rota_app` more than SELECT and INSERT on it. Correct mistakes with a new `REVERSAL` entry. Pair every `REFUND_ISSUED` with a `REVERSAL`. Use the entry types and signs in PRD 8.7. `CHARGE_SUBSCRIPTION` is the plan price only, never deferred prorations. Keep ledger and charges when a team is purged. (PRD 8.7, G8)
- **B-13.** Run the grace flow exactly as PRD 8.6: `PAST_DUE` with `graceEndsAt` 7 days after the first failure, retries on days 1, 3 and 5 with new attempts, `READ_ONLY` on day 7 unless a verified payment is waiting (`RECONCILE_PENDING`). Never move `graceEndsAt` on a second failure. Return a read-only team to `ACTIVE` only when no other charge is `FAILED` or past its `dueAt`. (FR-40)
- **B-14.** For a read-only team, return `403 TEAM_READ_ONLY` on every write except billing actions, own settings, leaving the team, transferring ownership and deleting the team. Freeze pending swaps and keep their expiry clock running. (PRD 5.1, FR-25)
- **B-15.** Send every plan change through `POST /billing/preview` first and show the exact cents before the owner confirms. Return `seatImpact` on invites that add a paid seat. The mobile app displays amounts the server computed and never computes money itself. (FR-09, FR-36, PRD 8.4)
- **B-16.** Allow billing endpoints for the owner only (`403 FORBIDDEN` for everyone else). Never put billing data in the activity feed. (FR-34, PRD 14.1)
- **B-17.** Use Flutterwave test keys only. Never add a live key, a live-mode switch or real card numbers. Encrypt card tokens with AES-256-GCM before storage. (PRD 3.2, 7.10)

### 3.2 Who may do what

- **B-18.** Check every permission on the server, on every request, using the matrix in PRD 5.1. Hiding a button in the app is never the permission check. Never put team or role claims in the JWT. (PRD 5.1, 7.9)
- **B-19.** Return `404 NOT_FOUND` to a user who is not an active member of the team, the same response as for a team that does not exist. Never return `403` for non-members. (FR-43)
- **B-20.** Keep teams isolated. Every shard query includes `teamId`. Every lookup by id filters by both `id` and `teamId`. Run shard queries only inside a tenant scope (`team`, `user` or `system`) enforced by the Prisma extension, which throws `TENANT_SCOPE_MISSING` or `TENANT_SCOPE_MISMATCH`. Never make the `system` scope reachable from a route handler. Every team-scoped endpoint, plus `/me/shifts` and `/me/notifications`, gets a case in the isolation suite. (FR-43, PRD 7.10, G4)
- **B-21.** Run raw SQL only through `teamQuery(teamId, sql)` with a `team_id = $1` parameter. Never use `$queryRawUnsafe`, and never use `$queryRaw` outside `teamQuery`. Keep the ESLint rule that bans both. (PRD 7.10)
- **B-22.** Keep exactly one owner per team. The owner cannot leave (`409 OWNER_MUST_TRANSFER`). Ownership transfer requires the owner's password and runs in one global transaction in this order: old owner to `MANAGER`, target to `OWNER`, `Team.ownerUserId` to target. Delete both permission cache keys after commit. (FR-12, FR-13)
- **B-23.** Never let an invite grant `OWNER`. Only the owner invites managers (`403 FORBIDDEN` for a manager). Only the owner changes roles. Managers may remove staff only. (FR-09, FR-11, FR-12)
- **B-24.** Never let a manager approve or reject a swap they are part of (`403 SWAP_SELF_DECISION`). The owner may, and the feed event records `selfApproved: true`. (FR-23)
- **B-25.** Delete `perm:{userId}:{teamId}` on role change, removal, leave, ownership transfer and team deletion, and read the primary on a cache miss, so revoked access ends on the next request. (PRD 7.3, 7.5)
- **B-26.** Show draft shifts only to managers and the owner. Leave drafts out of My Shifts, the staff schedule view, the offline cache and swap requests. Drafts never write feed events and never notify anyone. (FR-15c)
- **B-27.** Never show staff other members' availability. (PRD 5.1)

### 3.3 Accounts and secrets

- **B-28.** Hash passwords with Argon2id using the L-15 parameters. Store only SHA-256 hashes of refresh, invite and reset tokens. Compare hashes with `crypto.timingSafeEqual`. Never store or log a plaintext password or token. (PRD 7.9)
- **B-29.** Implement refresh rotation exactly as FR-03: rotate on each use within one family; reuse more than 30 seconds after rotation revokes the whole family (`401 AUTH_REFRESH_REUSED`); reuse within 30 seconds is a retry. The app refreshes single flight. (FR-03)
- **B-30.** Return the same `401 AUTH_INVALID_CREDENTIALS` message whether or not the email exists. Return `202` for every reset request whether or not the account exists. A password reset revokes all refresh tokens. (FR-02, FR-06)
- **B-31.** Keep the refresh token in expo-secure-store only and the access token in memory only. The app bundle contains only the API base URL and the Expo project id: never a Flutterwave key, JWT secret, database URL or any other secret. (PRD 7.7)
- **B-32.** Validate every body, query and path parameter with Zod; reject unknown fields with `.strict()`. Redact `password`, `token`, `refreshToken`, `authorization` and card fields from logs. Send `Cache-Control: private, no-store` on every authenticated response, plus the security headers in PRD 7.10. (PRD 7.10, 7.3)
- **B-33.** Accept an `Idempotency-Key` on every authenticated write, claimed with `SET … NX EX 60` before the handler runs, with `409 IDEMPOTENCY_IN_PROGRESS` and `409 IDEMPOTENCY_CONFLICT` as in PRD 7.3. (PRD 7.2, 7.3)

### 3.4 Schedules and swaps

- **B-34.** Store shift times as UTC instants only. Take `startsLocal` and `endsLocal` without an offset and resolve them in the team time zone with Luxon. Reject a nonexistent local time with `400 SHIFT_TIME_NONEXISTENT`; never move a time silently. Use the earlier instant for an ambiguous time unless the body sets the later-offset flag. Keep the DST tests in FR-15 for America/Chicago and Europe/London. (FR-15, PRD 9)
- **B-35.** Never give a user a time zone they did not choose. Registration requires a valid IANA zone from the device. The app asks before changing a saved zone. (FR-01, FR-31)
- **B-36.** Never let one assignee hold two overlapping live shifts in one team. Check in the server and keep the exclusion constraint. Map SQLSTATE 23P01 to `409 SHIFT_OVERLAP` on shift writes and `409 SWAP_OVERLAP` on swap writes. Swap approval runs `SET CONSTRAINTS shift_no_overlap DEFERRED` in its transaction. (FR-15, FR-24)
- **B-37.** Run swaps through this state machine only: `PENDING_PEER`, then `PENDING_MANAGER` after the coworker accepts, then `APPROVED` or `REJECTED` by a manager or owner, plus `DECLINED`, `CANCELED` and `EXPIRED`. Never skip the coworker step or the manager step. Approve in one shard transaction that checks the saved shift versions (`409 SWAP_STALE`), lets exactly one of two concurrent approvals win (`409 SWAP_ALREADY_DECIDED`) and rejects started shifts (`409 SWAP_TOO_LATE`). Cancel any open swap when either shift's time, assignee or existence changes. (FR-21 to FR-25, FR-16)
- **B-38.** Use optimistic concurrency with `version` on shifts and settings. Return `409 VERSION_CONFLICT` on a stale version. Never apply last-write-wins. (FR-16, FR-31)
- **B-39.** Return `409 AVAILABILITY_WARNING` with the uncovered intervals and save nothing when a shift falls outside the assignee's availability and `acknowledgeAvailability` is not true. Save once it is acknowledged. A member with no blocks is available. (FR-20)

### 3.5 Notifications

- **B-40.** Never send a push inside the recipient's quiet hours in the recipient's own time zone, including changes to shifts in the next 24 hours. Compute `scheduledFor` with the rule in PRD 6.3, check again at send time and move the existing job with `job.moveToDelayed` (never add a new one). Store `quietWindowAtSend` on every sent notification. (FR-28, PRD 6.3, G6)
- **B-41.** Never notify the person who caused the event. Send each trigger only to the recipients listed in FR-27. (FR-27)
- **B-42.** A publish sends each affected staff member exactly one `SCHEDULE_PUBLISHED` notification. The `SHIFT_CREATED` events a publish writes notify nobody. (FR-15c)
- **B-43.** Hold pushes beyond 10 per user per 60 minutes and release them through `notify.release`. Send one digest when 4 or more are due at once. (FR-30)
- **B-44.** Never put secrets, tokens or patient information in a notification's `data`. Never send shift notifications by email or SMS; email is only for invites, password resets and billing. (PRD 10, 3.2)

### 3.6 Privacy and data

- **B-45.** Never store patient data. Keep the hint "Do not enter patient information" on the shift notes field. Seed and demo data contain no real people. (PRD 3.2, FR-15)
- **B-46.** Cache offline only the user's published shifts from today to today + 14 days and their settings, with the user id as the cache buster. Delete the offline cache, the secure-store token and this device's push token on logout. (FR-04, FR-32, PRD 7.7)
- **B-47.** Never queue or send writes while offline. Disable write buttons with "Connect to make changes". Log the user out only on a `401` from the server, never on a network error. (FR-32)
- **B-48.** On team deletion, cut access for all members at once and purge team data after 30 days with `maintenance.purge-team`, keeping ledger and charges. Run the cleanup schedule in PRD 6.2. (FR-14)
- **B-49.** Meet the accessibility rules in PRD 7.11: 44 by 44 point targets, 200% text scaling, contrast 4.5:1 and 3:1, an `accessibilityLabel` on every icon button, status shown as text as well as color, errors and rollbacks announced, Reduce Motion respected.

### 3.7 Scope

- **B-50.** Never build anything in PRD 3.2 Non-goals: store releases, live payments, any AI feature, payroll or time clocks, offline writes, open shifts or bidding, in-app chat, a web dashboard or web client, social login or SSO, multi-currency, email or SMS shift notifications, email verification, qualification matching, more than two shards, resharding or multi-region.
- **B-51.** Build only the requirement ids of the current phase (section 1 table). Never build a later-phase feature early, never build a "Could" before phase 7, and never spend buffer time on new scope. If time runs short, cut in this order: FR-46, FR-45, FR-28a, FR-29, FR-41, FR-14.
- **B-52.** Use only the error codes in PRD 7.10 and the error shape `{ "error": { "code", "message", "requestId" } }`. Never invent a new code, status or response shape.

---

## 4. How is the work arranged?

### 4.1 Folder layout

Create exactly this layout. Put new code in the folder named for it. Do not create new top-level folders.

```text
rota/
├── AGENTS.md
├── .agents/rules/                 # CS-, DB-, GIT-, SEC-, MB-, UP- rules files
├── README.md                      # setup, architecture diagram, k6 results with host CPU and RAM
├── docs/
│   ├── Rota-PRD-v1.1.md           # source of truth, never edited
│   └── decisions.md               # decisions Rox made after v1.1, newest first
├── package.json                   # root scripts: lint, typecheck, test, build
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── .prettierrc
├── .nvmrc                         # 22
├── .env.example                   # every variable, no real values
├── .github/workflows/ci.yml       # lint, typecheck, test, build
├── infra/
│   ├── docker-compose.yml         # the services in L-19, with CPU and memory limits
│   ├── caddy/Caddyfile
│   ├── pgbouncer/                 # pgbouncer.ini, userlist
│   ├── postgres/                  # primary and replica config, role setup
│   └── k6/                        # feed.js from PRD 11, seed-users generator
├── packages/
│   └── shared/                    # imported by api and mobile
│       └── src/
│           ├── schemas/           # Zod request and response schemas, one file per area
│           ├── errors.ts          # error codes from PRD 7.10 and the error shape
│           └── enums.ts           # Role, ShiftStatus, SwapStatus, Plan, etc.
└── apps/
    ├── api/                       # Next.js: the API and two landing pages. Never a web client
    │   ├── app/
    │   │   ├── v1/**/route.ts     # thin handlers: withApi(...) and one service call
    │   │   ├── i/[token]/page.tsx # invite landing page
    │   │   └── r/[token]/page.tsx # reset landing page
    │   ├── lib/                   # shared by API and worker
    │   │   ├── api/               # withApi, error mapping, idempotency, rate limit
    │   │   ├── auth/              # tokens, passwords, requireTeamRole
    │   │   ├── db.ts              # shard Prisma clients with replica extensions, cached on globalThis
    │   │   ├── data/              # shard router, tenant scope extension, teamQuery, read routing
    │   │   ├── redis/             # client, keys, Redis-down fallbacks
    │   │   ├── outbox/            # write outbox rows, enqueue after commit
    │   │   ├── time/              # Luxon helpers: local to UTC, quiet hours, week ranges
    │   │   ├── billing/           # pricing.ts, proration.ts, ledger.ts, flutterwave/
    │   │   ├── domain/            # services: teams, members, invites, shifts, availability,
    │   │   │                      #   swaps, feed, notifications, settings, stats
    │   │   ├── config/env.ts      # Zod-validated environment, the only reader of process.env
    │   │   └── log.ts             # pino logger with redaction
    │   ├── worker/
    │   │   ├── index.ts           # starts workers, repeatable jobs, lag probe
    │   │   ├── queues.ts          # queue names and job options from PRD 6.2
    │   │   ├── jobs/<queue>/<job>.ts
    │   │   └── lag-probe.ts
    │   ├── prisma/
    │   │   ├── schema.prisma      # PRD 10, exactly
    │   │   ├── migrations/
    │   │   └── sql/               # raw SQL from PRD 10, run as rota_owner on both shards
    │   ├── scripts/               # seed (fake people only), admin refund and reversal script
    │   └── tests/
    │       ├── unit/
    │       ├── integration/       # against the Compose databases and Redis
    │       ├── isolation/         # every team-scoped endpoint with a foreign token
    │       └── property/          # fast-check, proration
    └── mobile/                    # Expo app
        ├── app.config.ts
        ├── app/                   # Expo Router screens, one per PRD 5.12 item
        │   ├── (auth)/            # login, register, reset request, reset confirm, invite accept
        │   └── (app)/             # every signed-in screen
        ├── src/
        │   ├── api/               # fetch client, single-flight refresh, idempotency keys
        │   ├── queries/           # TanStack Query keys, queries and mutations per area
        │   ├── state/             # Zustand stores (app-only state)
        │   ├── offline/           # persister and offline banner logic
        │   ├── notifications/     # token registration, foreground invalidation
        │   ├── features/<area>/   # components and hooks for one area
        │   ├── ui/                # shared accessible components
        │   └── lib/               # time formatting, a11y announce helper
        └── tests/
```

### 4.2 Rules about how the system is arranged

These rules also count as failure if broken, even when the feature works.

- **A-1.** Wrap every route handler in `withApi({ auth, roles, rateLimit, body, query })`. It runs, in order: rate limit, auth, team context and tenant scope (`requireTeamRole`), then Zod `safeParse`. The rate limit always runs before the team lookup. (PRD 7.1)
- **A-2.** Export `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` from every `route.ts`, and keep the test that checks every route file for both. Never use the Edge runtime, `revalidate`, Next.js `fetch` caching, Server Actions or `middleware.ts` for auth or data. (PRD 7.1, 9)
- **A-3.** Keep route handlers thin: parse, call one service in `lib/domain`, return. Put business logic only in `lib/domain` and `lib/billing`, never in `route.ts`, never in worker job files and never in the mobile app.
- **A-4.** Run slow and external work in the worker, never inside a request: push fan-out and delivery, email, Flutterwave verification, tokenized charges, renewals, scans, cleanup and the stats pipeline. Next.js never starts BullMQ workers. The one provider call allowed in a request is creating the hosted checkout link (FR-35). (PRD 6.1)
- **A-5.** Write one `Outbox` row in the same transaction as every state change that notifies someone or writes to another database. Add the job only after commit. Set each job's `jobId` to its idempotency key, and make each handler check its unique Postgres key so a repeated job does nothing. (PRD 6.1)
- **A-6.** Never run one transaction across both shards, and never one that writes both global models and shard models, even when the team is on shard 0. Cross-store effects go through the outbox: for example, membership activation writes a `feed.append` outbox row, and the job writes `MEMBER_JOINED` to the shard. (PRD 6.1, 7.6)
- **A-7.** Read and write global models only through the shard 0 client. Route shard models by `Team.shardIndex`, which is the directory. Use `hash(teamId) % 2` only when creating a team. Never add a Prisma relation between a global and a shard model; use plain id columns. (PRD 7.6)
- **A-8.** Create the Prisma clients (one per shard, each with its read-replica extension, so four pools) once per process in `lib/db.ts` and cache them on `globalThis`. Never create a `PrismaClient` anywhere else. (PRD 7.1)
- **A-9.** Send every write and every transaction to the primary. After a successful write by user U, set `ryow:{U}` for 5 seconds, and read the primary while it exists. Read the primary when `X-Read-Primary: 1` is sent, when Redis is unreachable, or when `replica:lag:{shard}` is above 2,000 ms or missing, until it drops below 1,000 ms. Return `X-Read-Source` in non-production builds. Set read-routing flags and tenant scope in AsyncLocalStorage in `withApi` or the job wrapper. (PRD 7.5)
- **A-10.** Apply the Redis-unavailable rules in PRD 7.3: permission lookups read the primary, rate limits fail open to an in-process 120 per minute, billing writes and invite acceptance return `503 DEPENDENCY_UNAVAILABLE`, other writes proceed without idempotency replay.
- **A-11.** Keep the API stateless. Nothing lives in process memory between requests except the Prisma clients, the Redis client and the in-process fallback rate limiter.
- **A-12.** In the mobile app, keep server data only in TanStack Query, app-only state only in Zustand (contents listed in PRD 7.7), and offline data only in the persister under `['me','shifts','offline']` and `['me','settings']`. Never copy server data into Zustand.
- **A-13.** Make optimistic only the mutations PRD 7.8 lists (approve, reject, accept, decline and cancel swap, mark notification read, update settings, replace availability), each with the five rules in PRD 7.8. Every other write shows a spinner and disables its button.
- **A-14.** The mobile app talks only to the `/v1` API and to Flutterwave hosted checkout in `expo-web-browser`. It never calls a database, Redis, the Flutterwave server API or the Expo push API directly.
- **A-15.** `apps/mobile` never imports from `apps/api`. `packages/shared` never imports Prisma, Node-only modules, server config or secrets. Request and response types come from the Zod schemas in `packages/shared`, used by both sides.
- **A-16.** Read environment variables only in `lib/config/env.ts`, validated with Zod at startup. The process fails to start on a missing or invalid variable. Keep `.env.example` complete. Never commit a real secret.

---

## 5. How should the code look?

These are style rules. Follow them, but they are not the failure rules in section 3.

### 5.1 Modern and long-term supported

- **S-1.** Use only stable releases: Node 22 LTS, and the latest stable minor of each locked major. Never use canary, beta, RC or experimental flags.
- **S-2.** Use TypeScript `strict: true`, plus `noUncheckedIndexedAccess` and `noImplicitOverride`. Use ES modules with `import` and `export`.
- **S-3.** Never use `any`, non-null `!` assertions or `@ts-ignore`. If you need `@ts-expect-error`, write the reason on the same line.
- **S-4.** Derive types from Zod schemas with `z.infer` and from Prisma's generated types. Never hand-write a type that duplicates a schema.

### 5.2 Clean and readable

- **S-5.** Name things for what they mean in the PRD: `paidSeats`, `startsAt`, `PENDING_MANAGER`, `quietEndMinute`. Files are kebab-case, React components PascalCase, functions and variables camelCase, constants UPPER_SNAKE_CASE.
- **S-6.** Write small, single-purpose functions that return early. Aim for files under about 300 lines; split by responsibility, not at random.
- **S-7.** Use named exports. Use a default export only where Next.js or Expo Router requires one.
- **S-8.** Throw one error class, `AppError(code, status, message)`, with codes from `packages/shared/src/errors.ts`. Map it to the PRD error shape in one place, inside `withApi`. Never swallow an error; log it with the request id or job id.
- **S-9.** Log with the pino logger. Never leave `console.log` in committed code.
- **S-10.** Write comments that explain why, and cite the PRD where a rule comes from, such as `// FR-23: owners may decide their own swaps`. Never leave commented-out code or a TODO without a reason.
- **S-11.** Never copy and paste logic. If two places need it, move it into `lib/` or `packages/shared`.
- **S-12.** Run Prettier and ESLint on every file you touch, with zero warnings.

### 5.3 React Native

- **S-13.** Write function components and hooks only. Keep screens in `app/` thin and put logic in `src/features` hooks.
- **S-14.** Style with `StyleSheet.create` and shared tokens in `src/ui`. Support light and dark mode.
- **S-15.** Format every time with Luxon in the team's time zone, adding the user's own zone in brackets when it differs (FR-17). Never format a time with `Date.toLocaleString`.

### 5.4 Tests

- **S-16.** Write a test for every acceptance criterion you implement, named with its id, such as `describe('FR-21 Request a swap')`.
- **S-17.** Test against real Postgres and Redis from the Compose stack for anything touching transactions, constraints, the ledger or replicas. Mock only external services: Flutterwave, Expo push and Resend.
- **S-18.** Never skip, delete, weaken or mark as expected-to-fail a test to make a build pass.

### 5.5 Commits

- **S-19.** Make one logical change per commit, with a message like `feat(swaps): FR-23 manager approval`. Never commit `.env` files, keys or generated build output.

---

## 6. What counts as done?

A task is done only when every item below is true. If any item is false, the task is not done, and you say which one in your report.

### 6.1 Checks that must pass

- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm lint` reports zero errors and zero warnings.
- [ ] `pnpm typecheck` reports zero errors in `apps/api`, `apps/mobile` and `packages/shared`.
- [ ] `pnpm test` passes in every workspace.
- [ ] `pnpm --filter api build` (`next build`) completes with no errors.
- [ ] `pnpm --filter api exec prisma validate` passes, and migrations plus the raw SQL apply cleanly to both shard primaries.
- [ ] `pnpm --filter mobile exec expo-doctor` reports no errors.
- [ ] `docker compose up` starts every service in L-19 and `/readyz` returns `200`.
- [ ] Every new or changed acceptance criterion has a passing test (S-16).
- [ ] Every new team-scoped endpoint has a case in the isolation suite (B-20).
- [ ] In phase 6 and after: both k6 scenarios in PRD 11 meet their thresholds, and the README records the host's CPU and RAM.
- [ ] The route export test passes (A-2).
- [ ] No new dependency outside section 2 was added.
- [ ] No rule in section 3 or section 4.2 is broken.
- [ ] `README.md`, `.env.example` and `docs/decisions.md` are updated if the task changed setup, variables or recorded a decision.

### 6.2 Report to give at the end of every task

End every task with this report. Do not leave out a requirement you touched, and do not mark one met without a test or a check that proves it.

```markdown
## Task report

**Phase:** <0 to 7> **Task:** <one line>

### Requirements

| Id    | Requirement                  | Status     | Proof                                             |
| ----- | ---------------------------- | ---------- | ------------------------------------------------- |
| FR-21 | Request a swap               | Met        | tests/integration/swaps/request.test.ts (5 cases) |
| FR-22 | Coworker accepts or declines | Partly met | Decline done; accept blocked, see Questions       |

### Rules checked

- Money (B-1 to B-17): <pass, or not touched>
- Access (B-18 to B-27): <pass, or not touched>
- Accounts and secrets (B-28 to B-33): <pass, or not touched>
- Schedules and swaps (B-34 to B-39): <pass, or not touched>
- Notifications (B-40 to B-44): <pass, or not touched>
- Privacy, data and scope (B-45 to B-52): <pass, or not touched>
- Architecture (A-1 to A-16): <pass, or not touched>
- Rules files (CS-, DB-, GIT-, SEC-, MB-, UP-): <ids checked, or not touched>

### Checks

- [x] lint - [x] typecheck - [x] test - [x] next build - [x] prisma validate - [x] expo-doctor - [x] compose up

### Changed files

<list>

### Assumptions and questions

<anything you were unsure about, what you did, and what needs Rox's answer>
```

---

## 7. What do you do when unsure?

1. **Look it up in this order:** the PRD section for the requirement, the PRD sections it points to (5.1, 6, 7, 8, 10), `docs/decisions.md`, this file, then the existing code.
2. **If the PRD marks something `[ASSUMPTION]`, build it exactly as written.** It is the current answer until Rox changes it.
3. **If you are still unsure, stop that part and ask.** Write one short question, name the options, recommend one and say why. Keep working on the parts that do not depend on the answer.
4. **Never invent scope.** Do not add a feature, screen, endpoint, field, model, error code, job, setting, dependency or service that the PRD and this file do not name. A "nice to have" is new scope. Mention the idea in your report and do not build it.
5. **Never guess with a workaround.** When unsure, do not write spaghetti code: no temporary hacks, no duplicated logic, no `any` casts, no swallowed errors, no feature flags to hide half-built work, no code that "will be cleaned up later", no commented-out alternatives. Write nothing for that part rather than something tangled.
6. **Never fix the PRD silently.** If the PRD looks wrong or two parts contradict each other, quote both lines in your question and wait. Do not choose for Rox.
7. **Never break a locked choice or a section 3 rule to unblock yourself.** If a locked tool cannot do what the PRD needs, report it with the error you hit.
8. **When Rox answers,** add the answer to `docs/decisions.md` with the date, then continue.
