---
trigger: model_decision
description: Use when a task seems to need a file, adds a field users type into, changes Compose volumes, or stores data in Redis, a container, an email or on the phone.
---

# Uploads and storage

Rota v1 has no file uploads: the PRD v1.1 has no photos, attachments, documents, CSV import or export, or PDF receipts. Users store only short text. This file says what not to build and where each kind of data may live. Ids like (B-46) point to AGENTS.md, FR- and PRD ids to the PRD v1.1.

## 1. Files

- **UP-1. Build no upload or download path** (B-50, B-51, AGENTS 7.4). No `multipart/form-data` route, presigned URL, object storage of any kind, or Compose service for files. `apps/mobile` never imports `expo-image-picker`, `expo-document-picker` or `expo-file-system`. Routes accept only `application/json` bodies within L-36. If a task seems to need a file (a photo, an export, a receipt), it is new scope: stop and ask. Why: an upload path needs storage, limits and scanning the PRD never designed.
- **UP-2. Emails carry no attachments** (B-44). Invite, reset and billing emails are text and HTML only. Never generate a PDF or attach a file. Why: the PRD has no document generation, and an attachment would be new scope.

## 2. Server storage

- **UP-3. API and worker write nothing to local disk at runtime** (A-11). Logs go to stdout through pino. No log files, upload folders, disk caches or SQLite in a container. Why: `api` runs as 2 replicas in the load test (PRD 7.1) and containers are rebuilt on deploy, so a local file is lost or seen by one replica only.
- **UP-4. Postgres and Redis use named volumes.** In `infra/docker-compose.yml`, each of the four Postgres services and `redis` mounts a named volume for its data directory. Redis runs with AOF persistence and `maxmemory-policy noeviction` (PRD 9). Why: BullMQ's delayed jobs live only in Redis (quiet-hours deliveries, `notify.release`, the `billing.grace-step` retries), so losing Redis data drops payment retries and the read-only step.
- **UP-5. Never destroy data volumes outside local development.** `docker compose down -v`, `docker volume rm` and `docker volume prune` never appear in CI, a demo host script or the README's demo host steps. A local reset script may remove local volumes only if its name and the README mark it local only. Why: the volumes hold the only copy of the data (UP-6).
- **UP-6. Add no backups or storage service.** No `pg_dump` cron, backup container or cloud bucket. Why: L-19 fixes the services and the PRD defines no backup, so this is an open question for Rox, not something to fix yourself.

## 3. What each store may hold

- **UP-7. Redis holds only PRD 7.3 keys and BullMQ data.** Keys: `perm:`, `team:`, `idem:`, `rl:`, `ryow:`, `replica:lag:` and BullMQ's own. Never a password, access or refresh token, or card data. Idempotency replay (B-33) never stores an `/auth/*` response. BullMQ job data holds only the inputs PRD 6.2 lists. Two places may hold a link token because the PRD requires it: the replay of `POST /teams/:teamId/invites` (FR-09 returns the link, kept 24 h by PRD 7.3) and the `vars` of an `email.send` job (PRD 6.2). Why: Redis is not encrypted at rest, so anything secret in it widens a leak.
- **UP-8. Raw link tokens live in as few places as possible** (B-28). A raw invite or reset token exists only in the request that created it, the create-invite response and its replay, the `email.send` job data, and the `link` in `EmailMessage.vars` (PRD 10). Never in an `Outbox` payload, log, notification, feed event or any other column. Why: every stored copy is a usable link.
- **UP-9. Text limits match the columns** (PRD 10). Each user-entered string has a Zod `.max()` equal to its column: `User.displayName` 80, `Team.name` 80, `Shift.position` 60, `Shift.location` 100, `Shift.notes` 500, `SwapRequest.message` 280, `SwapRequest.decisionNote` 280, `RefreshToken.deviceName` 100. The notes field keeps the B-45 hint. Why: a too-long value must get `400 VALIDATION_FAILED`, not a database error and a `500`.
- **UP-10. The phone holds three stores and nothing else** (L-3, L-5, A-12, B-46, PRD 7.7). expo-secure-store: the refresh token. AsyncStorage: the persister data (`['me','shifts','offline']`, `['me','settings']`), the active team id and the last user id. No files, SQLite, MMKV, saved logs or server data outside the persister. Why: a lost phone exposes whatever is on it, and logout (B-46) can only wipe stores it knows about.