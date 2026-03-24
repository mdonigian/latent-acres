import type Database from 'better-sqlite3';
import type { ModelAdapter, ModelResponse } from './model-adapter.js';
import { createAdapter } from './model-adapter.js';
import { getToolDefinitions, validateActionEnergy, ENERGY_COSTS } from './tools.js';
import { buildPerception } from './perception.js';
import { assemblePrompt } from './prompt-builder.js';
import { getMemoryForPrompt } from './memory.js';
import { validatePersonalityProfile } from './personality.js';
import { AgentRow, getLivingAgents, getLocation, getSimulation, getAgentInventory } from '../db/queries.js';
import { SeededRNG } from '../rng.js';
import { log } from '../utils/logger.js';

export const BATCH_SIZE = 4;

export interface AgentAction {
  agentId: string;
  agentName: string;
  action: string;
  params: Record<string, unknown>;
  energyCost: number;
}

export interface OrchestratorResult {
  actions: AgentAction[];
  tokenUsage: { input: number; output: number };
  errors: { agentId: string; error: string }[];
}

function heuristicActions(agent: AgentRow, db: Database.Database, rng: SeededRNG, actionsPerTick: number): AgentAction[] {
  const actions: AgentAction[] = [];
  const inventory = getAgentInventory(db, agent.id);
  const foodItems = inventory.filter(i => i.item_name === 'food');

  for (let i = 0; i < actionsPerTick; i++) {
    if (agent.energy < 20) {
      actions.push({
        agentId: agent.id,
        agentName: agent.name,
        action: 'rest',
        params: { reason: 'low energy' },
        energyCost: 0,
      });
    } else if (agent.hunger > 40 && foodItems.length > 0) {
      const food = foodItems.shift()!;
      actions.push({
        agentId: agent.id,
        agentName: agent.name,
        action: 'eat',
        params: { item: food.item_name },
        energyCost: 0,
      });
    } else if (agent.hunger > 60) {
      actions.push({
        agentId: agent.id,
        agentName: agent.name,
        action: 'gather',
        params: { resource: 'food' },
        energyCost: ENERGY_COSTS.gather,
      });
    } else {
      const roll = rng.random();
      if (roll < 0.4) {
        actions.push({
          agentId: agent.id,
          agentName: agent.name,
          action: 'gather',
          params: { resource: rng.pick(['food', 'wood', 'stone']) },
          energyCost: ENERGY_COSTS.gather,
        });
      } else if (roll < 0.6) {
        actions.push({
          agentId: agent.id,
          agentName: agent.name,
          action: 'rest',
          params: {},
          energyCost: 0,
        });
      } else if (roll < 0.8) {
        actions.push({
          agentId: agent.id,
          agentName: agent.name,
          action: 'explore',
          params: { focus: 'resources' },
          energyCost: ENERGY_COSTS.explore,
        });
      } else {
        actions.push({
          agentId: agent.id,
          agentName: agent.name,
          action: 'internal_monologue',
          params: { thought: 'Thinking about survival...' },
          energyCost: 0,
        });
      }
    }
  }

  return validateAndFilterActions(actions, agent);
}

function validateAndFilterActions(actions: AgentAction[], agent: AgentRow): AgentAction[] {
  const valid: AgentAction[] = [];
  let remainingEnergy = agent.energy;

  for (const action of actions) {
    const check = validateActionEnergy(action.action, remainingEnergy);
    if (check.valid) {
      valid.push(action);
      remainingEnergy -= action.energyCost;
    }
  }

  return valid;
}

