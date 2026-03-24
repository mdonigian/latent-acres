---
id: backend.database
status: active
code_paths:
  - src/db/schema.ts
  - src/db/queries.ts
test_paths:
  - tests/db.test.ts
test_commands:
  - npx vitest run tests/db.test.ts
---

# Summary
SQLite database layer using `better-sqlite3`. Provides schema initialization with WAL mode, typed query helpers for all game entities, and crash-safe persistence. The database IS the world save file.

## Use Cases
- Initialize a fresh database with all tables (agents, locations, resources, inventory, alliances, memory_short_term, memory_long_term, relationships, event_log, world_events, council_votes, simulation).
- Open an existing database and verify schema version.
- CRUD operations for agents (create, read, update status/stats, mark dead/eliminated).
- CRUD for locations and resources (read, update quantities during regen/depletion).
- Inventory management (add, remove, transfer items between agents, scatter at location).
- Event log append (never delete, only insert).
- Simulation singleton row (read/update current tick, epoch, phase, RNG state, status).
- Short-term memory: append entries, query last K entries per agent, trim old entries.
- Long-term memory: upsert summary per agent.
- Relationship tracking: upsert sentiment between agent pairs.
- Council votes: record votes per epoch.

## Invariants
- WAL mode must be enabled on database open for crash safety.
- The `simulation` table must always have exactly one row (id=1).
- The `event_log` table is append-only — no UPDATE or DELETE queries.
- All foreign key constraints must be enforced.
- All queries must use parameterized statements (no string interpolation for values).

## Failure Modes
- If the database file is locked by another process, throw a clear error on open.
- If schema initialization is run on an already-initialized DB, it should be idempotent (CREATE TABLE IF NOT EXISTS).
- If an agent ID does not exist when referenced, the foreign key constraint must reject the operation.

## Acceptance Criteria
- A fresh `initDatabase(path)` call creates all tables and indexes matching the schema in the spec.
- WAL mode is confirmed active after initialization.
- The simulation singleton row exists after init with default values.
- Agent CRUD: create an agent, read it back, update health, mark as dead — all work correctly.
- Event log: insert events, query by tick range and agent ID, count grows monotonically.
- Idempotent init: calling `initDatabase` twice on the same path does not error or duplicate data.
- An in-memory database (`:memory:`) works for testing.

## Out of Scope
- Schema migrations for live worlds (future work).
- Connection pooling (single-process, single-connection).
