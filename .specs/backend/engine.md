---
id: backend.engine
status: active
code_paths:
  - src/engine/tick-loop.ts
  - src/engine/action-resolver.ts
  - src/engine/resource-manager.ts
  - src/engine/death.ts
  - src/engine/event-system.ts
test_paths:
  - tests/engine.test.ts
test_commands:
  - npx vitest run tests/engine.test.ts
---

# Summary
The simulation engine: the main tick loop, action resolution, resource management, death checks, and random world events. This is the core game loop that ties all other systems together.

## Use Cases

### Tick Loop
- Execute one tick of the simulation following the 13-step pipeline from the spec.
- Steps per tick: regenerate resources, apply passive effects (hunger +8), check deaths, gather agent actions via orchestrator, resolve actions simultaneously, apply consequences, roll random events, log events, update memories, trigger memory compression if needed, persist state, advance RNG.
- Support configurable tick delay (tickDelayMs) for observability.
- Support running for a fixed number of ticks then pausing.
- Resume from the last completed tick on restart (read current_tick from DB).
- Print rich console output per tick showing location states, actions, warnings, and cost.

### Action Resolver
- Take all validated agent actions for a tick and resolve them simultaneously.
- Gather: deduct resources from location, add to agent inventory. If multiple agents gather the same scarce resource, split proportionally (weighted by tools, energy, luck via RNG).
- Move: update agent location to the destination (must be adjacent).
- Eat: consume food item from inventory, reduce hunger by food's nutrition value.
- Rest: recover 25-40 energy (more in shelter), costs the action but no energy.
- Craft: validate recipe, consume inputs, produce output item.
- Explore: roll RNG for discovery (hidden resources, items).
- Internal monologue: log the thought, no world effect.

### Resource Manager
- Regenerate resources at all locations at tick start.
- Each resource gains `regenerationRate` units per tick, capped at max quantity.
- Track depletion from gathering.

### Death System
- After consequences are applied, check all agents for health <= 0.
- If an agent dies: set isAlive=false, set causeOfDeath, scatter inventory items at their location, log death event.
- Notify agents at the same location of the death.

### Random Events
- Roll for random world events using seeded RNG each tick.
- Events: tropical_storm (damage shelters, injure unsheltered agents), resource_discovery (bonus resources at random location), illness_outbreak (random agents lose health), hidden_idol_appears (place findable item).
- Each event has a probability per tick and a trigger condition.

## Invariants
- Tick state must be persisted to SQLite after each completed tick (crash recovery).
- Actions are resolved simultaneously — no agent gets priority over another within a tick.
- Hunger increases by exactly +8 per tick for all living agents.
- Health damage from hunger: -5/tick if hunger > 80, -15/tick if hunger > 95.
- Health regenerates +2/tick only if hunger < 50 and agent rested that tick.
- Dead agents do not take actions and are skipped by the orchestrator.
- The event log is append-only.
- RNG state is advanced deterministically and persisted each tick.

## Failure Modes
- If a tick partially completes and the process crashes, on restart the tick should be re-executed from the last persisted state (not skipped).
- If all agents die, the simulation should pause with a "no living agents" status, not crash.
- If a random event targets a nonexistent location or agent, skip the event gracefully.

## Acceptance Criteria
- A single tick with 2 agents: one gathers food, one rests. After the tick, the gatherer has food in inventory and -15 energy, the rester has +25-40 energy. Both have +8 hunger.
- Resource conflict: 2 agents gather "food" at a location with quantity 3. Each gets a proportional share.
- Death: an agent with health=3 and hunger=96 dies after the tick (health -= 15, goes below 0). Their inventory appears at their location.
- After a tick, `simulation.current_tick` in the DB is incremented by 1.
- Running 12 ticks triggers an epoch boundary (ticksPerEpoch=12).
- Console output for each tick includes location summary, action list, warnings, and cost.
- Determinism: running 10 ticks from the same seed and initial state with dry-run agents produces identical world state.

## Out of Scope
- Tribal Council phase execution (Phase 2).
- Social action resolution (speak, trade, give — Phase 2).
- Dashboard/API integration.
