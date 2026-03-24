export interface SimulationConfig {
  ticksPerEpoch: number;
  actionsPerTick: number;
  tickDelayMs: number;
  discussionRounds: number;
  seed: number;
  dbPath: string;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  ticksPerEpoch: 12,
  actionsPerTick: 2,
  tickDelayMs: 1000,
  discussionRounds: 3,
  seed: 1,
  dbPath: 'data/latent-acres.db',
};

export function loadConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
