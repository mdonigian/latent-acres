import type Database from 'better-sqlite3';
import type { ModelAdapter } from '../agents/orchestrator.js';
import { getLivingAgents, getSimulation, updateSimulation, updateAgentStats, getAllLocations, appendEvent, getChieftain, getMotionsByEpoch, addJournalEntry, getLatestJournalEpoch, getShortTermMemory, getJournalEntries, upsertEpochRecap, getEpochRecap, getEventsByTickRange, adjustRelationship } from '../db/queries.js';
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

  // Step 2b: Auto-rest agents with critically low energy (prevents energy death spiral)
  for (const agent of getLivingAgents(db)) {
    if (agent.energy < 10) {
      const recovery = 25 + rng.randomInt(0, 15);
      const newEnergy = Math.min(100, agent.energy + recovery);
      updateAgentStats(db, agent.id, { energy: newEnergy });
      appendEvent(db, {
        tick, epoch, eventType: 'rest', agentId: agent.id,
        dataJson: JSON.stringify({ energyGained: newEnergy - agent.energy, auto: true }),
      });
    }
  }

  // Step 3: Check deaths from passive effects
  const earlyDeaths = checkDeaths(db);

  // Step 3b: Communication round (2 sub-rounds of speech before actions)
  if (!dryRun) {
    await runCommunicationRound(db, tick, epoch, config.ticksPerEpoch, rng);
  }

  // Step 4: Gather agent actions via orchestrator (no speech tools)
  const orchestratorResult: OrchestratorResult = await orchestrateTick(
    db, adapter, dryRun, config.actionsPerTick, config.ticksPerEpoch, rng,
  );

  // Step 5-6: Resolve actions simultaneously and apply consequences
  const resolvedActions = resolveActions(db, orchestratorResult.actions, rng);

  // Step 6b: Judge social interactions for relationship sentiment
  await judgeSocialInteractions(db, tick, epoch, dryRun);

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

  // Run council BEFORE advancing epoch so motions are stored under the correct epoch
  if (newEpoch > epoch && shouldTriggerCouncil(newTick, config.ticksPerEpoch)) {
    log('info', `=== Tribal Council (Epoch ${epoch}) ===`);

    const councilResult = dryRun
      ? runHeuristicCouncil(db, rng, dryRun)
      : await runInteractiveCouncil(db, rng, epoch, tick);

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

    // Epoch recap
    await generateEpochRecap(db, epoch, newTick, dryRun);

    log('info', `=== Epoch ${newEpoch} begins ===`);
    appendEvent(db, {
      tick: newTick,
      epoch: newEpoch,
      eventType: 'epoch_boundary',
      dataJson: JSON.stringify({ previousEpoch: epoch, newEpoch }),
    });
  }

  // Now persist tick/epoch advancement
  updateSimulation(db, {
    current_tick: newTick,
    current_epoch: newEpoch,
    rng_state: rng.getState(),
    last_tick_at: new Date().toISOString(),
  });

  // Check if all agents are dead
  if (getLivingAgents(db).length === 0) {
    updateSimulation(db, { status: 'paused' });
    log('warn', 'All agents have died. Simulation paused.');
  }

  const result: TickResult = {
    tick,
    epoch,
    actions: resolvedActions.map(a => ({ agentId: a.agentId, action: a.action, result: a.result, success: a.success })),
    deaths: allDeaths.map(d => ({ agentId: d.agentId, agentName: d.agentName, cause: d.cause })),
    events: worldEvents.map(e => ({ name: e.name, description: e.description })),
    tokenUsage: orchestratorResult.tokenUsage,
    cost: 0, // cost tracked per API call via trackCost()
  };

  logTickSummary(result);

  return result;
}

