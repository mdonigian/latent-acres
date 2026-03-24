import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../src/db/schema.js';
import {
  createAgent, getAgent, addInventoryItem, getAgentInventory,
  getRelationship, getShortTermMemory, getEventCount,
  getAlliance,
} from '../src/db/queries.js';
import { seedIslandToDatabase } from '../src/world/island.js';
import { speak, giveItem, proposeAlliance, betrayAlliance } from '../src/engine/social.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
  seedIslandToDatabase(db);
  createAgent(db, { id: 'a', name: 'AgentA', personalityJson: '{}', locationId: 'the_beach' });
  createAgent(db, { id: 'b', name: 'AgentB', personalityJson: '{}', locationId: 'the_beach' });
  createAgent(db, { id: 'c', name: 'AgentC', personalityJson: '{}', locationId: 'dense_jungle' });
  createAgent(db, { id: 'd', name: 'AgentD', personalityJson: '{}', locationId: 'the_beach' });
});

describe('Speech', () => {
  it('public speech: Agent B at same location receives, Agent C at different location does not', () => {
    const result = speak(db, 'a', 'Hello everyone!');
    expect(result.success).toBe(true);

    const bMemory = getShortTermMemory(db, 'b', 10);
    expect(bMemory.some(m => m.content.includes('Hello everyone!'))).toBe(true);

    const cMemory = getShortTermMemory(db, 'c', 10);
    expect(cMemory.some(m => m.content.includes('Hello everyone!'))).toBe(false);
  });

  it('whisper: only target receives the message', () => {
    const result = speak(db, 'a', 'Secret message', 'b');
    expect(result.success).toBe(true);

    const bMemory = getShortTermMemory(db, 'b', 10);
    expect(bMemory.some(m => m.content.includes('Secret message'))).toBe(true);

    const dMemory = getShortTermMemory(db, 'd', 10);
    expect(dMemory.some(m => m.content.includes('Secret message'))).toBe(false);
  });

  it('whisper to agent at different location fails', () => {
    const result = speak(db, 'a', 'Hey', 'c');
    expect(result.success).toBe(false);
  });
});

describe('Giving', () => {
  it('give item transfers from giver to receiver and increases sentiment', () => {
    addInventoryItem(db, { id: 'food1', agentId: 'a', itemName: 'food', itemType: 'resource', quantity: 3 });

    const result = giveItem(db, 'a', 'b', 'food');
    expect(result.success).toBe(true);

    const aInv = getAgentInventory(db, 'a');
    const aFood = aInv.find(i => i.item_name === 'food');
    expect(aFood!.quantity).toBe(2);

    const bInv = getAgentInventory(db, 'b');
    expect(bInv.some(i => i.item_name === 'food')).toBe(true);

    const rel = getRelationship(db, 'a', 'b');
    expect(rel).toBeDefined();
    expect(rel!.sentiment).toBe(8);
  });

  it('give to agent at different location fails', () => {
    addInventoryItem(db, { id: 'food1', agentId: 'a', itemName: 'food', itemType: 'resource', quantity: 1 });
    const result = giveItem(db, 'a', 'c', 'food');
    expect(result.success).toBe(false);
  });

  it('give item not in inventory fails', () => {
    const result = giveItem(db, 'a', 'b', 'diamond');
    expect(result.success).toBe(false);
  });
});

describe('Alliances', () => {
  it('propose alliance creates alliance with both members', () => {
    const result = proposeAlliance(db, 'a', 'b', 'Survivors');
    expect(result.success).toBe(true);

    // Find the alliance
    const alliances = db.prepare('SELECT * FROM alliances WHERE name = ?').all('Survivors') as any[];
    expect(alliances).toHaveLength(1);
    const members = JSON.parse(alliances[0].members_json);
    expect(members).toContain('a');
    expect(members).toContain('b');
  });

  it('betray alliance removes agent silently', () => {
    proposeAlliance(db, 'a', 'b', 'Survivors');
    const alliances = db.prepare('SELECT * FROM alliances WHERE name = ?').all('Survivors') as any[];
    const allianceId = alliances[0].id;

    const result = betrayAlliance(db, 'a', allianceId);
    expect(result.success).toBe(true);

    const updated = getAlliance(db, allianceId)!;
    const members = JSON.parse(updated.members_json);
    expect(members).not.toContain('a');
    expect(members).toContain('b');

    // Agent B should NOT receive a notification about the betrayal
    const bMemory = getShortTermMemory(db, 'b', 100);
    expect(bMemory.some(m => m.type === 'alliance_betrayal')).toBe(false);
  });
});

describe('Event Logging', () => {
  it('all social actions are logged in event_log', () => {
    const before = (db.prepare('SELECT COUNT(*) as c FROM event_log').get() as any).c;

    speak(db, 'a', 'Hello');
    addInventoryItem(db, { id: 'food1', agentId: 'a', itemName: 'food', itemType: 'resource', quantity: 1 });
    giveItem(db, 'a', 'b', 'food');
    proposeAlliance(db, 'a', 'b', 'Test');

    const after = (db.prepare('SELECT COUNT(*) as c FROM event_log').get() as any).c;
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeGreaterThanOrEqual(3);
  });
});
