# Latent Acres — Technical Specification

## Vision

Latent Acres is a **persistent, fully autonomous AI agent world**. Agents live on an isolated island, survive against environmental pressure, form social bonds and rivalries, govern themselves through tribal councils, and vote each other out — Survivor-style. The entire simulation runs without human intervention. The world evolves through discrete time steps ("ticks"), and agents interact exclusively through a sandboxed tool interface.

This is not a game with a winner. It is a **living world** that runs until its creator decides to stop it. Agents can die — from starvation, exposure, or the vote. New agents can be introduced. The world persists across server restarts. Think of it as a terrarium for AI behavior.

The long-term vision:
1. A Game Master agent that observes emergent behavior and builds new features into the living world.
2. External interaction — spectators (and eventually paying users) can send messages, drop items, or influence events, Hunger Games sponsor-style.
3. Multi-model agents — different LLM providers powering different personalities.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Game Server                     │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Tick Loop  │  │  World   │  │   Event Log  │  │
│  │ (Epoch    │──│  State   │──│  (append-only │  │
│  │  Engine)  │  │  (SQLite)│  │   history)   │  │
│  └─────┬─────┘  └──────────┘  └──────────────┘  │
│        │                                         │
│  ┌─────▼──────────────────────────────────────┐  │
│  │            Agent Orchestrator               │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐          │  │
│  │  │Agent 1 │ │Agent 2 │ │Agent N │  ...     │  │
│  │  │(Claude)│ │(Claude)│ │(Claude)│          │  │
│  │  └────────┘ └────────┘ └────────┘          │  │
│  └────────────────────────────────────────────┘  │
│        │                                         │
│  ┌─────▼─────┐  ┌────────────────┐               │
│  │  Action   │  │  Game Master   │               │
│  │  Resolver │  │  Agent (v2)    │               │
│  └───────────┘  └────────────────┘               │
└─────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript | Type safety for complex game state, good Claude SDK support |
| Runtime | Node.js (Bun optional) | Simple single-process server, no need for concurrency frameworks |
| Database | SQLite (via `better-sqlite3`) | Zero-config, file-based, perfect for single-server simulation |
| LLM | Claude Sonnet 4 via Anthropic SDK | Best cost/intelligence tradeoff for agent reasoning; tool use is native |
| Memory | SQLite + summarization | Rolling summaries + recent event buffer per agent |
| Frontend | React dashboard (optional, phase 2) | Observe the simulation live |

---

## 2. Core Concepts

### 2.1 Ticks and Epochs

The simulation advances in **ticks**. A tick is one atomic time step.

```
Epoch (e.g. 12 ticks)
├── Tick 1: All agents submit actions → resolved simultaneously
├── Tick 2: All agents submit actions → resolved simultaneously
├── ...
├── Tick 12: All agents submit actions → resolved simultaneously
└── EPOCH BOUNDARY: Tribal Council convenes
    ├── Discussion phase (agents speak freely, 2-3 rounds)
    ├── Voting phase (each agent votes to eliminate one)
    └── Resolution (eliminated agent is removed)
```

**Configuration (tunable):**
```typescript
interface SimulationConfig {
  ticksPerEpoch: number;          // default: 12
  actionsPerTick: number;         // default: 2 (each agent gets N actions per tick)
  tickDelayMs: number;            // delay between ticks (for rate limiting / observability)
  discussionRounds: number;       // tribal council discussion rounds, default: 3
  enableGameMaster: boolean;      // v2 feature flag
  seed: number;                   // RNG seed for reproducible random events
  dbPath: string;                 // path to SQLite db (the persistent world file)
}
```

**Seeded randomness:** All random events (weather, resource discovery, illness, etc.) use a seeded PRNG (e.g., `seedrandom` or a simple mulberry32). The seed is stored in the DB, so replaying from the same state produces identical outcomes. The seed advances deterministically with each tick. This means you can fork a world: copy the DB, change the seed, and see how an alternate timeline plays out.

### 2.2 World State

The island is modeled as a set of **locations** with **resources**. Not a full grid — think of it as a graph of named places.

```typescript
interface Location {
  id: string;
  name: string;                   // "The Beach", "Dense Jungle", "Freshwater Spring"
  description: string;
  resources: ResourceNode[];
  connectedTo: string[];          // adjacent location IDs
  shelter: Shelter | null;
  dangerLevel: number;            // 0-1, affects random events
}

interface ResourceNode {
  type: ResourceType;             // "food", "wood", "stone", "fiber", "freshwater"
  quantity: number;               // depletes when gathered, regenerates slowly
  gatherDifficulty: number;       // 0-1, affects success rate
  regenerationRate: number;       // units per tick
}

interface Shelter {
  builtBy: string[];              // agent IDs
  quality: number;                // 0-1, affects rest recovery and weather protection
  capacity: number;
}
```

**Resource regeneration** happens at the start of each tick. Resources are finite but renewable — agents can overfish a pond or strip a forest if they're not careful.

### 2.3 Agent State

Each agent has physical needs (survival) and social state (relationships, reputation).

```typescript
interface AgentState {
  id: string;
  name: string;
  personality: PersonalityProfile;

  // Physical
  health: number;                 // 0-100, death at 0 (removed from game)
  hunger: number;                 // 0-100, 100 = starving. Increases each tick.
  energy: number;                 // 0-100, spent on actions, recovered by resting
  location: string;               // current location ID

  // Inventory
  inventory: InventoryItem[];
  maxInventorySlots: number;      // default: 10

  // Social
  relationships: Record<string, number>;  // agentId -> sentiment (-100 to 100)
  alliances: string[];            // alliance IDs
  reputation: number;             // public reputation score, affected by actions

  // Status
  isAlive: boolean;               // false = dead (starvation, exposure, etc.)
  isEliminated: boolean;          // false = voted out at tribal council
  causeOfDeath: "starvation" | "exposure" | "voted_out" | "illness" | null;
  removedAtTick: number | null;
  removedAtEpoch: number | null;
}
```

