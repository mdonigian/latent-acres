import type Database from 'better-sqlite3';
import { getSimulation, updateSimulation } from '../db/queries.js';
import { log } from './logger.js';

export const MAX_COST_PER_TICK = 0.50;
export const COST_WARNING_THRESHOLD = 50.00;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 0.80 / 1_000_000, output: 4 / 1_000_000 },
};

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string = 'claude-sonnet-4-20250514',
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['claude-sonnet-4-20250514'];
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

export function trackCost(
  db: Database.Database,
  inputTokens: number,
  outputTokens: number,
  model?: string,
): { tickCost: number; totalCost: number; withinBudget: boolean } {
  const cost = estimateCost(inputTokens, outputTokens, model);
  const sim = getSimulation(db);
  const newTotal = sim.total_cost + cost;

  updateSimulation(db, { total_cost: newTotal });

  if (newTotal >= COST_WARNING_THRESHOLD) {
    log('warn', `Total cost has reached $${newTotal.toFixed(2)} (warning threshold: $${COST_WARNING_THRESHOLD.toFixed(2)})`);
  }

  return {
    tickCost: cost,
    totalCost: newTotal,
    withinBudget: cost <= MAX_COST_PER_TICK,
  };
}

export function getTotalCost(db: Database.Database): number {
  return getSimulation(db).total_cost;
}
