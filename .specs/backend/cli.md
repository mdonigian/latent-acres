---
id: backend.cli
status: active
code_paths:
  - src/index.ts
  - src/config.ts
  - src/utils/logger.ts
  - src/utils/rate-limiter.ts
  - src/utils/cost-tracker.ts
test_paths:
  - tests/cli.test.ts
test_commands:
  - npx vitest run tests/cli.test.ts
---

# Summary
CLI entry point and supporting utilities. Provides commands to initialize, run, pause, inspect, and manage the simulation. Includes configuration loading, structured logging, rate limiting, and cost tracking.

## Use Cases

### CLI Commands
- `init --seed <n> --agents-dir <path>`: Create a new world database, initialize island map, load agents from directory, set initial RNG seed.
- `run [--tick-delay <ms>] [--ticks <n>] [--dry-run]`: Start or resume the simulation. Optional fixed tick count. Dry-run mode uses heuristic agents.
- `pause`: Set simulation status to "paused" (graceful, finishes current tick).
- `status`: Print current simulation state — tick, epoch, phase, living agents, cost.
- `inspect --agent <name>`: Print detailed agent state — stats, inventory, memory, relationships.
- `generate-agents --count <n> --seed <n>`: Use Claude to auto-generate agent JSON files.
- `add-agent <path>`: Load a new agent JSON into a running world.

### Configuration
- Load SimulationConfig with defaults: ticksPerEpoch=12, actionsPerTick=2, tickDelayMs=1000, discussionRounds=3, seed from CLI, dbPath="data/latent-acres.db".
- Support environment variable ANTHROPIC_API_KEY.

### Logger
- Structured console output with timestamps and categories.
- Per-tick summary output matching the spec format.

### Cost Tracker
- Track input/output tokens per API call.
- Compute estimated cost based on model pricing.
- Persist cumulative cost to the simulation DB.
- Enforce MAX_COST_PER_TICK guardrail ($0.50).
- Log warning at COST_WARNING_THRESHOLD ($50.00).

### Rate Limiter
- Batch concurrent API calls (BATCH_SIZE=4).
- Apply INTER_BATCH_DELAY_MS=500 between batches.

## Invariants
- `init` must not overwrite an existing database without explicit confirmation.
- `run` must resume from last completed tick if the world already exists.
- Cost tracking must be accurate and persistent across restarts.
- ANTHROPIC_API_KEY must be present to run (not for init or status).

## Failure Modes
- Missing ANTHROPIC_API_KEY when running: clear error message with instructions.
- Invalid agents directory: list what was expected and what was found.
- Database corruption: catch and report, don't silently continue.

## Acceptance Criteria
- `init --seed 42 --agents-dir ./agents` creates a database at the default path with the island map and loaded agents.
- `status` on an initialized world prints tick 0, epoch 0, agent count, and $0.00 cost.
- `run --ticks 1 --dry-run` executes exactly one tick with heuristic agents and increments the tick counter.
- `inspect --agent Vex` shows Vex's health, hunger, energy, location, and inventory.
- Cost tracker correctly accumulates across multiple ticks.
- Rate limiter ensures no more than 4 concurrent API calls.

## Out of Scope
- `trigger-event` and `fork` commands (Phase 2).
- Dashboard server (`--dashboard` flag).
- Interactive/TUI mode.
