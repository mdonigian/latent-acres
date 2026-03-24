import type Database from 'better-sqlite3';
import type { ModelAdapter } from '../agents/orchestrator.js';
import { getLivingAgents, getSimulation, updateSimulation, updateAgentStats, getAllLocations, appendEvent, getChieftain, getMotionsByEpoch, addJournalEntry, getLatestJournalEpoch, getShortTermMemory, getJournalEntries } from '../db/queries.js';
import { regenerateResources } from './resource-manager.js';
import { checkDeaths } from './death.js';
import { resolveActions } from './action-resolver.js';
import { rollRandomEvents } from './event-system.js';
import { orchestrateTick, type OrchestratorResult } from '../agents/orchestrator.js';
import { appendMemory } from '../agents/memory.js';
import { shouldTriggerCouncil, runCouncilPhase, proposeMotion, secondMotionAction, castVote, tallyAndResolve, type MotionType } from './tribal-council.js';
import { SeededRNG } from '../rng.js';
import type { SimulationConfig } from '../config.js';
import { log, logTickSummary } from '../utils/logger.js';

export interface TickResult {
  tick: number;
  epoch: number;
  actions: { agentId: string; action: string; result: string; success: boolean }[];
  deaths: { agentId: string; agentName: string; cause: string }[];
  events: { name: string; description: string }[];
  tokenUsage: { input: number; output: number };
  cost: number;
}

function applyPassiveEffects(db: Database.Database): void {
  const agents = getLivingAgents(db);
  for (const agent of agents) {
    const newHunger = Math.min(100, agent.hunger + 8);
    let healthDelta = 0;

    // Starvation damage
    if (newHunger > 95) {
      healthDelta = -15;
    } else if (newHunger > 80) {
      healthDelta = -5;
    }

    // Passive health regen when not starving (even without resting)
    if (newHunger < 80 && agent.health < 100) {
      healthDelta += 2;
    }

    const newHealth = Math.max(0, Math.min(100, agent.health + healthDelta));
    updateAgentStats(db, agent.id, { hunger: newHunger, health: newHealth });
  }
}

