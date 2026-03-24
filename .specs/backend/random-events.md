---
id: backend.random-events
status: active
code_paths:
  - src/engine/event-system.ts
  - src/world/weather.ts
test_paths:
  - tests/events.test.ts
test_commands:
  - npx vitest run tests/events.test.ts
---

# Summary
Random world events that fire each tick based on seeded RNG probability rolls. Events create environmental pressure and narrative variety: storms damage shelters and injure unsheltered agents, resource discoveries add bonus resources, illness outbreaks reduce health, and hidden idols appear for agents to find via exploration.

## Use Cases
- Each tick, roll the seeded RNG against each event's probability to determine if it fires.
- Events have trigger conditions (e.g., storms only when shelters exist, illness only when agents > 3).
- **Tropical Storm** (5% per tick): Damages all shelters (reduce quality), agents without shelter take 10-20 health damage, some resources scatter.
- **Resource Discovery** (8% per tick): Bonus resources appear at a random location. All agents at that location are notified.
- **Illness Outbreak** (4% per tick): 1-3 random agents lose 10-25 health. Medicine becomes critical.
- **Hidden Idol** (6% per tick): A hidden immunity idol is placed at a random location. Not announced — agents must `explore` to find it. The idol can be used to nullify a banishment vote (Phase 2 council integration).
- Events are logged in the `world_events` table and the `event_log`.
- Agents at affected locations receive event descriptions in their perception.

## Invariants
- All event randomness uses the seeded PRNG — never Math.random().
- Events are deterministic given the same RNG state.
- Multiple events can fire in the same tick.
- Event effects are applied after action resolution but before state persistence.
- Hidden idol placement is not announced to any agent.

## Failure Modes
- If an event targets a location with no agents, effects still apply to the location (e.g., shelter damage) but no agents are affected.
- If illness targets a dead agent, skip that agent and pick another.
- If no valid targets exist for an event, the event is skipped (no error).

## Acceptance Criteria
- With a fixed seed, the exact same events fire at the exact same ticks across two runs.
- A tropical storm reduces shelter quality and damages unsheltered agents.
- A resource discovery increases resource quantity at the target location.
- An illness outbreak reduces health for affected agents.
- A hidden idol is placed at a location and is discoverable via the `explore` action.
- Events are logged in both `world_events` and `event_log` tables.
- Event announcements appear in affected agents' perception (except hidden idol).

## Out of Scope
- Custom event creation by agents or the game master.
- Event chaining (one event triggering another).
- Seasonal or time-based event frequency changes.
