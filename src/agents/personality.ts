import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface PersonalityProfile {
  name: string;
  model: string;
  personality: {
    traits: string[];
    backstory: string;
    communicationStyle: string;
    values: string[];
    hiddenAgenda?: string;
  };
  startingLocation?: string;
  isChieftain?: boolean;
}

const REQUIRED_PERSONALITY_FIELDS = ['traits', 'backstory', 'communicationStyle', 'values'] as const;

export function validatePersonalityProfile(data: unknown, filePath: string): PersonalityProfile {
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid agent JSON in ${filePath}: expected an object`);
  }
  const obj = data as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    throw new Error(`Invalid agent JSON in ${filePath}: missing required field "name"`);
  }
  if (!obj.personality || typeof obj.personality !== 'object') {
    throw new Error(`Invalid agent JSON in ${filePath}: missing required field "personality"`);
  }

  const personality = obj.personality as Record<string, unknown>;
  const missingFields: string[] = [];
  for (const field of REQUIRED_PERSONALITY_FIELDS) {
    if (personality[field] === undefined || personality[field] === null) {
      missingFields.push(field);
    }
  }
  if (missingFields.length > 0) {
    throw new Error(`Invalid agent JSON in ${filePath}: missing personality fields: ${missingFields.join(', ')}`);
  }

  if (!Array.isArray(personality.traits) || personality.traits.length === 0) {
    throw new Error(`Invalid agent JSON in ${filePath}: "traits" must be a non-empty array`);
  }
  if (typeof personality.backstory !== 'string') {
    throw new Error(`Invalid agent JSON in ${filePath}: "backstory" must be a string`);
  }
  if (typeof personality.communicationStyle !== 'string') {
    throw new Error(`Invalid agent JSON in ${filePath}: "communicationStyle" must be a string`);
  }
  if (!Array.isArray(personality.values) || personality.values.length === 0) {
    throw new Error(`Invalid agent JSON in ${filePath}: "values" must be a non-empty array`);
  }

  return {
    name: obj.name as string,
    model: (obj.model as string) ?? 'claude-sonnet-4-20250514',
    personality: {
      traits: personality.traits as string[],
      backstory: personality.backstory as string,
      communicationStyle: personality.communicationStyle as string,
      values: personality.values as string[],
      hiddenAgenda: personality.hiddenAgenda as string | undefined,
    },
    startingLocation: obj.startingLocation as string | undefined,
    isChieftain: obj.isChieftain as boolean | undefined,
  };
}

export function loadPersonality(filePath: string): PersonalityProfile {
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  return validatePersonalityProfile(data, filePath);
}

export function loadAllPersonalities(dirPath: string): PersonalityProfile[] {
  const files = readdirSync(dirPath).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`No agent JSON files found in ${dirPath}`);
  }
  return files.map(f => loadPersonality(join(dirPath, f)));
}
