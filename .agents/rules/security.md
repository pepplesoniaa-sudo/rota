---
trigger: model_decision
description: Use when touching authentication, a route's auth or roles, secrets and env config, logging, error responses, the invite or reset pages, the Flutterwave webhook route, Caddy or Compose ports.
---

# Security

AGENTS.md B-18 to B-33 set the main security rules. This file says how to build them so they hold. Ids like (B-19) point to AGENTS.md, FR- and PRD ids to the PRD v1.1.

## 1. Who may call what

- **SEC-1. Every route declares its auth; public routes are a closed list** (B-18, PRD 7.2). `withApi` has no default for `auth`. Only these are `public`: `POST /auth/register`, `POST /auth/login`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, `GET /invites/:token`, `GET /healthz`, `GET /readyz`. `POST /auth/refresh` uses `refresh`, the webhook uses `webhook`, and `POST /invites/:token/accept` needs an access token. A test lists every route's `auth` and fails on any difference from PRD 7.2. Why: with no default, a forgotten value fails the build instead of opening a route.
- **SEC-2. A role-matrix test covers every team route** (PRD 5.1). Besides the non-member isolation suite (B-20), a table-driven test calls every `:teamId` route as `OWNER`, `MANAGER` and `STAFF` and asserts the PRD 5.1 status. It also covers a read-only team (B-14) and a deleted team, which returns `404 NOT_FOUND` for everyone (FR-14). Why: permissions are checked per route, so only a full matrix catches one wrong route.
- **SEC-3. Access tokens are verified one way** (L-15). Use `jose` `jwtVerify` with `algorithms: ['HS256']` fixed in code. Pick the secret by the `kid` header, current or previous (PRD 7.9). Reject an unknown `kid`, missing `exp` or missing `sub` with `401`. Read only `sub`; load roles from the membership on every request. Why: trusting the token's own `alg` lets forged tokens through, and roles in a token outlive a role change.

## 2. Secrets

- **SEC-4. Secrets are checked at startup** (A-16, B-17). `lib/config/env.ts` rejects a missing value, a JWT secret under 32 bytes, a card-token key that does not decode to exactly 32 bytes, a Flutterwave secret key not starting `FLWSECK_TEST-` and a public key not starting `FLWPUBK_TEST-`. Why: a bad secret stops the process at boot instead of on the first request; HS256 needs a key at least as long as its 32-byte hash (RFC 7518), AES-256 needs exactly 32 bytes, and the prefixes make a live key unable to run.
- **SEC-5. Card tokens are encrypted correctly** (B-17). AES-256-GCM from `node:crypto` with a fresh random 12-byte IV per encryption, never fixed or derived. Store IV, auth tag and ciphertext together in `providerTokenEncrypted`. Decrypt only in `lib/billing/flutterwave/`, just before a tokenized charge. Never put a card token, encrypted or not, in a response, job data, log or notification; jobs carry `chargeId`. Why: a reused GCM IV exposes plaintext and lets tags be forged.
- **SEC-6. Nothing secret in the bundle** (B-31, CS-6). Never put a secret in `extra`, an `EXPO_PUBLIC_*` variable or a test fixture the app bundles. Why: anyone with the app can read everything in its bundle.

## 3. Tokens in links

- **SEC-7. Landing pages never consume their token** (PRD 7.9). `/i/[token]` and `/r/[token]` only try to open `rota://invite/{token}` or `rota://reset/{token}` and show install steps, without calling the database or API. `GET /invites/:token` only reads. Only `POST /invites/:token/accept` and `POST /auth/password-reset/confirm` consume a token. The pages load no third-party scripts, fonts or images. Why: email scanners and link previews open links, and must not use up a single-use token or leak it to a third party.
- **SEC-8. Tokens in URLs are never logged** (B-28). Caddy's access log replaces the token segment of `/i/*` and `/r/*`. Neither the API nor the app logs a deep link URL. Why: a logged token is a working link until it expires (L-33).

## 4. The webhook

- **SEC-9. Signature before anything else** (B-10, FR-42). In `POST /webhooks/flutterwave`, in order: rate limit; reject a body over the L-36 limit without reading the rest; read the raw body as text; hash `verif-hash` and `FLW_SECRET_HASH` with SHA-256 and compare digests with `crypto.timingSafeEqual`; only then parse with Zod; store; return `200`. On a mismatch, log one line with no headers or body and return `401 WEBHOOK_SIGNATURE_INVALID`. Why: unsigned bodies must never reach the parser, and hashing first gives equal lengths so the compare never throws or leaks timing.

## 5. Logs and errors

- **SEC-10. Logs hold no secrets or card data** (B-32). Add `newPassword` and `verif-hash` to the B-32 redaction list. Never log a request body for `/auth/*` or the webhook; for a webhook, log only the stored event id, type and `tx_ref`. Why: log storage is not protected like the database.
- **SEC-11. Error responses show no internals** (B-52). In production a `500` has a fixed generic `message`. No response carries a stack trace, Prisma or Postgres error, SQL, provider response or file path; log those with the request id. Why: internals help an attacker map the system.

## 6. Network exposure

- **SEC-12. Only Caddy is public** (L-19). In `infra/docker-compose.yml`, only `caddy` publishes ports on all interfaces (80 and 443). Any other published port binds to `127.0.0.1`. Why: the demo host runs the same file, so this keeps databases, Redis and the API off the internet while local tests can still reach them.
- **SEC-13. Client IP comes from Caddy** (L-34). Rate limits use the last `X-Forwarded-For` entry, the one Caddy appended, and ignore earlier ones. Why: the client writes the earlier entries and could fake them to dodge limits; SEC-12 ensures every request passes Caddy.