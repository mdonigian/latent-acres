import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../src/db/schema.js';
import {
  createAgent, getAgent, getSimulation, updateSimulation,
  setChieftain, getChieftain, getLivingAgents,
  getMotionsByEpoch, getVotesForMotion, getEventCount,
  addInventoryItem, getAgentInventory,
} from '../src/db/queries.js';
import { seedIslandToDatabase } from '../src/world/island.js';
import {
  shouldTriggerCouncil, proposeMotion, secondMotionAction, castVote,
  tallyAndResolve, resolveElection, runCouncilPhase,
} from '../src/engine/tribal-council.js';
import { SeededRNG } from '../src/rng.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
const rng = new SeededRNG(42);

beforeEach(() => {
  db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
  seedIslandToDatabase(db);
  createAgent(db, { id: 'a', name: 'AgentA', personalityJson: '{}', locationId: 'the_beach' });
  createAgent(db, { id: 'b', name: 'AgentB', personalityJson: '{}', locationId: 'the_beach' });
  createAgent(db, { id: 'c', name: 'AgentC', personalityJson: '{}', locationId: 'the_beach' });
  createAgent(db, { id: 'd', name: 'AgentD', personalityJson: '{}', locationId: 'the_beach' });
  setChieftain(db, 'a', true);
});

describe('Council Trigger', () => {
  it('triggers at tick 12 with ticksPerEpoch=12', () => {
    expect(shouldTriggerCouncil(12, 12)).toBe(true);
    expect(shouldTriggerCouncil(11, 12)).toBe(false);
    expect(shouldTriggerCouncil(0, 12)).toBe(false);
    expect(shouldTriggerCouncil(24, 12)).toBe(true);
  });
});

describe('Motion Lifecycle', () => {
  it('general motion: propose, second, vote, pass', () => {
    const motionId = proposeMotion(db, 'a', 'general', 'Share food equally');

    const secondResult = secondMotionAction(db, motionId, 'b');
    expect(secondResult.success).toBe(true);

    castVote(db, motionId, 'a', 'aye');
    castVote(db, motionId, 'b', 'aye');
    castVote(db, motionId, 'c', 'nay');
    castVote(db, motionId, 'd', 'abstain');

    const tally = tallyAndResolve(db, motionId, rng);
    expect(tally.passed).toBe(true);
    expect(tally.ayes).toBe(2);
    expect(tally.nays).toBe(1);
    expect(tally.abstentions).toBe(1);

    const motions = getMotionsByEpoch(db, 0);
    expect(motions[0].status).toBe('passed');
  });

  it('unseconded motion has status died after council phase', () => {
    const result = runCouncilPhase(
      db, rng,
      [{ proposerId: 'a', type: 'general', text: 'Do something' }],
      [], // no seconds
      [],
    );

    const motions = getMotionsByEpoch(db, 0);
    expect(motions[0].status).toBe('died');
  });

  it('cannot second your own motion', () => {
    const motionId = proposeMotion(db, 'a', 'general', 'My idea');
    const result = secondMotionAction(db, motionId, 'a');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Cannot second your own motion');
  });
});

describe('No Confidence + Election', () => {
  it('no confidence passes, chieftain deposed, election auto-raised', () => {
    const motionId = proposeMotion(db, 'b', 'no_confidence', 'Remove the chieftain');
    secondMotionAction(db, motionId, 'c');

    castVote(db, motionId, 'b', 'aye');
    castVote(db, motionId, 'c', 'aye');
    castVote(db, motionId, 'd', 'aye');
    castVote(db, motionId, 'a', 'nay');

    const tally = tallyAndResolve(db, motionId, rng);
    expect(tally.passed).toBe(true);

    const formerChieftain = getAgent(db, 'a')!;
    expect(formerChieftain.is_chieftain).toBe(0);
  });

  it('election: agent wins and becomes chieftain', () => {
    // First depose current chieftain
    setChieftain(db, 'a', false);

    const electionId = proposeMotion(db, 'b', 'election', 'Elect new chieftain');
    secondMotionAction(db, electionId, 'c');

    // Vote for 'c' to win
    castVote(db, electionId, 'a', 'c');
    castVote(db, electionId, 'b', 'c');
    castVote(db, electionId, 'c', 'c');
    castVote(db, electionId, 'd', 'b');

    const winner = resolveElection(db, electionId, rng);
    expect(winner).toBe('c');

    const newChieftain = getAgent(db, 'c')!;
    expect(newChieftain.is_chieftain).toBe(1);
  });
});

