---
trigger: model_decision
description: Use for any code that computes, stores, shows, charges or records money, including lib/billing, billing.* jobs, seat counts, invite acceptance and plan changes.
---

# Money and billing

How to build AGENTS.md B-1 to B-17 and PRD section 8 so they hold. Ids like (B-9) point to AGENTS.md.

## 1. Where money code lives

- **MB-1. One home for each money job.** Prices only in `lib/billing/pricing.ts` (B-4), proration only in `proration.ts` (B-5), Flutterwave calls only in `flutterwave/`. Ledger rows come from one function in `ledger.ts`; a test fails if `ledgerEntry.create` appears elsewhere. Cents become display text only through `formatUsd(cents)` in `packages/shared/src/money.ts`. Why: a second copy drifts from the first.
- **MB-2. Pricing and proration are pure.** `monthlyPrice` and `prorationCents` take every input, including the change instant and period bounds, as arguments and never read the clock, database or environment. The caller reads server time once, truncated to the second (PRD 8.2). The B-5 tests call them directly. Why: tests can pass any instant, and device time never sets a price.

## 2. Numbers

- **MB-3. Safe integers, and only BigInt divides** (B-1). Amounts pass `z.number().int()`, and each exported money function throws unless every amount passes `Number.isSafeInteger`. In `lib/billing/**` and `money.ts`, lint bans `parseFloat`, `.toFixed`, `Math.round`, `Math.ceil`, `Math.floor`, and the `/` operator in every file except `proration.ts`, where `/` divides only `BigInt` values (ms to seconds, and the product, which floors as PRD 8.2 asks). Never pass provider data through `Number(...)` or `parseInt`. Why: past 2^53 or after float division, cents go silently wrong.
- **MB-4. Provider amounts are strings** (B-2's `amountCents / 100` means this string math). `centsToProviderAmount(7100)` returns `"71.00"` by inserting a point into the padded digits. `providerAmountToCents` accepts only a string matching `^\d+(\.\d{1,2})?$` (take `String(value)` of a JSON number first) and builds cents from the digits; exponents and negatives are rejected. Never multiply or divide a provider amount by 100. Why: `71.1 * 100` is `7109.999999999999` in JavaScript.

## 3. Payment truth

- **MB-5. Only the verify response decides a payment** (B-9, PRD 8.5). The webhook body, the checkout redirect URL's `status` and `tx_ref`, the app and test helpers never mark a charge paid. After checkout the app refetches billing and shows "Payment processing" (FR-35). Why: the redirect and an unverified body can be forged.
- **MB-6. Exact match, or nothing changes.** If any B-9 check fails (cents vs `ChargeAttempt.amountCents`, `tx_ref` vs `ChargeAttempt.txRef`, currency `USD`, status `successful`), change no charge, attempt, ledger or subscription row. Set the `WebhookEvent` to `FAILED` with expected and received values in `error`, and log the event id. Why: a partial update leaves state no later event can repair.
- **MB-7. A timeout counts as accepted** (B-11). In `billing.charge`, commit the new `ChargeAttempt` before calling Flutterwave. Retry only when the request provably never left (DNS failure, refused connection). A timeout or any HTTP response sets the attempt to `PROCESSING` for the webhook or `billing.reconcile`. Why: after a timeout the card may already be charged.

## 4. Writing it down

- **MB-8. One transaction per money change** (B-12, A-6). A confirmed payment commits in one shard 0 transaction, or not at all: attempt update, conditional `PAID` (B-11), `PAYMENT_CONFIRMED`, each collected deferred charge set `PAID` with `collectedByChargeId`, subscription status, `WebhookEvent.status = PROCESSED`, notification `Outbox` rows. A new `Charge` and its `CHARGE_*` entry also commit together. Why: a crash between steps leaves a paid charge with no ledger entry, or the reverse.
- **MB-9. Ledger keys come from the source event** (A-5, PRD 9, `docs/decisions.md` 2026-11-01). Never random. `PAYMENT_CONFIRMED`: `payment:{providerTxId}`. The three `CHARGE_*` types: `charge:{chargeId}`. `PAYMENT_FAILED`: `payment-failed:{chargeAttemptId}` for a verified failure or decline, `payment-failed:overdue:{chargeId}` for an overdue charge. `REFUND_ISSUED`: `refund:{providerRefundId}`. `REVERSAL`: `reversal:{reversedEntryId}`. Why: a retry must produce the same key, or it writes a second entry.
- **MB-10. Charge amounts add up.** A charge's `amountCents` equals the sum of its `lineItems[].amountCents`, and a renewal's `CHARGE_SUBSCRIPTION` entry equals its plan-price line only (B-12). A test checks both on every test charge. Why: the ledger and the charges list must agree.
- **MB-11. Balance tests prove the ledger.** Each billing scenario test ends by asserting the team's `SUM(amount_cents)`. Required: the PRD 8.4 worked check (+87, +5000, −5087, balance 0); one webhook delivered 3 times (one `PAYMENT_CONFIRMED`); two successful attempts on one charge (`DOUBLE_PAYMENT`); a refund and its `REVERSAL` (balance 0, PRD 8.7). Why: it exposes a missing or doubled entry.

## 5. Seats and plan changes

- **MB-12. Count seats on the primary, inside the transaction** (B-7, PRD 8.1). Count active seats in the transaction that changes membership or plan, never from the permission cache, a replica or the app. Why: the cache and replica lag behind writes.
- **MB-13. Serialize seat and plan changes per team.** In any transaction that can change active seats, `paidSeats` or the plan (such as invite acceptance or a plan change), the first write increments the team's `Subscription.version`. Why: that row lock runs them one at a time; without it two acceptances on a 4-seat Starter team can reach 6 (B-7).
- **MB-14. Preview and change share one code path** (B-15). `POST /billing/preview` and `POST /billing/plan` call the same service function; preview writes nothing. Why: two paths drift, so the owner could confirm one price and pay another.