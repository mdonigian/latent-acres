---
id: backend.world-island
status: active
code_paths:
  - src/world/island.ts
  - src/world/crafting.ts
  - src/world/weather.ts
test_paths:
  - tests/world.test.ts
test_commands:
  - npx vitest run tests/world.test.ts
---

# Summary
Defines the island map as a graph of named locations with resources, connections, and danger levels. Includes the default island layout, resource regeneration logic, crafting recipes, and a simple weather system.

## Use Cases
- Load the default island map (8 locations from the spec: The Beach, Dense Jungle, Waterfall, Rocky Ridge, The Clearing, Tidal Pools, Mangrove Swamp, The Summit).
- Seed initial resources at each location with correct types and quantities.
- Persist locations and resources to the database during world initialization.
- Regenerate resources at the start of each tick (capped at max quantity).
- Validate adjacency: check if two locations are connected before allowing movement.
- Crafting: validate recipe inputs against agent inventory, consume inputs, produce outputs.
- Weather: generate weather state per tick using seeded RNG, apply weather effects (storm damages shelters, affects gather rates).

## Invariants
- The island graph must be connected — every location must be reachable from every other location.
- Each location's `connectedTo` must be bidirectional (if A connects to B, B connects to A).
- Resource quantities must never go below 0.
- Resource regeneration must not exceed a defined maximum per resource node.
- Crafting must be atomic: either all inputs are consumed and output is produced, or nothing changes.

## Failure Modes
- If a crafting recipe requires resources the agent doesn't have, return a failure result (not an error).
- If a location ID is invalid, throw.
- Weather effects on nonexistent shelters are no-ops.

## Acceptance Criteria
- The default island has exactly 8 locations with correct connections matching the spec map.
- All location pairs that should be adjacent are adjacent (bidirectional).
- Resource regeneration: a depleted resource gains `regenRate` units per tick, never exceeding its max.
- Crafting `fishing_spear` with {wood: 2, stone: 1} in inventory succeeds and produces the tool item.
- Crafting with insufficient materials returns failure without modifying inventory.
- Weather system produces deterministic weather given the same RNG state.

## Out of Scope
- Dynamic map generation or map editing.
- Tidal mechanics (tide-dependent resource availability is simplified to RNG).
