import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'path';
import { loadPersonality, validatePersonalityProfile } from '../src/agents/personality.js';
import { PHASE1_TOOLS, getToolDefinitions, validateActionEnergy, ENERGY_COSTS } from '../src/agents/tools.js';
import { buildPerception } from '../src/agents/perception.js';
import { appendMemory, SHORT_TERM_LIMIT, getMemoryForPrompt } from '../src/agents/memory.js';
import { assemblePrompt } from '../src/agents/prompt-builder.js';
import { orchestrateTick, BATCH_SIZE } from '../src/agents/orchestrator.js';
import { initDatabase } from '../src/db/schema.js';
import { createAgent, getAgent, createLocation, createResource, getLivingAgents, getShortTermMemory } from '../src/db/queries.js';
import { seedIslandToDatabase } from '../src/world/island.js';
import { SeededRNG } from '../src/rng.js';
import type Database from 'better-sqlite3';

describe('Personality Loading', () => {
  it('loads agents/vex.json with all required fields', () => {
    const profile = loadPersonality(join(process.cwd(), 'agents/vex.json'));
    expect(profile.name).toBe('Vex');
    expect(profile.personality.traits).toBeInstanceOf(Array);
    expect(profile.personality.traits.length).toBeGreaterThan(0);
    expect(profile.personality.backstory).toBeTruthy();
    expect(profile.personality.communicationStyle).toBeTruthy();
    expect(profile.personality.values).toBeInstanceOf(Array);
    expect(profile.personality.values.length).toBeGreaterThan(0);
    expect(profile.model).toBeTruthy();
  });

  it('throws for invalid schema with descriptive error', () => {
    expect(() => validatePersonalityProfile({ name: 'Bad' }, 'bad.json'))
      .toThrow(/missing required field "personality"/);
  });

  it('throws for missing personality fields', () => {
    expect(() => validatePersonalityProfile({
      name: 'Bad', personality: { traits: ['a'] },
    }, 'bad.json')).toThrow(/missing personality fields/);
  });
});

describe('Tool Definitions', () => {
  it('contains all Phase 1 tools', () => {
    const tools = getToolDefinitions(1);
    const names = tools.map(t => t.name);
    expect(names).toContain('gather');
    expect(names).toContain('craft');
    expect(names).toContain('eat');
    expect(names).toContain('rest');
    expect(names).toContain('move');
    expect(names).toContain('explore');
    expect(names).toContain('internal_monologue');
    expect(names).toContain('check_relationships');
  });

  it('each tool has correct parameter schema', () => {
    for (const tool of PHASE1_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
      expect(tool.input_schema.required).toBeInstanceOf(Array);
    }
  });
});

describe('Perception', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
    seedIslandToDatabase(db);
    createAgent(db, { id: 'agent1', name: 'Agent1', personalityJson: '{}', locationId: 'the_beach' });
    createAgent(db, { id: 'agent2', name: 'Agent2', personalityJson: '{}', locationId: 'the_beach' });
    createAgent(db, { id: 'agent3', name: 'Agent3', personalityJson: '{}', locationId: 'the_beach' });
  });

  it('includes other agents visible states at the same location', () => {
    const agent = getAgent(db, 'agent1')!;
    const perception = buildPerception(db, agent, 'The Beach', 'Sandy', 12);

    expect(perception.otherAgentsHere).toHaveLength(2);
    const names = perception.otherAgentsHere.map(a => a.name);
    expect(names).toContain('Agent2');
    expect(names).toContain('Agent3');
    for (const other of perception.otherAgentsHere) {
      expect(other.appearance).toBeTruthy();
    }
  });

  it('shows qualitative resource levels, not exact numbers', () => {
    const agent = getAgent(db, 'agent1')!;
    const perception = buildPerception(db, agent, 'The Beach', 'Sandy', 12);

    for (const res of perception.location.resources) {
      expect(['scarce', 'moderate', 'abundant']).toContain(res.availability);
    }
  });

  it('includes agent own stats as exact numbers', () => {
    const agent = getAgent(db, 'agent1')!;
    const perception = buildPerception(db, agent, 'The Beach', 'Sandy', 12);

    expect(perception.self.health).toBe(100);
    expect(perception.self.hunger).toBe(0);
    expect(perception.self.energy).toBe(100);
  });
});