**Death vs. Elimination:** Both remove an agent from the active world, but they're distinct narratively. An eliminated agent was voted out by the tribe. A dead agent succumbed to the island. Both are permanent — the world is harsh. Dead/eliminated agents' belongings scatter at their last location.

interface PersonalityProfile {
  traits: string[];               // e.g. ["strategic", "empathetic", "paranoid", "loyal"]
  backstory: string;              // 2-3 sentences, injected into system prompt
  communicationStyle: string;     // e.g. "blunt and direct" or "diplomatic, avoids conflict"
  values: string[];               // e.g. ["fairness", "self-preservation", "loyalty"]
  hiddenAgenda: string | null;    // secret goal only this agent knows
}
```

**Hunger/health decay:**
- Hunger increases by `+8` per tick
- If hunger > 80: health decreases by `-5` per tick
- If hunger > 95: health decreases by `-15` per tick
- Eating food reduces hunger (amount depends on food type)
- Health regenerates `+2` per tick if hunger < 50 and agent rested

### 2.4 Agent Creation

Agents are **created manually** via JSON config files. Each agent is a deliberate character design. An auto-generate option exists for convenience, but the default workflow is hand-crafting agents.

#### Manual Creation (Primary)

Create agents via JSON files in `agents/` directory:

```jsonc
// agents/vex.json
{
  "name": "Vex",
  "model": "claude-sonnet-4-20250514",   // which LLM powers this agent
  "personality": {
    "traits": ["cunning", "charismatic", "ruthless"],
    "backstory": "A former poker player who reads people better than situations. Burned every bridge in their old life and sees the island as a fresh deck to deal from.",
    "communicationStyle": "Warm and disarming on the surface, always probing for information. Rarely makes direct statements — prefers questions.",
    "values": ["information", "leverage", "self-preservation"],
    "hiddenAgenda": "Wants to be the last person anyone suspects, right up until the end."
  },
  "startingLocation": "the_beach"       // optional, random if omitted
}
```

```jsonc
// agents/moss.json
{
  "name": "Moss",
  "model": "claude-sonnet-4-20250514",
  "personality": {
    "traits": ["nurturing", "observant", "quietly stubborn"],
    "backstory": "A field biologist who has spent years alone in remote ecosystems. Genuinely loves the island and sees the other castaways as fascinating specimens — but also as people worth protecting.",
    "communicationStyle": "Calm, factual, occasionally poetic about nature. Avoids conflict but won't back down when cornered.",
    "values": ["sustainability", "honesty", "collective survival"],
    "hiddenAgenda": "Secretly documenting everyone's behavior in internal monologue, building psychological profiles."
  }
}
```

#### Auto-Generate (Convenience)

For quick starts, use Claude to generate a full cast:

```bash
npx tsx src/index.ts generate-agents --count 8 --seed 42
```

This calls Claude with a meta-prompt:

```
Generate a cast of {N} castaways for a Survivor-style island survival game.
Each should have a distinct personality archetype, communication style,
and hidden agenda. Make them diverse — include strategists, social
players, wildcards, loyalists, and schemers. Give each a 2-sentence
backstory that informs their decision-making. Make them feel like
real characters, not archetypes.

Return as JSON array matching the PersonalityProfile schema.
```

Generated agents are written to `agents/generated/` for review and editing before loading.

#### Adding Agents to a Running World

Since the world is persistent, new agents can be introduced mid-simulation:

```bash
npx tsx src/index.ts add-agent agents/newcomer.json
# Agent arrives at a random coastal location next tick
# Other agents see: "A stranger washes ashore at The Beach..."
```

This creates natural dramatic tension — existing alliances must decide how to handle the newcomer.

---

## 3. The Agent Sandbox

This is the most critical design decision. Each agent is a Claude instance that receives a structured prompt and can ONLY interact with the world through a defined set of tools. The agent never sees raw game state — only a filtered "perception" of what their character would know.

### 3.1 Agent Prompt Structure

Each tick, the orchestrator constructs a prompt for each agent:

```typescript
interface AgentPromptPayload {
  // System prompt (constant per agent)
  systemPrompt: string;

  // Injected per-tick
  perception: AgentPerception;
  memory: AgentMemory;
  availableActions: ToolDefinition[];
  tickContext: {
    currentTick: number;
    currentEpoch: number;
    ticksUntilTribalCouncil: number;
    actionsRemaining: number;
  };
}
```

**System prompt template:**

```
You are {name}, a castaway on a remote island in the game Latent Acres.

PERSONALITY:
{backstory}
Your traits: {traits}
Your communication style: {communicationStyle}
Your values: {values}
{hiddenAgenda ? "Your secret goal (known only to you): " + hiddenAgenda : ""}

RULES:
- You must survive. If your health reaches 0, you die permanently.
- You can die from starvation, exposure, illness, or other hazards. Death is real.
- Every {ticksPerEpoch} ticks, a Tribal Council is held where one person is voted out.
- Votes are cast secretly. Results show who received votes, but NOT who cast them.
  Other agents may tell you how they voted — but they may be lying.
- You can only interact with the world through the tools provided.
- You see only what is observable from your current location.
- Other agents may lie to you. Trust is earned.
- You have {actionsPerTick} actions per tick. Choose wisely.
- New castaways may arrive at any time. The world does not end.

