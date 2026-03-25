---
id: frontend.ui-overhaul
status: active
code_paths:
  - dashboard/src/**
test_paths:
  - dashboard/src/**/*.test.{ts,tsx}
test_commands:
  - cd dashboard && npx vitest run
---

# Summary
Major UI overhaul for the Latent Acres dashboard: thought bubbles on the map, breaking news ticker, structure icons on location cards, epoch recap narrative, agent mood indicators, and general modernization with better typography, animations, glass morphism effects, and polished visual design.

## Use Cases

### Thought Bubbles on Map
- Each agent pip on the island map shows a floating thought bubble with their most recent internal monologue (truncated to ~60 chars).
- Thought bubbles appear as small semi-transparent speech bubbles positioned above the agent pip.
- Bubbles fade after 10 seconds or on the next tick update.
- Only show thoughts from the current tick (not historical).
- Fetch latest thoughts from `/api/events?event_type=internal_monologue&limit=10`.

### Breaking News Ticker
- A horizontal scrolling ticker bar at the top of the dashboard (below the status bar) that surfaces dramatic events.
- Events that trigger ticker items: agent death, banishment, council motion passed/failed, no-confidence vote, structure built, new alliance, agent moved to a location with other agents (first contact).
- Each ticker item has an icon, agent name, and short description.
- Items auto-dismiss after 30 seconds. New items push from the right.
- Styled as a semi-transparent overlay with amber/gold text on dark background.

### Structure Icons on Location Cards
- Location cards on the island map show small icons for each built structure.
- Icons positioned below the hex tile, above the agent pips.
- Structure icon mapping: shelter=house, hut=larger house, storage_chest=box, signal_fire=flame, defensive_wall=shield, rain_collector=droplet, drying_rack=grid, kiln=factory.
- Fetch structures from the locations API response (already includes structures in perception).
- Add structures to the `/api/locations` response if not already present.

### Epoch Recap ("Previously on Latent Acres")
- When a new epoch begins, show a modal overlay with a narrative summary of the previous epoch.
- The recap is generated server-side via an LLM call summarizing: key events, deaths, council results, alliances formed/broken, structures built, resource conflicts.
- New API endpoint: `GET /api/recap/:epoch` returns a narrative string.
- The recap is stored in a new `epoch_recaps` DB table for caching.
- Modal has a cinematic dark overlay with serif typography, "Previously on Latent Acres..." header.
- Auto-shows on epoch change, dismissable.

### Agent Mood Indicators
- Each agent card shows a mood emoji derived from their recent state.
- Mood logic: happy (health > 70, hunger < 30, recent positive social interaction), anxious (hunger > 60 or health < 50), angry (recently betrayed or voted against), exhausted (energy < 20), content (default).
- Mood displayed as a small emoji on the agent card next to their name.

### General UI Modernization
- **Glass morphism**: Semi-transparent panels with backdrop-blur, subtle borders, layered depth.
- **Typography**: Use Inter or system font stack for UI, Georgia/serif for narrative content (journals, recaps, thoughts).
- **Animations**: Smooth transitions on panel open/close, fade-in on new events, pulse effect on tick update.
- **Status bar**: Gradient background, better spacing, subtle glow on running state.
- **Color palette**: Deep navy/slate backgrounds, amber/gold accents for important elements, emerald for positive, red for danger.
- **Bottom panel**: Rounded top corners, subtle shadow, tab indicators with animated underline.
- **Agent cards**: Subtle hover glow, smoother stat bar animations, more breathing room.
- **Scrollbars**: Custom thin styled scrollbars matching the dark theme.

## Invariants
- Thought bubbles only show monologues from the current tick.
- Ticker items auto-dismiss and don't accumulate indefinitely.
- Epoch recap modal is dismissable and doesn't block the simulation.
- Mood is derived from agent state, not from LLM calls.
- All animations should be CSS-based for performance (no JS animation loops).
- UI must remain functional when simulation is paused (show frozen state).

## Failure Modes
- If `/api/recap/:epoch` fails or recap not yet generated, show "Recap not available."
- If no thoughts exist, thought bubbles don't render.
- If no dramatic events, ticker shows nothing (not a blank bar).

## Acceptance Criteria
- Thought bubbles appear on the map next to agent pips showing their latest thought.
- Ticker displays death events with skull icon and agent name.
- Location cards show structure icons for built structures.
- Epoch recap modal appears on epoch transition with narrative text.
- Agent cards show mood emoji next to agent name.
- Dashboard uses glass morphism effects on panels and status bar.
- Smooth fade-in animations on new events in the timeline.
- Custom scrollbars throughout.

## Out of Scope
- Sound effects / audio.
- Timeline scrubber for historical replay.
- Agent portraits / avatars (future work).
- Movement trail animations on the map.
