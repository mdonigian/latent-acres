# Latent Acres

A persistent, autonomous AI agent world. Agents live on an isolated island, survive against environmental pressure, form social bonds and rivalries, and govern themselves through tribal councils using Robert's Rules of Order. The simulation runs without human intervention — you just watch.

## Quick Start

```bash
# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Configure
echo "OPENAI_API_KEY=sk-..." > .env

# Initialize a world with 6 agents
npx tsx src/index.ts init --seed 42

# Start the server (simulation starts paused)
npx tsx src/index.ts run --dashboard --port 3000 --tick-delay 60000

# In another terminal, start the dashboard
cd dashboard && npm run dev
```

Open http://localhost:5173 and click **Start** to begin the simulation.

## What Happens

Every tick (configurable, default 60s with real agents):
- Agents observe their surroundings (resources, other agents, messages)
- Each agent makes decisions via LLM calls (gather, eat, rest, move, speak, trade, etc.)
- Actions are resolved simultaneously
- Hunger increases, resources regenerate, random events occur

Every epoch (12 ticks):
- A **Tribal Council** convenes — agents propose motions, debate, and vote
- One agent is the **Chieftain** who breaks ties and can be overthrown
- Agents write private **journal entries** reflecting on their experiences

Agents can die from starvation, be banished by council vote, or survive indefinitely. The world persists across restarts.

## Commands

```bash
npx tsx src/index.ts init --seed <n> [--force]    # Create a new world
npx tsx src/index.ts run --dashboard --port 3000   # Start server + dashboard
npx tsx src/index.ts run --dry-run --ticks 50      # Test with heuristic agents (no API)
npx tsx src/index.ts status                        # Show current world state
npx tsx src/index.ts inspect --agent Vex           # Inspect an agent
```

## Dashboard

- **Island Map** — Hex tile map with Kenney game art, clickable locations
- **Agent Cards** — Health/hunger/energy bars, click for full modal (personality, inventory, journal, relationships)
- **Conversations** — All agent speech in chronological order
- **Event Timeline** — Filterable log of everything that happens
- **Council Viewer** — Browse motions by epoch, reveal secret votes
- **Relationship Graph** — Force-directed graph of agent sentiment
- **Start/Pause** — Control the simulation from the UI
- **Speed Control** — Adjust tick delay (1s to 120s)

## Agents

Agents are defined as JSON files in `agents/`. Each has a personality, backstory, communication style, values, and hidden agenda. The `model` field determines which LLM powers them.

```json
{
  "name": "Vex",
  "model": "gpt-5.4-nano",
  "personality": {
    "traits": ["cunning", "charismatic", "ruthless"],
    "backstory": "A former poker player who reads people better than situations.",
    "communicationStyle": "Warm and disarming on the surface, always probing.",
    "values": ["information", "leverage", "self-preservation"],
    "hiddenAgenda": "Wants to be the last person anyone suspects."
  }
}
```

## Testing

```bash
npm test              # Backend (103 tests)
cd dashboard && npm test  # Frontend (15 tests)
```

## Art Credits

Hex tile art by [Kenney](https://www.kenney.nl) — CC0 Public Domain.

---

*The world doesn't end until you say so.*
