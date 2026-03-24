---
id: backend.social-layer
status: active
code_paths:
  - src/engine/social.ts
  - src/engine/action-resolver.ts
  - src/agents/tools.ts
  - src/agents/perception.ts
  - src/db/queries.ts
  - src/db/schema.ts
test_paths:
  - tests/social.test.ts
test_commands:
  - npx vitest run tests/social.test.ts
---

# Summary
Social interaction layer enabling agents to communicate, trade, give items, form alliances, and betray alliances. Speech is routed based on location (public) or targeted (whisper). Relationships are tracked both objectively (server-side sentiment scores) and subjectively (agent memory).

## Use Cases

### Speech
- Public speech: an agent speaks at their location, all agents at that location receive the message.
- Whisper: an agent speaks privately to a specific agent at the same location. Only the target receives it.
- Messages are capped at 200 characters.
- Messages are logged to event_log and added to recipient agents' short-term memory.

### Trading
- An agent proposes a trade to another agent at the same location: offering an inventory item in exchange for a resource type.
- The target agent receives the trade proposal as a message in their next tick.
- Trade acceptance/rejection is handled via the target agent's response tools in the following tick.
- If both sides are valid (items exist, agents co-located), the trade executes atomically.

### Giving
- An agent gives an inventory item to another agent at the same location. No reciprocity required.
- The item is removed from the giver's inventory and added to the receiver's.
- Giving positively affects the relationship sentiment between the two agents.

### Alliances
- An agent proposes a named alliance to another agent at the same location.
- The target must accept (via a response in a future tick) for the alliance to form.
- Alliance membership is stored in the alliances table.
- Betrayal: an agent can secretly leave an alliance. Other members are not notified by the system — they must discover it through social interaction or observation.

### Relationship Tracking
- Server-side: objective sentiment scores between all agent pairs, updated by interactions.
- Sentiment deltas: helped (+10), traded (+5), spoke_positively (+3), gave_gift (+8), spoke_negatively (-5), betrayed (-20), voted_against (-10).
- Agents see their own subjective relationship model via memory, which may diverge from reality.

## Invariants
- Speech, trade, and give all require agents to be at the same location.
- Whispers are never visible to non-target agents at the same location.
- Trade execution is atomic: either both sides transfer or neither does.
- Alliance betrayal is silent — the system does not announce it.
- Relationship sentiment is clamped to [-100, 100].

## Failure Modes
- Speaking to an agent not at your location: action fails silently, logged as failed.
- Trading an item you don't have: trade fails, both agents notified.
- Giving an item to an agent not at your location: action fails.
- Forming an alliance with yourself: rejected.

## Acceptance Criteria
- Agent A speaks publicly at The Beach. Agent B (at The Beach) receives the message. Agent C (at Dense Jungle) does not.
- Agent A whispers to Agent B. Agent B receives it. Agent D (also at The Beach) does not.
- Agent A gives food to Agent B. A's inventory decreases, B's increases. Relationship sentiment A->B increases.
- Agent A proposes alliance "Survivors" with Agent B. After B accepts, both are members.
- Agent A betrays the alliance. The alliance record shows A is no longer a member, but B receives no system notification.
- Relationship tracker: after A gives B a gift, sentiment(A,B) increases by +8.
- All social actions are logged in the event_log.

## Out of Scope
- Group chat or broadcast across locations.
- Enforced alliance obligations (alliances are purely social constructs).
- Reputation decay over time.