STRATEGY GUIDANCE:
- Balance survival needs (food, shelter, health) with social gameplay (alliances, reputation)
- Information is power — what you share and withhold matters
- The Tribal Council vote is the most consequential moment each epoch
- Dead agents leave their belongings behind. A death can shift the balance of power.
- There is no "winning." There is only surviving, and the relationships you build.

Respond ONLY with tool calls. Do not output any text outside of tool calls.
If you want to think/plan, use the `internal_monologue` tool.
```

### 3.2 Perception System

Agents only see what their character could plausibly observe. No omniscience.

```typescript
interface AgentPerception {
  // What you see at your current location
  currentLocation: {
    name: string;
    description: string;
    visibleResources: { type: string; estimatedQuantity: "scarce" | "moderate" | "abundant" }[];
    presentAgents: { name: string; visibleState: string }[];  // e.g. "looks tired and hungry"
    shelter: { quality: string; occupants: string[] } | null;
    weather: string;
  };

  // Your own state (agents always know their own stats)
  self: {
    health: number;
    hunger: number;
    energy: number;
    inventory: { name: string; type: string; quantity: number }[];
  };

  // What you've heard recently (messages directed at you or spoken publicly at your location)
  recentMessages: {
    from: string;
    content: string;
    wasPrivate: boolean;
    tickAgo: number;
  }[];

  // Public knowledge
  eliminatedAgents: string[];
  currentEpoch: number;
  tribalCouncilIn: number;        // ticks until next council
}
```

**Key constraint:** Resource quantities are shown as qualitative estimates ("scarce", "moderate", "abundant"), not exact numbers. Agents must explore and learn. Other agents' health/hunger is shown as visible cues ("looks well-fed", "looks exhausted"), not exact stats.

### 3.3 Tool Definitions (The Sandbox API)

These are the ONLY ways an agent can affect the world. Defined as Claude tool schemas.

```typescript
const AGENT_TOOLS: ToolDefinition[] = [

  // === SURVIVAL ===

  {
    name: "gather",
    description: "Gather resources at your current location. Costs 15 energy.",
    parameters: {
      resource_type: {
        type: "string",
        enum: ["food", "wood", "stone", "fiber", "freshwater"],
        description: "The type of resource to gather"
      }
    }
  },

  {
    name: "craft",
    description: "Craft an item from resources in your inventory. Costs 20 energy.",
    parameters: {
      recipe: {
        type: "string",
        enum: ["fishing_spear", "shelter_upgrade", "fire_starter", "snare_trap", "raft", "medicine"],
        description: "What to craft"
      }
    }
  },

  {
    name: "eat",
    description: "Consume food from your inventory to reduce hunger.",
    parameters: {
      item_id: {
        type: "string",
        description: "Inventory item ID to consume"
      }
    }
  },

  {
    name: "rest",
    description: "Rest to recover energy. More effective in shelter. Costs your action but recovers 25-40 energy.",
    parameters: {}
  },

  {
    name: "move",
    description: "Move to an adjacent location. Costs 10 energy.",
    parameters: {
      destination: {
        type: "string",
        description: "Name or ID of adjacent location"
      }
    }
  },

  {
    name: "explore",
    description: "Scout your current location more thoroughly. May reveal hidden resources or information. Costs 20 energy.",
    parameters: {}
  },

  // === SOCIAL ===

  {
    name: "speak",
    description: "Say something to agents at your location. Public unless whispered.",
    parameters: {
      message: {
        type: "string",
        description: "What to say (max 200 chars)"
      },
      target: {
        type: "string",
        description: "Agent name for private whisper, or 'all' for public",
        default: "all"
      }
    }
  },

  {
    name: "trade",
    description: "Propose a trade to another agent at your location.",
    parameters: {
      target: {
        type: "string",
        description: "Name of agent to trade with"
      },
      offer_item_id: {
        type: "string",
        description: "Your inventory item to offer"
      },
      request_type: {
        type: "string",
        description: "What resource type you want in return"
      }
    }
  },

  {
    name: "give",
    description: "Give an item to another agent at your location (no trade required).",
    parameters: {
      target: { type: "string" },
      item_id: { type: "string" }
    }
  },

  {
    name: "form_alliance",
    description: "Propose a named alliance with another agent. They must accept.",
    parameters: {
      target: { type: "string" },
      alliance_name: { type: "string", description: "A name for the alliance" }
    }
  },

  {
    name: "betray_alliance",
    description: "Secretly leave an alliance. Other members won't know until they check.",
    parameters: {
      alliance_id: { type: "string" }
    }
  },

  // === TRIBAL COUNCIL (only available during council phase) ===

  {
    name: "council_speak",
    description: "Address the tribal council. All agents hear this.",
    parameters: {
      message: { type: "string", description: "Your statement (max 300 chars)" }
    }
  },

  {
    name: "council_vote",
    description: "Cast your vote to eliminate an agent. Secret until revealed.",
    parameters: {
      target: {
        type: "string",
        description: "Name of agent to vote out"
      }
    }
  },

  // === META ===

  {
    name: "internal_monologue",
    description: "Think to yourself. Not visible to other agents. Use this to plan strategy, evaluate threats, or reason about decisions.",
    parameters: {
      thought: { type: "string" }
    }
  },

  {
    name: "check_relationships",
    description: "Reflect on your relationships with other agents based on past interactions.",
    parameters: {}
  }
];
```

### 3.4 Crafting Recipes

```typescript
const RECIPES: Record<string, Recipe> = {
  fishing_spear:    { inputs: { wood: 2, stone: 1 }, outputs: [{ type: "tool", name: "Fishing Spear", effect: "2x food from fishing" }] },
  shelter_upgrade:  { inputs: { wood: 4, fiber: 2 }, outputs: [{ type: "shelter_upgrade", bonus: 0.2 }] },
  fire_starter:     { inputs: { wood: 1, stone: 2 }, outputs: [{ type: "tool", name: "Fire Starter", effect: "cook food for 2x nutrition" }] },
  snare_trap:       { inputs: { wood: 1, fiber: 3 }, outputs: [{ type: "tool", name: "Snare Trap", effect: "passive food generation" }] },
  raft:             { inputs: { wood: 6, fiber: 4 }, outputs: [{ type: "tool", name: "Raft", effect: "access to offshore locations" }] },
  medicine:         { inputs: { food: 2, freshwater: 2 }, outputs: [{ type: "consumable", name: "Medicine", effect: "+30 health" }] },
};
```

---

## 4. Memory System

Each agent maintains two tiers of memory:

### 4.1 Short-Term Memory (Recent Events Buffer)

A rolling window of the last `K` events (default: `K = 50`) stored as structured entries:

```typescript
interface MemoryEntry {
  tick: number;
  epoch: number;
  type: "observation" | "action" | "conversation" | "council" | "internal";
  content: string;          // natural language description
  involvedAgents: string[];
  emotionalValence: number; // -1 to 1, set by the agent's reaction
  importance: number;       // 0-1, for prioritized recall
}
```

These are injected verbatim into the agent's prompt each tick.

### 4.2 Long-Term Memory (Compressed Summaries)

Every `M` ticks (default: `M = 6`, i.e. twice per epoch), the agent's short-term buffer is summarized by a separate Claude call:

```
Given these recent events from the perspective of {agent_name}:
{recentEvents}