async function runCommunicationRound(db: Database.Database, tick: number, epoch: number, ticksPerEpoch: number, rng: SeededRNG): Promise<void> {
  const { createAdapter } = await import('../agents/model-adapter.js');
  const { getCommunicationToolDefinitions } = await import('../agents/tools.js');
  const { validatePersonalityProfile } = await import('../agents/personality.js');
  const { buildPerception } = await import('../agents/perception.js');
  const { getMemoryForPrompt } = await import('../agents/memory.js');

  const commTools = getCommunicationToolDefinitions();
  const agents = getLivingAgents(db);
  if (agents.length < 2) return;

  const COMM_ROUNDS = 2;

  for (let round = 0; round < COMM_ROUNDS; round++) {
    // Gather recent messages for this round (including from previous sub-rounds)
    const recentSpeech = db.prepare(
      "SELECT agent_id, data_json FROM event_log WHERE tick = ? AND event_type = 'speech' ORDER BY id"
    ).all(tick) as { agent_id: string; data_json: string }[];

    const messagesByLocation = new Map<string, string[]>();
    for (const s of recentSpeech) {
      try {
        const data = JSON.parse(s.data_json);
        const locId = data.location_id;
        if (!locId) continue;
        const line = data.isWhisper
          ? `${data.from} (whisper to ${data.target}): "${data.message}"`
          : `${data.from}: "${data.message}"`;
        // Public messages go to location, whispers only to target
        if (!data.isWhisper) {
          if (!messagesByLocation.has(locId)) messagesByLocation.set(locId, []);
          messagesByLocation.get(locId)!.push(line);
        }
      } catch {}
    }

    // Call each agent in parallel
    const promises = agents.map(async (agent) => {
      // Skip agents alone at their location (no one to talk to)
      const colocated = agents.filter(a => a.id !== agent.id && a.location_id === agent.location_id);
      if (colocated.length === 0) return;

      try {
        const agentAdapter = createAdapter(agent.model ?? 'gpt-5.4-nano');
        const loc = db.prepare('SELECT name, description FROM locations WHERE id = ?').get(agent.location_id) as { name: string; description: string } | undefined;

        let personality: { traits?: string[]; backstory?: string; communicationStyle?: string } = {};
        try { const p = JSON.parse(agent.personality_json); personality = p.personality ?? p; } catch {}

        // Build a lightweight prompt for communication
        const locMessages = messagesByLocation.get(agent.location_id) ?? [];
        // Also get whispers directed at this agent
        const whispers = recentSpeech.filter(s => {
          try { const d = JSON.parse(s.data_json); return d.isWhisper && (d.target === agent.name || d.target_id === agent.id); } catch { return false; }
        }).map(s => { const d = JSON.parse(s.data_json); return `${d.from} (whisper to you): "${d.message}"`; });

        const allMessages = [...locMessages, ...whispers];

        const prompt = `You are ${agent.name} at ${loc?.name ?? agent.location_id}. This is the COMMUNICATION ROUND — you can only speak or think.

Your traits: ${personality.traits?.join(', ') ?? 'unknown'}
Style: ${personality.communicationStyle ?? 'natural'}

Others here: ${colocated.map(a => a.name).join(', ')}
${allMessages.length > 0 ? `\nConversation so far this tick:\n${allMessages.join('\n')}` : '\nNo one has spoken yet this tick.'}

You may speak publicly (target "all") or whisper to someone specific. Keep messages short and in character. You can also use internal_monologue to think. If you have nothing to say, just use internal_monologue.`;

        const response = await agentAdapter.call(
          prompt,
          [{ role: 'user', content: `Communication round ${round + 1}. Speak or think.` }],
          commTools,
        );

        // Process speech tool calls
        for (const tc of response.toolCalls) {
          if (tc.name === 'speak') {
            const message = String(tc.input.message ?? '').slice(0, 200);
            const target = String(tc.input.target ?? 'all');
            const isWhisper = target !== 'all';

            let targetId: string | undefined;
            if (isWhisper) {
              const t = agents.find(a => a.name.toLowerCase() === target.toLowerCase());
              targetId = t?.id;
            }

            appendEvent(db, {
              tick, epoch,
              eventType: 'speech', agentId: agent.id,
              dataJson: JSON.stringify({
                from: agent.name, message, target: isWhisper ? target : 'all',
                target_id: targetId, location_id: agent.location_id, isWhisper,
              }),
            });
          }
          // internal_monologue — log it
          if (tc.name === 'internal_monologue') {
            appendEvent(db, {
              tick, epoch,
              eventType: 'internal_monologue', agentId: agent.id,
              dataJson: JSON.stringify({ thought: tc.input.thought }),
            });
          }
        }
      } catch (err) {
        log('error', `Comm round: ${agent.name} failed: ${(err as Error).message}`);
      }
    });

    await Promise.all(promises);
  }

  log('info', `Communication round complete (${COMM_ROUNDS} sub-rounds)`);
}

