import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../src/db/schema.js';
import {
  createAgent, addInventoryItem, getAgentInventory, getAgent,
  updateAgentStats, getResourcesAtLocation,
  getStructuresAtLocation, getLocationStorage,
  createLocationStructure,
} from '../src/db/queries.js';
import { seedIslandToDatabase, DEFAULT_ISLAND } from '../src/world/island.js';
import { craft, canCraft, RECIPES } from '../src/world/crafting.js';
import { resolveActions } from '../src/engine/action-resolver.js';
import { regenerateResources } from '../src/engine/resource-manager.js';
import { buildPerception } from '../src/agents/perception.js';
import { SeededRNG } from '../src/rng.js';
import type Database from 'better-sqlite3';

function setupDb(): Database.Database {
  const db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
  seedIslandToDatabase(db);
  return db;
}

function giveItems(db: Database.Database, agentId: string, items: { name: string; type: string; qty: number; props?: Record<string, unknown> }[]) {
  for (let i = 0; i < items.length; i++) {
    addInventoryItem(db, {
      id: `${agentId}_${items[i].name}_${i}`,
      agentId,
      itemName: items[i].name,
      itemType: items[i].type,
      quantity: items[i].qty,
      propertiesJson: items[i].props ? JSON.stringify(items[i].props) : undefined,
    });
  }
}

describe('Island resources', () => {
  it('has 7 resource types across the island', () => {
    const db = setupDb();
    const allResources = db.prepare('SELECT DISTINCT type FROM resources').all() as { type: string }[];
    const types = new Set(allResources.map(r => r.type));
    for (const t of ['food', 'wood', 'stone', 'fiber', 'freshwater', 'clay', 'herbs']) {
      expect(types.has(t), `Missing resource type: ${t}`).toBe(true);
    }
  });

  it('clay exists at Waterfall, Tidal Pools, and Mangrove Swamp', () => {
    const db = setupDb();
    for (const locId of ['waterfall', 'tidal_pools', 'mangrove_swamp']) {
      const resources = getResourcesAtLocation(db, locId);
      expect(resources.some(r => r.type === 'clay'), `No clay at ${locId}`).toBe(true);
    }
  });

  it('herbs exists at Dense Jungle and Mangrove Swamp', () => {
    const db = setupDb();
    for (const locId of ['dense_jungle', 'mangrove_swamp']) {
      const resources = getResourcesAtLocation(db, locId);
      expect(resources.some(r => r.type === 'herbs'), `No herbs at ${locId}`).toBe(true);
    }
  });
});

describe('Recipes', () => {
  it('has exactly 22 recipes', () => {
    expect(RECIPES).toHaveLength(22);
  });

  it('all 22 recipes can be crafted when agent has required inputs', () => {
    const db = setupDb();
    for (const recipe of RECIPES) {
      const agentId = `test_${recipe.id}`;
      createAgent(db, { id: agentId, name: agentId, personalityJson: '{}', locationId: 'the_clearing' });
      // Give generous amounts of all possible inputs
      const allInputNames = [...new Set(recipe.inputs.map(i => i.itemName))];
      for (const name of allInputNames) {
        const needed = recipe.inputs.find(i => i.itemName === name)!.quantity;
        addInventoryItem(db, {
          id: `${agentId}_${name}`,
          agentId,
          itemName: name,
          itemType: 'resource',
          quantity: needed + 10,
        });
      }
      const result = craft(db, agentId, recipe.id, 'the_clearing', 1);
      expect(result.success, `Recipe ${recipe.id} failed: ${result.reason}`).toBe(true);
    }
  });
});

