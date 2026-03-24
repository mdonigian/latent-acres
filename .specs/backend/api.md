---
id: backend.api
status: active
code_paths:
  - src/api/server.ts
  - src/api/routes.ts
test_paths:
  - tests/api.test.ts
test_commands:
  - npx vitest run tests/api.test.ts
---

# Summary
REST API + WebSocket server exposing simulation state, agent details, event logs, council transcripts, and cost data. Built with Express. Provides real-time updates via WebSocket so the dashboard can stream tick results live.

## Use Cases

### REST Endpoints

**Simulation State:**
- `GET /api/status` — Current tick, epoch, phase, status, living/total agent count, cumulative cost.
- `GET /api/config` — Simulation configuration (ticksPerEpoch, actionsPerTick, seed, etc.).

**Agents:**
- `GET /api/agents` — All agents with current stats (health, hunger, energy, location, alive/banished, isChieftain).
- `GET /api/agents/:id` — Single agent with full detail: stats, inventory, personality, relationships, short-term memory (last 20), long-term memory summary.
- `GET /api/agents/:id/memory` — Full short-term memory buffer for an agent.
- `GET /api/agents/:id/thoughts` — Internal monologue entries from event log (filtered by agent + event_type='internal_monologue').

**World:**
- `GET /api/locations` — All locations with current resources (qualitative and raw), connected locations, shelters, and which agents are present.
- `GET /api/map` — Location graph data (nodes + edges) for rendering the island map.

**Events:**
- `GET /api/events` — Paginated event log. Query params: `limit` (default 50), `offset`, `tick`, `epoch`, `agent_id`, `event_type`.
- `GET /api/events/world` — World events (storms, discoveries, etc.).

**Council:**
- `GET /api/council/:epoch` — Council transcript for a given epoch: motions, debate statements, vote tallies.
- `GET /api/council/:epoch/votes` — Secret vote ledger for an epoch (admin/spoiler endpoint — reveals who voted how).
- `GET /api/council/latest` — Most recent council transcript.

**Relationships:**
- `GET /api/relationships` — All relationship pairs with sentiment scores. Returns as array of `{agentA, agentB, sentiment}`.
- `GET /api/relationships/:agentId` — Relationships for a specific agent.

**Cost:**
- `GET /api/cost` — Cumulative cost, per-tick cost history from event log metadata.

**Export:**
- `GET /api/export/transcript` — Full simulation transcript as markdown. Query params: `from_tick`, `to_tick`.

### WebSocket
- `ws://host:port/ws` — Streams tick results, council events, deaths, and world events in real-time as JSON messages.
- Message types: `tick_complete`, `council_started`, `council_motion`, `council_vote_result`, `council_adjourned`, `agent_death`, `world_event`, `agent_banished`.

### Server Lifecycle
- The API server starts alongside the simulation when `--dashboard` flag is passed to `run`.
- Reads from the same SQLite database (read-only for API routes).
- Default port 3000, configurable via `--port`.

## Invariants
- API is read-only — no mutation endpoints. The simulation engine is the sole writer.
- WebSocket messages are broadcast to all connected clients.
- Secret vote endpoint (`/council/:epoch/votes`) must be clearly marked as a spoiler/admin route.
- All responses are JSON with consistent error format: `{ error: string }` for failures.
- Pagination defaults: limit=50, offset=0, max limit=500.

## Failure Modes
- If the database doesn't exist, return 503 with `{ error: "No simulation database found" }`.
- If an agent ID doesn't exist, return 404 with `{ error: "Agent not found" }`.
- If an epoch has no council data, return `{ motions: [], events: [] }`.
- WebSocket disconnections are handled gracefully — no server crash.

## Acceptance Criteria
- `GET /api/status` returns current tick, epoch, agent count, and cost.
- `GET /api/agents` returns all agents with correct stats.
- `GET /api/agents/:id` includes inventory, personality, and memory.
- `GET /api/events?limit=10&agent_id=vex` returns at most 10 events for Vex.
- `GET /api/locations` includes resource levels and present agents.
- `GET /api/map` returns nodes and edges suitable for graph rendering.
- `GET /api/council/0` returns the council transcript for epoch 0.
- `GET /api/relationships` returns sentiment scores for all agent pairs.
- `GET /api/export/transcript` returns a markdown string of the simulation.
- WebSocket clients receive `tick_complete` messages when ticks execute.
- Server starts on the configured port and serves all endpoints.

## Out of Scope
- Authentication or access control.
- Write/mutation endpoints (admin commands remain CLI-only).
- Rate limiting on the API.
- HTTPS (reverse proxy handles that).
