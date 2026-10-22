# Coding standards

Rules for all TypeScript in `apps/api` (route handlers, `lib/`, `worker/`), `apps/mobile` and `packages/shared`. Read this file before any task that writes or changes code, and before you touch `tsconfig*.json` or `eslint.config.mjs`.

**How this file relates to AGENTS.md.** It adds detail to AGENTS.md and never relaxes it. Ids such as (S-3) or (B-21) point to AGENTS.md. `FR-` and `PRD` ids point to the PRD v1.1. If this file seems to disagree with AGENTS.md or the PRD, they win: stop and ask (AGENTS section 7).

**Every numbered rule here is a failure rule.** Breaking one means the task failed even if the code builds, the tests pass and the feature works. A coding standard is a rule here only when a tool checks it. AGENTS.md 6.1 requires zero lint warnings and zero type errors, so anything the config below checks fails the task when broken. Style that no tool checks stays a default in AGENTS.md section 5.

---

## 1. The checks must exist and must stay strict

- **CS-1. Compiler flags.** `tsconfig.base.json` sets `strict: true`, `noUncheckedIndexedAccess: true` and `noImplicitOverride: true` (S-2). Every workspace `tsconfig.json` extends it. Never turn any of the three off, in any workspace or file.

- **CS-2. Lint command.** `pnpm lint` runs `eslint . --max-warnings 0` and `prettier --check .` across every workspace. `eslint.config.mjs` sets `linterOptions.reportUnusedDisableDirectives: "error"` and uses type-aware typescript-eslint, so the rules below can see types.

- **CS-3. Rules that must be set to `error`.** Never remove one, lower it to `warn` or `off`, or narrow its file patterns.

  | Rule                                                                                                                                                                                         | Why it is here                                                                                      |
  | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
  | `@typescript-eslint/no-explicit-any`                                                                                                                                                         | S-3                                                                                                 |
  | `@typescript-eslint/no-non-null-assertion`                                                                                                                                                   | S-3                                                                                                 |
  | `@typescript-eslint/ban-ts-comment` with `ts-expect-error: "allow-with-description"`                                                                                                         | S-3                                                                                                 |
  | `@typescript-eslint/no-floating-promises` and `@typescript-eslint/no-misused-promises`                                                                                                       | An unawaited promise in a handler or job fails silently: a lost outbox job, a lost ledger write     |
  | `@typescript-eslint/switch-exhaustiveness-check`                                                                                                                                             | A `switch` on `SwapStatus`, `ChargeStatus`, `Role` or any other enum must handle every value (B-37) |
  | `no-console`                                                                                                                                                                                 | S-9                                                                                                 |
  | `no-empty` (it also flags an empty `catch`)                                                                                                                                                  | S-8: never swallow an error                                                                         |
  | `no-restricted-properties` on `$queryRawUnsafe` and `$executeRawUnsafe` everywhere, and on `$queryRaw` and `$executeRaw` everywhere except the `teamQuery` file in `lib/data/`               | B-21                                                                                                |
  | `no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties` and `no-restricted-syntax` as set out in CS-5 to CS-9, CS-13, and the money bans in `money-and-billing.md` MB-3 | The boundaries below, and B-1                                                                       |

- **CS-4. Never silence a check to get green.** Never add `eslint-disable` for any rule in CS-3, CS-5 to CS-9, CS-13 or MB-3, and never add a config override that exempts a file from them, except the exception files each rule names. Any other `eslint-disable-next-line` names one rule and ends with `-- <reason>`. Never use `// @ts-nocheck`.

## 2. Boundaries the lint config enforces

- **CS-5. Import boundaries** (A-15, A-3, A-8):
  - `apps/mobile/**` never imports `apps/api/**`, `@prisma/client`, `ioredis`, `bullmq`, `argon2`, `jose` or any `node:` module.
  - `packages/shared/**` never imports `@prisma/client`, any `node:` module, `apps/**` or server config.
  - `apps/api/app/**/route.ts` imports only from `lib/api`, `lib/domain` and `packages/shared`. It never imports `zod`, `next/server`'s `NextResponse`, `lib/db`, `lib/data` or `@prisma/client`. `withApi` builds every response, so a route never builds one by hand.
  - `new PrismaClient(...)` appears only in `apps/api/lib/db.ts` (`no-restricted-syntax`).

- **CS-6. Environment access** (A-16, B-31). `process.env` is read only in `apps/api/lib/config/env.ts` and `apps/mobile/app.config.ts` (`no-restricted-properties`, with an override for those two files). `app.config.ts` exposes only the API base URL and the Expo project id to the app.

- **CS-7. Network access in the app** (A-14). In `apps/mobile`, the global `fetch` is used only inside `src/api/` (`no-restricted-globals`). Every request goes through that client, so it always carries the access token, the single-flight refresh (FR-03) and the `Idempotency-Key` (B-33).

- **CS-8. Time** (L-14, S-15, B-34). `moment`, `date-fns`, `date-fns-tz` and `dayjs` are banned imports. These `Date` methods are banned properties, because they use the process or device time zone instead of the team's or the user's: `getTimezoneOffset`, `getHours`, `getMinutes`, `getDay`, `getDate`, `setHours`, `setMinutes`, `setDate`, `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`. Use Luxon with an explicit zone.

- **CS-9. Tests stay on** (S-18). `describe.skip`, `it.skip`, `test.skip`, `describe.only`, `it.only`, `test.only`, `it.todo`, `test.todo` and `test.fails` are banned properties in every test file. Vitest runs with `allowOnly: false`.

- **CS-13. No hardcoded colors in mobile UI.** Hex color string literals (matching `/^#[0-9a-fA-F]{3,8}$/`) are banned in `apps/mobile/**` except inside `src/ui/tokens/**` (`no-restricted-syntax`). All component colors must come from the resolved theme tokens in `src/ui`.

## 3. Rules about code shape that a check proves

- **CS-10. Schemas come from `packages/shared`** (S-4, L-8). Every body, query and path schema passed to `withApi` is imported from `packages/shared/src/schemas`. Every body schema is `.strict()`. The mobile app parses responses with the same schemas. CS-5 makes this checkable: a route cannot import `zod`, so it cannot declare its own schema.

- **CS-11. One error path** (S-8, B-52). Expected failures throw `AppError(code, status, message)` with a code from `packages/shared/src/errors.ts`. Anything else propagates to `withApi`, which returns `500 INTERNAL`. In worker jobs, let unexpected errors throw so BullMQ retries them. The one exception is a provider decline in `billing.charge`, which is a payment result and not a job failure (PRD 6.2). A unit test asserts that `errors.ts` contains exactly the codes in PRD 7.10, no more and no fewer.

- **CS-12. Route export test** (A-2). The test that reads every `app/v1/**/route.ts` and checks for `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'` also fails if a route file exports `revalidate`, uses `'use server'`, or if `middleware.ts` exists in `apps/api`.

---

## Defaults, not failure rules

These come from AGENTS.md section 5. Follow them. A reviewer may ask you to fix them, but breaking one is not a failed task.

- Naming, file case and named exports (S-5, S-7).
- Small functions with early returns, files under about 300 lines (S-6).
- Comments that say why and cite the PRD id (S-10).
- Function components and hooks, thin screens, `StyleSheet.create` with shared tokens, light and dark mode (S-13, S-14).
- Test names start with the requirement id (S-16).
