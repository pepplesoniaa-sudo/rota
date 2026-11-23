# STATE.md: State Architecture & Data Placement

This document details where every piece of state lives in the Rota mobile application, the architectural rationale behind its placement, caching parameters, persistence rules, and the optimistic update / rollback mechanics.

---

## 1. State Classification & Taxonomy

Rota classifies all runtime data into three distinct layers to ensure predictability, offline resilience, and immediate user feedback:

| Layer               | Tool / Mechanism                                      | Storage Target                                              | Lifetime                                               | Examples                                                                                                           |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Server State**    | TanStack Query v5                                     | In-memory QueryCache + AsyncStorage                         | Configured stale times (0s to 300s); 14-day offline GC | Shifts, Activity Feed, Swaps, Billing Overview, Settings, Team Members                                             |
| **Client State**    | Zustand store (`useAppStore`)                         | In-memory JS runtime                                        | Ephemeral (resets on logout)                           | `userId`, `activeTeamId`, `activeRole`, `isOnline`, `lastSyncedAt`, Modals                                         |
| **Persisted State** | TanStack AsyncStorage Persister & `expo-secure-store` | Flash storage (Encrypted Keychain / Keystore & App sandbox) | Survives app closure & reboots                         | Stored refresh token (`SecureStore`), last known `userId` (`SecureStore`), offline schedule cache (`AsyncStorage`) |

---

## 2. Server State: TanStack Query & Caching Policies

All server data is fetched and managed through TanStack Query (`apps/mobile/src/lib/query/client.ts`). The caching rules adhere to locked PRD specifications (L-32 & PRD 7.3):

| Query Key                        | Cache Duration (`staleTime`) | Garbage Collection (`gcTime`) | Rationale                                                                                                                                                        |
| -------------------------------- | ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feed(teamId)`                   | **30 seconds**               | 14 days                       | Activity feeds change frequently as coworkers post shifts and accept swaps. 30s prevents over-fetching on rapid tab navigation while ensuring fresh events.      |
| `myShifts()`                     | **60 seconds**               | 14 days                       | Personal upcoming shifts do not alter every second. 60s allows fast navigation between tabs without refetching, while staying fresh enough for schedule changes. |
| `teamSchedule(teamId, from, to)` | **60 seconds**               | 14 days                       | Team schedules are edited in batches. 60s preserves battery and network bandwidth.                                                                               |
| `swaps(teamId)`                  | **15 seconds**               | 14 days                       | Swaps require near-real-time visibility because coworkers and managers act concurrently to approve or claim shifts.                                              |
| `settings()`                     | **300 seconds (5 min)**      | 14 days                       | User settings (quiet hours, timezones, notification preferences) change infrequently. 5 minutes eliminates redundant network queries.                            |
| `billing(teamId)`                | **0 seconds (never cached)** | 14 days                       | Billing involves money, proration calculations, active seats, and invoice statuses. Stale billing data risks financial confusion.                                |

### Offline Persistence & 14-Day Invalidation (FR-32, L-3)

- The TanStack Query client is bound to `@tanstack/query-async-storage-persister` writing to `AsyncStorage` under the key `rota_query_cache_v1`.
- `maxAge` is locked at **14 days** (`1,209,600,000 ms`).
- On app launch without internet connectivity, the app reads the cached schedule and displays the `OfflineBanner` indicating: `Offline. Last updated {HH:MM}.`
- If the cache age exceeds 14 days, cached schedule data is considered expired and displays `No offline schedule. Connect to update.`
- The cache buster string incorporates the active `userId` (`buster: userId ?? ''`), preventing cache leakage between different users logging in on the same physical device.

---

## 3. Client State: Why Zustand?

Rota chose **Zustand** as its dedicated client state manager (Rule L-4) for the following reasons:

1. **Zero Context Re-render Cascades**: React Context triggers re-renders on all consuming subtree components whenever any slice of context changes. Zustand provides atomic selectors (`useAppStore(s => s.activeTeamId)`), ensuring components only re-render when their specific observed slice changes.
2. **Outside-of-React Access**: Zustand's `useAppStore.getState()` and `useAppStore.setState()` can be invoked directly inside non-React modules, such as API client interceptors (`client.ts`), token refresh mutexes, and offline network listeners.
3. **Minimal Boilerplate**: Unlike Redux, Zustand requires no actions, reducers, dispatched thunks, or wrapped providers, keeping the mobile bundle compact and memory overhead minimal.

---

## 4. Persisted State & Secret Isolation

Strict boundary enforcement between encrypted secrets and non-sensitive cache (Rules L-5, SEC-1, SEC-2):

- **Tokens (`expo-secure-store`)**:
  - `rota_refresh_token`: Encrypted at rest in iOS Keychain or Android Keystore with hardware-backed encryption.
  - `rota_last_user_id`: Stored in secure store to enable offline user attribution on cold start without exposing auth tokens.
  - **`AsyncStorage` is NEVER used for tokens or credentials.** AsyncStorage is unencrypted on device storage and vulnerable to extraction.
- **Offline Data (`AsyncStorage`)**:
  - Stores only sanitized query cache data (e.g., published shift lists).
  - Draft shifts (`DRAFT`) are filtered on the server and never persisted to the client offline cache (FR-15c).

---

## 5. Optimistic Updates with Rollback Architecture

### The Problem (Kemi's Scenario)

When a user taps "Accept Swap", waiting for network round-trips (1–3 seconds) creates a sluggish feel and invites double-tapping. If a user taps twice, duplicate requests fire, leading to 409 conflict errors or inconsistent local state.

### The Solution (`createOptimisticMutation`)

Rota implements the `createOptimisticMutation` helper (`apps/mobile/src/lib/offline/mutations.ts`) which enforces a 7-step transactional rollback cycle:

```text
User Action (Tap "Accept Swap")
       │
       ▼
1. Assert Online? ──(No)──> Throw OfflineError (Block mutation)
       │ (Yes)
       ▼
2. Cancel Outgoing Refetches (queryClient.cancelQueries)
       │
       ▼
3. Snapshot Previous Cache Data (previousData)
       │
       ▼
4. Optimistically Apply Update to Cache (Instant UI update)
       │
       ▼
5. Execute Server Mutation (POST /v1/teams/:id/swaps/:id/accept)
       │
       ├───> [Success] ──> 7. onSettled: Invalidate queries to sync with truth
       │
       └───> [Failure] ──> 6. onError: Roll back cache to previousData snapshot
                           Announce rollback to Screen Reader (PRD 7.11)
                           Display alert with server error message
```

### Verified Scenarios

1. **Swap State Transitions**:
   - Tapping "Accept" immediately transforms status badge from `PENDING_PEER` to `PENDING_MANAGER`.
   - If the server rejects (e.g. shift was deleted or coworker already took another shift), the cache reverts to `PENDING_PEER` instantly, and an accessibility announcement alerts the user.
2. **Settings Coordination**:
   - Toggling quiet hours switches the UI immediately.
   - If server rejects (e.g., version mismatch / conflict), the switch snaps back to its server-backed state.
