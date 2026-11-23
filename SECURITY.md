# SECURITY.md: Threat Model & Security Architecture

This document defines the security boundaries, threat mitigation strategies, and configuration audits for the Rota shift scheduling platform.

---

## 1. Public Environment Variable Audit (Zero Secrets in Bundle)

Any constant prefixed with `EXPO_PUBLIC_` is baked directly into the compiled JavaScript bundle and is extractable by anyone inspecting the APK or IPA binaries.

| Variable                 | Value                                                   | Purpose                      | Why Safe to Expose                                                                                                  |
| ------------------------ | ------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`    | `http://localhost:3000/v1` (or production HTTPS origin) | Base URL for API requests    | Public DNS endpoint; contains zero credentials, signing secrets, or private keys.                                   |
| `EXPO_PUBLIC_PROJECT_ID` | `c902db9e-8f9d-4f89-8257-bf903270dc6b`                  | EAS Cloud Project Identifier | Public build metadata identifier; cannot be used to trigger builds or authenticate requests without EAS CLI tokens. |

**Zero Sensitive Keys**:

- `JWT_SECRET` exists strictly on the server (`apps/api/.env`).
- `FLW_SECRET_KEY` and `FLW_SECRET_HASH` exist strictly on the server.
- `CARD_ENCRYPTION_KEY` exists strictly on the server.
- Database credentials exist strictly on the server.

---

## 2. Threat Modeling: 8 Critical Threats & Mitigations

### Threat 1: Reverse Engineering of Mobile Client & Token Extraction

- **Risk**: An attacker unzips the compiled application package (APK/IPA) and searches for API tokens, secret keys, or hardcoded passwords.
- **Mitigation**:
  - No secret keys are stored in the client codebase or client environment variables.
  - Access tokens are stored strictly in volatile JavaScript runtime memory (`inMemoryAccessToken`) and are never written to disk.
  - Refresh tokens are stored exclusively in hardware-backed secure storage via `expo-secure-store` (iOS Keychain / Android Keystore with AES-GCM), never in unencrypted `AsyncStorage`.

### Threat 2: Refresh Token Theft & Replay Attacks

- **Risk**: A compromised device or stolen refresh token allows persistent unauthorized account access.
- **Mitigation**:
  - Refresh tokens are rotated on **every single use** (Rule L-33, FR-04).
  - The server maintains a strict 30-second grace window to absorb concurrent in-flight requests.
  - If an already-rotated refresh token is reused outside the grace window, the server detects token theft, marks the entire family compromised, and invalidates all tokens associated with the session.
  - Users can invoke "Log out of all devices" (`POST /v1/auth/logout-all`), immediately terminating all active sessions in the database.

### Threat 3: Broken Object Level Authorization (BOLA / Multi-Tenant Data Leakage)

- **Risk**: An attacker on Team A crafts requests with IDs belonging to Team B to inspect or modify shifts, member lists, or billing records.
- **Mitigation**:
  - Multi-tenant isolation is enforced on every query at the database layer (Rule B-19).
  - Every route is wrapped in `withApi` which resolves the user's active membership and tenant scope before invoking business logic.
  - Queries against non-existent teams or teams where the caller is not an active member return `404 NOT_FOUND` (never `403`), preventing team enumeration.
  - Verified by 12 comprehensive tenant-scoping integration tests in `apps/api/tests/unit/tenant-scope.test.ts`.

### Threat 4: Unauthorized Privilege Escalation via API Manipulation

- **Risk**: A user with `STAFF` role sends raw HTTP requests (via Postman or curl) to endpoints like `DELETE /v1/teams/:id/shifts/:id` or `POST /v1/teams/:id/billing/plan`.
- **Mitigation**:
  - Client UI role checks are purely cosmetic. Every API endpoint enforces strict role-based access control (RBAC) via `withApi({ roles: [Role.OWNER, Role.MANAGER] })`.
  - A `STAFF` member attempting to delete a shift receives an immediate `403 FORBIDDEN` from the server.
  - Verified by tests in `apps/api/tests/unit/route-auth.test.ts` and `apps/api/tests/integration/shifts/shifts.test.ts`.

### Threat 5: Webhook Spoofing & Replay Attacks

- **Risk**: An attacker sends forged payment success webhooks to mark delinquent subscriptions as paid.
- **Mitigation**:
  - The Flutterwave webhook endpoint verifies `verif-hash` header against `FLW_SECRET_HASH` using **constant-time string comparison** (`crypto.timingSafeEqual`) to prevent timing attacks (Rule B-10).
  - On signature mismatch, the server returns `401 WEBHOOK_SIGNATURE_INVALID` and records nothing.
  - On match, the raw event is stored in `webhook_event` with unique idempotency constraints on `eventId`.
  - The server verifies transaction legitimacy via an outbound server-to-server call to `GET /v3/transactions/{id}/verify` matching `tx_ref`, currency `USD`, status `successful`, and exact integer cents before recording payment in the append-only ledger.

### Threat 6: Brute Force & Denial of Service Attacks

- **Risk**: Attackers attempt credential stuffing against the login endpoint or spam password reset emails.
- **Mitigation**:
  - Sliding-window Redis rate limiters protect every public entry point (Rule L-34, PRD 7.10):
    - `POST /v1/auth/login`: 5 attempts per 15 minutes per email and IP address pair.
    - `POST /v1/auth/password-reset/request`: 3 requests per hour per email.
    - General authenticated requests: 120 per minute per user.
    - Webhook receiver: 300 per minute per IP.
  - Rate-limited responses return `429 RATE_LIMITED` with standard `Retry-After` HTTP headers.

### Threat 7: Mass Assignment & Malformed Payload Exploits

- **Risk**: Attackers submit payloads containing injected fields (e.g. `role: 'OWNER'`, `status: 'PAID'`, SQL fragments).
- **Mitigation**:
  - Every incoming request body is validated using Zod with **`.strict()`** mode enabled (Rule L-8).
  - Unrecognized fields are rejected with `400 VALIDATION_FAILED` before entering domain services or database queries.
  - Prisma 6 parameterized queries and prepared statements prevent SQL injection across all primary and replica database instances.

### Threat 8: Card Token Leakage & PCI Non-Compliance

- **Risk**: Card tokens or customer billing credentials leak through database logs, error traces, or unencrypted backups.
- **Mitigation**:
  - The application stores **zero raw card numbers, CVVs, or expiration dates**; all checkout transactions use Flutterwave hosted payment pages.
  - Returned payment method authorization tokens are encrypted at rest using **AES-256-GCM** with unique initialization vectors (`iv`) and authentication tags (`authTag`) before being written to PostgreSQL (Rule B-17).
  - Logging libraries (`pino`) explicitly redact authorization headers, tokens, and billing fields.
