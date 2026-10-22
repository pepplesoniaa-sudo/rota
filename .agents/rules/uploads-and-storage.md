# Uploads and storage

Rules for files and for every place Rota keeps data: request bodies, the API and worker containers, Postgres and Redis volumes, Redis keys, emails, and the phone. Read this file before any task that adds a field users type into, changes `infra/docker-compose.yml`, stores something in Redis or on the device, or seems to need a file.

**How this file relates to AGENTS.md.** It adds detail to AGENTS.md and never relaxes it. Ids such as (B-46) point to AGENTS.md. `FR-` and `PRD` ids point to the PRD v1.1. If this file seems to disagree with AGENTS.md or the PRD, they win: stop and ask (AGENTS section 7).

**Rota v1 has no file uploads.** The PRD v1.1 has no profile photos, avatars, shift attachments, documents, image messages, CSV import or export, or PDF receipts or invoices. The only content users store is short text: names, positions, locations, shift notes and swap messages. So this file mostly says what not to build, and protects the storage Rota does have.

**Every numbered rule here is a failure rule.** Breaking one means the task failed even if the code builds, the tests pass and the feature works. Cite the ids you checked in your task report.

---

## 1. Files

- **UP-1. Build no upload or download path** (B-50, B-51, AGENTS 7.4). No `multipart/form-data` route, presigned URL, object storage (S3, R2, GCS, Supabase Storage, Cloudinary, MinIO or any other), new Compose service for files, or file and image picker in the app (`expo-image-picker`, `expo-document-picker`, or `expo-file-system` used for user files). Every API route accepts only `application/json` bodies within the L-36 limits: 100 KB, and 1 MB for the webhook. If a task seems to need a file, such as a profile photo, a schedule export or a PDF receipt, it is new scope: stop and ask.

- **UP-2. Emails carry no attachments.** Invite, reset and billing emails are text and HTML only (B-44). Receipt and billing emails show amounts the server computed (B-15). Never generate a PDF or attach any file.

## 2. Server storage

- **UP-3. The API and worker write nothing to local disk at runtime** (A-11). `api` runs as 2 replicas behind Caddy in the load test (PRD 7.1), and containers are rebuilt on deploy, so a local file is lost or seen by only one replica. Logs go to stdout through pino. There are no log files, upload folders, disk caches or SQLite files in a container.

- **UP-4. Postgres and Redis keep their data on named volumes.** In both Compose files, each of the four Postgres services and `redis` mounts a named Docker volume for its data directory. Redis runs with AOF persistence on and `maxmemory-policy noeviction` (PRD 9). BullMQ's delayed jobs live only in Redis: quiet-hours deliveries, `notify.release` and the `billing.grace-step` jobs on days 1, 3, 5 and 7. Losing Redis data drops payment retries and the read-only step.

- **UP-5. Never destroy data volumes outside local development.** `docker compose down -v`, `docker volume rm` and `docker volume prune` never appear in CI, in a demo host script or in the README's demo host steps. A local reset script may remove local volumes, but only if its name and the README mark it as local only.

- **UP-6. Do not add backups or a storage service.** The PRD defines no backup job, and L-19 fixes the Compose services. Do not add `pg_dump` cron jobs, a backup container or a cloud bucket. This is an open question for Rox, not something to fix yourself.

## 3. What each store may hold

- **UP-7. Redis holds only PRD 7.3 keys and BullMQ data.** The only Redis keys are `perm:`, `team:`, `idem:`, `rl:`, `ryow:`, `replica:lag:` and BullMQ's own keys. Redis never holds a password, an access or refresh token, or card data. Idempotency replay (B-33) never stores a response from an `/auth/*` route, because those responses carry tokens. BullMQ job data holds only the inputs PRD 6.2 lists for that job. Two places may hold a link token, because the PRD requires them: the stored replay of `POST /teams/:teamId/invites` (FR-09 returns the invite link, and PRD 7.3 keeps replays for 24 hours), and the `vars` of an `email.send` job (PRD 6.2 lists `vars` as an input).

- **UP-8. On the server, raw tokens live in as few places as possible** (B-28). A raw invite or reset token exists only in: the request that created it, the create-invite response and its Redis replay, the `email.send` job data (UP-7), and the `link` value in `EmailMessage.vars` that `email.send` sends (PRD 10). It never appears in an `Outbox` payload, a log line, a notification, a feed event or any other column. Every token table stores only the SHA-256 hash.

- **UP-9. Text limits match the columns.** Each user-entered string has a Zod `.max()` equal to its column length: `User.displayName` 80, `Team.name` 80, `Shift.position` 60, `Shift.location` 100, `Shift.notes` 500, `SwapRequest.message` 280, `SwapRequest.decisionNote` 280, `RefreshToken.deviceName` 100. A value that is too long gets `400 VALIDATION_FAILED`, never a database error and a `500`. The notes field keeps the "Do not enter patient information" hint (B-45).

- **UP-10. The phone holds three stores and nothing else** (L-3, L-5, A-12, B-46, PRD 7.7). expo-secure-store holds the refresh token only. AsyncStorage holds the TanStack Query persister data (`['me','shifts','offline']` and `['me','settings']`), the active team id and the last user id. Nothing else is written to the device: no files, no SQLite, no MMKV, no saved logs, no cached server data outside the persister. On logout, delete what B-46 lists.