export async function executeTick(
  db: Database.Database,
  config: SimulationConfig,
  adapter: ModelAdapter | null,
  dryRun: boolean,
): Promise<TickResult> {
  const sim = getSimulation(db);
  const rng = SeededRNG.fromState(sim.rng_state);
  const tick = sim.current_tick;
  const epoch = Math.floor(tick / config.ticksPerEpoch);

  log('tick', `--- Tick ${tick} (Epoch ${epoch}) ---`);

  // Step 1: Regenerate resources
  regenerateResources(db);

  // Step 2: Apply passive effects (hunger +8, health damage from hunger)
  applyPassiveEffects(db);

  // Step 3: Check deaths from passive effects
  const earlyDeaths = checkDeaths(db);

  // Step 4: Gather agent actions via orchestrator
  const orchestratorResult: OrchestratorResult = await orchestrateTick(
    db, adapter, dryRun, config.actionsPerTick, config.ticksPerEpoch, rng,
  );

  // Step 5-6: Resolve actions simultaneously and apply consequences
  const resolvedActions = resolveActions(db, orchestratorResult.actions, rng);

  // Step 7: Check deaths from action consequences
  const postActionDeaths = checkDeaths(db);

  // Step 8: Roll random events
  const worldEvents = rollRandomEvents(db, rng);

  // Step 9: Check deaths from events
  const eventDeaths = checkDeaths(db);

  const allDeaths = [...earlyDeaths, ...postActionDeaths, ...eventDeaths];

  // Step 10: Update memories for living agents
  const livingAgents = getLivingAgents(db);
  for (const agent of livingAgents) {
    const agentActions = resolvedActions.filter(a => a.agentId === agent.id);
    for (const action of agentActions) {
      appendMemory(db, agent.id, {
        tick,
        epoch,
        type: action.action,
        content: action.result,
        importance: action.success ? 0.5 : 0.7,
      });
    }
  }

  // Step 11: Persist state
  const newTick = tick + 1;
  const newEpoch = Math.floor(newTick / config.ticksPerEpoch);

  // Estimate cost (simplified)
  const costPerInputToken = 0.003 / 1000;
  const costPerOutputToken = 0.015 / 1000;
  const tickCost = orchestratorResult.tokenUsage.input * costPerInputToken +
    orchestratorResult.tokenUsage.output * costPerOutputToken;

  updateSimulation(db, {
    current_tick: newTick,
    current_epoch: newEpoch,
    rng_state: rng.getState(),
    total_cost: sim.total_cost + tickCost,
    last_tick_at: new Date().toISOString(),
  });

  // Check if all agents are dead
  if (getLivingAgents(db).length === 0) {
    updateSimulation(db, { status: 'paused' });
    log('warn', 'All agents have died. Simulation paused.');
  }

  // Check epoch boundary — trigger Tribal Council
  if (newEpoch > epoch && shouldTriggerCouncil(newTick, config.ticksPerEpoch)) {
    log('info', `=== Tribal Council (Epoch ${epoch}) ===`);

    const councilResult = runHeuristicCouncil(db, rng, dryRun);

    const chieftain = getChieftain(db);
    log('council', `Chieftain: ${chieftain?.name ?? 'none'}`);
    for (const m of councilResult.motions) {
      const statusIcon = m.status === 'passed' ? 'PASSED' : m.status === 'failed' ? 'FAILED' : m.status === 'died' ? 'DIED (no second)' : m.status;
      log('council', `Motion [${m.type}]: "${m.text}" — ${statusIcon} (ayes: ${m.ayes}, nays: ${m.nays}, abstain: ${m.abstentions})`);
    }
    for (const b of councilResult.banished) {
      log('council', `${b} has been banished from the island!`);
    }
    if (councilResult.newChieftain) {
      log('council', `New Chieftain elected: ${councilResult.newChieftain}`);
    }
    if (councilResult.motions.length === 0) {
      log('council', 'No motions raised. Council adjourned.');
    }

    // Journal entries — each agent writes a private journal at epoch boundaries
    await generateJournalEntries(db, epoch, newTick, dryRun);

    log('info', `=== Epoch ${newEpoch} begins ===`);
    appendEvent(db, {
      tick: newTick,
      epoch: newEpoch,
      eventType: 'epoch_boundary',
      dataJson: JSON.stringify({ previousEpoch: epoch, newEpoch }),
    });
  }

  const result: TickResult = {
    tick,
    epoch,
    actions: resolvedActions.map(a => ({ agentId: a.agentId, action: a.action, result: a.result, success: a.success })),
    deaths: allDeaths.map(d => ({ agentId: d.agentId, agentName: d.agentName, cause: d.cause })),
    events: worldEvents.map(e => ({ name: e.name, description: e.description })),
    tokenUsage: orchestratorResult.tokenUsage,
    cost: tickCost,
  };

  logTickSummary(result);

  return result;
}

