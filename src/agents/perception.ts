import type Database from 'better-sqlite3';
import { AgentRow, getAgentInventory, getResourcesAtLocation, getLivingAgents, getSimulation } from '../db/queries.js';

export interface AgentVisibleState {
  name: string;
  appearance: string;
}

export interface ResourceEstimate {
  type: string;
  availability: 'scarce' | 'moderate' | 'abundant';
}

export interface PerceptionPayload {
  self: {
    health: number;
    hunger: number;
    energy: number;
    inventory: { name: string; type: string; quantity: number }[];
  };
  location: {
    id: string;
    name: string;
    description: string;
    resources: ResourceEstimate[];
  };
  otherAgents: AgentVisibleState[];
  publicKnowledge: {
    eliminatedAgents: string[];
    currentEpoch: number;
    ticksUntilCouncil: number;
  };
  recentMessages: string[];
}

function getResourceAvailability(quantity: number, maxQuantity: number): 'scarce' | 'moderate' | 'abundant' {
  const ratio = quantity / maxQuantity;
  if (ratio < 0.3) return 'scarce';
  if (ratio < 0.7) return 'moderate';
  return 'abundant';
}

function getAgentAppearance(agent: AgentRow): string {
  const cues: string[] = [];

  if (agent.energy < 20) cues.push('looks exhausted');
  else if (agent.energy > 80) cues.push('looks energetic');

  if (agent.hunger > 80) cues.push('looks starving');
  else if (agent.hunger < 20) cues.push('looks well-fed');

  if (agent.health < 30) cues.push('looks injured');
  else if (agent.health > 80) cues.push('looks healthy');

  if (cues.length === 0) cues.push('looks unremarkable');
  return cues.join(', ');
}

export function buildPerception(
  db: Database.Database,
  agent: AgentRow,
  locationName: string,
  locationDescription: string,
  ticksPerEpoch: number,
): PerceptionPayload {
  const inventory = getAgentInventory(db, agent.id);
  const resources = getResourcesAtLocation(db, agent.location_id);
  const allAgents = getLivingAgents(db);
  const sim = getSimulation(db);

  const otherAgentsHere = allAgents
    .filter(a => a.id !== agent.id && a.location_id === agent.location_id)
    .map(a => ({
      name: a.name,
      appearance: getAgentAppearance(a),
    }));

  const resourceEstimates = resources.map(r => ({
    type: r.type,
    availability: getResourceAvailability(r.quantity, r.max_quantity),
  }));

  const eliminatedAgents = allAgents
    .filter(() => false) // only dead/eliminated
    .map(a => a.name);
  // Actually get eliminated agents
  const allAgentsIncludingDead = db.prepare('SELECT name FROM agents WHERE is_alive = 0 OR is_eliminated = 1').all() as { name: string }[];

  const ticksUntilCouncil = ticksPerEpoch - (sim.current_tick % ticksPerEpoch);

  // Fetch recent speech events visible to this agent (public at same location + whispers to them)
  const recentSpeechEvents = db.prepare(`
    SELECT data_json, tick FROM event_log
    WHERE event_type = 'speech' AND tick >= ? AND tick <= ?
    ORDER BY tick DESC LIMIT 20
  `).all(Math.max(0, sim.current_tick - 6), sim.current_tick) as { data_json: string; tick: number }[];

  const recentMessages: string[] = [];
  for (const evt of recentSpeechEvents) {
    try {
      const data = JSON.parse(evt.data_json);
      // Public speech at agent's location or whisper directed at this agent
      if (data.location_id === agent.location_id && (!data.target || data.target === 'all')) {
        recentMessages.push(`[Tick ${evt.tick}] ${data.from} (public): "${data.message}"`);
      } else if (data.target === agent.name || data.target_id === agent.id) {
        recentMessages.push(`[Tick ${evt.tick}] ${data.from} (whisper): "${data.message}"`);
      }
    } catch {}
  }

  return {
    self: {
      health: agent.health,
      hunger: agent.hunger,
      energy: agent.energy,
      inventory: inventory.map(i => ({ name: i.item_name, type: i.item_type, quantity: i.quantity })),
    },
    location: {
      id: agent.location_id,
      name: locationName,
      description: locationDescription,
      resources: resourceEstimates,
    },
    otherAgents: otherAgentsHere,
    publicKnowledge: {
      eliminatedAgents: allAgentsIncludingDead.map(a => a.name),
      currentEpoch: sim.current_epoch,
      ticksUntilCouncil,
    },
    recentMessages,
  };
}
