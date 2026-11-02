---
name: add-mobile-screen
description: Use when you build one screen from the PRD 5.12 screen list in apps/mobile.
---

# Add a mobile screen

## Prepare

1. Find the screen in PRD 5.12 and the FRs it serves. Check: the FR ids are in your task report.
2. List the endpoints the screen calls. If one does not exist, build it first with `add-api-endpoint`. Check: each endpoint has a `route.ts` and a shared response schema.

## Build

3. Create the route file in `apps/mobile/app/(auth)/` or `apps/mobile/app/(app)/` (L-22). Keep it to layout and one hook call (S-13). Check: the file holds no fetch, query or business logic.
4. Write the queries and mutations in `apps/mobile/src/queries/<area>.ts`. Use the L-32 `staleTime`. Call the API only through `src/api/` (CS-7). Parse each response with its shared schema (CS-10). Check: `pnpm lint` passes and each `staleTime` matches L-32.
5. Make a mutation optimistic only if A-13 lists it, and then follow PRD 7.8. Give every other write a spinner and a disabled button while it is pending. Check: each mutation is on the A-13 list or disables its button while pending.
6. Write the screen hook in `apps/mobile/src/features/<area>/`. Keep app-only state in Zustand (A-12, L-4). Check: no Zustand store holds server data.
7. Build the offline state. Disable every write button and show "Connect to make changes" (B-47). Check: a test with the network offline shows the label on a disabled button.
8. Build the error state. Map each error code to a message and announce it (PRD 7.8 rule 2). Check: a test with a failing request shows the message and calls `AccessibilityInfo.announceForAccessibility`.
9. Show money only through `formatUsd` (MB-1, B-15). Show times only through the Luxon helpers in `src/lib/` (CS-8, S-15). Check: the screen computes no amount and formats no `Date` itself.
10. Show buttons by the user's role in the active team (B-18). Hide drafts from staff (B-26). Check: a test renders the screen as `STAFF` and as `MANAGER` and finds the right buttons for each.
11. Apply B-49 and PRD 7.11, the L-2 tablet width and the S-14 tokens from `src/ui/`. Check: every icon button has an `accessibilityLabel`, every target is at least 44 by 44 points, and every status shows as text.

## Test

12. Write a Jest test with React Native Testing Library, named with the FR id (L-20, S-16). Check: `pnpm --filter mobile test` passes.