async function judgeSocialInteractions(db: Database.Database, tick: number, epoch: number, dryRun: boolean): Promise<void> {
  // Collect speech events from this tick
  const speechEvents = db.prepare(
    "SELECT id, agent_id, data_json FROM event_log WHERE tick = ? AND event_type = 'speech'"
  ).all(tick) as { id: number; agent_id: string; data_json: string }[];

  if (speechEvents.length === 0) return;

  // Build interaction list for judging
  const interactions: { id: number; from: string; to: string; toId: string; message: string; isWhisper: boolean }[] = [];
  const allAgents = getLivingAgents(db);
  const nameToId = new Map(allAgents.map(a => [a.name.toLowerCase(), a.id]));

  for (const evt of speechEvents) {
    try {
      const data = JSON.parse(evt.data_json);
      const fromName = data.from ?? evt.agent_id;
      const target = data.target ?? 'all';
      const message = data.message ?? '';
      const isWhisper = data.isWhisper ?? false;

      if (target === 'all') {
        // Public speech — judge against all co-located agents
        const speaker = allAgents.find(a => a.id === evt.agent_id);
        if (!speaker) continue;
        const colocated = allAgents.filter(a => a.id !== evt.agent_id && a.location_id === speaker.location_id);
        for (const other of colocated) {
          interactions.push({ id: evt.id, from: fromName, to: other.name, toId: other.id, message, isWhisper: false });
        }
      } else {
        const toId = data.target_id ?? nameToId.get(target.toLowerCase());
        if (toId) {
          interactions.push({ id: evt.id, from: fromName, to: target, toId, message, isWhisper });
        }
      }
    } catch {}
  }

  if (interactions.length === 0) return;

  if (dryRun) {
    // Simple heuristic: positive words = positive, negative words = negative
    const positiveWords = /thank|help|share|friend|ally|together|good|great|trust|cooperat/i;
    const negativeWords = /threat|warn|betray|lie|steal|danger|vote.*against|don't trust|suspicious|hoard/i;

    for (const interaction of interactions) {
      let delta = 1; // default: slight positive for any communication
      if (positiveWords.test(interaction.message)) delta = 5;
      if (negativeWords.test(interaction.message)) delta = -5;
      // Receiver's sentiment toward speaker
      adjustRelationship(db, interaction.toId, nameToId.get(interaction.from.toLowerCase()) ?? '', delta, tick);
    }
    return;
  }

  // LLM judge — batch all interactions in one call
  try {
    const { createAdapter } = await import('../agents/model-adapter.js');
    const judge = createAdapter('gpt-5.4-nano');

    const interactionText = interactions.map((int, i) =>
      `${i + 1}. ${int.from} ${int.isWhisper ? 'whispered to' : 'said to'} ${int.to}: "${int.message}"`
    ).join('\n');

    const prompt = `Rate each interaction's sentiment from the RECEIVER's perspective. Score: -2 (very negative/threatening), -1 (negative/dismissive), 0 (neutral), 1 (positive/friendly), 2 (very positive/generous/supportive).

${interactionText}

Respond ONLY with a JSON array of numbers, one per interaction. Example for 3 interactions: [-1, 2, 0]`;

    const response = await judge.call(
      'You are a social interaction sentiment judge. Respond only with a JSON array of integers.',
      [{ role: 'user', content: prompt }],
      [],
    );

    const text = response.textContent?.trim() ?? '[]';
    // Extract JSON array from response (might have markdown wrapping)
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) {
      log('warn', 'Sentiment judge returned unparseable response');
      return;
    }

    const scores: number[] = JSON.parse(match[0]);
    const SCORE_TO_DELTA: Record<number, number> = { '-2': -15, '-1': -5, '0': 0, '1': 5, '2': 15 };

    for (let i = 0; i < Math.min(scores.length, interactions.length); i++) {
      const score = Math.max(-2, Math.min(2, Math.round(scores[i])));
      const delta = SCORE_TO_DELTA[score] ?? 0;
      if (delta !== 0) {
        const fromId = nameToId.get(interactions[i].from.toLowerCase());
        if (fromId) {
          // Store as receiver's sentiment toward speaker (how the listener feels about who spoke)
          adjustRelationship(db, interactions[i].toId, fromId, delta, tick);
        }
      }
    }

    log('info', `Sentiment judge scored ${interactions.length} interactions`);
  } catch (err) {
    log('error', `Sentiment judge failed: ${(err as Error).message}`);
    // Fallback: small positive — receiver feels slightly better about speaker
    for (const interaction of interactions) {
      const fromId = nameToId.get(interaction.from.toLowerCase());
      if (fromId) adjustRelationship(db, interaction.toId, fromId, 1, tick);
    }
  }
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

