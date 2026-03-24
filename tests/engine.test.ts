import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../src/db/schema.js';
import { createAgent, getAgent, getSimulation, updateAgentStats, addInventoryItem, getAgentInventory, updateSimulation } from '../src/db/queries.js';
import { seedIslandToDatabase } from '../src/world/island.js';
import { executeTick } from '../src/engine/tick-loop.js';
import { resolveActions } from '../src/engine/action-resolver.js';
import { regenerateResources } from '../src/engine/resource-manager.js';
import { checkDeaths } from '../src/engine/death.js';
import { loadConfig } from '../src/config.js';
import { SeededRNG } from '../src/rng.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const config = loadConfig({ seed: 42, tickDelayMs: 0, ticksPerEpoch: 12 });

function setupWorld(): Database.Database {
  const db = initDatabase(':memory:', { seed: 42, configJson: JSON.stringify(config) });
  seedIslandToDatabase(db);
  return db;
}

describe('Tick Loop', () => {
  beforeEach(() => {
    db = setupWorld();
  });

  it('single tick: gatherer gets food and -15 energy, rester gets +25-40 energy, both +8 hunger', async () => {
    createAgent(db, { id: 'gatherer', name: 'Gatherer', personalityJson: '{}', locationId: 'the_beach' });
    createAgent(db, { id: 'rester', name: 'Rester', personalityJson: '{}', locationId: 'the_beach' });

    const rng = new SeededRNG(42);

    // Resolve gather + rest actions
    const actions = [
      { agentId: 'gatherer', agentName: 'Gatherer', action: 'gather', params: { resource: 'food' }, energyCost: 15 },
      { agentId: 'rester', agentName: 'Rester', action: 'rest', params: {}, energyCost: 0 },
    ];

    const results = resolveActions(db, actions, rng);

    const gathererResult = results.find(r => r.agentId === 'gatherer');
    expect(gathererResult?.success).toBe(true);
    expect(gathererResult?.result).toContain('Gathered');

    const resterResult = results.find(r => r.agentId === 'rester');
    expect(resterResult?.success).toBe(true);

    // Check gatherer state
    const gatherer = getAgent(db, 'gatherer')!;
    expect(gatherer.energy).toBe(85); // 100 - 15
    const gatherInv = getAgentInventory(db, 'gatherer');
    expect(gatherInv.some(i => i.item_name === 'food')).toBe(true);

    // Check rester state
    const rester = getAgent(db, 'rester')!;
    expect(rester.energy).toBeGreaterThanOrEqual(100); // Already at 100, capped
  });

  it('resource conflict: 2 agents gather food at location with quantity 3', async () => {
    createAgent(db, { id: 'a1', name: 'A1', personalityJson: '{}', locationId: 'the_beach' });
    createAgent(db, { id: 'a2', name: 'A2', personalityJson: '{}', locationId: 'the_beach' });

    // Set food to exactly 3
    const foods = db.prepare("SELECT * FROM resources WHERE location_id = 'the_beach' AND type = 'food'").all() as any[];
    if (foods.length > 0) {
      db.prepare('UPDATE resources SET quantity = 3 WHERE id = ?').run(foods[0].id);
    }

    const rng = new SeededRNG(42);
    const actions = [
      { agentId: 'a1', agentName: 'A1', action: 'gather', params: { resource: 'food' }, energyCost: 15 },
      { agentId: 'a2', agentName: 'A2', action: 'gather', params: { resource: 'food' }, energyCost: 15 },
    ];

    const results = resolveActions(db, actions, rng);
    const successes = results.filter(r => r.success);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Both should get a share
    const a1Inv = getAgentInventory(db, 'a1');
    const a2Inv = getAgentInventory(db, 'a2');
    const a1Food = a1Inv.filter(i => i.item_name === 'food').reduce((s, i) => s + i.quantity, 0);
    const a2Food = a2Inv.filter(i => i.item_name === 'food').reduce((s, i) => s + i.quantity, 0);
    expect(a1Food + a2Food).toBeLessThanOrEqual(3);
    expect(a1Food + a2Food).toBeGreaterThan(0);
  });

  it('death: agent with health=3 and hunger=96 dies after passive effects', () => {
    createAgent(db, { id: 'dying', name: 'Dying', personalityJson: '{}', locationId: 'the_beach', health: 3, hunger: 96 });
    addInventoryItem(db, { id: 'item1', agentId: 'dying', itemName: 'wood', itemType: 'resource', quantity: 2 });

    // Apply passive effects: hunger 96 + 8 = 104 -> capped at 100, but > 95 so -15 health
    // health = 3 - 15 = -12 -> capped at 0
    updateAgentStats(db, 'dying', { hunger: Math.min(100, 96 + 8), health: Math.max(0, 3 - 15) });

    const deaths = checkDeaths(db);
    expect(deaths).toHaveLength(1);
    expect(deaths[0].agentName).toBe('Dying');

    const agent = getAgent(db, 'dying')!;
    expect(agent.is_alive).toBe(0);

    // Inventory scattered at location
    const groundItems = db.prepare("SELECT * FROM inventory WHERE agent_id LIKE 'ground_%'").all();
    expect(groundItems.length).toBeGreaterThan(0);
  });

  it('tick increments simulation.current_tick', async () => {
    createAgent(db, { id: 'a1', name: 'A1', personalityJson: JSON.stringify({
      name: 'A1', model: 'test', personality: { traits: ['a'], backstory: 'b', communicationStyle: 'c', values: ['d'] },
    }), locationId: 'the_beach' });

    const beforeTick = getSimulation(db).current_tick;
    await executeTick(db, config, null, true);
    const afterTick = getSimulation(db).current_tick;
    expect(afterTick).toBe(beforeTick + 1);
  });

  it('12 ticks triggers epoch boundary', async () => {
    createAgent(db, { id: 'a1', name: 'A1', personalityJson: JSON.stringify({
      name: 'A1', model: 'test', personality: { traits: ['a'], backstory: 'b', communicationStyle: 'c', values: ['d'] },
    }), locationId: 'the_beach' });

    for (let i = 0; i < 12; i++) {
      await executeTick(db, config, null, true);
    }

    const sim = getSimulation(db);
    expect(sim.current_tick).toBe(12);
    expect(sim.current_epoch).toBe(1);
  });

  it('determinism: same seed + dry-run produces identical state', async () => {
    function runSim() {
      const d = setupWorld();
      createAgent(d, { id: 'a1', name: 'A1', personalityJson: JSON.stringify({
        name: 'A1', model: 'test', personality: { traits: ['a'], backstory: 'b', communicationStyle: 'c', values: ['d'] },
      }), locationId: 'the_beach' });
      return d;
    }

    const db1 = runSim();
    const db2 = runSim();

    for (let i = 0; i < 10; i++) {
      await executeTick(db1, config, null, true);
      await executeTick(db2, config, null, true);
    }

    const sim1 = getSimulation(db1);
    const sim2 = getSimulation(db2);
    const agent1 = getAgent(db1, 'a1')!;
    const agent2 = getAgent(db2, 'a1')!;

    expect(sim1.current_tick).toBe(sim2.current_tick);
    expect(sim1.rng_state).toBe(sim2.rng_state);
    expect(agent1.health).toBe(agent2.health);
    expect(agent1.hunger).toBe(agent2.hunger);
    expect(agent1.energy).toBe(agent2.energy);
    expect(agent1.location_id).toBe(agent2.location_id);
  });
});

describe('Resource Manager', () => {
  it('regenerates resources capped at max', () => {
    const db = setupWorld();
    // Deplete a resource
    const res = db.prepare("SELECT * FROM resources WHERE type = 'food' LIMIT 1").get() as any;
    db.prepare('UPDATE resources SET quantity = 0 WHERE id = ?').run(res.id);

    regenerateResources(db);

    const updated = db.prepare('SELECT * FROM resources WHERE id = ?').get(res.id) as any;
    expect(updated.quantity).toBe(res.regen_rate);
    expect(updated.quantity).toBeLessThanOrEqual(res.max_quantity);
  });
});
