---
name: add-notification-trigger
description: Use when an event must send one NotificationType to its recipients through notify.fanout.
---

# Add a notification trigger

## Prepare

1. Confirm `notify.fanout` and `notify.deliver` exist. If they do not, build them first with `add-background-job`. Check: both handler files exist in `apps/api/worker/jobs/notify/`.
2. Find the type's recipients in FR-27, or in FR-22, FR-25, FR-39, FR-40, FR-45 or PRD 8.4 when that line names the trigger. Write them down. Check: you can quote a PRD line for every recipient.
3. Find the `UserSettings` toggle that controls the type. If no toggle fits, stop and ask Rox (AGENTS.md 7.3). Check: your notes name the toggle, or your report holds the question.

## Build

4. Write a function that builds the `sourceKey` from the PRD 6.2 `notify.fanout` format for this source. Check: a unit test builds the key and gets the PRD format.
5. In the transaction that makes the change, insert one `Outbox` row with `kind` set to `notify.fanout` and the step 4 key (A-5). Check: an integration test rolls back the change and finds no `Outbox` row.
6. Add the type's case to the recipient switch in `notify.fanout`. Leave out the actor (B-41). For a publish, apply B-42. Check: `pnpm lint` passes with the exhaustiveness check (CS-3).
7. Write the title and body. Check: the title is at most 80 characters and the body at most 240 (PRD 10).
8. Write `data` with the deep link target and the `invalidate` query keys (PRD 7.3). Parse it with the `Notification.data` schema (DB-3). Check: `data` holds no token, secret or patient text (B-44, UP-8).
9. Set `scheduledFor` with the quiet-hours helper in `apps/api/lib/time/` (B-40, B-43). Check: the case calls the helper and does no time math of its own.
10. If the type also sends an email, confirm the PRD names email for this trigger (B-44, UP-2). Check: the email template is an invite, reset or billing template.

## Test

11. Test the recipients. Check: each recipient from step 2 gets exactly one `Notification` row and the actor gets none.
12. Run the fanout twice for the same `sourceKey`. Check: each recipient still has exactly one row (DB-11).
13. Test a recipient inside quiet hours. Check: their `scheduledFor` equals their quiet end in their own time zone.
14. In `apps/mobile/tests/`, send a foreground push of this type. Check: the queries in its `data.invalidate` keys are invalidated (PRD 7.3).