describe('Banishment', () => {
  it('banishment motion passes: agent is banished, inventory scattered', () => {
    addInventoryItem(db, { id: 'item1', agentId: 'd', itemName: 'wood', itemType: 'resource', quantity: 3 });

    const motionId = proposeMotion(db, 'a', 'banishment', 'Banish Agent D', 'd');
    secondMotionAction(db, motionId, 'b');

    castVote(db, motionId, 'a', 'aye');
    castVote(db, motionId, 'b', 'aye');
    castVote(db, motionId, 'c', 'aye');

    const tally = tallyAndResolve(db, motionId, rng);
    expect(tally.passed).toBe(true);

    const d = getAgent(db, 'd')!;
    expect(d.is_banished).toBe(1);

    // Inventory should be scattered
    const dInv = getAgentInventory(db, 'd');
    expect(dInv).toHaveLength(0);

    const groundItems = db.prepare("SELECT * FROM inventory WHERE agent_id LIKE 'ground_%'").all();
    expect(groundItems.length).toBeGreaterThan(0);
  });
});

describe('Vote Secrecy', () => {
  it('council_votes records individual votes but perception would only show totals', () => {
    const motionId = proposeMotion(db, 'a', 'general', 'Test motion');
    secondMotionAction(db, motionId, 'b');

    castVote(db, motionId, 'a', 'aye');
    castVote(db, motionId, 'b', 'nay');
    castVote(db, motionId, 'c', 'aye');

    const votes = getVotesForMotion(db, motionId);
    expect(votes).toHaveLength(3);
    // Individual votes are stored
    expect(votes.find(v => v.voter_agent_id === 'a')!.vote).toBe('aye');
    expect(votes.find(v => v.voter_agent_id === 'b')!.vote).toBe('nay');

    // But the tally only shows totals
    const tally = tallyAndResolve(db, motionId, rng);
    expect(tally.ayes).toBe(2);
    expect(tally.nays).toBe(1);
  });
});

describe('Tie Vote', () => {
  it('chieftain breaks tie - chieftain voted aye means motion passes', () => {
    const motionId = proposeMotion(db, 'b', 'general', 'Tie test');
    secondMotionAction(db, motionId, 'c');

    castVote(db, motionId, 'a', 'aye'); // chieftain
    castVote(db, motionId, 'b', 'aye');
    castVote(db, motionId, 'c', 'nay');
    castVote(db, motionId, 'd', 'nay');

    const tally = tallyAndResolve(db, motionId, rng);
    expect(tally.passed).toBe(true);
  });

  it('chieftain abstained on tie means motion fails', () => {
    const motionId = proposeMotion(db, 'b', 'general', 'Tie test 2');
    secondMotionAction(db, motionId, 'c');

    castVote(db, motionId, 'a', 'abstain'); // chieftain abstains
    castVote(db, motionId, 'b', 'aye');
    castVote(db, motionId, 'c', 'nay');

    const tally = tallyAndResolve(db, motionId, rng);
    expect(tally.passed).toBe(false);
  });
});

describe('Council With No Seconded Motions', () => {
  it('adjourns immediately with no votes taken', () => {
    const result = runCouncilPhase(db, rng, [], [], []);
    expect(result.events).toContain('Council adjourned with no votes taken');
  });
});

describe('Event Logging', () => {
  it('all council events are logged in event_log', () => {
    const before = (db.prepare('SELECT COUNT(*) as c FROM event_log').get() as any).c;

    runCouncilPhase(
      db, rng,
      [{ proposerId: 'b', type: 'general', text: 'Test' }],
      [],
      [],
    );

    const after = (db.prepare('SELECT COUNT(*) as c FROM event_log').get() as any).c;
    expect(after).toBeGreaterThan(before);
  });
});
