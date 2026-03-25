import type Database from 'better-sqlite3';
import { createLocation, createResource } from '../db/queries.js';

export interface LocationDef {
  id: string;
  name: string;
  description: string;
  dangerLevel: number;
  connectedTo: string[];
  resources: { type: string; quantity: number; maxQuantity: number; gatherDifficulty: number; regenRate: number }[];
}

export const DEFAULT_ISLAND: LocationDef[] = [
  {
    id: 'the_beach',
    name: 'The Beach',
    description: 'A wide sandy beach with gentle waves. Good fishing here.',
    dangerLevel: 0.1,
    connectedTo: ['the_clearing', 'mangrove_swamp'],
    resources: [
      { type: 'food', quantity: 8, maxQuantity: 10, gatherDifficulty: 0.3, regenRate: 2 },
      { type: 'wood', quantity: 3, maxQuantity: 5, gatherDifficulty: 0.5, regenRate: 0.5 },
    ],
  },
  {
    id: 'dense_jungle',
    name: 'Dense Jungle',
    description: 'Thick tropical vegetation. Rich in wood and fiber but dangerous.',
    dangerLevel: 0.5,
    connectedTo: ['the_clearing', 'the_summit'],
    resources: [
      { type: 'wood', quantity: 10, maxQuantity: 15, gatherDifficulty: 0.4, regenRate: 2 },
      { type: 'fiber', quantity: 8, maxQuantity: 12, gatherDifficulty: 0.3, regenRate: 1.5 },
      { type: 'food', quantity: 4, maxQuantity: 6, gatherDifficulty: 0.6, regenRate: 1 },
      { type: 'herbs', quantity: 5, maxQuantity: 8, gatherDifficulty: 0.4, regenRate: 1 },
    ],
  },
  {
    id: 'waterfall',
    name: 'Waterfall',
    description: 'A pristine waterfall feeding a clear pool. The best source of fresh water.',
    dangerLevel: 0.2,
    connectedTo: ['the_clearing', 'the_summit'],
    resources: [
      { type: 'freshwater', quantity: 12, maxQuantity: 15, gatherDifficulty: 0.1, regenRate: 3 },
      { type: 'food', quantity: 3, maxQuantity: 5, gatherDifficulty: 0.5, regenRate: 0.5 },
      { type: 'clay', quantity: 6, maxQuantity: 8, gatherDifficulty: 0.4, regenRate: 1 },
    ],
  },
  {
    id: 'rocky_ridge',
    name: 'Rocky Ridge',
    description: 'High ground with exposed rock faces. Good vantage point and stone source.',
    dangerLevel: 0.4,
    connectedTo: ['tidal_pools', 'the_summit'],
    resources: [
      { type: 'stone', quantity: 10, maxQuantity: 12, gatherDifficulty: 0.4, regenRate: 1 },
      { type: 'wood', quantity: 2, maxQuantity: 3, gatherDifficulty: 0.6, regenRate: 0.3 },
    ],
  },
  {
    id: 'the_clearing',
    name: 'The Clearing',
    description: 'A central open area, safe and good for gathering. The social hub of the island.',
    dangerLevel: 0.05,
    connectedTo: ['the_beach', 'dense_jungle', 'waterfall', 'tidal_pools'],
    resources: [
      { type: 'wood', quantity: 5, maxQuantity: 8, gatherDifficulty: 0.2, regenRate: 1 },
      { type: 'food', quantity: 5, maxQuantity: 8, gatherDifficulty: 0.3, regenRate: 1 },
    ],
  },
  {
    id: 'tidal_pools',
    name: 'Tidal Pools',
    description: 'Shallow pools teeming with small sea creatures. Food is tide-dependent.',
    dangerLevel: 0.2,
    connectedTo: ['the_clearing', 'rocky_ridge', 'mangrove_swamp'],
    resources: [
      { type: 'food', quantity: 7, maxQuantity: 10, gatherDifficulty: 0.3, regenRate: 1.5 },
      { type: 'stone', quantity: 3, maxQuantity: 5, gatherDifficulty: 0.5, regenRate: 0.5 },
      { type: 'clay', quantity: 4, maxQuantity: 6, gatherDifficulty: 0.4, regenRate: 0.5 },
    ],
  },
  {
    id: 'mangrove_swamp',
    name: 'Mangrove Swamp',
    description: 'A tangled, humid swamp. Rich resources but high danger.',
    dangerLevel: 0.7,
    connectedTo: ['the_beach', 'tidal_pools'],
    resources: [
      { type: 'fiber', quantity: 10, maxQuantity: 12, gatherDifficulty: 0.3, regenRate: 2 },
      { type: 'food', quantity: 6, maxQuantity: 8, gatherDifficulty: 0.5, regenRate: 1 },
      { type: 'wood', quantity: 4, maxQuantity: 6, gatherDifficulty: 0.6, regenRate: 0.5 },
      { type: 'clay', quantity: 3, maxQuantity: 5, gatherDifficulty: 0.5, regenRate: 0.5 },
      { type: 'herbs', quantity: 6, maxQuantity: 10, gatherDifficulty: 0.4, regenRate: 1.5 },
    ],
  },
  {
    id: 'the_summit',
    name: 'The Summit',
    description: 'The highest point on the island. Dangerous but has rare stone.',
    dangerLevel: 0.8,
    connectedTo: ['dense_jungle', 'waterfall', 'rocky_ridge'],
    resources: [
      { type: 'stone', quantity: 8, maxQuantity: 10, gatherDifficulty: 0.5, regenRate: 0.5 },
    ],
  },
];

export function isAdjacent(locations: LocationDef[], fromId: string, toId: string): boolean {
  const loc = locations.find(l => l.id === fromId);
  if (!loc) throw new Error(`Invalid location ID: ${fromId}`);
  return loc.connectedTo.includes(toId);
}

export function getLocationDef(locations: LocationDef[], id: string): LocationDef {
  const loc = locations.find(l => l.id === id);
  if (!loc) throw new Error(`Invalid location ID: ${id}`);
  return loc;
}

export function validateIslandGraph(locations: LocationDef[]): boolean {
  // Check bidirectional connections
  for (const loc of locations) {
    for (const connId of loc.connectedTo) {
      const other = locations.find(l => l.id === connId);
      if (!other || !other.connectedTo.includes(loc.id)) {
        return false;
      }
    }
  }

  // Check connectivity via BFS
  if (locations.length === 0) return true;
  const visited = new Set<string>();
  const queue = [locations[0].id];
  visited.add(locations[0].id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const loc = locations.find(l => l.id === current)!;
    for (const neighbor of loc.connectedTo) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === locations.length;
}

export function seedIslandToDatabase(db: Database.Database, locations: LocationDef[] = DEFAULT_ISLAND): void {
  for (const loc of locations) {
    createLocation(db, {
      id: loc.id,
      name: loc.name,
      description: loc.description,
      dangerLevel: loc.dangerLevel,
      connectedTo: loc.connectedTo,
    });

    for (let i = 0; i < loc.resources.length; i++) {
      const res = loc.resources[i];
      createResource(db, {
        id: `${loc.id}_${res.type}_${i}`,
        locationId: loc.id,
        type: res.type,
        quantity: res.quantity,
        maxQuantity: res.maxQuantity,
        gatherDifficulty: res.gatherDifficulty,
        regenRate: res.regenRate,
      });
    }
  }
}
