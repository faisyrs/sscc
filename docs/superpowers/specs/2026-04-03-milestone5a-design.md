# SSCC Engine Milestone 5a -- Design Spec

**Date:** 2026-04-03
**Scope:** CLI playtesting tool with 40k-themed display

---

## 1. What Milestone 5a Includes

1. **CLI package** -- new `cli/` package alongside `engine/`
2. **40k-themed terminal display** -- units, phase, dice pools, choices
3. **Game loop** -- auto-advance with step mode, choice selection, dice picking
4. **Debug commands** -- undo, log, rules, state, step, help, quit
5. **cli-demo pack** -- minimal pack exercising all UI sections

## What Milestone 5a Does NOT Include

- Real 40k rules (Milestone 5b)
- Army list / config file customization
- Networking, multiplayer, or GUI
- Colour/formatting beyond basic ASCII

---

## 2. Package Structure

```text
cli/
  src/
    index.ts          Entry point: parse args, load pack, start loop
    game-loop.ts      Main loop: advance, pause, prompt, apply
    renderer.ts       40k-themed display formatting
    commands.ts       Debug command parser and executor
  package.json
  tsconfig.json
```

The CLI depends on the `engine` package. It imports `SSCCEngine`,
`loadPack`, `get`, `readDiePool`, etc.

### package.json

```json
{
  "name": "@sscc/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "sscc-cli": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@sscc/engine": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

During development, run with `tsx` directly:

```bash
cd cli && npx tsx src/index.ts ../packs/cli-demo
```

---

## 3. Startup and Arguments

```bash
npx tsx cli/src/index.ts <pack-path> [options]
```

Options:

| Flag | Default | Description |
|---|---|---|
| `--seed <N>` | `Date.now()` | Fixed RNG seed |
| `--step` | off | Start in step mode |

The entry point:

1. Parse args (pack path required, options optional)
2. Call `loadPack(packPath)` -- exit with error message if validation fails
3. Create `SSCCEngine(pack, { seed })` and `initialize()`
4. Print seed value (always, for reproducibility)
5. Enter game loop

---

## 4. Display Layout

The renderer prints sections top-to-bottom. It reads engine state
and formats for the terminal.

### Full display (at choice points)

```text
=== Battle Round 1 | Shooting Phase | attacker ===

-- Units (attacker) --
  tactical_squad [INFANTRY] Statuses: -
  hellblaster_squad [INFANTRY] Statuses: -

-- Units (defender) --
  intercessor_squad [INFANTRY] Statuses: overwatchReady

-- Dice Pool: $.currentAttack.hitRolls --
  [0] 2   [1] 6   [2] 4   [3] 1
  (4 dice, 0 spent)

-- Choices --
  0. Pass
  1. Warp Blades (double 5+ or triple)  [pick 2 dice]
  2. Wrathful Devotion (any double)     [pick 2 dice]

> _
```

### Condensed display (auto-advance, non-choice events)

```text
  > SetupAttack
  > RollToHit -- roll: 4d6 -> [2, 6, 4, 1] at $.currentAttack.hitRolls
  > EvaluateHitDie (x4 events)
