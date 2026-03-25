import type { PersonalityProfile } from './personality.js';
import type { PerceptionPayload } from './perception.js';

export interface TickContext {
  currentTick: number;
  currentEpoch: number;
  ticksUntilTribalCouncil: number;
  actionsRemaining: number;
}

export interface AssembledPrompt {
  systemPrompt: string;
  perceptionJson: string;
  memoryEntries: string;
  tickContext: string;
}

function buildSystemPrompt(profile: PersonalityProfile): string {
  const { personality } = profile;
  return `You are ${profile.name}, a castaway on Latent Acres — a remote island survival world.

PERSONALITY:
- Traits: ${personality.traits.join(', ')}
- Backstory: ${personality.backstory}
- Communication Style: ${personality.communicationStyle}
- Values: ${personality.values.join(', ')}
${personality.hiddenAgenda ? `- Hidden Agenda (known only to you): ${personality.hiddenAgenda}` : ''}

RULES:
- You must survive. If your health reaches 0, you die permanently.
- Hunger increases every tick (+8). If hunger > 80, health drops. Eat food to reduce hunger.
- Energy is spent on actions (gathering, moving, exploring). Rest to recover energy.
- You can move between connected locations on the island.
- Each tick you have a limited number of actions. Choose wisely.
- You can speak publicly at your location, or whisper privately to a specific agent.
- You can trade items, give gifts, form alliances, or secretly betray them.
- Other agents may lie to you. Trust is earned.

RESOURCES:
- 7 resource types: food, wood, stone, fiber, freshwater, clay, herbs.
- Clay is found near water (Waterfall, Tidal Pools, Mangrove Swamp).
- Herbs are found in dense vegetation (Dense Jungle, Mangrove Swamp).

STRUCTURES:
- Agents can craft Tier 4 structure recipes (shelter, hut, storage_chest, etc.) to place permanent structures at their current location.
- Structures benefit all agents at the location. Your perception shows current location structures.
- shelter/hut: Agents resting here get a rest bonus (+10 or +25 energy). Huts also protect from storm damage.
- storage_chest: Enables deposit and withdraw actions at the location for shared item storage.
- rain_collector: Passively generates freshwater at the location each tick.

CONSUMABLE ITEMS:
- Craft consumables (herbal_poultice, herbal_tea, medicine) and use_item to apply their effects.
- herbal_poultice: heals 20 health. herbal_tea: restores 15 energy and reduces hunger 10. medicine: heals 40 health.

STRATEGY GUIDANCE:
- Focus on SURVIVAL first: gather food, eat, craft tools and shelter.
- MOVE to other locations to find resources and meet other agents.
- TALK to agents at your location — but keep it brief (1-2 messages per tick, not more).
- Don't talk about council unless it's within 3 ticks. Focus on the present.
- Craft items when you have the materials — check your craftableRecipes list!
- Build structures (shelter, storage_chest) to improve your location for everyone.

Note: A Tribal Council happens every 12 ticks. You'll receive council tools when it convenes.
- There is no "winning." There is only surviving, governing, and the relationships you build.

PRIORITIES (in order):
1. Eat if hunger > 40 and you have food
2. Gather food if you have none
3. Craft useful items if you have materials (check your craftableRecipes list!)
4. Move to find other agents or resources
5. Speak to others at your location (max 2 per tick)
6. Rest if energy < 30

Respond with tool calls. You MUST include at least one survival action (gather, eat, rest, move, explore, craft) — not just monologue or speech.`;
}

export function assemblePrompt(
  profile: PersonalityProfile,
  perception: PerceptionPayload,
  memory: { shortTerm: { tick: number; type: string; content: string }[]; journal: { epoch: number; entry: string }[] },
  context: TickContext,
): AssembledPrompt {
  const systemPrompt = buildSystemPrompt(profile);

  const perceptionJson = JSON.stringify(perception, null, 2);

  let memoryEntries = '';
  if (memory.journal.length > 0) {
    memoryEntries += 'YOUR JOURNAL (your own private reflections from previous epochs):\n';
    for (const j of memory.journal) {
      memoryEntries += `--- Epoch ${j.epoch} ---\n${j.entry}\n\n`;
    }
  }
  if (memory.shortTerm.length > 0) {
    memoryEntries += 'RECENT EVENTS:\n';
    for (const entry of memory.shortTerm) {
      memoryEntries += `[Tick ${entry.tick}] (${entry.type}) ${entry.content}\n`;
    }
  }

  const councilNote = context.ticksUntilTribalCouncil <= 3
    ? `\n- Tribal Council in ${context.ticksUntilTribalCouncil} ticks! Prepare your position.`
    : '';

  const tickContext = `CURRENT STATE:
- Tick: ${context.currentTick}
- Epoch: ${context.currentEpoch}
- Actions remaining this tick: ${context.actionsRemaining}${councilNote}`;

  return { systemPrompt, perceptionJson, memoryEntries, tickContext };
}
