---
trigger: model_decision
description: Use when changing prisma/schema.prisma, writing a migration or raw SQL, or writing any Prisma query or transaction in the API or the worker.
---

# Database schema

Ids like (L-25) point to AGENTS.md, FR- and PRD ids to the PRD v1.1.

## 1. The schema

- **DB-1. A schema change needs a decision** (L-25). Any change to `schema.prisma` needs a dated `docs/decisions.md` entry that names it, cited in the commit. PRD 10 makes `charge.created_at` `timestamptz(3)`, which L-29 omits: follow PRD 10. Why: both shards and every test share the schema, and charges use cursor paging.
- **DB-2. Placement checks stay** (L-27, A-7). Keep the startup check that fails when shard 1's global tables hold rows (PRD 7.6) and the `maintenance.shard-check` job (PRD 6.2). Why: a misrouted write raises no error.
- **DB-3. One Zod schema per JSON column.** Read and write each `Json` column only through its schema in `lib/`: `Charge.lineItems`, `Notification.data`, `Notification.quietWindowAtSend`, `ActivityEvent.payload`, `Outbox.payload`, `EmailMessage.vars`, `LedgerEntry.metadata`. `WebhookEvent.payload` is stored as received and never trusted for money (MB-5). Why: Prisma types `Json` as anything, so nothing else checks its shape.
- **DB-4. Emails are stored lowercase.** Zod trims and lowercases every email before any lookup or insert on `User.email` and `Invite.email`. Why: otherwise one person can hold two accounts.

## 2. Migrations

- **DB-5. Generate, read, apply. Never edit history.** Create with `prisma migrate dev --create-only`, read the SQL, then apply. Never edit, rename or delete a committed migration; fix mistakes with a new one. Never use `prisma db push`. Why: an edited migration makes old and new databases differ; `db push` leaves no migration.
- **DB-6. No data loss without a decision.** Dropping or renaming a table, column or enum value, or changing a column type, needs a `docs/decisions.md` entry that allows it. Prisma's data-loss warning is a stop. Why: deleted data cannot be migrated back.
- **DB-7. Both shards stay identical** (L-26, L-30). One migrate script applies the Prisma migrations, then every file in `prisma/sql/`, to both shard primaries as `rota_owner` through `directUrl`. Never migrate one shard alone, or a replica. On the demo host the script uses `prisma migrate deploy`; never run `migrate dev` or `migrate reset` there. Why: the router assumes one schema on both shards, replicas copy their primary, and `dev` or `reset` can wipe data.
- **DB-8. Raw SQL is rerunnable and proven.** `prisma/sql/` files match the PRD 10 definitions and change nothing on a second run (`IF NOT EXISTS`, `CREATE OR REPLACE`, or a `DO` block that checks `pg_constraint`, `pg_indexes` or `pg_trigger`). An integration test checks on both primaries that `shift_no_overlap`, `shift_duration`, `swap_one_open_per_shift`, `availability_range`, `membership_one_owner`, `invite_role_not_owner`, both ledger triggers and the `rota_app` grants exist. Why: the script reruns every deploy, and no other test notices a missing constraint.
- **DB-9. Schema and migrations never drift.** CI runs `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <a throwaway Postgres 16 in the CI job> --exit-code`. Why: a schema edit without its migration works locally and breaks every other database.

## 3. Queries

- **DB-10. Live-data filters** (B-20, B-26). Besides `teamId`: current-shift reads filter `deletedAt: null`; access checks and seat counts use `Membership.status = ACTIVE` and `Team.deletedAt = null`; staff reads add `status: PUBLISHED`. Why: the exclusion constraint ignores deleted shifts, so they must also vanish from swaps, My Shifts and the offline cache.
- **DB-11. Guards live in the database** (B-38, B-11, A-5). Never read a row, check it in code, then write unguarded. Use `updateMany({ where: { id, teamId, version } })` with a count of 0 as `409 VERSION_CONFLICT`; conditional status updates, where 0 means already done; and unique keys: `Charge.idempotencyKey`, `ChargeAttempt.txRef`, `LedgerEntry.idempotencyKey`, `WebhookEvent.providerEventKey`, `Notification.dedupeKey`, `ActivityEvent.dedupeKey`, `Outbox.sourceKey`. In a job, `P2002` on the job's own key means done: return success and write nothing. Why: another request or a retried job can change the row between read and write.
- **DB-12. No outside calls in a transaction** (A-5, A-6). Inside `$transaction`, never call Flutterwave, Expo push, Resend or any HTTP service, add a BullMQ job or wait on a timer. Why: a slow call holds a pooled connection, and a job added before commit can run against a rolled-back write.
- **DB-13. Nothing depends on a session** (L-11). Never use `SET` without `LOCAL`, `pg_advisory_lock`, `LISTEN`/`NOTIFY`, temp tables beyond one transaction, or `WITH HOLD` cursors. `SET CONSTRAINTS shift_no_overlap DEFERRED` is fine because it lasts one transaction (B-36). Why: in transaction mode PgBouncer gives your connection to other clients between transactions.

## 4. Deletes

- **DB-14. Hard deletes only where PRD 6.2 says.** Only `maintenance.cleanup` and `maintenance.purge-team` delete rows, and only the rows their PRD 6.2 entries list. Everywhere else use `deletedAt`, `revokedAt`, `disabledAt` or `status`. Why: soft deletes keep feed and swap history intact.
- **DB-15. Billing history survives a purge** (B-12, B-48). `maintenance.purge-team` deletes the team's shard rows and its global memberships, invites and settings (PRD 6.2). It never deletes `Team`, `Subscription`, `PaymentMethod`, `Charge`, `ChargeAttempt`, `LedgerEntry` or `WebhookEvent` rows. Never change `onDelete: Restrict` on a billing relation. No endpoint or job deletes a `User`: the PRD has no account deletion. Why: the ledger must still balance after a team is gone.