describe('Structure crafting', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
    createAgent(db, { id: 'builder', name: 'Builder', personalityJson: '{}', locationId: 'the_clearing' });
  });

  it('crafting shelter places a structure at location, not inventory', () => {
    giveItems(db, 'builder', [
      { name: 'wood', type: 'resource', qty: 5 },
      { name: 'fiber', type: 'resource', qty: 3 },
    ]);
    const result = craft(db, 'builder', 'shelter', 'the_clearing', 1);
    expect(result.success).toBe(true);
    expect(result.outputItem).toBe('shelter');

    // Should be in location_structures, not inventory
    const inv = getAgentInventory(db, 'builder');
    expect(inv.some(i => i.item_name === 'shelter')).toBe(false);
    const structures = getStructuresAtLocation(db, 'the_clearing');
    expect(structures.some(s => s.structure_type === 'shelter')).toBe(true);
  });

  it('building a new shelter replaces the old one (only one shelter/hut per location)', () => {
    giveItems(db, 'builder', [{ name: 'wood', type: 'resource', qty: 10 }, { name: 'fiber', type: 'resource', qty: 6 }]);
    craft(db, 'builder', 'shelter', 'the_clearing', 1);
    craft(db, 'builder', 'shelter', 'the_clearing', 2);
    const structures = getStructuresAtLocation(db, 'the_clearing');
    expect(structures.filter(s => s.structure_type === 'shelter')).toHaveLength(1);
  });

  it('crafting hut replaces existing shelter', () => {
    // Place a shelter first
    createLocationStructure(db, {
      id: 'the_clearing_shelter_existing',
      locationId: 'the_clearing',
      structureType: 'shelter',
      propertiesJson: JSON.stringify({ restBonus: 10 }),
    });
    giveItems(db, 'builder', [
      { name: 'treated_wood', type: 'material', qty: 3 },
      { name: 'rope', type: 'material', qty: 2 },
      { name: 'clay_brick', type: 'material', qty: 4 },
    ]);
    craft(db, 'builder', 'hut', 'the_clearing', 2);
    const structures = getStructuresAtLocation(db, 'the_clearing');
    expect(structures.some(s => s.structure_type === 'shelter')).toBe(false);
    expect(structures.some(s => s.structure_type === 'hut')).toBe(true);
  });
});

describe('Rest with structures', () => {
  let db: Database.Database;
  const rng = new SeededRNG(42);

  beforeEach(() => {
    db = setupDb();
    createAgent(db, { id: 'rester', name: 'Rester', personalityJson: '{}', locationId: 'the_clearing' });
    updateAgentStats(db, 'rester', { energy: 50 });
  });

  it('resting at location with hut gives at least +25 bonus energy', () => {
    createLocationStructure(db, {
      id: 'the_clearing_hut',
      locationId: 'the_clearing',
      structureType: 'hut',
      propertiesJson: JSON.stringify({ restBonus: 25, weatherProtection: true }),
    });
    const actions = [{ agentId: 'rester', agentName: 'Rester', action: 'rest', params: {}, energyCost: 0 }];
    resolveActions(db, actions, rng);
    const agent = getAgent(db, 'rester')!;
    // Base recovery 25-40 + 25 hut bonus = at least 50 energy gained, capped at 100
    expect(agent.energy).toBe(100);
  });

  it('resting without structures gives base recovery only', () => {
    const actions = [{ agentId: 'rester', agentName: 'Rester', action: 'rest', params: {}, energyCost: 0 }];
    resolveActions(db, actions, rng);
    const agent = getAgent(db, 'rester')!;
    // 50 + (25..40) = 75..90
    expect(agent.energy).toBeGreaterThanOrEqual(75);
    expect(agent.energy).toBeLessThanOrEqual(90);
  });
});

describe('use_item', () => {
  let db: Database.Database;
  const rng = new SeededRNG(42);

  beforeEach(() => {
    db = setupDb();
    createAgent(db, { id: 'user', name: 'User', personalityJson: '{}', locationId: 'the_clearing' });
    updateAgentStats(db, 'user', { health: 60, energy: 50, hunger: 50 });
  });

  it('herbal_poultice heals 20 health and removes item from inventory', () => {
    giveItems(db, 'user', [{ name: 'herbal_poultice', type: 'consumable', qty: 1, props: { healAmount: 20 } }]);
    const actions = [{ agentId: 'user', agentName: 'User', action: 'use_item', params: { item: 'herbal_poultice' }, energyCost: 0 }];
    resolveActions(db, actions, rng);
    const agent = getAgent(db, 'user')!;
    expect(agent.health).toBe(80);
    const inv = getAgentInventory(db, 'user');
    expect(inv.some(i => i.item_name === 'herbal_poultice')).toBe(false);
  });

  it('fails on non-consumable item', () => {
    giveItems(db, 'user', [{ name: 'stone_axe', type: 'tool', qty: 1 }]);
    const actions = [{ agentId: 'user', agentName: 'User', action: 'use_item', params: { item: 'stone_axe' }, energyCost: 0 }];
    const results = resolveActions(db, actions, rng);
    expect(results[0].success).toBe(false);
    expect(results[0].result).toContain('not a consumable');
  });

  it('fails when item not in inventory', () => {
    const actions = [{ agentId: 'user', agentName: 'User', action: 'use_item', params: { item: 'medicine' }, energyCost: 0 }];
    const results = resolveActions(db, actions, rng);
    expect(results[0].success).toBe(false);
  });
});

