# Money and billing

Rules for every line of code that computes, stores, shows, charges or records money: `lib/billing/` (`pricing.ts`, `proration.ts`, `ledger.ts`, `flutterwave/`), the `billing.*` jobs, the billing routes, invite acceptance and seat counts, and the mobile Billing and Ledger screens. Read this file before any task in phase 5, and before any task that touches seats, plans, charges or the ledger in another phase.

**How this file relates to AGENTS.md.** AGENTS.md B-1 to B-17 already set the money rules and PRD section 8 sets the formulas. This file adds how to build them so they hold, and never relaxes them. Ids such as (B-9) point to AGENTS.md. `FR-` and `PRD` ids point to the PRD v1.1. If this file seems to disagree with AGENTS.md or the PRD, they win: stop and ask (AGENTS section 7).

**Every numbered rule here is a failure rule.** Breaking one means the task failed even if the code builds, the tests pass and the feature works. Cite the ids you checked in your task report.

---

## 1. Where money code lives

- **MB-1. One home for each money job.** Prices live only in `lib/billing/pricing.ts` (B-4). Proration lives only in `lib/billing/proration.ts` (B-5). Ledger rows are written only by one function in `lib/billing/ledger.ts`. Calls to Flutterwave live only in `lib/billing/flutterwave/`. Turning cents into display text happens only in one `formatUsd(cents)` function in `packages/shared/src/money.ts`, used by the app for every amount. No other file creates a `LedgerEntry`, holds a price, or formats money. A test fails if `ledgerEntry.create` appears outside `ledger.ts`.

- **MB-2. Pricing and proration are pure functions.** `monthlyPrice` and `prorationCents` take every input as an argument, including the change instant and the period bounds. They never read the clock, the database or the environment. The caller reads server time once, truncates it to the second (PRD 8.2) and passes it in. Device time is never used for money. The 3 golden tests from PRD 8.3 and the 10,000-case property test call these functions directly (B-5).

## 2. Numbers

- **MB-3. Amounts are safe integers, and only BigInt divides** (B-1). Every amount is an integer number of cents. Zod checks it with `z.number().int()`, and every amount that enters a money function passes `Number.isSafeInteger`. In `lib/billing/**` and `packages/shared/src/money.ts`, the lint config bans `parseFloat`, `.toFixed`, `Math.round`, `Math.ceil` and `Math.floor`, and bans the `/` operator in every file except `proration.ts`. In `proration.ts`, `/` is used only on `BigInt` values: to turn milliseconds into whole seconds and to divide the proration product. Since the delta is positive there, `BigInt` division is the floor PRD 8.2 asks for. Never pass provider data through `Number(...)` or `parseInt`.

- **MB-4. Converting to and from the provider uses strings** (B-2). `centsToProviderAmount(7100)` returns `"71.00"`, built by padding the integer's digits and inserting the decimal point. `providerAmountToCents` accepts only a string matching `^\d+(\.\d{1,2})?$` and builds cents from the digits. When Flutterwave sends a JSON number, convert it with `String(value)` first, then parse that string. Reject exponent forms and negative values. Never multiply or divide a provider amount by 100.

## 3. Payment truth

- **MB-5. Only the verify response decides a payment** (B-9, PRD 8.5). The amount, currency, status and `tx_ref` that decide `PAID` come only from `GET /v3/transactions/{id}/verify`, called in `billing.webhook`. Never use the webhook body, the hosted checkout redirect URL (its `status` and `tx_ref` query values), the app or a test helper for this. After checkout, the app only refetches billing and shows "Payment processing" (FR-35).

- **MB-6. An exact match, or nothing changes.** The verified cents must equal `ChargeAttempt.amountCents`, the currency must be `USD`, `tx_ref` must equal `ChargeAttempt.txRef`, and the status must be `successful`. On any mismatch, change no charge, attempt, ledger or subscription row. Set the `WebhookEvent` to `FAILED` with the expected and received values in `error`, and log it with the event id.

- **MB-7. A timeout counts as accepted** (B-11). In `billing.charge`, commit the new `ChargeAttempt` row before calling Flutterwave, so its `tx_ref` exists first. Retry only when the request provably never reached the provider, such as a DNS failure or a refused connection. A timeout or any HTTP response counts as accepted: set the attempt to `PROCESSING` and leave it to the webhook or `billing.reconcile`. Never send a second charge for the same attempt.

## 4. Writing it down

- **MB-8. Money state changes happen in one transaction** (B-12, A-6). When `billing.webhook` confirms a payment, these all commit together in one shard 0 transaction, or none do: the attempt update, the conditional `PAID` update on the charge (B-11), the `PAYMENT_CONFIRMED` entry, every deferred charge it collects set to `PAID` with `collectedByChargeId`, the subscription status change, `WebhookEvent.status = PROCESSED`, and the `Outbox` rows for notifications. The same applies when a charge is created: the `Charge` row and its `CHARGE_*` ledger entry commit together.

- **MB-9. Ledger idempotency keys come from the source, never from randomness.** A retry of the same event must produce the same key. Use `payment:{providerTxId}` for `PAYMENT_CONFIRMED` (PRD 9). For the other types, this file sets the formats: `charge:{chargeId}` for `CHARGE_SUBSCRIPTION`, `CHARGE_SEAT_PRORATION` and `CHARGE_UPGRADE_PRORATION`; `payment-failed:{chargeAttemptId}` for a verified failure or decline; `payment-failed:overdue:{chargeId}` for an overdue charge; `refund:{providerRefundId}` for `REFUND_ISSUED`; `reversal:{reversedEntryId}` for `REVERSAL`.

- **MB-10. Charge amounts add up.** For every charge, `amountCents` equals the sum of its `lineItems[].amountCents`. A renewal's `CHARGE_SUBSCRIPTION` entry equals the plan-price line item only. Deferred prorations already have their own entries (B-12, PRD 8.4). A test checks both on every charge the billing tests create.

- **MB-11. Balance tests prove the ledger.** Every billing scenario test ends by asserting the team's `SUM(amount_cents)`. These scenarios must exist: the PRD 8.4 worked check (+87, +5000, −5087, balance 0); one webhook delivered 3 times (one `PAYMENT_CONFIRMED`); two successful attempts on one charge (balance shows the credit, `DOUBLE_PAYMENT` logged); and a refund (its `REFUND_ISSUED` plus the paired `REVERSAL` brings the balance back to 0, PRD 8.7).

## 5. Seats and plan changes

- **MB-12. Seat counts come from the primary, inside the transaction.** Active seats are `Membership` rows with `status = ACTIVE` for the team, owner included (PRD 8.1). Count them on the primary inside the transaction that changes membership or plan. Never count from the permission cache, the replica or a value the app sent.

- **MB-13. Serialize every seat and plan change per team.** The first write in any transaction that can change seats, `paidSeats` or the plan is an update of that team's `Subscription` row that increments `version`. That row lock makes concurrent invite acceptances and plan changes run one at a time. Without it, two acceptances on a Starter team with 4 active seats can both see 4 and reach 6 (B-7), or two seat adds can both create the same proration.

- **MB-14. The preview and the change use one code path** (B-15). `POST /billing/preview` and `POST /billing/plan` call the same service function. The only difference is that preview writes nothing. The app shows the preview's server-computed amounts and never adds, subtracts or estimates money itself.
