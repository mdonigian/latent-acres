import { SeededRNG } from '../rng.js';

export type WeatherType = 'clear' | 'rain' | 'storm' | 'overcast';

export interface WeatherState {
  type: WeatherType;
  intensity: number; // 0-1
  description: string;
}

const WEATHER_DESCRIPTIONS: Record<WeatherType, string[]> = {
  clear: ['The sun shines brightly over the island.', 'A beautiful clear day on the island.'],
  rain: ['A steady rain falls across the island.', 'Rain clouds darken the sky.'],
  storm: ['A tropical storm batters the island with heavy winds.', 'Thunder rumbles as a fierce storm passes through.'],
  overcast: ['Grey clouds blanket the sky.', 'An overcast sky keeps the island cool.'],
};

export function generateWeather(rng: SeededRNG): WeatherState {
  const roll = rng.random();
  let type: WeatherType;

  if (roll < 0.4) {
    type = 'clear';
  } else if (roll < 0.65) {
    type = 'overcast';
  } else if (roll < 0.85) {
    type = 'rain';
  } else {
    type = 'storm';
  }

  const intensity = type === 'storm' ? 0.5 + rng.random() * 0.5 : rng.random() * 0.5;
  const descriptions = WEATHER_DESCRIPTIONS[type];
  const description = descriptions[rng.randomInt(0, descriptions.length - 1)];

  return { type, intensity, description };
}

export interface WeatherEffects {
  gatherModifier: number;
  shelterDamage: number;
  unsheltered_damage: number;
}

export function getWeatherEffects(weather: WeatherState): WeatherEffects {
  switch (weather.type) {
    case 'storm':
      return {
        gatherModifier: -0.3,
        shelterDamage: Math.floor(weather.intensity * 20),
        unsheltered_damage: Math.floor(weather.intensity * 10),
      };
    case 'rain':
      return {
        gatherModifier: -0.1,
        shelterDamage: 0,
        unsheltered_damage: 0,
      };
    case 'clear':
      return {
        gatherModifier: 0.1,
        shelterDamage: 0,
        unsheltered_damage: 0,
      };
    default:
      return {
        gatherModifier: 0,
        shelterDamage: 0,
        unsheltered_damage: 0,
      };
  }
}
