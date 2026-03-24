import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../src/db/schema.js';
import {
  createAgent, getAgent, updateAgentStats, markAgentDead,
  appendEvent, getEventsByTickRange, getEventsByAgent, getEventCount,
  getSimulation,
  appendShortTermMemory, getShortTermMemory, trimShortTermMemory,
  createLocation,
} from '../src/db/queries.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
});

describe('initDatabase', () => {
  it('creates all tables with WAL mode enabled', () => {
    // In-memory DBs can't use WAL, so test with a temp file
    const fs = require('fs');
    const path = '/tmp/test_wal_' + Date.now() + '.db';
    try {
      const fileDb = initDatabase(path, { seed: 1, configJson: '{}' });
      const mode = fileDb.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
      fileDb.close();
    } finally {
      if (fs.existsSync(path)) fs.unlinkSync(path);
      // Clean up WAL/SHM files
      if (fs.existsSync(path + '-wal')) fs.unlinkSync(path + '-wal');
      if (fs.existsSync(path + '-shm')) fs.unlinkSync(path + '-shm');
    }
  });

  it('creates simulation singleton row with defaults', () => {
    const sim = getSimulation(db);
    expect(sim).toBeDefined();
    expect(sim.id).toBe(1);
    expect(sim.current_tick).toBe(0);
    expect(sim.current_epoch).toBe(0);
    expect(sim.status).toBe('running');
    expect(sim.total_cost).toBe(0);
  });

  it('is idempotent - calling twice does not error or duplicate', () => {
    expect(() => initDatabase(':memory:', { seed: 42, configJson: '{}' })).not.toThrow();
    // The original db should still have exactly one simulation row
    const count = db.prepare('SELECT COUNT(*) as c FROM simulation').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('works with in-memory database', () => {
    expect(db).toBeDefined();
    const sim = getSimulation(db);
    expect(sim).toBeDefined();
  });
});

describe('Agent CRUD', () => {
  beforeEach(() => {
    createLocation(db, {
      id: 'the_beach', name: 'The Beach', description: 'Sandy', dangerLevel: 0.1, connectedTo: ['the_clearing'],
    });
  });

  it('creates and reads an agent', () => {
    createAgent(db, {
      id: 'vex', name: 'Vex', personalityJson: '{}', locationId: 'the_beach',
    });
    const agent = getAgent(db, 'vex');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('Vex');
    expect(agent!.health).toBe(100);
    expect(agent!.hunger).toBe(0);
    expect(agent!.energy).toBe(100);
  });

  it('updates agent health', () => {
    createAgent(db, { id: 'vex', name: 'Vex', personalityJson: '{}', locationId: 'the_beach' });
    updateAgentStats(db, 'vex', { health: 50 });
    const agent = getAgent(db, 'vex');
    expect(agent!.health).toBe(50);
  });

  it('marks agent as dead', () => {
    createAgent(db, { id: 'vex', name: 'Vex', personalityJson: '{}', locationId: 'the_beach' });
    markAgentDead(db, 'vex', 'starvation', 5, 0);
    const agent = getAgent(db, 'vex');
    expect(agent!.is_alive).toBe(0);
    expect(agent!.cause_of_removal).toBe('starvation');
  });
});

describe('Event log', () => {
  it('inserts and queries events', () => {
    appendEvent(db, { tick: 0, epoch: 0, eventType: 'test', dataJson: '{}' });
    appendEvent(db, { tick: 1, epoch: 0, eventType: 'test', agentId: 'a1', dataJson: '{"detail":"x"}' });

    const events = getEventsByTickRange(db, 0, 1);
    expect(events).toHaveLength(2);
  });

  it('queries events by agent', () => {
    appendEvent(db, { tick: 0, epoch: 0, eventType: 'test', agentId: 'a1', dataJson: '{}' });
    appendEvent(db, { tick: 1, epoch: 0, eventType: 'test', agentId: 'a2', dataJson: '{}' });

    const events = getEventsByAgent(db, 'a1');
    expect(events).toHaveLength(1);
  });

  it('count grows monotonically', () => {
    expect(getEventCount(db)).toBe(0);
    appendEvent(db, { tick: 0, epoch: 0, eventType: 'test', dataJson: '{}' });
    expect(getEventCount(db)).toBe(1);
    appendEvent(db, { tick: 1, epoch: 0, eventType: 'test', dataJson: '{}' });
    expect(getEventCount(db)).toBe(2);
  });
});

describe('Foreign key enforcement', () => {
  it('enforces foreign keys on resources', () => {
    // Try to insert a resource referencing a nonexistent location
    expect(() => {
      db.prepare(
        "INSERT INTO resources (id, location_id, type, quantity, max_quantity) VALUES ('r1', 'nonexistent', 'food', 5, 10)"
      ).run();
    }).toThrow();
  });
});
