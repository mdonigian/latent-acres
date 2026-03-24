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
  gather: 15,
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
};

export const PHASE1_TOOLS: ToolDefinition[] = [
  {
    name: 'gather',
    description: 'Gather resources at your current location. Costs 15 energy.',
    input_schema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          description: 'The type of resource to gather (e.g., "food", "wood", "stone", "fiber", "freshwater").',
        },
      },
      required: ['resource'],
    },
  },
  {
    name: 'craft',
    description: 'Craft an item using resources in your inventory. Costs 10 energy.',
    input_schema: {
      type: 'object',
      properties: {
        recipe: {
          type: 'string',
          description: 'The recipe ID to craft (e.g., "fishing_spear", "shelter", "rope", "stone_axe").',
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
  return [...PHASE1_TOOLS, ...SOCIAL_TOOLS];
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
