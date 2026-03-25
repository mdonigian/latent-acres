import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { initDatabase } from '../src/db/schema.js';
import { createAgent, getSimulation, getLivingAgents, getAgentByName, getAgentInventory } from '../src/db/queries.js';
import { seedIslandToDatabase } from '../src/world/island.js';
import { estimateCost, MAX_COST_PER_TICK, COST_WARNING_THRESHOLD, trackCost, getTotalCost } from '../src/utils/cost-tracker.js';
import { rateLimitedBatch, BATCH_SIZE, INTER_BATCH_DELAY_MS } from '../src/utils/rate-limiter.js';
import { executeTick } from '../src/engine/tick-loop.js';
import type Database from 'better-sqlite3';

describe('Configuration', () => {
  it('loadConfig has correct defaults', () => {
    const config = loadConfig();
    expect(config.ticksPerEpoch).toBe(12);
    expect(config.actionsPerTick).toBe(6);
    expect(config.tickDelayMs).toBe(1000);
    expect(config.discussionRounds).toBe(3);
    expect(config.dbPath).toBe('data/latent-acres.db');
  });

  it('supports overrides', () => {
    const config = loadConfig({ seed: 42, tickDelayMs: 500 });
    expect(config.seed).toBe(42);
    expect(config.tickDelayMs).toBe(500);
  });
});

describe('Status command behavior', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', { seed: 42, configJson: JSON.stringify(loadConfig({ seed: 42 })) });
    seedIslandToDatabase(db);
  });

  it('shows tick 0, epoch 0, and $0.00 cost on fresh init', () => {
    const sim = getSimulation(db);
    expect(sim.current_tick).toBe(0);
    expect(sim.current_epoch).toBe(0);
    expect(sim.total_cost).toBe(0);
  });

  it('shows agent count', () => {
    createAgent(db, { id: 'vex', name: 'Vex', personalityJson: '{}', locationId: 'the_beach' });
    createAgent(db, { id: 'luna', name: 'Luna', personalityJson: '{}', locationId: 'the_beach' });
    const living = getLivingAgents(db);
    expect(living).toHaveLength(2);
  });
});

describe('Inspect command behavior', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
    seedIslandToDatabase(db);
    createAgent(db, { id: 'vex', name: 'Vex', personalityJson: '{}', locationId: 'the_beach' });
  });

  it('shows agent stats', () => {
    const agent = getAgentByName(db, 'Vex');
    expect(agent).toBeDefined();
    expect(agent!.health).toBe(100);
    expect(agent!.hunger).toBe(0);
    expect(agent!.energy).toBe(100);
    expect(agent!.location_id).toBe('the_beach');
  });

  it('shows agent inventory', () => {
    const inventory = getAgentInventory(db, 'vex');
    expect(inventory).toBeInstanceOf(Array);
  });
});

describe('Run --ticks 1 --dry-run', () => {
  it('executes one tick and increments counter', async () => {
    const db = initDatabase(':memory:', { seed: 42, configJson: JSON.stringify(loadConfig({ seed: 42 })) });
    seedIslandToDatabase(db);
    createAgent(db, { id: 'vex', name: 'Vex', personalityJson: JSON.stringify({
      name: 'Vex', model: 'test',
      personality: { traits: ['a'], backstory: 'b', communicationStyle: 'c', values: ['d'] },
    }), locationId: 'the_beach' });

    const config = loadConfig({ seed: 42, tickDelayMs: 0 });
    await executeTick(db, config, null, true);

    const sim = getSimulation(db);
    expect(sim.current_tick).toBe(1);
  });
});

describe('Cost Tracker', () => {
  it('estimates cost correctly', () => {
    const cost = estimateCost(1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('accumulates across ticks', () => {
    const db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
    const r1 = trackCost(db, 1000, 500);
    const r2 = trackCost(db, 1000, 500);
    expect(r2.totalCost).toBeGreaterThan(r1.totalCost);
    expect(r2.totalCost).toBeCloseTo(r1.tickCost * 2, 10);
  });

  it('has correct guardrails', () => {
    expect(MAX_COST_PER_TICK).toBe(0.50);
    expect(COST_WARNING_THRESHOLD).toBe(50.00);
  });
});

describe('Rate Limiter', () => {
  it('BATCH_SIZE is 4', () => {
    expect(BATCH_SIZE).toBe(4);
  });

  it('processes items in batches', async () => {
    const callOrder: number[] = [];
    const items = [1, 2, 3, 4, 5, 6];

    const results = await rateLimitedBatch(items, async (item) => {
      callOrder.push(item);
      return item * 2;
    }, 4, 0);

    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(callOrder).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ensures no more than BATCH_SIZE concurrent calls', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    await rateLimitedBatch(items, async (item) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 10));
      concurrent--;
      return item;
    }, 4, 0);

    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });
});
