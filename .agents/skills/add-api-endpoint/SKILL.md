---
name: add-api-endpoint
description: Use when you build one route from the PRD 7.2 endpoint table in apps/api.
---

# Add an API endpoint

## Prepare

1. Find the route's row in PRD 7.2. Write down its method, path, auth value and schema name. Check: all four are in your task report.
2. Find the FR the route serves. List its acceptance criteria. Check: each criterion has a row in the report's Requirements table.
3. Confirm the FR belongs to the current phase (B-51). Check: the FR id is in this phase's row of the AGENTS.md section 1 table. If it is not, stop and ask.

## Build

4. Write the request schema in `packages/shared/src/schemas/<area>.ts` under the PRD 7.2 name. Write the response schema next to it. Apply CS-10, UP-9, and DB-4 for any email field. Check: the schema name matches PRD 7.2 exactly and `pnpm typecheck` passes.
5. Write one service function in `apps/api/lib/domain/<area>/`. Apply A-3, A-6, B-14, DB-10, DB-11 and DB-12. For a billing route, also apply B-16 and MB-1, MB-12 to MB-14. Check: the function takes the parsed input, returns the response type and imports nothing from Next.js.
6. Throw `AppError` only with the codes the FR names (CS-11, B-52). Check: every code you throw is in both the FR and PRD 7.10.
7. If the write must notify someone, run `add-notification-trigger` for each notification type. If the write must start a job, run `add-background-job` for that job. Check: each one is listed in your report.
8. Create `apps/api/app/v1/<path>/route.ts`. Wrap the handler in `withApi` with the PRD 7.2 auth value (SEC-1) and roles. Call the service once and return its result. Apply A-1, A-2 and CS-5. Check: the route export test (CS-12) passes.

## Test

9. Write one test per acceptance criterion in `apps/api/tests/integration/<area>/`, named with the FR id (S-16, S-17). Check: `pnpm test` passes and every criterion from step 2 has a named test.
10. If the path has `:teamId`, add the route to `apps/api/tests/isolation/` (B-20). Check: the case calls the route with a token from another team on the same shard and expects `404` or zero foreign rows.
11. If the path has `:teamId`, add the route to the role-matrix test (SEC-2). Check: the row asserts the PRD 5.1 status for `OWNER`, `MANAGER`, `STAFF`, a read-only team and a deleted team.
12. Add the route to the auth list test (SEC-1). Check: the test passes with the PRD 7.2 auth value for this route.
13. If the route is an authenticated write, add a test that sends the request twice with one `Idempotency-Key` (B-33). Check: both responses match and the state changed once.
