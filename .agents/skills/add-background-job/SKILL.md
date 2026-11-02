---
name: add-background-job
description: Use when you add one job from the PRD 6.2 queue and job table to the worker.
---

# Add a background job

## Prepare

1. Find the job's row in PRD 6.2. Copy its queue, job, trigger, inputs, outputs, retry policy, idempotency key and failure handling into your notes. Check: all eight are filled from the row and none is invented.
2. If an `Outbox` row triggers the job, confirm `outbox.sweep` exists. If it does not, build `outbox.sweep` first with this skill. Check: `apps/api/worker/jobs/outbox/sweep.ts` exists.

## Build

3. Add the job to `apps/api/worker/queues.ts` with the row's queue name, job name, attempts, backoff, `removeOnComplete` and `removeOnFail` (L-35). Check: every value matches the PRD 6.2 row exactly.
4. Write a function that builds the job's `jobId` from the row's idempotency key format. Check: a unit test builds the key from sample inputs and gets the PRD format.
5. Define the job data as a `.strict()` Zod schema that holds only the row's inputs (UP-7, SEC-5). Check: the schema has no field outside the Inputs column.
6. If an event triggers the job, write the producer. In the transaction that makes the change, insert one `Outbox` row with `kind` set to the job name. Add the job only after commit (A-5, A-6, DB-12). Check: no `queue.add` call sits inside a `$transaction` callback. For a notification, use `add-notification-trigger` instead of this step.
7. If the job is repeatable, register its schedule in `apps/api/worker/index.ts` from the Trigger column (L-13). Check: the interval or cron time matches the row.
8. Write the handler at `apps/api/worker/jobs/<queue>/<job>.ts`. Parse the data with the step 5 schema. Run in the `system` tenant scope (B-20). Call one function in `lib/domain` or `lib/billing` (A-3, A-4). Check: the handler file contains no Prisma query.
9. In that function, guard the write with the unique Postgres key the row names. Treat `P2002` on that key as done (DB-11). Check: the key in the code is the one in the row's idempotency column.
10. Handle failure as the row's failure column says. Let unexpected errors throw (CS-11). For `billing.charge`, apply MB-7. For `maintenance.cleanup` and `maintenance.purge-team`, delete only what DB-14 and DB-15 allow. Check: no `catch` block returns success for an unexpected error.

## Test

11. Write an integration test that runs the job once and asserts the Outputs column (S-16, S-17). Check: the test uses the Compose Postgres and Redis and mocks only Flutterwave, Expo push or Resend.
12. Write a test that runs the job twice with the same input. Check: the second run writes no row and ends as a success.
13. If the job has a producer, write a test that loses the job after commit and then runs `outbox.sweep`. Check: the job runs exactly once.