```

In step mode, each event gets a single line and waits for Enter.

### Display data sources

| Section | Source |
|---|---|
| Header (round, phase, player) | Last event ID + params. Map event names to display names. |
| Units | Walk `$.units.*`. Show id, keywords (from unit object), active statuses. Group by owner. |
| Dice Pool | Scan state for objects with `.count` + `.d0` structure. Show value, spent marker. |
| Choices | `engine.enumerateChoices()`. Show label, pick count if applicable. Always prepend `0. Pass`. |

### Renderer implementation

The renderer is a pure function:

```typescript
function renderFullDisplay(
  engine: SSCCEngine,
  lastEvent: GameEvent,
): string
```

It returns a string. The game loop prints it. This keeps rendering
testable without terminal I/O.

---

## 5. Game Loop

The game loop is the core control flow.

### State machine

```text
ADVANCING ---(choice offered)---> WAITING_FOR_CHOICE
WAITING_FOR_CHOICE ---(choice applied)---> ADVANCING
WAITING_FOR_CHOICE ---(pass/0)---> ADVANCING
WAITING_FOR_CHOICE ---(dice needed)---> WAITING_FOR_DICE
WAITING_FOR_DICE ---(dice selected)---> ADVANCING
ADVANCING ---(timeline done)---> GAME_OVER
```

### Auto-advance mode

1. Call `advanceToNextEvent()` in a loop
2. For each event, print a condensed line
3. When the engine pauses (choices offered), render full display and prompt
4. After choice is applied (or passed), resume advancing

### Step mode

1. Call `advanceToNextEvent()` once
2. Print event line
3. Wait for Enter (or a command)
4. If paused, render full display and prompt for choice

### Passing on choices

When the user types `0` or `f`, all currently offered choices need
to be dismissed so the engine can advance. Use the existing
`cancelOfferedChoices` function from the choices module to cancel
all offered choices in state, then continue advancing.

If `cancelOfferedChoices` is not accessible from the engine's public
API, add a `passAllChoices()` method to SSCCEngine that cancels all
offered choices and returns the updated state.

### Choice with dice

When a choice has `pick`, the flow is:

1. User types choice number (e.g., `1`)
2. CLI prompts: `Select {pick} dice: `
3. User types space-separated indices (e.g., `5 6`)
4. CLI calls `engine.applyChoice(instanceId, { selectedDice: [5, 6] })`

If validation fails (wrong count, invalid index, filter mismatch),
print the error and re-prompt.

---

## 6. Input Handling and Commands

At the `> ` prompt:

| Input | Context | Action |
|---|---|---|
| `0` or `f` | Choices offered | Pass on all choices, advance |
| `1`-`N` | Choices offered | Select that choice |
| `5 6` | Dice prompt | Select dice by index |
| Enter | Step mode, no choices | Advance one event |
| `undo` | Any | Undo last choice (with confirm for RNG) |
| `log` | Any | Show last 20 log entries |
| `log 50` | Any | Show last N entries |
| `rules` | Any | Show rules that fired on last event |
| `state $.path` | Any | Print value at state path |
| `step` | Any | Toggle step mode |
| `help` | Any | List commands |
| `quit` | Any | Exit |

### Command parsing

Simple string matching. Split input on whitespace. First token is
the command or a number. Unrecognized input prints a short error.

### Undo flow

1. `undo` calls `canUndoChoice` on the most recent choice
2. If `requiresConfirm`, print warning and ask `Confirm? (y/n)`
3. If confirmed (or not needed), call `undoChoice`
4. Re-render the display

---

## 7. Engine Changes

### passAllChoices method

Add to `SSCCEngine`:

```typescript
passAllChoices(): State {
  this.state = cancelOfferedChoices(this.state);
  this.logger.log("note", "All offered choices passed");
  return this.state;
}
```

`cancelOfferedChoices` is already imported in engine/index.ts but
not exposed. This method wraps it for the CLI.

---

## 8. cli-demo Pack

A minimal pack that exercises all CLI display sections.

### State

- 2 players: `attacker`, `defender`
- 2 units per player with keywords and statuses
- Resources (CP) for both players

### Timeline

```yaml
timeline:
  - event: StartOfGame

  - event: BattleRoundStart
    params: [player]

  - event: CommandPhaseStart
    params: [player]

  - event: ShootingPhaseStart
    params: [player]

  - event: RollToHit
    params: [player]

  - event: BlessingsOfKhorne
    params: [player]

  - event: EndOfGame

subSequences: {}
```

### Rules

- `setup_attack`: On `RollToHit`, roll 4d6 to `$.currentAttack.hitRolls`
- `roll_blessings`: On `BlessingsOfKhorne`, roll 8d6 to `$.blessingsRoll`
  with spent tracking, then emit `BlessingsChoices`
- `offer_stratagem`: On `CommandPhaseStart`, offer a test stratagem (1 CP)
- `offer_warp_blades`: On `BlessingsChoices`, offer Warp Blades
  (double 5+ or triple, pick 2)
- `offer_wrathful_devotion`: On `BlessingsChoices`, offer Wrathful
  Devotion (any double, pick 2)
- `do_activate` rules for each choice

This is enough to test: header display, unit listing, dice pool,
numbered choice list, dice selection, pass, undo, and auto-advance.

---

## 9. Files Changed / Created

| File | Action |
|---|---|
| `cli/package.json` | Create |
| `cli/tsconfig.json` | Create |
| `cli/src/index.ts` | Create: entry point |
| `cli/src/game-loop.ts` | Create: main loop state machine |
| `cli/src/renderer.ts` | Create: 40k display formatting |
| `cli/src/commands.ts` | Create: debug command parser |
| `engine/src/engine/index.ts` | Modify: add `passAllChoices()` |
| `engine/src/index.ts` | Modify: export `passAllChoices` if needed |
| `packs/cli-demo/manifest.yaml` | Create |
| `packs/cli-demo/initial_state.json` | Create |
| `packs/cli-demo/timeline.yaml` | Create |
| `packs/cli-demo/glossary.yaml` | Create |
| `packs/cli-demo/rules.json` | Create |
