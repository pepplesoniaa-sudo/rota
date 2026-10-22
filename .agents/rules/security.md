# Security

Rules for authentication, authorization, secrets, logging, network exposure and the webhook endpoint, in the API, the worker, the mobile app and `infra/`. Read this file before any task that touches `lib/auth`, `lib/api`, `lib/config`, `lib/log.ts`, a route's `auth` or `roles`, the invite or reset pages, the webhook route, `infra/caddy` or `infra/docker-compose.yml`.

**How this file relates to AGENTS.md.** AGENTS.md B-18 to B-33 already set the main security rules. This file adds how to build them so they hold, and never relaxes them. Ids such as (B-19) point to AGENTS.md. `FR-` and `PRD` ids point to the PRD v1.1. If this file seems to disagree with AGENTS.md or the PRD, they win: stop and ask (AGENTS section 7).

**Every numbered rule here is a failure rule.** Breaking one means the task failed even if the code builds, the tests pass and the feature works. Cite the ids you checked in your task report.

---

## 1. Who may call what

- **SEC-1. Every route declares its auth, and public routes are a closed list** (B-18, PRD 7.2). `withApi` has no default for `auth`. Only these routes may be `public`: `POST /auth/register`, `POST /auth/login`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `GET /invites/:token`, `GET /healthz` and `GET /readyz`. `POST /auth/refresh` uses `refresh`, `POST /webhooks/flutterwave` uses `webhook`, and `POST /invites/:token/accept` needs an access token. A test lists every route file with its `auth` value and fails if any value differs from PRD 7.2.

- **SEC-2. A role matrix test covers every team route** (B-18, PRD 5.1). Besides the isolation suite for non-members (B-20), a table-driven test calls every `:teamId` route as `OWNER`, `MANAGER` and `STAFF` and asserts the status PRD 5.1 gives each role. It also covers a read-only team (B-14) and a deleted team, which returns `404 NOT_FOUND` for everyone (FR-14).

- **SEC-3. Access tokens are verified one way** (L-15, B-18). Use `jose` `jwtVerify` with `algorithms: ['HS256']` fixed in code. Select the secret by the `kid` header, either current or previous (PRD 7.9). Reject an unknown `kid`, a missing `exp` or a missing `sub` with `401`. Read only `sub` from the token. Load roles from the membership on every request.

## 2. Secrets

- **SEC-4. Secrets come from the environment and are checked at startup** (A-16). `lib/config/env.ts` rejects a missing value, a JWT secret shorter than 32 bytes, and a card-token key that does not decode to exactly 32 bytes. It also rejects a Flutterwave secret key that does not start with `FLWSECK_TEST-` and a public key that does not start with `FLWPUBK_TEST-`, so a live key cannot run (B-17). `.env.example` lists every variable with a placeholder.

- **SEC-5. Card tokens are encrypted correctly** (B-17, PRD 7.10). Use AES-256-GCM from `node:crypto` with a fresh random 12-byte IV for every encryption. Never reuse an IV and never use a fixed or derived one. Store the IV, the auth tag and the ciphertext together in `providerTokenEncrypted`. Decrypt only inside `lib/billing/flutterwave/`, just before a tokenized charge. Never put a card token, encrypted or not, in an API response, a job's data, a log line or a notification. Jobs carry `chargeId` and look the method up.

- **SEC-6. The app holds no secrets** (B-31). Never put a key, secret, database URL or Redis URL in `app.config.ts`, `extra`, an `EXPO_PUBLIC_*` variable, the app source or a test fixture the app bundles.

## 3. Tokens in links

- **SEC-7. Invite and reset pages never consume their token** (PRD 7.9). `/i/[token]` and `/r/[token]` only try to open `rota://invite/{token}` or `rota://reset/{token}` and show install instructions. They never call the database or the API with the token. `GET /invites/:token` only reads the invite and never marks it used. Only `POST /invites/:token/accept` and `POST /auth/password-reset/confirm` consume a token, so email link scanners and link previews cannot use up a single-use link. The pages load no third-party scripts, fonts or images.

- **SEC-8. Tokens in URLs are never logged** (B-28). Configure Caddy's access log to replace the token segment of `/i/*` and `/r/*` paths. Neither the API nor the app logs a deep link URL. The `Referrer-Policy: no-referrer` header stays on every response (PRD 7.10).

## 4. The webhook

- **SEC-9. Check the signature before anything else** (B-10, FR-42). In `POST /webhooks/flutterwave`, in this order: apply the webhook rate limit; reject a body over 1 MB without reading the rest; read the raw body as text; compare `verif-hash` to `FLW_SECRET_HASH` by hashing both with SHA-256 and comparing the digests with `crypto.timingSafeEqual`, so values of different lengths never throw or leak timing; only then parse the JSON with its Zod schema; store the event; return `200`. On a mismatch, write one log line with no headers and no body, then return `401 WEBHOOK_SIGNATURE_INVALID`.

## 5. Logs and errors

- **SEC-10. Logs never hold secrets or card data** (B-32). The pino redaction list includes `password`, `newPassword`, `token`, `refreshToken`, `authorization`, `verif-hash` and every card field. Never log a request body for `/auth/*` routes or the webhook. For a webhook, log only the stored event id, event type and `tx_ref`.

- **SEC-11. Error responses never show internals** (B-52). In production builds, a `500` response's `message` is a fixed generic sentence. No response includes a stack trace, a Prisma or Postgres error, SQL, a provider response or a file path. Log the details with the request id instead.

## 6. Network exposure

- **SEC-12. Only Caddy is public** (L-19). In the demo host's Compose file, only `caddy` publishes ports, 80 and 443. `api`, `worker`, `pgbouncer`, the four Postgres services and `redis` publish no ports. `mailpit` and `bull-board` do not run there. In the local Compose file, any published port other than Caddy's binds to `127.0.0.1`.

- **SEC-13. Client IP comes from Caddy only** (L-34). Rate limits key on the client IP that Caddy adds. The API takes the last `X-Forwarded-For` entry, the one Caddy appended, and ignores any earlier entries the client sent. SEC-12 makes this safe, because nothing can reach the API without going through Caddy.
