---
id: backend.cost-tracking
status: draft
code_paths:
  - src/utils/cost-tracker.ts
  - src/utils/rate-limiter.ts
  - src/utils/logger.ts
test_commands:
  - vitest run
---

## Summary

The cost-tracking subsystem estimates, accumulates, and guards the monetary cost of LLM API calls made during simulation ticks. It converts per-model token counts to USD, enforces a per-tick budget cap, and raises warnings when cumulative spend crosses a configurable threshold. Supporting utilities provide batched rate-limiting for concurrent API calls and structured logging with category-based formatting.

## Use Cases

1. **Per-tick cost estimation** — After each agent orchestration round the engine passes input/output token counts and the model identifier to `estimateCost()`, which returns a USD value using model-specific pricing tables.
2. **Cumulative cost tracking** — `trackCost()` persists the running total in the `simulation` table and returns the new total alongside a `withinBudget` flag.
3. **Budget enforcement** — The engine checks `withinBudget` (tick cost <= `MAX_COST_PER_TICK`) to decide whether to continue processing agents in the current tick.
4. **Spend warnings** — When cumulative cost reaches `COST_WARNING_THRESHOLD`, a warning is emitted via the logger.
5. **Batch rate-limiting** — `rateLimitedBatch()` processes agent API calls in batches of `BATCH_SIZE` (default 4) with an inter-batch delay of `INTER_BATCH_DELAY_MS` (default 500 ms) to stay within API rate limits.
6. **Structured logging** — `log()` emits timestamped, category-prefixed messages (info, warn, error, tick, action, death, event, cost, council). `logTickSummary()` formats a complete tick result including actions, deaths, world events, and token usage.

## Invariants

1. `estimateCost()` must use the pricing entry for the requested model; if the model is unknown it must fall back to the `claude-sonnet-4-20250514` pricing.
2. Model pricing constants: `claude-sonnet-4-20250514` at $3.00/M input, $15.00/M output; `claude-haiku-4-5-20251001` at $0.80/M input, $4.00/M output.
3. `MAX_COST_PER_TICK` is $0.50. `COST_WARNING_THRESHOLD` is $50.00.
4. `trackCost()` must atomically read the current `total_cost`, add the new tick cost, and persist the updated total before returning.
5. `trackCost()` returns `withinBudget: true` only when the single-tick cost is <= `MAX_COST_PER_TICK`.
6. The warning log must fire on every call where cumulative cost >= `COST_WARNING_THRESHOLD`, not just the first crossing.
7. `rateLimitedBatch()` must process items in sequential batches of `batchSize`, running items within each batch concurrently via `Promise.all`. The inter-batch delay must not be applied after the final batch.
8. `log()` must route `error` category to `console.error`, `warn` to `console.warn`, and all others to `console.log`.
9. All log lines must be prefixed with ISO-8601 timestamp and uppercased category tag.

## Acceptance Criteria

- [ ] `estimateCost(1_000_000, 0, 'claude-haiku-4-5-20251001')` returns 0.80.
- [ ] `estimateCost(0, 1_000_000, 'claude-sonnet-4-20250514')` returns 15.00.
- [ ] Unknown model falls back to Sonnet pricing.
- [ ] `trackCost()` increments `simulation.total_cost` in the database by exactly the estimated amount.
- [ ] `trackCost()` returns `withinBudget: false` when a single tick costs > $0.50.
- [ ] Warning is logged when cumulative cost >= $50.00.
- [ ] `rateLimitedBatch([1,2,3,4,5], fn, 2)` calls `fn` for items 1-2 concurrently, waits, then 3-4, waits, then 5 (no trailing delay).
- [ ] `log('error', msg)` writes to stderr; `log('info', msg)` writes to stdout.
- [ ] `logTickSummary()` includes action outcomes, deaths, world events, and cost line.

## Out of Scope

- Per-agent or per-model cost breakdown reporting (handled by API routes).
- Dynamic adjustment of `MAX_COST_PER_TICK` or `COST_WARNING_THRESHOLD` at runtime.
- Rate-limit retry logic or backoff strategies for 429 responses.
- Dashboard cost visualization (covered by `frontend.dashboard`).

## Open Questions

1. Should the simulation halt (not just warn) when cumulative cost exceeds a hard ceiling?
2. Should pricing be configurable or loaded from environment rather than hard-coded?

## Uncertainty

- **Low**: The pricing constants, thresholds, and batch parameters are explicit in source. Behavior is straightforward with no ambiguous branches.
- **Medium**: The relationship between `withinBudget: false` and actual engine behavior — the cost tracker returns the flag but does not itself halt processing; it is unclear whether the engine currently acts on a `false` value.
