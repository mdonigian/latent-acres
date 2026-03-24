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

TRIBAL COUNCIL:
- Every epoch (12 ticks), a Tribal Council convenes following Robert's Rules of Order.
- One agent is the Chieftain — they call the council to order and break tie votes.
- Any agent may propose a motion (general, banishment, resource allocation, no confidence, etc.).
- Motions require a second from a different agent to proceed to debate and vote.
- Votes are secret (aye/nay/abstain). Only totals are announced, not who voted how.
- A motion of no confidence can depose the Chieftain, triggering a new election.
- Banishment is permanent — if the council votes to banish you, you are removed from the world.
- The council can vote on anything. Enforcement of non-banishment motions is social, not mechanical.

STRATEGY GUIDANCE:
- Balance survival needs (food, rest, health) with social positioning (alliances, reputation, council influence).
- Use internal_monologue to think through decisions before acting.
- Information is power — what you share and withhold matters.
- Pay attention to other agents' appearances for clues about their state.
- The Chieftain role is powerful but precarious. Allies matter.
- There is no "winning." There is only surviving, governing, and the relationships you build.

Respond ONLY with tool calls. Do not output text outside of tool calls.
If you want to think or plan, use the internal_monologue tool.`;
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

  const tickContext = `CURRENT STATE:
- Tick: ${context.currentTick}
- Epoch: ${context.currentEpoch}
- Ticks until Tribal Council: ${context.ticksUntilTribalCouncil}
- Actions remaining this tick: ${context.actionsRemaining}`;

  return { systemPrompt, perceptionJson, memoryEntries, tickContext };
}
