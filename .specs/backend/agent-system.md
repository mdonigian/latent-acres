---
id: backend.agent-system
status: active
code_paths:
  - src/agents/personality.ts
  - src/agents/tools.ts
  - src/agents/perception.ts
  - src/agents/memory.ts
  - src/agents/prompt-builder.ts
  - src/agents/orchestrator.ts
  - src/agents/model-adapter.ts
test_paths:
  - tests/agents.test.ts
test_commands:
  - npx vitest run tests/agents.test.ts
---

# Summary
The agent subsystem: loading agent personalities from JSON, defining the sandbox tool API, building per-tick perception and memory payloads, assembling prompts, and orchestrating Claude API calls with rate limiting. Agents are stateless between ticks — all context comes from the prompt.

## Use Cases

### Personality Loading
- Load agent definitions from JSON files in `agents/` directory.
- Validate against the PersonalityProfile schema (traits, backstory, communicationStyle, values, optional hiddenAgenda).
- Support optional `startingLocation` and `model` fields.
- Auto-generate agents via Claude API call with a meta-prompt (generate-agents command).

### Tool Definitions
- Define all Phase 1 survival tools as Claude tool schemas: gather, craft, eat, rest, move, explore, internal_monologue, check_relationships.
- Each tool has typed parameters with descriptions and constraints.
- Tools must match the spec exactly (names, parameter shapes, descriptions).

### Perception System
- Build a perception payload for an agent given current world state.
- Show qualitative resource estimates ("scarce"/"moderate"/"abundant") based on quantity thresholds, not exact numbers.
- Show other agents at the same location with visible state cues ("looks well-fed", "looks exhausted") based on their health/hunger/energy.
- Include agent's own stats (health, hunger, energy, inventory) as exact numbers.
- Include recent messages directed at this agent or spoken publicly at their location.
- Include public knowledge: eliminated agents list, current epoch, ticks until council.

### Memory System
- Short-term memory: append structured MemoryEntry objects, maintain rolling buffer of last K=50 entries per agent.
- Long-term memory: every M=6 ticks, call Claude to summarize short-term buffer into a compressed first-person summary (max 800 words), merge with existing long-term memory.
- Memory entries include: tick, epoch, type, content, involvedAgents, importance.

### Prompt Builder
- Assemble the full prompt: system prompt (personality-specific) + perception + memory + tick context.
- System prompt follows the template from the spec (personality injection, rules, strategy guidance).
- Include tick context: currentTick, currentEpoch, ticksUntilTribalCouncil, actionsRemaining.

### Orchestrator
- For each living agent in a tick, call Claude with the assembled prompt and tools.
- Parse tool call responses into structured action objects.
- Batch API calls (BATCH_SIZE=4) with inter-batch delays for rate limiting.
- Validate actions: check energy costs, location constraints, inventory requirements.
- If an agent returns text without tool calls, ignore it (log for debugging).
- Support dry-run mode with heuristic agents (no API calls) for testing.

## Invariants
- Agents never see exact resource quantities — only qualitative estimates.
- Agents never see other agents' exact stats — only visible cues.
- Agents cannot use tools they don't have access to in the current phase.
- The system prompt must always include the agent's personality, rules, and strategy guidance.
- Short-term memory buffer never exceeds K entries per agent.
- Orchestrator must respect rate limits and never fire more than BATCH_SIZE concurrent API calls.

## Failure Modes
- If an agent JSON file has invalid schema, throw with a descriptive error naming the file and missing fields.
- If Claude API returns an error, log it and skip that agent's turn for the tick (don't crash the simulation).
- If an agent tries to use more actions than allowed per tick, excess actions are silently dropped.
- If memory compression API call fails, keep existing long-term memory unchanged.

## Acceptance Criteria
- Loading `agents/vex.json` returns a validated PersonalityProfile with all required fields.
- Tool definitions array contains all Phase 1 tools with correct parameter schemas.
- Perception for an agent at The Beach with 2 other agents present includes those agents' visible states and qualitative resource levels.
- Short-term memory: after 60 appends, only the most recent 50 are retained.
- Prompt builder output contains the system prompt, perception JSON, memory entries, and tick context.
- Orchestrator in dry-run mode processes all agents and returns valid actions without API calls.
- An agent with 5 energy cannot perform a gather action (costs 15 energy) — validation rejects it.

## Out of Scope
- Social tools (speak, trade, give, form_alliance, betray_alliance) — Phase 2.
- Council tools (council_speak, council_vote) — Phase 2.
- Multi-model support beyond the model-adapter stub.