And their existing long-term memory:
{existingLongTermMemory}

Produce an updated long-term memory summary (max 800 words) that captures:
1. Key alliances and relationships (who do you trust? who is dangerous?)
2. Resource knowledge (where is food? what's scarce?)
3. Strategic observations (who is likely to be voted out? who has power?)
4. Personal goals and evolving plans
5. Unresolved questions or suspicions

Write in first person from {agent_name}'s perspective.
```

This compressed summary is included in every agent prompt, giving them persistent context across the entire game without blowing up context windows.

### 4.3 Relationship Tracker

Maintained server-side based on interactions, but agents also have their own *subjective* perception of relationships (via memory). The server tracks:

```typescript
interface RelationshipEvent {
  tick: number;
  agentA: string;
  agentB: string;
  type: "helped" | "traded" | "spoke_positively" | "spoke_negatively" |
        "betrayed" | "formed_alliance" | "voted_against" | "gave_gift";
  sentimentDelta: number;   // how much this shifts the relationship
}
```

The server computes objective relationship scores, but agents only see their own subjective model (which can be wrong — they might not know someone voted against them).

---

## 5. Action Resolution

### 5.1 Tick Resolution Pipeline

```
For each tick:
  1. Regenerate resources at all locations (using seeded RNG)
  2. Apply passive effects (hunger increase, trap yields, weather)
  3. Check for agent deaths:
     - If health <= 0: agent dies, inventory scatters at location
     - Death event logged, surviving agents at same location are notified
  4. For each LIVING agent (parallel, batched for rate limits):
     a. Build perception payload
     b. Build memory payload
     c. Call Claude with system prompt + perception + memory + tools
     d. Parse tool calls from response
     e. Validate actions (energy costs, location constraints, inventory checks)
  5. Resolve all valid actions simultaneously:
     - Gather: distribute resources (if multiple agents gather same node, split proportionally)
     - Movement: update locations
     - Speech: route messages to recipients
     - Trades: match proposals, execute if both sides valid
     - Crafting: consume inputs, produce outputs
     - Combat/sabotage: resolve contested actions
  6. Apply consequences (hunger damage, health regen, etc.)
  7. Roll for random world events (seeded RNG)
  8. Log all events to event log
  9. Update short-term memory buffers for all agents
  10. If tick % M == 0: trigger long-term memory compression for all agents
  11. If tick marks end of epoch: trigger Tribal Council phase
  12. Persist tick state to SQLite (crash recovery point)
  13. Advance RNG seed
```

### 5.2 Conflict Resolution

When agents compete for the same scarce resource:

```typescript
function resolveGatherConflict(agents: AgentState[], resource: ResourceNode): Map<string, number> {
  // Proportional split weighted by:
  // 1. Who has relevant tools (e.g., fishing spear for food)
  // 2. Energy invested
  // 3. Small random factor (luck)
  // If resource is insufficient for all, some get nothing
}
```

### 5.3 Tribal Council Phase

Tribal Council is a special multi-round phase, not a single tick:

```
Council Phase:
  Round 1 (Discussion):
    - All agents receive: who's present, recent events summary, their memory
    - Each agent uses `council_speak` to make a statement
    - All statements are broadcast to all agents

  Round 2 (Discussion):
    - Agents see Round 1 statements
    - Another round of `council_speak`
    - Agents can also `speak` privately (whisper) during this phase

  Round 3 (Final Plea):
    - Last statements before the vote

  Vote:
    - Each agent uses `council_vote` to cast one vote
    - Votes are tallied
    - Agent with most votes is eliminated (ties broken by seeded RNG)
    - ONLY the vote totals are announced: "{Agent} received N votes"
    - WHO voted for whom is SECRET — agents can claim anything
    - This creates a rich deception layer: agents can whisper "I voted with you"
      whether or not it's true. The server knows the truth; the agents don't.
    - Eliminated agent gives a final statement
    - Eliminated agent's inventory scatters at their last location
```

---

## 6. Event System & Random Events

To keep things dynamic, the world generates random events:

```typescript
interface WorldEvent {
  id: string;
  name: string;
  description: string;
  triggerCondition: (state: WorldState) => boolean;   // when can this fire?
  probability: number;                                  // chance per tick
  effect: (state: WorldState) => WorldState;           // mutation
  announcement: string;                                // what agents see
}

const RANDOM_EVENTS: WorldEvent[] = [
  {
    name: "tropical_storm",
    description: "A violent storm hits the island",
    probability: 0.05,
    effect: (state) => {
      // Damage shelters, scatter resources, injure agents without shelter
    },
    announcement: "Dark clouds gather and a tropical storm batters the island!"
  },
  {
    name: "resource_discovery",
    description: "A new resource cache is found",
    probability: 0.08,
    effect: (state) => {
      // Add bonus resources to a random location
    },
    announcement: "A landslide has revealed a cache of resources at {location}!"
  },
  {
    name: "illness_outbreak",
    description: "A mysterious illness spreads",
    probability: 0.04,
    effect: (state) => {
      // Random agents lose health, medicine becomes critical
    },
    announcement: "Several castaways are feeling unwell..."
  },
  {
    name: "hidden_idol_appears",
    description: "A tribal immunity idol is hidden somewhere",
    probability: 0.06,
    effect: (state) => {
      // Place an idol at a random location, findable via explore
    },
    announcement: null  // no announcement — agents must discover it
  }
];
```

---

## 7. Island Map (Default)

```
                    ┌──────────────┐
                    │  The Summit   │
                    │  (dangerous,  │
                    │   rare stone) │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
      ┌───────▼──────┐ ┌──▼─────────┐ ┌▼──────────────┐
      │ Dense Jungle  │ │  Waterfall │ │  Rocky Ridge   │
      │ (wood, fiber, │ │  (fresh-   │ │  (stone, good  │
      │  danger: med) │ │  water)    │ │   vantage)     │
      └───────┬──────┘ └──┬─────────┘ └┬──────────────┘
              │            │            │
      ┌───────▼──────┐    │     ┌──────▼───────┐
      │  The Clearing │◄───┘     │  Tidal Pools  │
      │  (central hub,│          │  (food, but   │
      │   safe, fire) │◄─────────│   tide-dep.)  │
      └───────┬──────┘          └──────┬───────┘
              │                         │
      ┌───────▼──────┐          ┌──────▼───────┐
      │  The Beach    │          │  Mangrove     │
      │  (food via    │◄─────────│  Swamp        │
      │   fishing)    │          │  (fiber, food,│
      └──────────────┘          │   danger:high)│
                                 └──────────────┘
```

---

## 8. Data Model (SQLite Schema)

```sql
-- Core tables
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',  -- LLM model powering this agent
  personality_json TEXT NOT NULL,
  health INTEGER DEFAULT 100,
  hunger INTEGER DEFAULT 0,
  energy INTEGER DEFAULT 100,
  location_id TEXT NOT NULL,
  reputation INTEGER DEFAULT 50,
  is_alive BOOLEAN DEFAULT TRUE,
  is_eliminated BOOLEAN DEFAULT FALSE,
  cause_of_removal TEXT,          -- 'starvation' | 'exposure' | 'voted_out' | 'illness' | null
  removed_at_tick INTEGER,
  removed_at_epoch INTEGER,
  introduced_at_tick INTEGER DEFAULT 0,  -- when this agent entered the world
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  danger_level REAL DEFAULT 0,
  connected_to_json TEXT NOT NULL  -- JSON array of location IDs
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  gather_difficulty REAL DEFAULT 0.3,
  regen_rate REAL DEFAULT 1.0,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  properties_json TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE alliances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  members_json TEXT NOT NULL,
  formed_at_tick INTEGER,
  is_active BOOLEAN DEFAULT TRUE
);

