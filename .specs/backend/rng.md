---
id: backend.rng
status: active
code_paths:
  - src/rng.ts
test_paths:
  - tests/rng.test.ts
test_commands:
  - npx vitest run tests/rng.test.ts
---

# Summary
Seeded pseudo-random number generator (PRNG) module providing deterministic randomness for the entire simulation. All random events (weather, resource discovery, illness, gather conflicts) use this module so that replaying from the same state produces identical outcomes.

## Use Cases
- Initialize a PRNG from a numeric seed stored in the simulation DB.
- Generate random floats in [0, 1) for probability checks (e.g., event triggers).
- Generate random integers within a range (e.g., picking a random location).
- Pick a random element from an array (e.g., selecting a random agent for illness).
- Shuffle an array deterministically (e.g., tie-breaking order).
- Serialize and restore RNG state so the simulation can resume deterministically after restart.
- Fork the RNG (create a child PRNG from the current state) for isolated sub-sequences.

## Invariants
- Two PRNG instances initialized with the same seed must produce identical sequences of outputs.
- Calling `getState()` and later restoring via `fromState()` must resume the exact same sequence.
- The PRNG must never use `Math.random()` or any non-deterministic source.
- State serialization must be a plain string (storable in SQLite TEXT column).

## Failure Modes
- If an invalid seed (NaN, undefined) is provided, throw a descriptive error.
- If state restoration receives a corrupted/invalid state string, throw rather than silently producing bad output.

## Acceptance Criteria
- Given seed 42, the first 10 calls to `random()` produce the same 10 floats every time.
- `randomInt(0, 5)` always returns values in [0, 5] inclusive.
- `pick([a, b, c])` always returns one of the elements.
- `shuffle([1,2,3,4])` produces a deterministic permutation for a given seed.
- State round-trip: `fromState(rng.getState())` continues the sequence identically.
- Two RNGs with different seeds produce different sequences.

## Out of Scope
- Cryptographic randomness.
- Distribution shaping (normal, exponential, etc.).