async function generateJournalEntries(db: Database.Database, epoch: number, tick: number, dryRun: boolean): Promise<void> {
  const agents = getLivingAgents(db);

  for (const agent of agents) {
    const lastEpoch = getLatestJournalEpoch(db, agent.id);
    if (lastEpoch !== null && lastEpoch >= epoch) continue;

    const recentMemory = getShortTermMemory(db, agent.id, 20);
    const previousJournal = getJournalEntries(db, agent.id, 2);

    let personality: { backstory?: string; traits?: string[]; communicationStyle?: string; values?: string[] } = {};
    try {
      const parsed = JSON.parse(agent.personality_json);
      personality = parsed.personality ?? parsed;
    } catch {}

    if (dryRun) {
      // Heuristic journal — still more narrative
      const entry = generateHeuristicJournal(agent, personality, recentMemory, epoch);
      addJournalEntry(db, agent.id, epoch, tick, entry);
      log('info', `${agent.name} wrote a journal entry for epoch ${epoch}`);
    } else {
      // Real journal via Claude (use Haiku for cost efficiency regardless of agent's model)
      try {
        const { createAdapter } = await import('../agents/model-adapter.js');
        const journalAdapter = createAdapter('claude-haiku-4-5-20251001');

        const events = recentMemory.map(m => `[Tick ${m.tick}] ${m.content}`).join('\n');
        const prevEntries = previousJournal.map(j => `--- Epoch ${j.epoch} ---\n${j.entry}`).join('\n\n');

        const prompt = `You are ${agent.name}. Write a private journal entry reflecting on epoch ${epoch} of your time on the island.

YOUR CHARACTER:
- Backstory: ${personality.backstory ?? 'Unknown'}
- Traits: ${personality.traits?.join(', ') ?? 'Unknown'}
- Communication style: ${personality.communicationStyle ?? 'Natural'}
- Values: ${personality.values?.join(', ') ?? 'Unknown'}

YOUR CURRENT STATE:
- Health: ${agent.health}/100
- Hunger: ${agent.hunger}/100
- Energy: ${agent.energy}/100
- Location: ${agent.location_id}

EVENTS THIS EPOCH:
${events || 'Nothing notable happened.'}

${prevEntries ? `YOUR PREVIOUS JOURNAL ENTRIES:\n${prevEntries}` : ''}

INSTRUCTIONS:
Write 3-5 paragraphs as a deeply personal journal entry. This is your private diary — be honest, emotional, reflective. Let your personality shine through your writing style. Include:
- How you FEEL about what happened (not just what happened)
- Your fears, hopes, suspicions about other castaways
- Your evolving strategy and what you plan to do next
- Vivid sensory details about the island
- Internal conflicts or doubts

Write in first person. Be literary, not clinical. This should read like a page from a novel.`;

        const response = await journalAdapter.call(
          `You are a creative writer channeling the voice of ${agent.name}, a castaway on a remote island.`,
          [{ role: 'user', content: prompt }],
          [], // no tools needed
        );

        const entry = response.textContent ?? 'The words wouldn\'t come today.';
        addJournalEntry(db, agent.id, epoch, tick, entry);
        log('info', `${agent.name} wrote a journal entry for epoch ${epoch}`);
      } catch (err) {
        log('error', `Journal generation failed for ${agent.name}: ${(err as Error).message}`);
        // Fall back to heuristic
        const entry = generateHeuristicJournal(agent, personality, recentMemory, epoch);
        addJournalEntry(db, agent.id, epoch, tick, entry);
      }
    }
  }
}

function generateHeuristicJournal(
  agent: { name: string; health: number; hunger: number; energy: number; location_id: string },
  personality: { backstory?: string; traits?: string[]; communicationStyle?: string },
  recentMemory: { tick: number; content: string }[],
  epoch: number,
): string {
  const name = agent.name;
  const traits = personality.traits?.slice(0, 2).join(' and ') ?? 'determined';

  const healthFeel = agent.health > 80 ? 'strong' : agent.health > 50 ? 'worn but holding together' : 'fragile, like something could break';
  const hungerFeel = agent.hunger > 70 ? 'gnawing' : agent.hunger > 40 ? 'a constant low hum' : 'manageable for now';

  const actions = recentMemory.filter(m => !m.content.includes('Thought recorded')).slice(0, 6);
  const thoughts = recentMemory.filter(m => m.content.includes('Thought recorded'));

  const actionNarrative = actions.length > 0
    ? actions.map(a => a.content).join('. ') + '.'
    : 'The days blurred together. I moved through routines without thinking.';

  return `The ${epoch === 0 ? 'first' : epoch < 3 ? 'early' : 'long'} days on this island have a way of stripping everything down to essentials. I feel ${healthFeel}. The hunger is ${hungerFeel}.

${actionNarrative}

Being ${traits}, I find myself approaching each day with a mix of calculation and instinct. ${personality.backstory ? `My old life — ${personality.backstory.split('.')[0].toLowerCase()} — feels like a dream someone else had.` : 'My old life feels impossibly far away.'}

${agent.location_id.replace(/_/g, ' ')} has become familiar to me now. The sounds, the shadows, the way the light falls. ${thoughts.length > 3 ? 'I think too much. I know that. But on this island, thinking might be what keeps me alive.' : 'I need to think more carefully about what comes next.'}

Tomorrow I need to focus on survival. But survival alone isn't enough here — not with the council, not with the others watching.`;
}

