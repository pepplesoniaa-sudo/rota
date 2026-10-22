# Database schema

Rules for `apps/api/prisma/` (schema, migrations, raw SQL), the shard clients in `lib/db.ts`, the data layer in `lib/data/`, and every query any service or job runs. Read this file before any task that changes the schema, writes a migration, adds a query, or opens a transaction.

**How this file relates to AGENTS.md.** It adds detail to AGENTS.md and never relaxes it. Ids such as (L-25) or (A-6) point to AGENTS.md. `FR-` and `PRD` ids point to the PRD v1.1. If this file seems to disagree with AGENTS.md or the PRD, they win: stop and ask (AGENTS section 7).

**Every numbered rule here is a failure rule.** Breaking one means the task failed even if the code builds, the tests pass and the feature works. Cite the ids you checked in your task report.

---

## 1. The schema

- **DB-1. The schema is PRD section 10, exactly** (L-25). `prisma/schema.prisma` matches PRD section 10 field for field, including every `@map`, `@db` type, index, unique key, enum value and `onDelete`. A change needs a dated entry in `docs/decisions.md` that names the change, and the commit cites it. Where AGENTS.md L-29 and the schema differ, the schema wins: `charge.created_at` is `timestamptz(3)`, because the charges list uses the cursor rules.

- **DB-2. Placement** (L-27, A-7). Global models are read and written only through the shard 0 client. Shard models are routed by `Team.shardIndex`. Never add a Prisma relation between a global model and a shard model. Keep the startup check that fails when shard 1's global tables contain rows (PRD 7.6), and keep `maintenance.shard-check` (PRD 6.2).

- **DB-3. JSON columns have one schema each.** Every `Json` column has one Zod schema in `lib/`, and code writes and reads that column only through it: `Charge.lineItems`, `Notification.data`, `Notification.quietWindowAtSend`, `ActivityEvent.payload`, `Outbox.payload`, `EmailMessage.vars` and `LedgerEntry.metadata`. `WebhookEvent.payload` is stored exactly as received and is never trusted for money (MB-5).

- **DB-4. Emails are stored lowercase.** The Zod schema trims and lowercases every email before any lookup or insert on `User.email` and `Invite.email`, so one person can never hold two accounts.

## 2. Migrations

- **DB-5. Generate, read, apply. Never edit history.** Create migrations with `prisma migrate dev --create-only`, read the generated SQL, then apply it. Never edit, rename or delete a migration folder after it is committed. Fix a mistake with a new migration. Never use `prisma db push`.

- **DB-6. A migration never loses data without a decision.** A migration that drops or renames a table, column or enum value, or changes a column type, needs a `docs/decisions.md` entry that allows it. Prisma's data-loss warning is a stop sign, not a prompt to accept.

- **DB-7. Both shards are always identical.** One migrate script applies the Prisma migrations and then every file in `prisma/sql/` to both shard primaries, as `rota_owner` through `directUrl` (L-26, L-30). Never run a migration on only one shard, and never against a replica. On the demo host, run only `prisma migrate deploy`. Never run `prisma migrate dev` or `prisma migrate reset` there.

- **DB-8. Raw SQL objects are protected and proven.** The files in `prisma/sql/` hold the PRD section 10 objects with the same definitions, written so a second run changes nothing (`IF NOT EXISTS`, `CREATE OR REPLACE`, or a `DO` block that checks `pg_constraint`, `pg_indexes` or `pg_trigger` first). An integration test checks, on both shard primaries, that `shift_no_overlap`, `shift_duration`, `swap_one_open_per_shift`, `availability_range`, `membership_one_owner`, `invite_role_not_owner`, both ledger triggers and the `rota_app` grants exist. Running `prisma migrate dev` twice on a clean database creates no new migration (PRD 13, phase 0).

- **DB-9. Schema and migrations never drift.** CI runs `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <ci shadow db> --exit-code`, and the build fails if the schema changed without a migration.

## 3. Queries

- **DB-10. Live data filters are always applied.** Besides `teamId` on every shard query (B-20):
  - Reads of current shifts filter `deletedAt: null`. The exclusion constraint ignores deleted shifts, so a deleted shift must also be invisible to swaps, My Shifts and the offline cache.
  - Access checks and seat counts use `Membership.status = ACTIVE` and `Team.deletedAt = null`.
  - Staff-facing reads also filter `status: PUBLISHED` (B-26).

- **DB-11. Guards live in the database, not only in code** (B-38, B-11, A-5). Never read a row, check it in code, then write it unguarded. Use:
  - Version checks: `updateMany({ where: { id, teamId, version } })` and treat a count of 0 as `409 VERSION_CONFLICT`.
  - Status guards: a conditional update such as `status <> 'PAID'`, with a count of 0 meaning the work is already done.
  - Unique keys for idempotency: `Charge.idempotencyKey`, `ChargeAttempt.txRef`, `LedgerEntry.idempotencyKey`, `WebhookEvent.providerEventKey`, `Notification.dedupeKey`, `ActivityEvent.dedupeKey` and `Outbox.sourceKey`. In a job, a unique violation (Prisma `P2002`) on the job's own key means "already done". The job returns success and writes nothing more.

- **DB-12. Transactions are short and local** (A-5, A-6). One transaction touches one database. Inside a transaction, never call Flutterwave, Expo push, Resend or any HTTP service, never add a BullMQ job and never wait on a timer. Add jobs after commit, from the outbox. Every write that must happen together, such as a state change and its `Outbox` row, runs in one `$transaction` on the primary.

- **DB-13. Nothing depends on a session** (L-11, L-31). PgBouncer runs in transaction mode, so a connection is not yours between transactions. Never use `SET` without `LOCAL`, session advisory locks (`pg_advisory_lock`), `LISTEN` or `NOTIFY`, temporary tables that outlive one transaction, or `WITH HOLD` cursors. `SET CONSTRAINTS shift_no_overlap DEFERRED` is allowed because it lasts only for its transaction (B-36). Keep `?pgbouncer=true&connection_limit=15&pool_timeout=10` on every pooled URL.

## 4. Deletes

- **DB-14. Hard deletes happen only where PRD 6.2 says so.** Only `maintenance.cleanup` and `maintenance.purge-team` delete rows, and only the rows their PRD 6.2 entries list. Everything else uses the soft-delete or status columns the schema already has (`deletedAt`, `revokedAt`, `disabledAt`, `status`).

- **DB-15. Billing history is never deleted** (B-12, B-48). `maintenance.purge-team` deletes the team's shard rows, memberships and invites. It never deletes the `Team` row, `Subscription`, `PaymentMethod`, `Charge`, `ChargeAttempt`, `LedgerEntry` or `WebhookEvent` rows, which reference the team with `onDelete: Restrict`. Never change a `Restrict` on a billing relation to `Cascade` or `SetNull`. No endpoint or job deletes a `User` row. The PRD has no account deletion.
