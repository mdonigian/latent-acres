---
id: backend.crafting
status: active
code_paths:
  - src/world/crafting.ts
  - src/world/island.ts
  - src/engine/action-resolver.ts
  - src/engine/resource-manager.ts
  - src/db/schema.ts
  - src/db/queries.ts
  - src/agents/tools.ts
  - src/agents/perception.ts
  - src/agents/prompt-builder.ts
test_paths:
  - tests/crafting.test.ts
test_commands:
  - npx vitest run tests/crafting.test.ts
---

# Summary
Expanded crafting system with 22 recipes across 4 tiers, 2 new resource types (clay, herbs), consumable items, and permanent structures placed at locations. Structures benefit all agents at a location and persist across ticks.

## Use Cases

### New Resources
- Add `clay` resource to: Waterfall (qty 6, max 8, regen 1), Tidal Pools (qty 4, max 6, regen 0.5), Mangrove Swamp (qty 3, max 5, regen 0.5).
- Add `herbs` resource to: Dense Jungle (qty 5, max 8, regen 1), Mangrove Swamp (qty 6, max 10, regen 1.5).
- Update the `gather` tool description to include clay and herbs as valid resource types.

### Crafting Tiers

**Tier 1 — Basic** (raw resources only):
- `stone_axe`: 1 wood + 2 stone → tool (gatherBonus 0.2)
- `fishing_spear`: 2 wood + 1 stone → tool (gatherBonus 0.3)
- `rope`: 4 fiber → material
- `clay_brick`: 3 clay + 1 wood → material
- `torch`: 1 wood + 1 fiber → tool
- `herbal_poultice`: 2 herbs + 1 freshwater → consumable (healAmount 20)

**Tier 2 — Intermediate** (require Tier 1 crafted items as inputs):
- `treated_wood`: 2 wood + 1 freshwater → material
- `woven_mat`: 2 fiber + 1 rope → material
- `clay_pot`: 2 clay + 1 wood → material
- `herbal_tea`: 1 herbs + 1 freshwater + 1 clay_pot → consumable (energyRestore 15, hungerReduce 10)
- `medicine`: 3 herbs + 2 freshwater + 1 clay_pot → consumable (healAmount 40)

**Tier 3 — Advanced Tools** (require intermediate materials):
- `reinforced_axe`: 1 stone_axe + 1 rope + 1 treated_wood → tool (gatherBonus 0.5)
- `fishing_net`: 3 rope + 2 fiber → tool (gatherBonus 0.6)
- `water_skin`: 2 fiber + 1 rope → tool

**Tier 4 — Structures** (placed at location, not in agent inventory):
- `shelter`: 5 wood + 3 fiber → structure (restBonus 10)
- `hut`: 3 treated_wood + 2 rope + 4 clay_brick → structure (restBonus 25, weatherProtection true)
- `storage_chest`: 3 wood + 2 rope → structure (sharedStorage true, capacity 20)
- `signal_fire`: 4 wood + 2 stone + 1 rope → structure (signalRange 2)
- `defensive_wall`: 6 stone + 4 clay_brick + 2 rope → structure (dangerReduction 0.3)
- `rain_collector`: 2 treated_wood + 1 clay_pot + 2 fiber → structure (freshwaterGen 2)
- `drying_rack`: 3 wood + 2 rope + 1 woven_mat → structure (foodBonus 1)
- `kiln`: 5 stone + 3 clay + 2 wood → structure (doubles clay_brick output)

### Location Structures
- New `location_structures` DB table: id, location_id, structure_type, built_by_agent_id, built_at_tick, durability (default 100), properties_json.
- When an agent crafts a structure recipe, the output is placed at the agent's current location in the `location_structures` table (not in their inventory).
- Query helpers: createLocationStructure, getStructuresAtLocation, removeLocationStructure.
- Structures are visible in agent perception under `location.structures`.

### Structure Gameplay Effects
- **shelter/hut**: Agents resting at a location with a shelter get +restBonus energy. The `rest` action in the action resolver checks `location_structures` for shelter/hut at the agent's location (not agent inventory).
- **hut weatherProtection**: Agents at a location with a hut take no damage from tropical storms.
- **storage_chest**: Enables `deposit` and `withdraw` actions at that location. Stored items persist in a `location_storage` table.
- **signal_fire**: Agents at a location with a signal fire see agents at locations within 2 connections in their perception (extended visibility).
- **defensive_wall**: Reduces the location's effective danger_level by 0.3 (clamped to 0).
- **rain_collector**: Adds freshwaterGen amount of freshwater to the location's freshwater resource each tick during resource regeneration.
- **drying_rack**: Agents gathering food at a location with a drying rack get +1 bonus food.
- **kiln**: Agents crafting clay_brick at a location with a kiln produce 2 instead of 1.

### Consumable Items
- New `use_item` agent action/tool: consume a consumable from inventory.
- `herbal_poultice`: heals 20 health.
- `herbal_tea`: restores 15 energy and reduces hunger by 10.
- `medicine`: heals 40 health.
- After use, the item is removed from inventory (or quantity decremented).

### New Agent Actions
- `use_item(item)`: Consume a consumable item. Zero energy cost.
- `deposit(item)`: Put an inventory item into a storage chest at current location. Zero energy cost.
- `withdraw(item)`: Take an item from a storage chest at current location. Zero energy cost.

### Prompt & Tool Updates
- Update the `craft` tool description to list all 22 recipes grouped by tier.
- Update the `gather` tool description to include clay and herbs.
- Add `use_item`, `deposit`, `withdraw` tool definitions.
- Update the system prompt to mention: new resources, structures at locations, consumable items, storage chests.

## Invariants
- Crafting is atomic: all inputs consumed and output produced, or nothing changes.
- Structure recipes produce location structures, not inventory items.
- Only one shelter or hut per location (building a new one replaces the old).
- Storage chest capacity limits the total quantity of items stored.
- Consumable use removes the item from inventory.
- Resource quantities must always be whole numbers (Math.floor on regeneration).
- Rain collector freshwater generation is added during the standard resource regeneration step.

## Failure Modes
- Crafting with insufficient materials returns a descriptive failure without mutating state.
- Unknown recipe ID returns failure.
- `deposit` without a storage chest at the location fails.
- `withdraw` of an item not in storage fails.
- `use_item` on a non-consumable item fails.

## Acceptance Criteria
- 7 resource types exist across the island: food, wood, stone, fiber, freshwater, clay, herbs.
- All 22 recipes can be crafted when the agent has the required inputs.
- Crafting `shelter` places a structure at the agent's location in `location_structures`.
- Resting at a location with a hut gives +25 energy bonus.
- `use_item` with herbal_poultice heals 20 health and removes the item.
- `deposit` moves an item from agent inventory to location storage.
- `withdraw` moves an item from location storage to agent inventory.
- Rain collector adds freshwater to its location each tick.
- Agent perception includes structures at current location.
- Crafting a Tier 3 recipe (e.g., reinforced_axe) that requires a Tier 1 output (stone_axe) as input succeeds when the agent has the required items.

## Out of Scope
- Structure durability degradation (future work).
- Structure repair mechanics.
- Visual structure rendering on the dashboard map (future work).
- Recipe discovery or unlocking.
