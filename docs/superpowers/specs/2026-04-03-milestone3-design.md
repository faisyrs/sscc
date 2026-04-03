# SSCC Engine Milestone 3 -- Design Spec

**Date:** 2026-04-03
**Scope:** Roll effect verb, seeded RNG, attack pipeline validation
**Branch:** milestone2

---

## 1. What Milestone 3 Includes

1. **Seeded RNG subsystem** -- deterministic, reproducible Mulberry32 PRNG
2. **`roll` effect verb** -- generates dice arrays, writes to state path
3. **`setSeed` effect verb** -- reseeds the RNG (for debugging/testing)
4. **Attack pipeline integration test** -- reproduce worked example from spec Section 13

## What Milestone 3 Does NOT Include

- `whyNot` API (Milestone 4)
- Snapshot/restore (Milestone 4)
- Full 40K attack pipeline pack (this validates the engine mechanics only)

---

## 2. Seeded RNG

### Algorithm: Mulberry32

A fast 32-bit PRNG with good statistical distribution. Pure TypeScript,
zero dependencies, ~10 lines of code.

```typescript
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### SeededRNG class

```typescript
class SeededRNG {
  private rng: () => number;
  private currentSeed: number;

  constructor(seed: number);
  nextInt(min: number, max: number): number;  // inclusive range
  reseed(seed: number): void;
  getSeed(): number;
}
```

### Seed lifecycle

1. Engine constructor accepts optional `{ seed?: number }`
2. If omitted, seed is generated from `Date.now()`
3. Seed is logged at initialization
4. Packs can reseed via `setSeed` effect (guarded by conditions)
5. Every reseed is logged

---

## 3. Roll Effect Verb

### Schema

```json
{ "roll": {
    "count": 4,
    "sides": 6,
    "storePath": "$.currentAttack.hitRolls"
}}
```

- `count` -- literal number or `{ "path": "$.some.path" }` resolved from state
- `sides` -- literal number, default 6
- `storePath` -- state path where the result array is written

### Behavior

1. Resolve `count` (literal or from state path)
2. Generate `count` random integers in range `[1, sides]` using the engine's RNG
3. Write the array to `storePath` via `set(state, storePath, results)`
4. Log one entry: `"roll: {count}d{sides} -> [results] at {storePath}"`

### Conflict domain

`(storePath)` -- same as `setValue`. Stackability: singleton.

---

## 4. SetSeed Effect Verb

### Schema

```json
{ "setSeed": { "seed": 42 } }
```

### Behavior

1. Call `rng.reseed(seed)`
2. Log: `"RNG reseeded to {seed}"`

### Conflict domain

`"setSeed"` -- singleton. Only one reseed per event evaluation.

---

## 5. Engine Integration

The `SSCCEngine` constructor changes:

```typescript
constructor(pack: LoadedPack, options?: { seed?: number })
```

The RNG instance is stored on the engine. The effect executor receives
the RNG as a parameter so `roll` and `setSeed` can use it.

### Effect executor signature change

```typescript
function executeEffect(
  state: State,
  effect: Effect,
  event: GameEvent,
  sourceRuleId: string,
  glossary: Glossary,
  rng?: SeededRNG,
): EffectResult
```

The `rng` parameter is optional to avoid breaking existing callers
(unit tests that don't need RNG). The `roll` and `setSeed` effects
throw if `rng` is not provided.

---

## 6. Worked Example Validation

Spec Section 13 walks through a complete hit resolution with:
- 4 attacks, WS 3+, abilities Lethal Hits + Sustained 1
- Seed 668 produces `[2, 6, 4, 1]`
- Die 2: miss (2 < 3)
- Die 6: crit hit (6 >= 6) -- triggers Lethal Hits (+1 auto-wound) and Sustained 1 (+1 hit)
- Die 4: hit (4 >= 3)
- Die 1: miss (1 < 3)
- Final: 2 hits to wound rolls, 1 auto-wound bypasses

The integration test loads a pack with the `resolveHitRolls` sub-sequence
and the rules from Section 13, uses seed 668, and verifies the exact
state values after each step.

---

## 7. Files Changed

| File | Change |
|---|---|
| `engine/src/rng/index.ts` | New: SeededRNG class with Mulberry32 |
| `engine/src/types/rules.ts` | Add `roll` and `setSeed` to Effect union |
| `engine/src/rules/effects.ts` | Implement `roll` and `setSeed` executors |
| `engine/src/rules/conflicts.ts` | Add conflict domains for `roll` and `setSeed` |
| `engine/src/engine/index.ts` | Accept seed config, create RNG, pass to effects |
| `engine/src/index.ts` | Export SeededRNG |
| `engine/tests/unit/rng.test.ts` | Determinism, range, reseed tests |
| `engine/tests/unit/effects-roll.test.ts` | Roll effect with fixed seed |
| `engine/tests/integration/attack-pipeline.test.ts` | Worked example from Section 13 |
| `packs/attack-test/` | Minimal pack with hit resolution sub-sequence |