export async function orchestrateTick(
  db: Database.Database,
  adapter: ModelAdapter | null,
  dryRun: boolean,
  actionsPerTick: number,
  ticksPerEpoch: number,
  rng: SeededRNG,
): Promise<OrchestratorResult> {
  const agents = getLivingAgents(db);
  const sim = getSimulation(db);
  const tools = getToolDefinitions(2);
  const allActions: AgentAction[] = [];
  const errors: { agentId: string; error: string }[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  if (dryRun) {
    for (const agent of agents) {
      const actions = heuristicActions(agent, db, rng, actionsPerTick);
      allActions.push(...actions);
    }
    return { actions: allActions, tokenUsage: { input: 0, output: 0 }, errors };
  }

  // Process agents in batches
  for (let i = 0; i < agents.length; i += BATCH_SIZE) {
    const batch = agents.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (agent) => {
      try {
        // Resolve per-agent model adapter
        const agentModel = agent.model ?? 'claude-haiku-4-5-20251001';
        const agentAdapter = adapter ?? createAdapter(agentModel);

        const loc = getLocation(db, agent.location_id);
        const perception = buildPerception(
          db, agent,
          loc?.name ?? agent.location_id,
          loc?.description ?? '',
          ticksPerEpoch,
        );
        const memory = getMemoryForPrompt(db, agent.id);
        const profile = validatePersonalityProfile(
          JSON.parse(agent.personality_json),
          `agent:${agent.id}`,
        );

        const tickContext = {
          currentTick: sim.current_tick,
          currentEpoch: sim.current_epoch,
          ticksUntilTribalCouncil: ticksPerEpoch - (sim.current_tick % ticksPerEpoch),
          actionsRemaining: actionsPerTick,
        };

        const prompt = assemblePrompt(profile, perception, memory, tickContext);
        const userMessage = `${prompt.perceptionJson}\n\n${prompt.memoryEntries}\n\n${prompt.tickContext}\n\nYou MUST use at least one survival or social action tool (gather, eat, rest, move, explore, craft, speak, trade, give). Think with internal_monologue first if needed, then ACT.`;

        const FREE_ACTIONS = new Set(['internal_monologue', 'check_relationships']);
        const allFreeActions: AgentAction[] = [];
        const allRealActions: AgentAction[] = [];

        // Multi-turn: up to 3 rounds to get real actions
        const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
          { role: 'user', content: userMessage },
        ];

        for (let turn = 0; turn < 3; turn++) {
          const response: ModelResponse = await agentAdapter.call(
            prompt.systemPrompt,
            messages,
            tools,
          );

          totalInput += response.inputTokens;
          totalOutput += response.outputTokens;

          if (response.toolCalls.length === 0) break;

          for (const tc of response.toolCalls) {
            const action: AgentAction = {
              agentId: agent.id,
              agentName: agent.name,
              action: tc.name,
              params: tc.input,
              energyCost: ENERGY_COSTS[tc.name] ?? 0,
            };
            if (FREE_ACTIONS.has(tc.name)) {
              allFreeActions.push(action);
            } else if (allRealActions.length < actionsPerTick) {
              allRealActions.push(action);
            }
          }

          // Got enough real actions — done
          if (allRealActions.length >= actionsPerTick) break;

          // Build assistant turn from the tool calls, then user turn with tool results + nudge
          const assistantContent = response.toolCalls.map(tc => ({
            type: 'tool_use',
            id: tc.id ?? `tool_${turn}_${tc.name}`,
            name: tc.name,
            input: tc.input,
          }));
          messages.push({ role: 'assistant', content: assistantContent });

          const toolResults = response.toolCalls.map(tc => ({
            type: 'tool_result',
            tool_use_id: tc.id ?? `tool_${turn}_${tc.name}`,
            content: tc.name === 'internal_monologue' ? 'Thought recorded. Now take a SURVIVAL ACTION — gather, eat, rest, move, explore, or craft.'
              : 'OK',
          }));
          messages.push({ role: 'user', content: toolResults });
        }

        const agentActions = [...allFreeActions, ...allRealActions];

        return validateAndFilterActions(agentActions, agent);
      } catch (err) {
        const msg = (err as Error).message;
        log('error', `Agent ${agent.name} (${agent.model}): ${msg}`);
        errors.push({ agentId: agent.id, error: msg });
        return [];
      }
    });

    const batchResults = await Promise.all(promises);
    for (const actions of batchResults) {
      allActions.push(...actions);
    }

    // Inter-batch delay (handled externally by rate limiter in production)
  }

  return { actions: allActions, tokenUsage: { input: totalInput, output: totalOutput }, errors };
}
