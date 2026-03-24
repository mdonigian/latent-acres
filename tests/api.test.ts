import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../src/db/schema.js';
import {
  createAgent, getSimulation, updateSimulation, addInventoryItem,
  appendEvent, setChieftain, createMotion, secondMotion,
  recordCouncilVote, updateMotionTally, updateMotionStatus,
  upsertRelationship,
} from '../src/db/queries.js';
import { seedIslandToDatabase } from '../src/world/island.js';
import { createApiServer, type ServerInstance } from '../src/api/server.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let server: ServerInstance;
let baseUrl: string;

function request(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

beforeEach(async () => {
  db = initDatabase(':memory:', { seed: 42, configJson: JSON.stringify({ ticksPerEpoch: 12, actionsPerTick: 2, seed: 42 }) });
  seedIslandToDatabase(db);

  createAgent(db, { id: 'vex', name: 'Vex', personalityJson: JSON.stringify({ name: 'Vex', personality: { traits: ['cunning'], backstory: 'test', communicationStyle: 'direct', values: ['survival'] } }), locationId: 'the_beach' });
  createAgent(db, { id: 'luna', name: 'Luna', personalityJson: '{}', locationId: 'the_beach' });
  createAgent(db, { id: 'moss', name: 'Moss', personalityJson: '{}', locationId: 'dense_jungle' });
  setChieftain(db, 'vex', true);

  const config = { ticksPerEpoch: 12, actionsPerTick: 2, tickDelayMs: 1000, discussionRounds: 3, seed: 1, dbPath: ':memory:' };
  server = createApiServer(db, 0, config, null, true);
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, () => resolve());
  });
  const addr = server.httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterEach(() => {
  server.close();
});

describe('GET /api/status', () => {
  it('returns tick, epoch, agent count, and cost', async () => {
    const res = await request('/status');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tick).toBe(0);
    expect(data.epoch).toBe(0);
    expect(data.livingAgents).toBe(3);
    expect(data.totalAgents).toBe(3);
    expect(data.cost).toBe(0);
  });
});

describe('GET /api/agents', () => {
  it('returns all agents with correct stats', async () => {
    const res = await request('/agents');
    const data = await res.json();
    expect(data).toHaveLength(3);
    const vex = data.find((a: any) => a.id === 'vex');
    expect(vex.health).toBe(100);
    expect(vex.hunger).toBe(0);
    expect(vex.energy).toBe(100);
    expect(vex.isChieftain).toBe(true);
  });
});

describe('GET /api/agents/:id', () => {
  it('includes inventory, personality, and memory', async () => {
    addInventoryItem(db, { id: 'item1', agentId: 'vex', itemName: 'wood', itemType: 'resource', quantity: 3 });
    const res = await request('/agents/vex');
    const data = await res.json();
    expect(data.id).toBe('vex');
    expect(data.inventory).toHaveLength(1);
    expect(data.inventory[0].name).toBe('wood');
    expect(data.personality).toBeDefined();
    expect(data.shortTermMemory).toBeInstanceOf(Array);
    expect(data.journal).toBeInstanceOf(Array);
  });

  it('returns 404 for nonexistent agent', async () => {
    const res = await request('/agents/nonexistent');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Agent not found');
  });
});

describe('GET /api/events', () => {
  it('returns filtered events with limit', async () => {
    appendEvent(db, { tick: 0, epoch: 0, eventType: 'test', agentId: 'vex', dataJson: '{"detail":"a"}' });
    appendEvent(db, { tick: 0, epoch: 0, eventType: 'test', agentId: 'luna', dataJson: '{"detail":"b"}' });
    appendEvent(db, { tick: 1, epoch: 0, eventType: 'test', agentId: 'vex', dataJson: '{"detail":"c"}' });

    const res = await request('/events?limit=10&agent_id=vex');
    const data = await res.json();
    expect(data.length).toBeLessThanOrEqual(10);
    expect(data.every((e: any) => e.agentId === 'vex')).toBe(true);
  });
});

describe('GET /api/locations', () => {
  it('includes resource levels and present agents', async () => {
    const res = await request('/locations');
    const data = await res.json();
    expect(data.length).toBe(8);
    const beach = data.find((l: any) => l.id === 'the_beach');
    expect(beach.resources.length).toBeGreaterThan(0);
    expect(beach.agents.length).toBe(2); // vex and luna
    for (const r of beach.resources) {
      expect(['scarce', 'moderate', 'abundant']).toContain(r.availability);
    }
  });
});

describe('GET /api/map', () => {
  it('returns nodes and edges for graph rendering', async () => {
    const res = await request('/map');
    const data = await res.json();
    expect(data.nodes).toBeInstanceOf(Array);
    expect(data.edges).toBeInstanceOf(Array);
    expect(data.nodes.length).toBe(8);
    expect(data.edges.length).toBeGreaterThan(0);
    expect(data.nodes[0]).toHaveProperty('id');
    expect(data.nodes[0]).toHaveProperty('name');
    expect(data.edges[0]).toHaveProperty('from');
    expect(data.edges[0]).toHaveProperty('to');
  });
});

describe('GET /api/council/:epoch', () => {
  it('returns council transcript for epoch', async () => {
    // Create a motion for epoch 0
    const result = db.prepare(
      "INSERT INTO council_motions (epoch, motion_type, motion_text, proposed_by, seconded_by, target_agent_id, status, ayes, nays, abstentions, created_at_tick) VALUES (0, 'general', 'Share food', 'vex', 'luna', NULL, 'passed', 2, 1, 0, 12)"
    ).run();

    const res = await request('/council/0');
    const data = await res.json();
    expect(data.epoch).toBe(0);
    expect(data.motions).toBeInstanceOf(Array);
    expect(data.motions.length).toBe(1);
    expect(data.motions[0].text).toBe('Share food');
  });

  it('returns empty for epoch with no council data', async () => {
    const res = await request('/council/5');
    const data = await res.json();
    expect(data.motions).toEqual([]);
  });
});

describe('GET /api/relationships', () => {
  it('returns sentiment scores for all agent pairs', async () => {
    upsertRelationship(db, 'vex', 'luna', 15, 0);
    upsertRelationship(db, 'vex', 'moss', -5, 0);

    const res = await request('/relationships');
    const data = await res.json();
    expect(data.length).toBe(2);
    expect(data[0]).toHaveProperty('agentA');
    expect(data[0]).toHaveProperty('agentB');
    expect(data[0]).toHaveProperty('sentiment');
  });
});

describe('GET /api/export/transcript', () => {
  it('returns markdown string', async () => {
    appendEvent(db, { tick: 0, epoch: 0, eventType: 'gather', agentId: 'vex', dataJson: '{"resource":"food"}' });
    const res = await request('/export/transcript');
    const text = await res.text();
    expect(text).toContain('# Latent Acres Simulation Transcript');
    expect(text).toContain('gather');
  });
});

describe('WebSocket', () => {
  it('clients receive broadcast messages', async () => {
    const addr = server.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const { WebSocket: WsClient } = await import('ws');
    const ws = new WsClient(`ws://127.0.0.1:${port}/ws`);

    const received = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 3000);
      ws.on('open', () => {
        server.broadcast('tick_complete', { tick: 1 });
      });
      ws.on('message', (data: any) => {
        clearTimeout(timeout);
        resolve(JSON.parse(data.toString()));
        ws.close();
      });
    });

    expect(received.type).toBe('tick_complete');
    expect(received.data.tick).toBe(1);
  });
});

describe('Server starts and serves endpoints', () => {
  it('server is listening', async () => {
    const res = await request('/status');
    expect(res.ok).toBe(true);
  });
});