function runHeuristicCouncil(db: Database.Database, rng: SeededRNG, dryRun: boolean) {
  const agents = getLivingAgents(db);
  if (agents.length < 2) {
    return runCouncilPhase(db, rng, [], [], []);
  }

  // Heuristic: random agent proposes a motion, another seconds it, everyone votes
  const motionTypes: MotionType[] = ['general', 'resource_allocation', 'exploration_mandate'];
  const motionTexts: Record<string, string[]> = {
    general: [
      'We should share food equally among all tribe members',
      'Night watches should be established for safety',
      'We need to build a communal shelter at The Clearing',
      'All crafted tools should be shared with the group',
    ],
    resource_allocation: [
      'Each member gets one food ration per day from the communal store',
      'The Waterfall freshwater supply should be reserved for drinking only',
      'Wood gathering should focus on Dense Jungle to preserve other areas',
    ],
    exploration_mandate: [
      'Someone should scout The Summit for rare resources',
      'We should map all locations before the next council',
      'The Mangrove Swamp is too dangerous — no one should go alone',
    ],
  };

  const proposer = rng.pick(agents);
  const others = agents.filter(a => a.id !== proposer.id);
  const seconder = rng.pick(others);

  const type = rng.pick(motionTypes);
  const text = rng.pick(motionTexts[type] ?? motionTexts.general);

  // Build motion inputs
  const motionInputs = [{ proposerId: proposer.id, type, text }];

  const motionId = proposeMotion(db, proposer.id, type, text);
  secondMotionAction(db, motionId, seconder.id);

  // Everyone votes
  for (const agent of agents) {
    const roll = rng.random();
    let vote: 'aye' | 'nay' | 'abstain';
    if (roll < 0.5) vote = 'aye';
    else if (roll < 0.8) vote = 'nay';
    else vote = 'abstain';
    castVote(db, motionId, agent.id, vote);
  }

  // Tally
  tallyAndResolve(db, motionId, rng);

  // Occasionally propose no_confidence (10% chance)
  if (rng.random() < 0.1) {
    const chieftain = getChieftain(db);
    if (chieftain) {
      const challenger = agents.find(a => a.id !== chieftain.id);
      if (challenger) {
        const ncId = proposeMotion(db, challenger.id, 'no_confidence', `Motion of no confidence in Chieftain ${chieftain.name}`);
        const ncSeconder = agents.find(a => a.id !== challenger.id && a.id !== chieftain.id);
        if (ncSeconder) {
          secondMotionAction(db, ncId, ncSeconder.id);
          for (const agent of agents) {
            const vote = agent.id === chieftain.id ? 'nay' : (rng.random() < 0.4 ? 'aye' : 'nay');
            castVote(db, ncId, agent.id, vote);
          }
          tallyAndResolve(db, ncId, rng);
        }
      }
    }
  }

  // Build result from DB state
  const sim = getSimulation(db);
  const allMotions = getMotionsByEpoch(db, sim.current_epoch);

  const result = {
    motions: allMotions.map((m: any) => ({
      id: m.id,
      type: m.motion_type,
      text: m.motion_text,
      proposedBy: m.proposed_by,
      secondedBy: m.seconded_by,
      status: m.status,
      ayes: m.ayes,
      nays: m.nays,
      abstentions: m.abstentions,
    })),
    newChieftain: null as string | null,
    banished: [] as string[],
    events: [] as string[],
  };

  // Return to tick phase
  updateSimulation(db, { phase: 'tick' });

  return result;
}

export async function runSimulation(
  db: Database.Database,
  config: SimulationConfig,
  adapter: ModelAdapter | null,
  options: { ticks?: number; dryRun?: boolean; broadcast?: (type: string, data: unknown) => void },
): Promise<TickResult[]> {
  const results: TickResult[] = [];
  const sim = getSimulation(db);
  const maxTicks = options.ticks ?? Infinity;
  let ticksRun = 0;

  updateSimulation(db, { status: 'running' });

  while (ticksRun < maxTicks) {
    const currentSim = getSimulation(db);
    if (currentSim.status === 'paused') break;
    if (getLivingAgents(db).length === 0) break;

    const result = await executeTick(db, config, adapter, options.dryRun ?? false);
    results.push(result);
    ticksRun++;

    if (options.broadcast) {
      options.broadcast('tick_complete', result);
      for (const d of result.deaths) {
        options.broadcast('agent_death', d);
      }
      for (const e of result.events) {
        options.broadcast('world_event', e);
      }
    }

    if (config.tickDelayMs > 0 && ticksRun < maxTicks) {
      await new Promise(resolve => setTimeout(resolve, config.tickDelayMs));
    }
  }

  return results;
}
