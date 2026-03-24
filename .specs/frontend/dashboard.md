---
id: frontend.dashboard
status: active
code_paths:
  - dashboard/src/**
  - dashboard/index.html
  - dashboard/package.json
  - dashboard/vite.config.ts
test_paths:
  - dashboard/src/**/*.test.{ts,tsx}
test_commands:
  - cd dashboard && npx vitest run
---

# Summary
React dashboard for observing the Latent Acres simulation in real-time. Connects to the REST API and WebSocket to display the island map, agent states, relationships, events, council transcripts, and costs. Built with React, Vite, and Tailwind CSS.

## Use Cases

### Island Map View
- Render the island as a node-link graph using the `/api/map` data.
- Each location is a node labeled with its name, showing resource levels (color-coded) and agent avatars.
- Edges represent connections between locations.
- Agents at each location shown as small icons/badges with health indicator.
- Click a location to see details (resources, shelter, agents present).
- Map updates live via WebSocket.

### Agent Cards Panel
- Sidebar or panel showing all agents as cards.
- Each card: name, health bar, hunger bar, energy bar, location, inventory count, chieftain badge if applicable.
- Dead/banished agents shown greyed out with cause.
- Click an agent card to expand: full inventory, personality traits, long-term memory summary, recent actions.
- Highlight the agent's location on the map when selected.

### Relationship Graph
- Force-directed graph of agent relationships.
- Nodes are agents, edges weighted by sentiment score.
- Positive sentiment = green edge, negative = red edge, neutral = grey.
- Edge thickness proportional to |sentiment|.
- Hover to see exact sentiment value.
- Updates after each tick.

### Event Timeline
- Scrollable timeline of events from `/api/events`.
- Filter by: event type, agent, epoch, tick range.
- Each event shows: tick, epoch, type icon, description, involved agents.
- Auto-scrolls to latest event when live, with a "pin to bottom" toggle.
- Color-coded by event type (action, death, council, world event).

### Agent Thought Viewer
- Dedicated view for internal monologue entries.
- Select an agent to see their private thoughts chronologically.
- Each thought shows the tick number and content.
- This is read-only narration — the "novel" view of the simulation.

### Council Transcript Viewer
- Select an epoch to view the full council session.
- Shows: motions proposed, who proposed/seconded, debate statements, vote tallies.
- "Reveal Votes" toggle that calls the spoiler endpoint to show individual votes.
- Visual pass/fail indicator for each motion.
- Highlights banishments and chieftain changes.

### Cost Dashboard
- Cumulative cost display.
- Per-tick cost chart (line graph over time).
- Token usage breakdown (input vs output).
- Projected cost based on average tick cost.

### Layout
- Top bar: simulation status (tick, epoch, phase, running/paused), cost counter.
- Left sidebar: agent cards panel.
- Center: island map (default view), switchable to relationship graph.
- Right panel: event timeline (collapsible).
- Bottom drawer or tab: council transcripts, agent thoughts.
- Responsive but optimized for desktop (1920x1080+).

## Invariants
- Dashboard is read-only — it never mutates simulation state.
- Live updates only when WebSocket is connected; falls back to polling `/api/status` every 5s.
- All data comes from the API — the dashboard does not read the database directly.
- Agent thought viewer only shows `internal_monologue` events.
- Vote reveal is opt-in — secret by default.

## Failure Modes
- If API is unreachable, show a connection error banner with retry.
- If WebSocket disconnects, show "disconnected" indicator and attempt reconnection with backoff.
- If an agent has no thoughts, show "No thoughts recorded yet."
- If no council has occurred, show "No council sessions yet."

## Acceptance Criteria
- Dashboard loads and displays the island map with agent positions from a running simulation.
- Agent cards show live health/hunger/energy bars that update each tick.
- Clicking an agent card highlights their location on the map and shows expanded details.
- Event timeline scrolls and filters correctly.
- Council transcript for epoch 0 shows motions, debate, and vote tallies.
- "Reveal Votes" toggle shows individual vote breakdown.
- Relationship graph renders with colored/weighted edges.
- Cost display shows cumulative spend.
- WebSocket connection indicator shows connected/disconnected state.
- Dashboard works when simulation is paused (shows frozen state).

## Out of Scope
- Mobile-responsive layout (desktop-first).
- Dashboard-initiated simulation control (start/pause/resume — use CLI).
- User accounts or multi-user access.
- Animated transitions between tick states.
