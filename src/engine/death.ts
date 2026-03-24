import type Database from 'better-sqlite3';
import { getLivingAgents, markAgentDead, appendEvent, getSimulation } from '../db/queries.js';
import { scatterInventoryAtLocation } from '../db/queries.js';

export interface DeathEvent {
  agentId: string;
  agentName: string;
  cause: string;
  locationId: string;
}

export function checkDeaths(db: Database.Database): DeathEvent[] {
  const sim = getSimulation(db);
  const agents = getLivingAgents(db);
  const deaths: DeathEvent[] = [];

  for (const agent of agents) {
    if (agent.health <= 0) {
      const cause = agent.hunger > 95 ? 'starvation' : agent.hunger > 80 ? 'malnutrition' : 'health_depleted';
      markAgentDead(db, agent.id, cause, sim.current_tick, sim.current_epoch);
      scatterInventoryAtLocation(db, agent.id, agent.location_id);

      appendEvent(db, {
        tick: sim.current_tick,
        epoch: sim.current_epoch,
        eventType: 'death',
        agentId: agent.id,
        locationId: agent.location_id,
        dataJson: JSON.stringify({ cause, agentName: agent.name }),
      });

      deaths.push({
        agentId: agent.id,
        agentName: agent.name,
        cause,
        locationId: agent.location_id,
      });
    }
  }

  return deaths;
}