-- Memory tables
CREATE TABLE memory_short_term (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  tick INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  involved_agents_json TEXT,
  importance REAL DEFAULT 0.5,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE memory_long_term (
  agent_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  last_updated_tick INTEGER,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE relationships (
  agent_a TEXT NOT NULL,
  agent_b TEXT NOT NULL,
  sentiment INTEGER DEFAULT 0,
  last_interaction_tick INTEGER,
  PRIMARY KEY (agent_a, agent_b),
  FOREIGN KEY (agent_a) REFERENCES agents(id),
  FOREIGN KEY (agent_b) REFERENCES agents(id)
);

-- Event log (append-only, the full historical record)
CREATE TABLE event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  agent_id TEXT,
  target_agent_id TEXT,
  location_id TEXT,
  data_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  description TEXT NOT NULL,
  effects_json TEXT NOT NULL
);

-- Secret vote ledger (server knows truth; agents don't)
CREATE TABLE council_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch INTEGER NOT NULL,
  voter_agent_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  tick INTEGER NOT NULL,
  FOREIGN KEY (voter_agent_id) REFERENCES agents(id),
  FOREIGN KEY (target_agent_id) REFERENCES agents(id)
);

-- Simulation state (singleton — the "save file")
CREATE TABLE simulation (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
  current_tick INTEGER DEFAULT 0,
  current_epoch INTEGER DEFAULT 0,
  phase TEXT DEFAULT 'tick',               -- 'tick' | 'council_discussion' | 'council_vote'
  config_json TEXT NOT NULL,
  seed INTEGER NOT NULL,                   -- initial RNG seed
  rng_state TEXT NOT NULL,                 -- current RNG state for deterministic resume
  status TEXT DEFAULT 'running',           -- 'running' | 'paused' | 'stopped'
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_tick_at TIMESTAMP                   -- for crash recovery: know when we last ran
);

CREATE INDEX idx_events_tick ON event_log(tick);
CREATE INDEX idx_events_agent ON event_log(agent_id);
CREATE INDEX idx_memory_agent_tick ON memory_short_term(agent_id, tick);
```

---

## 9. Project Structure

```
latent-acres/
├── package.json
├── tsconfig.json
├── .env                          # ANTHROPIC_API_KEY
├── agents/                       # hand-crafted agent definitions
│   ├── vex.json
│   ├── moss.json
│   ├── ... (your custom agents)
│   └── generated/                # auto-generated agents land here for review
├── src/
│   ├── index.ts                  # CLI entry point (init, run, pause, resume, add-agent, etc.)
│   ├── config.ts                 # simulation configuration
│   ├── rng.ts                    # seeded PRNG (mulberry32 or similar)
│   ├── db/
│   │   ├── schema.ts             # SQLite schema initialization
│   │   ├── queries.ts            # typed query helpers
│   │   └── migrations/           # schema versioning for live worlds
│   ├── engine/
│   │   ├── tick-loop.ts          # main simulation loop
│   │   ├── action-resolver.ts    # processes and resolves agent actions
│   │   ├── resource-manager.ts   # resource regen, depletion, weather effects
│   │   ├── tribal-council.ts     # council phase logic (secret votes)
│   │   ├── death.ts              # death checks, inventory scatter, notifications
│   │   └── event-system.ts       # random world events (seeded)
│   ├── agents/
│   │   ├── orchestrator.ts       # manages all agent instances, parallel execution
│   │   ├── prompt-builder.ts     # constructs per-tick prompts for each agent
│   │   ├── perception.ts         # builds what an agent can "see"
│   │   ├── memory.ts             # short-term buffer + long-term summarization
│   │   ├── personality.ts        # personality loading + auto-generation
│   │   ├── tools.ts              # tool definitions (the sandbox API)
│   │   └── model-adapter.ts      # abstraction layer for multi-model support (future)
│   ├── world/
│   │   ├── island.ts             # map definition, locations, connections
│   │   ├── crafting.ts           # recipe definitions and resolution
│   │   └── weather.ts            # weather system (seeded)
│   ├── admin/                    # operator controls (you, Matt)
│   │   ├── cli.ts                # CLI commands: pause, resume, add-agent, kill, inspect
│   │   └── interventions.ts      # manual world modifications (add resources, trigger events)
│   ├── game-master/              # v2: meta-agent that modifies the game
│   │   ├── observer.ts           # watches for patterns in event log
│   │   ├── designer.ts           # proposes new features/events
│   │   └── sandbox.ts            # safe execution environment for GM changes
│   ├── api/                      # optional REST API for dashboard
│   │   ├── server.ts
│   │   └── routes.ts
│   └── utils/
│       ├── logger.ts             # structured logging for simulation
│       ├── rate-limiter.ts       # respect Anthropic rate limits
│       └── cost-tracker.ts       # track token usage and estimated cost
├── dashboard/                    # optional React frontend (phase 2)
│   └── ...
├── data/
│   └── latent-acres.db           # THE persistent world (back this up!)
└── logs/
    └── simulation-{timestamp}/   # per-session logs (restart boundary)
        ├── events.jsonl          # machine-readable event stream
        ├── conversations.log     # all agent speech
        ├── council-transcripts/  # full tribal council logs
        └── agent-thoughts/       # internal monologues (for debugging/entertainment)
```

---

## 10. Cost & Rate Limit Management

Each tick requires N agent calls (one per living agent), and memory compression adds more. Since the world is persistent, cost tracking is cumulative — you'll want to know the lifetime cost of a world.

### Estimates (per tick, 8 agents alive):

| Call Type | Count | Est. Input Tokens | Est. Output Tokens | Cost (Sonnet) |
|-----------|-------|-------------------|--------------------|----|
| Agent action | 8 | ~2,000 each | ~200 each | ~$0.04 |
| Memory compression | 1-2 | ~3,000 each | ~800 each | ~$0.02 |
| **Tick total** | ~10 | ~22,000 | ~2,400 | **~$0.06** |

**Per epoch (12 ticks + council):** ~$0.85
**Per 100 ticks:** ~$6
**Per 24-hour run at 1 tick/min:** ~$86

For development/testing, use Haiku agents (cut cost ~10x) or slow the tick rate down. The `cost-tracker.ts` module should log cumulative spend to the DB so you always know what a world has cost.

### Rate limiting strategy:
```typescript
// Process agents in batches to stay under RPM limits
const BATCH_SIZE = 4;           // concurrent API calls
const INTER_BATCH_DELAY_MS = 500;

// Cost guardrails
const MAX_COST_PER_TICK = 0.50;         // halt if a single tick costs more than this
const COST_WARNING_THRESHOLD = 50.00;   // log warning when cumulative spend hits this
```

---

## 11. Phased Build Plan

### Phase 1: Core Simulation (MVP)
- [ ] Seeded PRNG module (`rng.ts`)
- [ ] SQLite schema + typed query layer with WAL mode for crash safety
- [ ] World initialization (island map, resources from config)
- [ ] Agent loading from JSON config files (`agents/*.json`)
- [ ] Auto-generate agents via Claude (`generate-agents` CLI command)
- [ ] Agent prompt builder (system prompt + perception + memory + tools)
- [ ] Tool definitions and action validation
- [ ] Perception system (qualitative resource estimates, visible agent cues)
- [ ] Tick loop with simultaneous action resolution
- [ ] Basic resource gathering, movement, rest, eating
- [ ] Death system: health=0 kills agent, inventory scatters, event logged
- [ ] Short-term memory buffer (last 50 events)
- [ ] Long-term memory summarization (every 6 ticks)
- [ ] Structured event logging (JSONL + SQLite `event_log`)
- [ ] Console output showing simulation progress (rich, readable)
- [ ] Persistence: simulation resumes from last tick on restart
- [ ] Cost tracking (tokens used per tick, cumulative spend)
- [ ] Rate limiting (batched API calls)
- [ ] Admin CLI: `init`, `run`, `pause`, `status`, `inspect`
- **Goal:** Run a persistent world in the terminal. Agents gather, eat, move, rest, and can die. Stop the server, restart it, and the world picks up exactly where it left off.

### Phase 2: Social Layer + Tribal Council
- [ ] Speech routing (public at location + private whispers)
- [ ] Alliance system (form, join, betray — betrayal is secret)
- [ ] Trading system (propose, accept/reject)
- [ ] Giving items (no reciprocity required)
- [ ] Relationship tracker (server-side objective + agent-side subjective via memory)
- [ ] Tribal Council phase:
  - [ ] Multi-round discussion (`council_speak`)
  - [ ] Whisper phase during council
  - [ ] Secret voting (`council_vote`, stored in `council_votes` table)
  - [ ] Vote tally announcement (totals only, not who voted for whom)
  - [ ] Elimination + final statement
  - [ ] Inventory scatter on elimination
- [ ] Random world events (seeded: storms, illness, resource discovery, hidden idols)
- [ ] Crafting system (recipes from spec)
- [ ] `add-agent` CLI command (introduce new agents to running world)
- [ ] `trigger-event` CLI command (god mode)
- [ ] `fork` CLI command (copy world DB + new seed)
- **Goal:** Full Survivor-style gameplay loop. Agents talk, scheme, betray, vote, and die. The world is persistent and can receive new agents at any time.

### Phase 3: Observability Dashboard
- [ ] REST API exposing world state, event log, agent details
- [ ] React dashboard:
  - [ ] Live island map with agent positions
  - [ ] Agent cards: health, hunger, energy, inventory, location
  - [ ] Relationship graph (force-directed, edge weight = sentiment)
  - [ ] Event timeline with filtering
  - [ ] Agent thought viewer (internal monologues — the best part)
  - [ ] Council transcript viewer with secret vote reveal toggle
  - [ ] Cost/token usage dashboard (cumulative + per-tick)
- [ ] Transcript export (markdown, for reading like a story)
- **Goal:** Watch the simulation unfold in real-time with a beautiful UI. Read agent thoughts like a novel.

### Phase 4: Game Master Agent
- [ ] Observer module: reads event log, identifies emergent patterns
- [ ] Pattern detection: stagnation, resource hoarding, alliance stalemates
- [ ] Designer module: proposes new events, tools, locations, or rule tweaks
- [ ] Proposal review: GM proposals are logged for admin approval (or auto-approved in brave mode)
- [ ] Sandboxed execution: GM changes validated against schema before applying
- [ ] Dynamic difficulty: if all agents are comfortable, make the island harder
- **Goal:** Self-evolving game world that responds to emergent behavior.

### Phase 5: External Interaction (Future)
- [ ] Spectator WebSocket feed (watch live without affecting world)
- [ ] Sponsor system: external users can send messages to agents
- [ ] Item drops: sponsors can drop items at locations
- [ ] Event triggers: sponsors can pay to trigger weather, discoveries, etc.
- [ ] Multi-model support: OpenAI, Gemini, local models via `model-adapter.ts`
- **Goal:** Hunger Games sponsor system. A living world with an audience.

---

## 12. Resolved Design Decisions

| Decision | Resolution | Implications |
|----------|-----------|--------------|
| **Determinism** | Seeded PRNG for all random events | Reproducible runs; can fork timelines by copying DB + changing seed |
| **Agent creation** | Manual JSON configs (primary) + auto-generate option | `agents/` directory with hand-crafted characters; `generate-agents` CLI for convenience |
| **Death** | Agents can die from starvation, exposure, illness | Health=0 is permanent death; inventory scatters; creates real survival pressure |
| **Vote secrecy** | Vote totals announced; individual votes are secret | Agents can lie about how they voted; the server tracks truth in `council_votes` table |
| **Endgame** | Open-ended persistent world | No win condition; world runs until admin stops it; new agents can be introduced anytime |
| **Spectator mode** | Deferred (phase 3+) | Future: paid interactions à la Hunger Games sponsors (messages, items, events) |
| **Persistence** | Fully persistent SQLite world file | Crash recovery via `last_tick_at`; world survives server restarts; back up `latent-acres.db` |
| **Multi-model** | Anthropic-only for v1; `model` field on agent config | `model-adapter.ts` stub for future OpenAI/Gemini/BYO support |

---

## 13. Running the Simulation

```bash
# Install
npm install

# Configure
cp .env.example .env
# Set ANTHROPIC_API_KEY

# === WORLD CREATION ===

# Initialize a new world with hand-crafted agents
npx tsx src/index.ts init --seed 42 --agents-dir ./agents

# Or auto-generate agents and init
npx tsx src/index.ts generate-agents --count 8 --seed 42
npx tsx src/index.ts init --seed 42 --agents-dir ./agents/generated

# === RUNNING ===

# Start the simulation (resumes from last tick if world exists)
npx tsx src/index.ts run

# Run with tick delay for observability (ms between ticks)
npx tsx src/index.ts run --tick-delay 2000

# Run for a specific number of ticks, then pause
npx tsx src/index.ts run --ticks 50

# === ADMIN CONTROLS ===

# Pause a running simulation (graceful, finishes current tick)
npx tsx src/index.ts pause

# Resume from where you left off
npx tsx src/index.ts run   # just run again — it picks up from last tick

# Inspect current world state
npx tsx src/index.ts status

# View a specific agent's memory and state
npx tsx src/index.ts inspect --agent Vex

# Add a new agent to a running world
npx tsx src/index.ts add-agent agents/newcomer.json

# Manually trigger an event (god mode)
npx tsx src/index.ts trigger-event tropical_storm

# Fork the world (copy DB, new seed for alternate timeline)
npx tsx src/index.ts fork --new-seed 99 --output data/latent-acres-fork.db

# === OPTIONAL ===

# Run with dashboard
npx tsx src/index.ts run --dashboard --port 3000

# Export game transcript (human-readable)
npx tsx src/index.ts export --format markdown --output transcript.md
```

---

## 14. Implementation Notes for Claude Code

### Where to Start

Build Phase 1 in this order:

1. **`rng.ts`** — Simple seeded PRNG. Everything else depends on deterministic randomness.
2. **`db/schema.ts`** — Initialize SQLite with the full schema. Use WAL mode. Include the `simulation` singleton row.
3. **`world/island.ts`** — Hard-code the default island map from section 7. Locations, connections, initial resources.
4. **`agents/personality.ts`** — Load agent JSON configs from disk. Validate against `PersonalityProfile` schema. Include the `generate-agents` Claude call.
5. **`agents/tools.ts`** — Define all tool schemas as Claude tool definitions. Start with survival tools only (gather, eat, rest, move, explore, craft, internal_monologue). Social tools come in phase 2.
6. **`agents/perception.ts`** — Build the perception payload for an agent. This is the "what can I see?" function. Qualitative estimates, not raw numbers.
7. **`agents/memory.ts`** — Short-term buffer (append + trim to K=50) and long-term summarization call.
8. **`agents/prompt-builder.ts`** — Assemble the full prompt: system prompt + perception + memory + tick context. This is the composition layer.
9. **`agents/orchestrator.ts`** — Call Claude for each agent, parse tool calls, return structured actions. Handle rate limiting and batching here.
10. **`engine/action-resolver.ts`** — Take all agent actions for a tick and resolve them simultaneously. Resource conflicts, movement, eating.
11. **`engine/death.ts`** — Check for health=0 after consequences. Scatter inventory. Log death event.
12. **`engine/tick-loop.ts`** — The main loop. Ties everything together. Persist state after each tick.
13. **`index.ts`** — CLI with `init`, `run`, `pause`, `status`, `inspect` commands.

### Key Principles

- **The DB is the world.** Everything persists to SQLite. If the process crashes mid-tick, the world should be recoverable from the last completed tick. Treat the DB like a save file.
- **Agents are stateless between ticks.** Each tick is a fresh Claude call. The agent has no memory except what's in the prompt (perception + short-term buffer + long-term summary). This is by design.
- **Tools are the only interface.** If an agent outputs text that isn't a tool call, ignore it. The `internal_monologue` tool exists so agents can "think" — log these, they're gold.
- **Perception is lossy.** Agents see qualitative descriptions, not numbers. "The pond looks nearly fished out" not "quantity: 2". This forces them to reason under uncertainty.
- **The event log is append-only.** Never delete from it. It's the ground truth for the entire history of the world.

### Testing Strategy

- **Dry-run mode:** Replace Claude calls with a simple heuristic agent (always gather food, always rest if low energy) to test the tick loop without API costs.
- **Snapshot tests:** After N ticks with the same seed and heuristic agents, the world state should be byte-identical. Use this to catch non-determinism bugs.
- **Single-agent test:** Run with 1 agent to verify the perception → prompt → action → resolution → memory pipeline before scaling to 8+.

### Console Output

During `run`, print something like:

```
═══ LATENT ACRES — Tick 47 (Epoch 3) ═══════════════════════════

  🏝️  The Beach     │ Vex, Coral         │ food: abundant
  🌿  Dense Jungle  │ Moss               │ wood: moderate, fiber: scarce
  💧  Waterfall     │ (empty)            │ freshwater: abundant
  🪨  Rocky Ridge   │ Sable, Drift       │ stone: abundant
  🔥  The Clearing  │ Phantom, Hex       │ shelter (quality: 0.6)
  🦀  Tidal Pools   │ Wren               │ food: scarce (low tide)

  Actions:
    Vex      → gather food (success: 3 fish)
    Vex      → whisper to Coral: "We need to talk about Phantom."
    Moss     → gather wood (success: 2 logs)
    Moss     → internal monologue: "Coral and Vex are always together..."
    Sable    → craft fishing_spear (success)
    Drift    → rest (+32 energy)
    Phantom  → speak (all): "Has anyone seen the idol?"
    Hex      → explore (found: nothing)
    Coral    → gather food (success: 2 fish)
    Coral    → whisper to Vex: "I don't trust him either."
    Wren     → gather food (failed — too scarce)
    Wren     → move → The Beach

  ⚠️  Wren is starving (hunger: 87, health: 72)
  💀  No deaths this tick.
  🎲  Random event: none

  [Tick 47 complete — 8 agents alive — next council in 5 ticks]
  [Cost this tick: $0.058 | Cumulative: $3.42]
```

---

*Latent Acres v0.2 — The world doesn't end until you say so.*