describe('Memory', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
    seedIslandToDatabase(db);
    createAgent(db, { id: 'mem_agent', name: 'MemAgent', personalityJson: '{}', locationId: 'the_beach' });
  });

  it('after 60 appends, only the most recent 50 are retained', () => {
    for (let i = 0; i < 60; i++) {
      appendMemory(db, 'mem_agent', {
        tick: i, epoch: 0, type: 'action', content: `Event ${i}`,
      });
    }

    const memories = getShortTermMemory(db, 'mem_agent', 100);
    expect(memories).toHaveLength(SHORT_TERM_LIMIT);

    // The oldest should be from tick 10 (events 0-9 trimmed)
    const ticks = memories.map(m => m.tick).sort((a, b) => a - b);
    expect(ticks[0]).toBe(10);
    expect(ticks[ticks.length - 1]).toBe(59);
  });
});

describe('Prompt Builder', () => {
  it('output contains system prompt, perception, memory, and tick context', () => {
    const profile = {
      name: 'TestAgent',
      model: 'claude-sonnet-4-20250514',
      personality: {
        traits: ['brave'],
        backstory: 'A test agent',
        communicationStyle: 'Direct',
        values: ['survival'],
      },
    };

    const perception = {
      self: { health: 100, hunger: 0, energy: 100, inventory: [] },
      location: { id: 'the_beach', name: 'The Beach', description: 'Sandy', resources: [] },
      otherAgents: [],
      publicKnowledge: { eliminatedAgents: [], currentEpoch: 0, ticksUntilCouncil: 12 },
      recentMessages: [],
    };

    const memory = { shortTerm: [], journal: [] };
    const context = { currentTick: 5, currentEpoch: 0, ticksUntilTribalCouncil: 7, actionsRemaining: 2 };

    const prompt = assemblePrompt(profile, perception, memory, context);

    expect(prompt.systemPrompt).toContain('TestAgent');
    expect(prompt.systemPrompt).toContain('brave');
    expect(prompt.systemPrompt).toContain('survival');
    expect(prompt.systemPrompt).toContain('RULES');
    expect(prompt.systemPrompt).toContain('STRATEGY GUIDANCE');
    expect(prompt.perceptionJson).toContain('The Beach');
    expect(prompt.tickContext).toContain('Tick: 5');
    expect(prompt.tickContext).toContain('Actions remaining this tick: 2');
  });
});

describe('Orchestrator', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', { seed: 42, configJson: '{}' });
    seedIslandToDatabase(db);
    createAgent(db, { id: 'vex', name: 'Vex', personalityJson: JSON.stringify({
      name: 'Vex', model: 'claude-sonnet-4-20250514',
      personality: { traits: ['cunning'], backstory: 'Test', communicationStyle: 'Direct', values: ['survival'] },
    }), locationId: 'the_beach' });
    createAgent(db, { id: 'luna', name: 'Luna', personalityJson: JSON.stringify({
      name: 'Luna', model: 'claude-sonnet-4-20250514',
      personality: { traits: ['kind'], backstory: 'Test', communicationStyle: 'Warm', values: ['friendship'] },
    }), locationId: 'the_beach' });
  });

  it('dry-run mode processes all agents without API calls', async () => {
    const rng = new SeededRNG(42);
    const result = await orchestrateTick(db, null, true, 2, 12, rng);

    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.tokenUsage.input).toBe(0);
    expect(result.tokenUsage.output).toBe(0);

    // Should have actions for both agents
    const agentIds = new Set(result.actions.map(a => a.agentId));
    expect(agentIds.has('vex')).toBe(true);
    expect(agentIds.has('luna')).toBe(true);
  });

  it('validates energy costs - agent with 5 energy cannot gather (costs 15)', () => {
    const check = validateActionEnergy('gather', 5);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain('Insufficient energy');
  });

  it('BATCH_SIZE is 4', () => {
    expect(BATCH_SIZE).toBe(4);
  });
});