describe('deposit and withdraw', () => {
  let db: Database.Database;
  const rng = new SeededRNG(42);

  beforeEach(() => {
    db = setupDb();
    createAgent(db, { id: 'agent', name: 'Agent', personalityJson: '{}', locationId: 'the_clearing' });
    // Place a storage chest at the location
    createLocationStructure(db, {
      id: 'the_clearing_storage_chest',
      locationId: 'the_clearing',
      structureType: 'storage_chest',
      propertiesJson: JSON.stringify({ sharedStorage: true, capacity: 20 }),
    });
  });

  it('deposit moves item from agent inventory to location storage', () => {
    giveItems(db, 'agent', [{ name: 'wood', type: 'resource', qty: 3 }]);
    const actions = [{ agentId: 'agent', agentName: 'Agent', action: 'deposit', params: { item: 'wood' }, energyCost: 0 }];
    const results = resolveActions(db, actions, rng);
    expect(results[0].success).toBe(true);
    const inv = getAgentInventory(db, 'agent');
    const woodInInv = inv.find(i => i.item_name === 'wood');
    expect(woodInInv?.quantity ?? 0).toBe(2);
    const storage = getLocationStorage(db, 'the_clearing');
    expect(storage.some(s => s.item_name === 'wood')).toBe(true);
  });

  it('withdraw moves item from location storage to agent inventory', () => {
    // Pre-populate storage
    db.prepare(
      'INSERT INTO location_storage (id, location_id, item_name, item_type, quantity) VALUES (?, ?, ?, ?, ?)'
    ).run('test_storage_wood', 'the_clearing', 'wood', 'resource', 2);

    const actions = [{ agentId: 'agent', agentName: 'Agent', action: 'withdraw', params: { item: 'wood' }, energyCost: 0 }];
    const results = resolveActions(db, actions, rng);
    expect(results[0].success).toBe(true);
    const inv = getAgentInventory(db, 'agent');
    expect(inv.some(i => i.item_name === 'wood')).toBe(true);
    const storage = getLocationStorage(db, 'the_clearing');
    const woodInStorage = storage.find(s => s.item_name === 'wood');
    expect(woodInStorage?.quantity ?? 0).toBe(1);
  });

  it('deposit fails without storage chest', () => {
    createAgent(db, { id: 'nomad', name: 'Nomad', personalityJson: '{}', locationId: 'the_beach' });
    giveItems(db, 'nomad', [{ name: 'wood', type: 'resource', qty: 1 }]);
    const actions = [{ agentId: 'nomad', agentName: 'Nomad', action: 'deposit', params: { item: 'wood' }, energyCost: 0 }];
    const results = resolveActions(db, actions, rng);
    expect(results[0].success).toBe(false);
  });

  it('withdraw fails when item not in storage', () => {
    const actions = [{ agentId: 'agent', agentName: 'Agent', action: 'withdraw', params: { item: 'stone_axe' }, energyCost: 0 }];
    const results = resolveActions(db, actions, rng);
    expect(results[0].success).toBe(false);
  });
});

describe('Rain collector', () => {
  it('adds freshwater to location during resource regeneration', () => {
    const db = setupDb();
    // Waterfall has freshwater — place rain collector there
    createLocationStructure(db, {
      id: 'waterfall_rain_collector',
      locationId: 'waterfall',
      structureType: 'rain_collector',
      propertiesJson: JSON.stringify({ freshwaterGen: 2 }),
    });
    const before = getResourcesAtLocation(db, 'waterfall').find(r => r.type === 'freshwater')!;
    // Deplete freshwater slightly so regen can happen
    db.prepare('UPDATE resources SET quantity = 5 WHERE id = ?').run(before.id);
    regenerateResources(db);
    const after = getResourcesAtLocation(db, 'waterfall').find(r => r.type === 'freshwater')!;
    // Standard regen (3) + rain collector (2) = +5, but Math.floor applied, capped at max
    expect(after.quantity).toBeGreaterThan(5);
  });
});