async function generateEpochRecap(db: Database.Database, epoch: number, tick: number, dryRun: boolean): Promise<void> {
  // Idempotent — skip if already generated
  if (getEpochRecap(db, epoch)) return;

  const config = JSON.parse(getSimulation(db).config_json);
  const ticksPerEpoch = config.ticksPerEpoch ?? 12;
  const epochStart = epoch * ticksPerEpoch;
  const epochEnd = tick;
  const events = getEventsByTickRange(db, epochStart, epochEnd);

  const agents = db.prepare('SELECT name FROM agents').all() as { name: string }[];

  if (dryRun) {
    const deathEvents = events.filter(e => e.event_type === 'death');
    const craftEvents = events.filter(e => e.event_type === 'craft');
    const motionEvents = events.filter(e => e.event_type === 'motion_resolved');

    let recap = `Epoch ${epoch} on Latent Acres brought survival, strategy, and shifting alliances among ${agents.length} castaways.`;
    if (deathEvents.length > 0) {
      const names = deathEvents.map(e => { try { return JSON.parse(e.data_json).agentName ?? e.agent_id; } catch { return e.agent_id; } });
      recap += ` Tragedy struck as ${names.join(' and ')} perished.`;
    }
    if (craftEvents.length > 0) {
      recap += ` ${craftEvents.length} crafting ${craftEvents.length === 1 ? 'effort' : 'efforts'} shaped the island's infrastructure.`;
    }
    if (motionEvents.length > 0) {
      recap += ` The Tribal Council deliberated on ${motionEvents.length} ${motionEvents.length === 1 ? 'motion' : 'motions'}.`;
    }
    recap += ` Alliances were tested and survival hung in the balance.`;
    upsertEpochRecap(db, epoch, recap);
    log('info', `Generated heuristic recap for epoch ${epoch}`);
    return;
  }

  try {
    const { createAdapter } = await import('../agents/model-adapter.js');
    const recapAdapter = createAdapter('claude-haiku-4-5-20251001');

    const eventSummary = events.slice(0, 80).map(e => {
      try { return `[${e.event_type}] ${e.agent_id ?? ''}: ${JSON.parse(e.data_json).message ?? JSON.stringify(JSON.parse(e.data_json)).slice(0, 60)}`; } catch { return `[${e.event_type}]`; }
    }).join('\n');

    const motions = getMotionsByEpoch(db, epoch);

    const prompt = `Write a brief, dramatic "Previously on Latent Acres..." recap (3-5 sentences) summarizing epoch ${epoch}. Cover key events: deaths, council decisions, alliances, structures built, resource conflicts.

EVENTS:
${eventSummary || 'A quiet epoch passed.'}

COUNCIL MOTIONS:
${motions.map(m => `${m.motion_text} — ${m.status}`).join('\n') || 'No motions.'}

Write in past tense, cinematic style. Be specific with agent names. Do not use bullet points.`;

    const response = await recapAdapter.call(
      'You are a dramatic narrator for a survival simulation.',
      [{ role: 'user', content: prompt }],
      [],
    );

    const recapText = response.textContent ?? `Epoch ${epoch} passed in struggle and survival.`;
    upsertEpochRecap(db, epoch, recapText);
    log('info', `Generated LLM recap for epoch ${epoch}`);
  } catch (err) {
    log('error', `Recap generation failed for epoch ${epoch}: ${(err as Error).message}`);
    upsertEpochRecap(db, epoch, `Epoch ${epoch} — the castaways endured another chapter of survival on Latent Acres.`);
  }
}

