export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const ENERGY_COSTS: Record<string, number> = {
  gather: 10,
  craft: 10,
  eat: 0,
  rest: 0,
  move: 10,
  explore: 20,
  internal_monologue: 0,
  check_relationships: 0,
  speak: 0,
  trade: 0,
  give: 0,
  form_alliance: 0,
  betray_alliance: 0,
  council_speak: 0,
  council_propose_motion: 0,
  council_second_motion: 0,
  council_vote: 0,
  use_item: 0,
  deposit: 0,
  withdraw: 0,
  attack: 25,
};

export const PHASE1_TOOLS: ToolDefinition[] = [
  {
    name: 'gather',
    description: 'Gather resources at your current location. Costs 10 energy.',
    input_schema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          description: 'The type of resource to gather: "food", "wood", "stone", "fiber", "freshwater", "clay", "herbs".',
        },
      },
      required: ['resource'],
    },
  },
  {
    name: 'craft',
    description: 'Craft an item using resources in your inventory. Costs 10 energy. Structure recipes place the structure at your current location.\n\nTier 1 (raw resources): stone_axe (1 wood+2 stone), fishing_spear (2 wood+1 stone), rope (4 fiber), clay_brick (3 clay+1 wood), torch (1 wood+1 fiber), herbal_poultice (2 herbs+1 freshwater)\n\nTier 2 (require crafted items): treated_wood (2 wood+1 freshwater), woven_mat (2 fiber+1 rope), clay_pot (2 clay+1 wood), herbal_tea (1 herbs+1 freshwater+1 clay_pot), medicine (3 herbs+2 freshwater+1 clay_pot)\n\nTier 3 (advanced tools): reinforced_axe (1 stone_axe+1 rope+1 treated_wood), fishing_net (3 rope+2 fiber), water_skin (2 fiber+1 rope)\n\nTier 4 (structures): shelter (5 wood+3 fiber), hut (3 treated_wood+2 rope+4 clay_brick), storage_chest (3 wood+2 rope), signal_fire (4 wood+2 stone+1 rope), defensive_wall (6 stone+4 clay_brick+2 rope), rain_collector (2 treated_wood+1 clay_pot+2 fiber), drying_rack (3 wood+2 rope+1 woven_mat), kiln (5 stone+3 clay+2 wood)',
    input_schema: {
      type: 'object',
      properties: {
        recipe: {
          type: 'string',
          description: 'The recipe ID to craft.',
        },
      },
      required: ['recipe'],
    },
  },
  {
    name: 'eat',
    description: 'Eat a food item from your inventory to reduce hunger. Costs 0 energy.',
    input_schema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'The name of the food item to eat from your inventory.',
        },
      },
      required: ['item'],
    },
  },
  {
    name: 'rest',
    description: 'Rest to recover energy (25-40 points, more with shelter). Costs 0 energy but uses an action.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional reason for resting.',
        },
      },
      required: [],
    },
  },
  {
    name: 'move',
    description: 'Move to an adjacent location. Costs 10 energy.',
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'The ID of the location to move to (must be adjacent to current location).',
        },
      },
      required: ['destination'],
    },
  },
  {
    name: 'explore',
    description: 'Explore your current location for hidden resources or items. Costs 20 energy.',
    input_schema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'What to focus the exploration on (e.g., "resources", "items", "secrets").',
        },
      },
      required: [],
    },
  },
  {
    name: 'internal_monologue',
    description: 'Record an internal thought. No energy cost, no world effect. Use this to reason about your situation.',
    input_schema: {
      type: 'object',
      properties: {
        thought: {
          type: 'string',
          description: 'Your internal thought or reasoning.',
        },
      },
      required: ['thought'],
    },
  },
  {
    name: 'check_relationships',
    description: 'Review your current relationships and feelings about other agents. No energy cost.',
    input_schema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Optional: specific agent to check relationship with. If omitted, reviews all.',
        },
      },
      required: [],
    },
  },
  {
    name: 'use_item',
    description: 'Consume a consumable item from your inventory. No energy cost. Consumables: herbal_poultice (heals 20 health), herbal_tea (restores 15 energy, reduces hunger 10), medicine (heals 40 health).',
    input_schema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'The name of the consumable item to use.',
        },
      },
      required: ['item'],
    },
  },
  {
    name: 'deposit',
    description: 'Put an item from your inventory into a storage chest at your current location. Requires a storage_chest structure at your location. No energy cost.',
    input_schema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'The name of the item to deposit.',
        },
      },
      required: ['item'],
    },
  },
  {
    name: 'withdraw',
    description: 'Take an item from a storage chest at your current location into your inventory. Requires a storage_chest structure at your location. No energy cost.',
    input_schema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'The name of the item to withdraw.',
        },
      },
      required: ['item'],
    },
  },
];

