import type Database from 'better-sqlite3';
import { SeededRNG } from '../rng.js';
import { getAllLocations, getLivingAgents, updateAgentStats, updateResourceQuantity, getResourcesAtLocation, appendEvent, getSimulation } from '../db/queries.js';

export interface WorldEvent {
  name: string;
  description: string;
  effects: Record<string, unknown>;
}

interface EventDef {
  name: string;
  probability: number;
  trigger(db: Database.Database, rng: SeededRNG, tick: number, epoch: number): WorldEvent | null;
}

const EVENT_DEFINITIONS: EventDef[] = [
  {
    name: 'tropical_storm',
    probability: 0.08,
    trigger(db, rng, tick, epoch) {
      const locations = getAllLocations(db);
      const agents = getLivingAgents(db);
      const damage = rng.randomInt(5, 15);
      const affected: string[] = [];

      for (const agent of agents) {
        // Unsheltered agents take damage
        updateAgentStats(db, agent.id, { health: Math.max(0, agent.health - damage) });
        affected.push(agent.name);
      }

      return {
        name: 'tropical_storm',
        description: `A tropical storm hits the island! ${affected.length} agents take ${damage} damage.`,
        effects: { damage, affectedAgents: affected },
      };
    },
  },
  {
    name: 'resource_discovery',
    probability: 0.12,
    trigger(db, rng, tick, epoch) {
      const locations = getAllLocations(db);
      if (locations.length === 0) return null;
      const loc = rng.pick(locations);
      const resources = getResourcesAtLocation(db, loc.id);
      if (resources.length === 0) return null;

      const res = rng.pick(resources);
      const bonus = rng.randomInt(2, 5);
      const newQuantity = Math.min(res.quantity + bonus, res.max_quantity);
      updateResourceQuantity(db, res.id, newQuantity);

      return {
        name: 'resource_discovery',
        description: `A cache of ${res.type} was discovered at ${loc.name}!`,
        effects: { locationId: loc.id, resourceType: res.type, bonus },
      };
    },
  },
  {
    name: 'illness_outbreak',
    probability: 0.05,
    trigger(db, rng, tick, epoch) {
      const agents = getLivingAgents(db);
      if (agents.length === 0) return null;

      const victim = rng.pick(agents);
      const healthLoss = rng.randomInt(5, 15);
      updateAgentStats(db, victim.id, { health: Math.max(0, victim.health - healthLoss) });

      return {
        name: 'illness_outbreak',
        description: `${victim.name} falls ill and loses ${healthLoss} health.`,
        effects: { agentId: victim.id, healthLoss },
      };
    },
  },
  {
    name: 'hidden_idol_appears',
    probability: 0.03,
    trigger(db, rng, tick, epoch) {
      const locations = getAllLocations(db);
      if (locations.length === 0) return null;
      const loc = rng.pick(locations);

      return {
        name: 'hidden_idol_appears',
        description: `A hidden idol has been placed somewhere near ${loc.name}.`,
        effects: { locationId: loc.id },
      };
    },
  },
];

export function rollRandomEvents(db: Database.Database, rng: SeededRNG): WorldEvent[] {
  const sim = getSimulation(db);
  const events: WorldEvent[] = [];

  for (const def of EVENT_DEFINITIONS) {
    if (rng.random() < def.probability) {
      const event = def.trigger(db, rng, sim.current_tick, sim.current_epoch);
      if (event) {
        // Log the world event
        db.prepare(
          'INSERT INTO world_events (tick, event_name, description, effects_json) VALUES (?, ?, ?, ?)'
        ).run(sim.current_tick, event.name, event.description, JSON.stringify(event.effects));

        appendEvent(db, {
          tick: sim.current_tick,
          epoch: sim.current_epoch,
          eventType: `world_event:${event.name}`,
          dataJson: JSON.stringify(event),
        });

        events.push(event);
      }
    }
  }

  return events;
}