describe('Agent perception includes structures', () => {
  it('location.structures contains structures at agent location', () => {
    const db = setupDb();
    createAgent(db, { id: 'observer', name: 'Observer', personalityJson: '{}', locationId: 'the_clearing' });
    createLocationStructure(db, {
      id: 'the_clearing_shelter',
      locationId: 'the_clearing',
      structureType: 'shelter',
      propertiesJson: JSON.stringify({ restBonus: 10 }),
    });
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get('observer') as any;
    const perception = buildPerception(db, agent, 'The Clearing', 'A clearing', 12);
    expect(perception.location.structures).toBeDefined();
    expect(perception.location.structures.some(s => s.type === 'shelter')).toBe(true);
    expect(perception.location.structures.find(s => s.type === 'shelter')?.properties).toMatchObject({ restBonus: 10 });
  });

  it('location.structures is empty when no structures present', () => {
    const db = setupDb();
    createAgent(db, { id: 'observer2', name: 'Observer2', personalityJson: '{}', locationId: 'the_beach' });
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get('observer2') as any;
    const perception = buildPerception(db, agent, 'The Beach', 'A beach', 12);
    expect(perception.location.structures).toHaveLength(0);
  });
});

describe('Tier 3 recipe crafting', () => {
  it('reinforced_axe crafts successfully with stone_axe (T1 output) as input', () => {
    const db = setupDb();
    createAgent(db, { id: 'crafter', name: 'Crafter', personalityJson: '{}', locationId: 'the_clearing' });
    giveItems(db, 'crafter', [
      { name: 'stone_axe', type: 'tool', qty: 1, props: { gatherBonus: 0.2 } },
      { name: 'rope', type: 'material', qty: 1 },
      { name: 'treated_wood', type: 'material', qty: 1 },
    ]);
    const result = craft(db, 'crafter', 'reinforced_axe', 'the_clearing', 1);
    expect(result.success).toBe(true);
    expect(result.outputItem).toBe('reinforced_axe');
    const inv = getAgentInventory(db, 'crafter');
    const axe = inv.find(i => i.item_name === 'reinforced_axe');
    expect(axe).toBeDefined();
    // stone_axe should be consumed
    expect(inv.some(i => i.item_name === 'stone_axe')).toBe(false);
  });
});

describe('Crafting atomicity', () => {
  it('no state mutation when crafting fails due to insufficient materials', () => {
    const db = setupDb();
    createAgent(db, { id: 'fail_crafter', name: 'Fail', personalityJson: '{}', locationId: 'the_clearing' });
    giveItems(db, 'fail_crafter', [{ name: 'wood', type: 'resource', qty: 1 }]);
    const result = craft(db, 'fail_crafter', 'stone_axe', 'the_clearing', 1);
    expect(result.success).toBe(false);
    const inv = getAgentInventory(db, 'fail_crafter');
    const wood = inv.find(i => i.item_name === 'wood');
    expect(wood?.quantity).toBe(1); // unchanged
  });

  it('unknown recipe returns descriptive failure', () => {
    const db = setupDb();
    createAgent(db, { id: 'x', name: 'X', personalityJson: '{}', locationId: 'the_clearing' });
    const result = canCraft(db, 'x', 'magic_potion');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Unknown recipe');
  });
});

describe('Kiln doubles clay_brick output', () => {
  it('produces 2 clay_brick when kiln is at location', () => {
    const db = setupDb();
    createAgent(db, { id: 'brickmaker', name: 'Brickmaker', personalityJson: '{}', locationId: 'the_clearing' });
    createLocationStructure(db, {
      id: 'the_clearing_kiln',
      locationId: 'the_clearing',
      structureType: 'kiln',
      propertiesJson: JSON.stringify({ doublesClayBrick: true }),
    });
    giveItems(db, 'brickmaker', [
      { name: 'clay', type: 'resource', qty: 3 },
      { name: 'wood', type: 'resource', qty: 1 },
    ]);
    const result = craft(db, 'brickmaker', 'clay_brick', 'the_clearing', 1);
    expect(result.success).toBe(true);
    const inv = getAgentInventory(db, 'brickmaker');
    const bricks = inv.find(i => i.item_name === 'clay_brick');
    expect(bricks?.quantity).toBe(2);
  });
});