async function runInteractiveCouncil(db: Database.Database, rng: SeededRNG, epoch: number, tick: number) {
  const { createAdapter } = await import('../agents/model-adapter.js');
  const { getCouncilToolDefinitions } = await import('../agents/tools.js');
  const { validatePersonalityProfile } = await import('../agents/personality.js');

  const agents = getLivingAgents(db);
  if (agents.length < 2) {
    updateSimulation(db, { phase: 'tick' });
    return { motions: [], newChieftain: null, banished: [] as string[], events: [] as string[] };
  }

  const councilTools = getCouncilToolDefinitions();
  const chieftain = getChieftain(db);
  const transcript: string[] = [];

  // Build council context for all agents
  function buildCouncilPrompt(agent: typeof agents[0], phase: string, extraContext: string) {
    let personality: { backstory?: string; traits?: string[] } = {};
    try {
      const parsed = JSON.parse(agent.personality_json);
      personality = parsed.personality ?? parsed;
    } catch {}

    return `You are ${agent.name} at a Tribal Council on Latent Acres island.
Your traits: ${personality.traits?.join(', ') ?? 'unknown'}
${personality.backstory ? `Background: ${personality.backstory}` : ''}
${agent.id === chieftain?.id ? 'You are the CHIEFTAIN — you call the council to order and break tie votes.' : ''}

COUNCIL PHASE: ${phase}
${extraContext}

RULES:
- Use council_speak to address the council (all agents hear you).
- Use council_propose_motion to propose something (needs a second from another agent).
- Use council_second_motion to second a pending motion.
- Use council_vote to vote aye/nay/abstain on a motion being voted on.
- Use internal_monologue to think privately.
- Motions can be: general, resource_allocation, exploration_mandate, banishment, no_confidence, custom.
- Votes are SECRET — no one will know how you voted.
- Be concise. Speak in character.`;
  }

  async function callAgentsForPhase(phase: string, extraContext: string) {
    const results: { agentId: string; agentName: string; toolCalls: { name: string; input: Record<string, unknown> }[] }[] = [];

    // Process all agents in parallel
    const promises = agents.map(async (agent) => {
      try {
        const adapter = createAdapter(agent.model ?? 'gpt-5.4-nano');
        const systemPrompt = buildCouncilPrompt(agent, phase, extraContext);
        const response = await adapter.call(systemPrompt, [{ role: 'user', content: `It is your turn to act in the ${phase} phase. Respond with tool calls.` }], councilTools);
        return { agentId: agent.id, agentName: agent.name, toolCalls: response.toolCalls };
      } catch (err) {
        log('error', `Council: ${agent.name} failed in ${phase}: ${(err as Error).message}`);
        return { agentId: agent.id, agentName: agent.name, toolCalls: [] };
      }
    });

    return Promise.all(promises);
  }

  // ── Phase 1: Motions ──
  updateSimulation(db, { phase: 'council_motions' });
  appendEvent(db, { tick, epoch, eventType: 'council_call_to_order', dataJson: JSON.stringify({ epoch, chieftain: chieftain?.name }) });
  transcript.push(`The Chieftain ${chieftain?.name ?? 'unknown'} calls the council to order.`);

  const motionResults = await callAgentsForPhase('MOTIONS — Propose motions for the tribe to consider. You may also speak to make your case.',
    `Living agents: ${agents.map(a => a.name).join(', ')}\nChieftain: ${chieftain?.name ?? 'none'}`);

  for (const r of motionResults) {
    for (const tc of r.toolCalls) {
      if (tc.name === 'council_propose_motion') {
        const motionId = proposeMotion(db, r.agentId, tc.input.motion_type as MotionType, String(tc.input.motion));
        transcript.push(`${r.agentName} proposes: "${tc.input.motion}" [${tc.input.motion_type}] (motion #${motionId})`);
        appendEvent(db, { tick, epoch, eventType: 'council_speech', agentId: r.agentId, dataJson: JSON.stringify({ type: 'proposal', motion: tc.input.motion, motionId }) });
      } else if (tc.name === 'council_speak') {
        transcript.push(`${r.agentName}: "${tc.input.message}"`);
        appendEvent(db, { tick, epoch, eventType: 'council_speech', agentId: r.agentId, dataJson: JSON.stringify({ type: 'speech', message: tc.input.message }) });
      }
    }
  }

  // ── Phase 2: Seconding ──
  const pendingMotions = getMotionsByEpoch(db, epoch).filter(m => m.status === 'proposed');
  if (pendingMotions.length > 0) {
    const motionList = pendingMotions.map(m => `Motion #${m.id}: "${m.motion_text}" [${m.motion_type}] — proposed by ${m.proposed_by}`).join('\n');

    const secondResults = await callAgentsForPhase('SECONDING — Second any motions you support. Unseconded motions die.',
      `Pending motions:\n${motionList}`);

    for (const r of secondResults) {
      for (const tc of r.toolCalls) {
        if (tc.name === 'council_second_motion') {
          const result = secondMotionAction(db, Number(tc.input.motion_id), r.agentId);
          if (result.success) {
            transcript.push(`${r.agentName} seconds motion #${tc.input.motion_id}.`);
            appendEvent(db, { tick, epoch, eventType: 'council_speech', agentId: r.agentId, dataJson: JSON.stringify({ type: 'second', motionId: tc.input.motion_id }) });
          }
        } else if (tc.name === 'council_speak') {
          transcript.push(`${r.agentName}: "${tc.input.message}"`);
          appendEvent(db, { tick, epoch, eventType: 'council_speech', agentId: r.agentId, dataJson: JSON.stringify({ type: 'speech', message: tc.input.message }) });
        }
      }
    }
  }

  // Mark unseconded motions as died
  for (const m of getMotionsByEpoch(db, epoch)) {
    if (m.status === 'proposed') {
      const { updateMotionStatus } = await import('../db/queries.js');
      updateMotionStatus(db, m.id, 'died');
      transcript.push(`Motion #${m.id} dies — no second.`);
    }
  }

  // ── Phase 3: Debate (2 rounds) ──
  const secondedMotions = getMotionsByEpoch(db, epoch).filter(m => m.status === 'seconded');
  if (secondedMotions.length > 0) {
    updateSimulation(db, { phase: 'council_debate' });
    const motionList = secondedMotions.map(m => `Motion #${m.id}: "${m.motion_text}" [${m.motion_type}]`).join('\n');

    for (let round = 1; round <= 2; round++) {
      transcript.push(`--- Debate Round ${round} ---`);
      const debateResults = await callAgentsForPhase(
        `DEBATE ROUND ${round} — Argue for or against the motions. Persuade others.`,
        `Motions under debate:\n${motionList}\n\nTranscript so far:\n${transcript.slice(-10).join('\n')}`
      );

      for (const r of debateResults) {
        for (const tc of r.toolCalls) {
          if (tc.name === 'council_speak') {
            transcript.push(`${r.agentName}: "${tc.input.message}"`);
            appendEvent(db, { tick, epoch, eventType: 'council_speech', agentId: r.agentId, dataJson: JSON.stringify({ type: 'debate', round, message: tc.input.message }) });
          }
        }
      }
    }

    // ── Phase 4: Voting ──
    updateSimulation(db, { phase: 'council_vote' });
    transcript.push(`--- Voting ---`);

    for (const motion of secondedMotions) {
      const voteResults = await callAgentsForPhase(
        `VOTING — Cast your vote on motion #${motion.id}: "${motion.motion_text}" [${motion.motion_type}]. Vote aye, nay, or abstain.`,
        `This is a SECRET ballot. No one will know how you voted.`
      );

      for (const r of voteResults) {
        for (const tc of r.toolCalls) {
          if (tc.name === 'council_vote') {
            castVote(db, motion.id, r.agentId, tc.input.vote as 'aye' | 'nay' | 'abstain');
          }
        }
      }

      const tally = tallyAndResolve(db, motion.id, rng);
      transcript.push(`Motion #${motion.id} "${motion.motion_text}": ${tally.passed ? 'PASSED' : 'FAILED'} (${tally.ayes} aye, ${tally.nays} nay, ${tally.abstentions} abstain)`);

      if (motion.motion_type === 'no_confidence' && tally.passed) {
        transcript.push(`The Chieftain has been deposed!`);
        // Auto-raise election would happen here
      }
    }
  }

  // Build result
  const allMotions = getMotionsByEpoch(db, epoch);
  const result = {
    motions: allMotions.map((m: any) => ({
      id: m.id, type: m.motion_type, text: m.motion_text,
      proposedBy: m.proposed_by, secondedBy: m.seconded_by, status: m.status,
      ayes: m.ayes, nays: m.nays, abstentions: m.abstentions,
    })),
    newChieftain: null as string | null,
    banished: [] as string[],
    events: transcript,
  };

  // Log full transcript
  appendEvent(db, { tick, epoch, eventType: 'council_adjourned', dataJson: JSON.stringify({ transcript }) });
  updateSimulation(db, { phase: 'tick' });

  return result;
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
