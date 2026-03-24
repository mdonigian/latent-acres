import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_ISLAND, validateIslandGraph, isAdjacent, seedIslandToDatabase } from '../src/world/island.js';
import { craft, canCraft, RECIPES } from '../src/world/crafting.js';
import { generateWeather } from '../src/world/weather.js';
import { initDatabase } from '../src/db/schema.js';
import { createAgent, addInventoryItem, getAgentInventory, getResourcesAtLocation, updateResourceQuantity } from '../src/db/queries.js';
import { SeededRNG } from '../src/rng.js';
import type Database from 'better-sqlite3';

describe('Island', () => {
  it('has exactly 8 locations', () => {
    expect(DEFAULT_ISLAND).toHaveLength(8);
  });

  it('has a connected graph', () => {
    expect(validateIslandGraph(DEFAULT_ISLAND)).toBe(true);
  });

  it('all connections are bidirectional', () => {
    for (const loc of DEFAULT_ISLAND) {
      for (const connId of loc.connectedTo) {
        const other = DEFAULT_ISLAND.find(l => l.id === connId);
        expect(other).toBeDefined();
        expect(other!.connectedTo).toContain(loc.id);
      }
    }
  });

  it('isAdjacent works correctly', () => {
    expect(isAdjacent(DEFAULT_ISLAND, 'the_beach', 'the_clearing')).toBe(true);
    expect(isAdjacent(DEFAULT_ISLAND, 'the_beach', 'the_summit')).toBe(false);
  });

  it('throws for invalid location ID', () => {
    expect(() => isAdjacent(DEFAULT_ISLAND, 'nonexistent', 'the_beach')).toThrow('Invalid location ID');
  });
});

describe('Resource regeneration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
    seedIslandToDatabase(db);
  });

  it('depleted resource gains regenRate per tick, capped at max', () => {
    const resources = getResourcesAtLocation(db, 'the_beach');
    const food = resources.find(r => r.type === 'food')!;

    // Deplete to 0
    updateResourceQuantity(db, food.id, 0);

    // Simulate regeneration
    const afterRegen = Math.min(0 + food.regen_rate, food.max_quantity);
    updateResourceQuantity(db, food.id, afterRegen);

    const updated = getResourcesAtLocation(db, 'the_beach').find(r => r.type === 'food')!;
    expect(updated.quantity).toBe(food.regen_rate);
    expect(updated.quantity).toBeLessThanOrEqual(food.max_quantity);
  });
});

describe('Crafting', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
    seedIslandToDatabase(db);
    createAgent(db, { id: 'crafter', name: 'Crafter', personalityJson: '{}', locationId: 'the_beach' });
  });

  it('crafts fishing_spear with correct materials', () => {
    addInventoryItem(db, { id: 'w1', agentId: 'crafter', itemName: 'wood', itemType: 'resource', quantity: 5 });
    addInventoryItem(db, { id: 's1', agentId: 'crafter', itemName: 'stone', itemType: 'resource', quantity: 3 });

    const result = craft(db, 'crafter', 'fishing_spear');
    expect(result.success).toBe(true);
    expect(result.outputItem).toBe('fishing_spear');

    const inventory = getAgentInventory(db, 'crafter');
    const spear = inventory.find(i => i.item_name === 'fishing_spear');
    expect(spear).toBeDefined();

    // Check materials were consumed
    const wood = inventory.find(i => i.item_name === 'wood');
    expect(wood!.quantity).toBe(3); // 5 - 2
    const stone = inventory.find(i => i.item_name === 'stone');
    expect(stone!.quantity).toBe(2); // 3 - 1
  });

  it('fails to craft with insufficient materials', () => {
    addInventoryItem(db, { id: 'w1', agentId: 'crafter', itemName: 'wood', itemType: 'resource', quantity: 1 });

    const result = craft(db, 'crafter', 'fishing_spear');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Insufficient');

    // Inventory unchanged
    const inventory = getAgentInventory(db, 'crafter');
    const wood = inventory.find(i => i.item_name === 'wood');
    expect(wood!.quantity).toBe(1);
  });

  it('canCraft returns failure for unknown recipe', () => {
    const result = canCraft(db, 'crafter', 'nonexistent');
    expect(result.success).toBe(false);
  });
});

describe('Weather', () => {
  it('produces deterministic weather for the same RNG state', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);

    const weather1 = generateWeather(rng1);
    const weather2 = generateWeather(rng2);

    expect(weather1.type).toBe(weather2.type);
    expect(weather1.intensity).toBe(weather2.intensity);
    expect(weather1.description).toBe(weather2.description);
  });

  it('weather has valid type', () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 50; i++) {
      const weather = generateWeather(rng);
      expect(['clear', 'rain', 'storm', 'overcast']).toContain(weather.type);
    }
  });
});
