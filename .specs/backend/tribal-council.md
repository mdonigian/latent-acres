---
id: backend.tribal-council
status: active
code_paths:
  - src/engine/tribal-council.ts
  - src/agents/tools.ts
  - src/agents/perception.ts
  - src/agents/prompt-builder.ts
  - src/db/queries.ts
  - src/db/schema.ts
test_paths:
  - tests/tribal-council.test.ts
test_commands:
  - npx vitest run tests/tribal-council.test.ts
---

# Summary
The Tribal Council is a general-purpose governing body that convenes at the end of each epoch (every 12 ticks). It follows Robert's Rules of Order: agents propose motions, motions require a second, debate occurs, and votes are cast secretly. One agent is the Chieftain who presides over the council, manages the agenda, and breaks tie votes. The Chieftain can be deposed via a motion of no confidence.

## Use Cases

### Chieftain Role
- At world initialization, one agent is designated Chieftain (via `isChieftain: true` in agent JSON or randomly selected if none specified).
- The Chieftain's `is_chieftain` flag is set in the agents table.
- During council, the Chieftain calls the session to order (system-generated event).
- The Chieftain breaks tie votes (ayes == nays on a motion).
- The Chieftain has no survival advantages — the role is purely political.

### Council Flow
1. **Call to Order**: Simulation transitions to `council_motions` phase. All living agents are gathered. The Chieftain is announced.
2. **Motion Phase**: Any agent may use `council_propose_motion` to propose a motion with a type and text. The motion is recorded in `council_motions` with status `proposed`.
3. **Seconding**: Another agent may `council_second_motion`. The motion moves to `seconded` status. Unseconded motions after the motion phase ends are marked `died`.
4. **Debate Phase**: For each seconded motion, 2-3 rounds of `council_speak` occur. Agents may also whisper privately. The simulation phase is `council_debate`.
5. **Vote Phase**: Each agent votes `aye`, `nay`, or `abstain` on the current motion via `council_vote`. Votes are recorded in `council_votes` table with the voter's identity (secret from other agents). Phase is `council_vote`.
6. **Tally**: Majority of non-abstaining votes wins. If tied, the Chieftain's vote is the tiebreaker (if Chieftain abstained, the motion fails). Only totals (ayes, nays, abstentions) are announced — not who voted how.
7. **Resolution**: Passed motions are marked `passed`, failed motions `failed`. Effects depend on motion type.

### Motion Types
- **general**: A free-form proposal. If passed, recorded as a resolution. Enforcement is social (agents choose to honor or ignore).
- **banishment**: Targets a specific agent. If passed, the target is banished — `is_banished` set to true, inventory scatters at their location, they are removed from the simulation. Permanent.
- **resource_allocation**: A proposal about how resources should be shared. Recorded as resolution. Social enforcement only.
- **exploration_mandate**: A proposal directing agents to explore or avoid certain locations. Social enforcement only.
- **no_confidence**: Targets the current Chieftain. If passed, the Chieftain's `is_chieftain` is set to false. An immediate `election` motion is automatically raised.
- **election**: Each agent may nominate themselves or another. A vote is held among nominees. Plurality wins (most votes, not necessarily majority). Ties broken by seeded RNG. Winner becomes the new Chieftain.
- **custom**: Any other motion text. Recorded as resolution if passed.

### Perception During Council
- Agents see: all living agents present, current Chieftain, pending motions, debate history for current session, their own memory.
- Agents see motion text and type but not who proposed or seconded (unless they witnessed it — all agents are present so they do see proposer/seconder).
- Vote results show only totals, never individual votes.

## Invariants
- Exactly one living agent is the Chieftain at any time (unless all agents are dead).
- A motion of no confidence must target the current Chieftain specifically.
- A motion requires a second from a *different* agent than the proposer.
- An agent cannot second their own motion.
- Votes are secret — the system never reveals individual votes to other agents.
- Banishment is permanent and immediate upon a passed banishment motion.
- The council phase must complete before normal ticks resume.
- Election motions use plurality voting (most votes wins), not majority.
- If there are no seconded motions, the council adjourns with no votes taken.

## Failure Modes
- If the Chieftain dies between epochs, the agent with the highest reputation becomes acting Chieftain, or a random living agent if tied.
- If a banishment motion targets a dead agent, the motion is ruled out of order (auto-failed).
- If only 1 agent is alive, council still convenes but no motions can be seconded — it auto-adjourns.
- If an agent votes on a motion they already voted on, the new vote replaces the old one.

## Acceptance Criteria
- Council triggers at tick 12 (end of epoch 0 with ticksPerEpoch=12).
- Agent A proposes a "general" motion. Agent B seconds it. After debate, agents vote. Motion passes with majority ayes — recorded as `passed` in council_motions.
- An unseconded motion has status `died` after the motion phase.
- Agent A proposes `no_confidence` against the Chieftain. It passes. The Chieftain's `is_chieftain` becomes false. An election motion is auto-raised. Agent C wins the election and becomes the new Chieftain.
- Agent A proposes `banishment` of Agent D. It passes. Agent D's `is_banished` is true, inventory is scattered, they no longer participate.
- Vote secrecy: the council_votes table records who voted how, but the perception payload only shows totals.
- Tie vote: Chieftain breaks the tie. If Chieftain abstained, motion fails.
- Council with no seconded motions: adjourns immediately, no votes taken.
- All council events are logged in event_log.

## Out of Scope
- Parliamentary procedure beyond motions/seconds/debate/vote (no amendments, no tabling, no filibuster).
- Multi-session councils (council completes in one epoch boundary).
- Proxy voting or absentee voting.
