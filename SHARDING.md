# SHARDING.md: Dual-Shard Architecture & Scale Proof

This document details Rota's dual-shard database topology, connection pooling configuration, streaming replication with Read-Your-Own-Writes (RYOW) consistency guarantees, and cursor pagination indexing analysis.

---

## 1. Dual-Shard Topology Overview

Rota partitions data horizontally across two PostgreSQL 16 shards, each provisioned with one primary database and one asynchronous streaming replica (4 Postgres instances total):

```text
               ┌────────────────────────────────────────────────────────┐
               │              Next.js API & BullMQ Worker               │
               └───────────────────────────┬────────────────────────────┘
                                           │
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │           PgBouncer (Transaction Pool Mode)            │
               │   max_client_conn=1000 | default_pool_size=20          │
               └───┬───────────────────┬───────────────────┬────────┬───┘
                   │                   │                   │        │
                   ▼                   ▼                   ▼        ▼
           [pg-s0-primary]     [pg-s0-replica]     [pg-s1-primary] [pg-s1-replica]
             (Shard 0)           (Shard 0)           (Shard 1)       (Shard 1)
```

---

## 2. Table Placement Strategy

To prevent distributed cross-shard joins and distributed transactions (2PC), tables are strictly bifurcated into **Global** and **Shard-Scoped** models (Rule L-27, PRD 7.6):

| Category                | Storage Shard                  | Tables                                                                                                                                                     | Rationale                                                                                                           |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Global Models**       | Shard 0 Only                   | `User`, `UserToken`, `UserSettings`, `PushToken`, `Team`, `Membership`, `Invite`, `Subscription`, `PaymentMethod`, `Charge`, `LedgerEntry`, `WebhookEvent` | Identity, billing ledgers, and team discovery require global uniqueness and unified auditability.                   |
| **Shard-Scoped Models** | Designated Team Shard (0 or 1) | `Shift`, `ShiftSwap`, `AvailabilityBlock`, `ActivityEvent`, `TeamDailyStat`, `MemberWeeklyStat`                                                            | High-volume operational shifts and activity records scale linearly with team count and are partitioned by `teamId`. |
| **Outbox**              | Both Shards (0 & 1)            | `Outbox`                                                                                                                                                   | Enables atomic transactional outbox pattern on writes on any shard.                                                 |

### Shard Selection Algorithm

Team IDs are generated as **UUID v7** (time-ordered) in the API before writing to the database (Rule L-28). The shard index is determined deterministically:
$$\text{shardIndex} = \text{hash}(\text{teamId}) \pmod 2$$

Every subsequent query targeting shifts or feeds uses the known `team.shardIndex` to route directly to Shard 0 or Shard 1.

---

## 3. Connection Pooling: PgBouncer in Transaction Mode

PostgreSQL allocates a dedicated OS process per client connection (~10MB memory per connection). Under high concurrency (e.g. 1,000 mobile clients), direct connections exhaust database resources.

Rota configures **PgBouncer** in front of all four PostgreSQL servers (Rule L-31, PRD 7.4):

- `pool_mode = transaction`: Connections are returned to the pool immediately after each transaction completes, allowing 1,000 active client connections to share 20 physical server connections.
- `max_client_conn = 1000`
- `default_pool_size = 20`
- `reserve_pool_size = 5`
- `reserve_pool_timeout = 3`
- `server_idle_timeout = 60`
- `query_wait_timeout = 10`
- Prisma connection URL: `?pgbouncer=true&connection_limit=15&pool_timeout=10`
- Raw database migrations bypass PgBouncer using `directUrl` to each primary instance.

---

## 4. Read-Your-Own-Writes (RYOW) Consistency Guarantee

### The Replication Lag Problem

Asynchronous streaming replication introduces a lag of 5–100ms between primary and replica nodes. When a manager publishes a shift and immediately refreshes their schedule, a read routed to a lagging replica would return stale data, making the manager believe the action failed.

### The RYOW Solution

Rota implements the Read-Your-Own-Writes routing pattern (`apps/api/lib/db/ryow.ts`):

1. **Write Path**: When any mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) succeeds, the API sets a Redis key:
   $$\text{Key: } \texttt{ryow:\{userId\}}, \quad \text{TTL: } 5 \text{ seconds}$$
2. **Read Path**: When an authenticated user issues a read query (`GET`), the database router checks for the existence of `ryow:{userId}`:
   - **If key exists**: The user recently performed a write; the query is routed directly to the **Primary** database.
   - **If key does not exist**: The read is safely routed to the **Replica** database.
3. This guarantees zero replication lag anomalies for the active user while offloading heavy background read traffic to streaming replicas.

---

## 5. Requirement 1: Activity Feed Cursor Pagination Index Proof

### Cursor Structure

Cursor pagination uses a composite cursor containing both `createdAt` and `id` (base64url encoded):
$$\text{Cursor} = \text{base64url}(\text{JSON}(\{ t: \text{createdAtIsoMillis}, \text{id}: \text{uuid} \}))$$

This guarantees that multiple events recorded in the exact same millisecond are never skipped or duplicated.

### Query Plan Analysis: EXPLAIN ANALYZE

#### Without Index (`Seq Scan`):

```sql
EXPLAIN ANALYZE
SELECT id, team_id, type, created_at
FROM activity_event
WHERE team_id = '018f6c40-7e2b-7b00-8000-000000000001'
  AND (created_at, id) < ('2026-11-23 10:00:00+00', '018f6c40-7e2b-7b00-8000-000000000099')
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**Execution Plan (Before Index):**

```text
Limit  (cost=1845.20..1845.25 rows=20 width=96) (actual time=42.150..42.155 rows=20 loops=1)
  ->  Sort  (cost=1845.20..1862.40 rows=6880 width=96) (actual time=42.148..42.151 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 28kB
        ->  Seq Scan on activity_event  (cost=0.00..1520.00 rows=6880 width=96) (actual time=0.040..35.200 rows=10000 loops=1)
              Filter: ((team_id = '018f6c40-7e2b-7b00-8000-000000000001'::uuid) AND ((created_at < '2026-11-23 10:00:00+00'::timestamptz) ...))
Planning Time: 0.180 ms
Execution Time: 42.210 ms
```

_Issue_: Requires a sequential table scan of 10,000+ rows followed by an in-memory `top-N heapsort`, degrading linearly as table size grows.

#### With Composite B-Tree Index:

```sql
CREATE INDEX idx_activity_event_team_cursor
ON activity_event (team_id, created_at DESC, id DESC);
```

**Execution Plan (After Index):**

```text
Limit  (cost=0.42..2.85 rows=20 width=96) (actual time=0.038..0.065 rows=20 loops=1)
  ->  Index Scan using idx_activity_event_team_cursor on activity_event  (cost=0.42..835.10 rows=6880 width=96) (actual time=0.037..0.061 rows=20 loops=1)
        Index Cond: ((team_id = '018f6c40-7e2b-7b00-8000-000000000001'::uuid) AND (Row(created_at, id) < Row('2026-11-23 10:00:00+00'::timestamptz, '018f6c40-7e2b-7b00-8000-000000000099'::uuid)))
Planning Time: 0.095 ms
Execution Time: 0.088 ms
```

_Result_: Execution time drops from **42.21 ms to 0.088 ms** (a **480x speedup**). Zero sorting overhead: the database walks the B-Tree index in exact sorted order and terminates after returning 20 tuples.
