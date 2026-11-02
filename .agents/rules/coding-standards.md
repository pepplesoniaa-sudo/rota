---
trigger: glob
description: Applies to every TypeScript file and to the compiler, lint and test config in apps/api, apps/mobile and packages/shared.
globs: "**/*.ts, **/*.tsx, **/tsconfig*.json, eslint.config.mjs, **/package.json"
---

# Coding standards

Only rules a tool checks live here. AGENTS.md 6.1 needs zero lint warnings and zero type errors, so breaking one fails the task. Style no tool checks stays in AGENTS.md section 5. Ids like (S-3) point to AGENTS.md, FR- and PRD ids to the PRD v1.1.

## 1. The checks stay strict

- **CS-1. Compiler flags.** Every workspace `tsconfig.json` extends `tsconfig.base.json`, which sets the three S-2 flags. Never turn one off in a workspace or a file. Why: one loose workspace lets unchecked types reach the others through `packages/shared`.
- **CS-2. Lint command.** `pnpm lint` runs `eslint . --max-warnings 0` and `prettier --check .` in every workspace. `eslint.config.mjs` uses type-aware typescript-eslint and `linterOptions.reportUnusedDisableDirectives: "error"`. Why: the promise and switch rules need types, and a stale disable comment hides a future break.
- **CS-3. These rules are `error`.** Never remove one, lower it to `warn` or `off`, or narrow its files.

| Rule | Why |
|---|---|
| `@typescript-eslint/no-explicit-any`, `no-non-null-assertion`, `ban-ts-comment` with `ts-expect-error: "allow-with-description"` | Enforce S-3 |
| `@typescript-eslint/no-floating-promises`, `no-misused-promises` | An unawaited promise fails silently: a lost outbox job or ledger write |
| `@typescript-eslint/switch-exhaustiveness-check` | A switch on `SwapStatus`, `ChargeStatus`, `Role` or any enum handles every value (B-37) |
| `no-console` | Enforce S-9 |
| `no-empty` (also flags an empty `catch`) | S-8: never swallow an error |
| `no-restricted-properties` on `$queryRawUnsafe` and `$executeRawUnsafe` everywhere, and on `$queryRaw` and `$executeRaw` everywhere except the one `lib/data/` file that defines `teamQuery` (the override names that file exactly) | Enforce B-21 |
| The `no-restricted-*` rules in CS-5 to CS-9 and the money bans in MB-3 | Turn those boundaries into checks |

- **CS-4. Never silence a check.** No `eslint-disable` and no config override for a rule in CS-3, CS-5 to CS-9 or MB-3, beyond the exception files each rule names. Any other `eslint-disable-next-line` names one rule and ends with `-- <reason>`. Never use `// @ts-nocheck`. Why: a silenced check is a broken rule that CI cannot see.

## 2. Boundaries the lint config enforces

- **CS-5. Imports** (A-15, A-3, A-8). Why: each ban keeps server code and secrets out of the app, or logic out of handlers.
  - `apps/mobile/**` never imports `apps/api/**`, `@prisma/client`, `ioredis`, `bullmq`, `argon2`, `jose` or a `node:` module.
  - `packages/shared/**` never imports `@prisma/client`, a `node:` module, `apps/**` or server config.
  - `apps/api/app/**/route.ts` imports only `lib/api`, `lib/domain` and `packages/shared`. Never `zod`, `NextResponse`, `lib/db`, `lib/data` or `@prisma/client`, because `withApi` builds every response.
  - `new PrismaClient(` appears only in `apps/api/lib/db.ts` (`no-restricted-syntax`).
- **CS-6. Environment** (A-16, B-31). `process.env` is read only in `apps/api/lib/config/env.ts` and `apps/mobile/app.config.ts`, the two override files. `app.config.ts` passes the app only the API base URL and the Expo project id. Why: one reader means one Zod check at startup and no secret in the bundle.
- **CS-7. Network in the app** (A-14). In `apps/mobile`, the global `fetch` is used only inside `src/api/`. Why: only that client adds the access token, the single-flight refresh (FR-03) and the `Idempotency-Key` (B-33).
- **CS-8. Time** (L-14, S-15, B-34). Banned imports: `moment`, `date-fns`, `date-fns-tz`, `dayjs`. Banned properties: `getTimezoneOffset`, `getHours`, `getMinutes`, `getDay`, `getDate`, `setHours`, `setMinutes`, `setDate`, `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`. `Date.now()` and `new Date()` for an instant are fine; do zone math in Luxon with an explicit zone. The ban matches the name on any object, so never give your own methods these names. Why: these methods use the process or device zone, not the team's or the user's.
- **CS-9. Tests stay on** (S-18). Banned in every test file: `.skip`, `.only` and `.todo` on `describe`, `it` and `test`; `test.fails`; and the Jest globals `xit`, `xtest`, `xdescribe`, `fit`, `fdescribe`. Vitest runs with `allowOnly: false`. Why: one `.only` silently skips the rest of a suite, and the Jest `x` and `f` aliases dodge a property ban.

## 3. Code shape a check proves

- **CS-10. Schemas come from `packages/shared`** (S-4, L-8). Every schema passed to `withApi` is imported from `packages/shared/src/schemas`. Body schemas are `.strict()`. The app parses responses with the same schemas. Why: one schema keeps API and app types identical, and CS-5 makes it checkable because a route cannot import `zod`.
- **CS-11. One error path** (S-8, B-52). Expected failures throw `AppError(code, status, message)` with a code from `errors.ts`. Anything else reaches `withApi` and returns `500 INTERNAL`. Worker jobs let unexpected errors throw so BullMQ retries them. Exception: a provider decline in `billing.charge` is a payment result, not a job failure (PRD 6.2). A unit test checks that `errors.ts` holds exactly the PRD 7.10 codes. Why: an invented or missing code breaks the app's error handling.
- **CS-12. Route export test** (A-2). The test that checks every `app/v1/**/route.ts` for `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` also fails on an exported `revalidate`, on `'use server'`, or if `apps/api/middleware.ts` exists. Why: each brings back Next.js caching or Edge code that A-2 bans, and `next build` does not catch it.