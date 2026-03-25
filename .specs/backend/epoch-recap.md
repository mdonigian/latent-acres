---
id: backend.epoch-recap
status: active
code_paths:
  - src/api/routes.ts
  - src/engine/tick-loop.ts
  - src/db/schema.ts
  - src/db/queries.ts
test_paths:
  - tests/api.test.ts
test_commands:
  - npx vitest run tests/api.test.ts
---

# Summary
At each epoch boundary, generate a narrative recap of the epoch's events using an LLM call. Store in an `epoch_recaps` table for caching. Expose via `GET /api/recap/:epoch`. Also add `structures` to the `/api/locations` response.

## Use Cases
- At each epoch boundary (after council, after journal entries), generate a recap by calling the LLM with a summary of all events from that epoch.
- The recap prompt includes: key actions, deaths, council motions and results, structures built, alliances, notable conversations, resource conflicts.
- Store the recap text in `epoch_recaps` (epoch, recap_text, created_at).
- `GET /api/recap/:epoch` returns `{ epoch, recap }` or 404 if not yet generated.
- `GET /api/locations` includes `structures` array for each location from `location_structures` table.
- In dry-run mode, generate a simple heuristic recap from event data (no LLM call).

## Invariants
- Only one recap per epoch (idempotent).
- Recap generation should not block the tick loop significantly (use Haiku for speed).
- Locations API always includes structures even if empty array.

## Acceptance Criteria
- After epoch 0 completes, an entry exists in `epoch_recaps` with a narrative text.
- `GET /api/recap/0` returns the recap text.
- `GET /api/locations` includes a `structures` array per location.

## Out of Scope
- Recap editing or regeneration.
- Recap display formatting (handled by frontend spec).