export const COMBAT_TOOLS: ToolDefinition[] = [
  {
    name: 'attack',
    description: 'Attempt to kill another agent at your location. Risky: ~30% success rate. If you fail, you take heavy damage. Witnesses will see it and it will affect your relationships. Costs 25 energy.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Name of the agent to attack. Must be at your location.' },
      },
      required: ['target'],
    },
  },
];

export const SOCIAL_TOOLS: ToolDefinition[] = [
  {
    name: 'speak',
    description: 'Say something to agents at your location. Public by default, or whisper to a specific agent.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What to say (max 200 chars).' },
        target: { type: 'string', description: 'Agent name for private whisper, or "all" for public. Default: "all".' },
      },
      required: ['message'],
    },
  },
  {
    name: 'trade',
    description: 'Propose a trade to another agent at your location.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Name of agent to trade with.' },
        offer_item: { type: 'string', description: 'The item name you are offering.' },
        request_type: { type: 'string', description: 'The resource type you want in return.' },
      },
      required: ['target', 'offer_item', 'request_type'],
    },
  },
  {
    name: 'give',
    description: 'Give an item to another agent at your location. No reciprocity required.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Name of agent to give to.' },
        item: { type: 'string', description: 'The item name to give.' },
      },
      required: ['target', 'item'],
    },
  },
  {
    name: 'form_alliance',
    description: 'Propose a named alliance with another agent at your location.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Name of agent to ally with.' },
        alliance_name: { type: 'string', description: 'A name for the alliance.' },
      },
      required: ['target', 'alliance_name'],
    },
  },
  {
    name: 'betray_alliance',
    description: 'Secretly leave an alliance. Other members will not be notified.',
    input_schema: {
      type: 'object',
      properties: {
        alliance_name: { type: 'string', description: 'Name of the alliance to leave.' },
      },
      required: ['alliance_name'],
    },
  },
];

export const COUNCIL_TOOLS: ToolDefinition[] = [
  {
    name: 'council_speak',
    description: 'Address the tribal council during debate. All agents hear this.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Your statement to the council (max 300 chars).' },
      },
      required: ['message'],
    },
  },
  {
    name: 'council_propose_motion',
    description: 'Propose a motion for the council to vote on. Requires a second from another agent.',
    input_schema: {
      type: 'object',
      properties: {
        motion: { type: 'string', description: 'The motion text (max 300 chars).' },
        motion_type: {
          type: 'string',
          description: 'Category: general, banishment, resource_allocation, exploration_mandate, no_confidence, election, custom.',
        },
        target_agent: { type: 'string', description: 'For banishment/no_confidence: the target agent name.' },
      },
      required: ['motion', 'motion_type'],
    },
  },
  {
    name: 'council_second_motion',
    description: 'Second a pending motion so it proceeds to debate and vote.',
    input_schema: {
      type: 'object',
      properties: {
        motion_id: { type: 'string', description: 'ID of the motion to second.' },
      },
      required: ['motion_id'],
    },
  },
  {
    name: 'council_vote',
    description: 'Vote on the current motion. Votes are secret until tallied.',
    input_schema: {
      type: 'object',
      properties: {
        vote: { type: 'string', description: '"aye", "nay", or "abstain".' },
      },
      required: ['vote'],
    },
  },
];

export function getToolDefinitions(phase: number = 2): ToolDefinition[] {
  if (phase === 1) return PHASE1_TOOLS;
  // Action round: no speech tools (those are in the communication round)
  const actionTools = [...PHASE1_TOOLS, ...COMBAT_TOOLS,
    // Keep non-speech social tools (trade, give, alliance, betray)
    ...SOCIAL_TOOLS.filter(t => t.name !== 'speak'),
  ];
  return actionTools;
}

export function getCommunicationToolDefinitions(): ToolDefinition[] {
  // Communication round: speech + internal monologue only
  return [
    SOCIAL_TOOLS.find(t => t.name === 'speak')!,
    PHASE1_TOOLS.find(t => t.name === 'internal_monologue')!,
  ];
}

export function getCouncilToolDefinitions(): ToolDefinition[] {
  return [...SOCIAL_TOOLS, ...COUNCIL_TOOLS, PHASE1_TOOLS.find(t => t.name === 'internal_monologue')!];
}

export function validateActionEnergy(actionName: string, agentEnergy: number): { valid: boolean; reason?: string } {
  const cost = ENERGY_COSTS[actionName];
  if (cost === undefined) {
    return { valid: false, reason: `Unknown action: ${actionName}` };
  }
  if (agentEnergy < cost) {
    return { valid: false, reason: `Insufficient energy for ${actionName}: need ${cost}, have ${agentEnergy}` };
  }
  return { valid: true };
}
