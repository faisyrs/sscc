# SSCC Conceptual Model

*Living specification -- updated as discovered during implementation.*

---

## Primitives

The SSCC engine is built on five primitives:

### State

The set of facts that are true right now.

State is the complete, structured snapshot of the game at a point in time.
Examples: a unit has `can_move`. Player A has 1 CP. The activation context holds
unit `u3`.

State changes only through atomic effects produced by rules. There is no other
mechanism for state mutation.

### Event

A discrete point in time where evaluation happens.

An event carries no effects of its own -- it is a named trigger for rule
evaluation. An event with no matching rules is a valid no-op. This is useful as
an extension point: the skeleton emits events that no current rules match,
allowing future packs to hook behavior onto them without modifying the timeline.

Events are scoped to their containing sequence. A rule-emitted event during
movement cannot appear in the shooting phase. Cross-phase communication is
always through state.

### Sequence

An ordered set of events, nestable.

The timeline is a set of nested sequences: the game contains rounds, rounds
contain turns, turns contain phases. Each phase is a sequence of events.

Sequences are finite and enumerable at load time. The set of event IDs that can
appear in any sequence is known before the game starts -- both timeline-declared
events and rule-emitted events (collected from `emit` effects in the rule set).

### Rule

A conditional, atomic state change.

Rules are evaluated at every event. If a rule's conditions over current state
are met, it performs an atomic state change. A rule's effects may include
inserting new events into the current sequence.

Rules never insert events outside their containing sequence. A rule firing
during the movement phase sequence can emit events within that sequence, but
cannot emit events into the shooting phase sequence.

Key properties:
- **Conditional** -- a rule has a `when` clause: predicates over current state
- **Atomic** -- all effects of a rule apply as one indivisible state change
- **Ordered** -- rules are evaluated in priority order (ascending: low fires
  first, high fires last)
- **Composable** -- multiple rules can fire on the same event; conflict
  resolution determines how their effects combine

### Choice

A state change that pauses the engine for player input.

When a rule's effects include `addChoice`, the engine suspends timeline
advancement. The engine does not advance to the next event while unresolved
choices exist.

When a player selects a choice, the engine inserts a `ChoiceSelected` event
into the current sequence. Rules triggered by `ChoiceSelected` perform the
action associated with that choice.

This is the mechanism that drives activation loops: a rule offers a choice, the
player selects, the selection triggers rules that may offer another choice, and
so on until no new choices are produced -- at which point the engine advances.

---

## Engine Advancement

The engine advances to the next event in the current sequence when all of the
following are true:

1. All rules for the current event have been evaluated
2. All rule-emitted events have been evaluated
3. All choices have been selected, expired, or cancelled
4. No new events or choices were produced by the above

This is the only advancement mechanism. There is no explicit "next" command or
timer.

---

## Cross-Phase Communication

Events are scoped to their containing sequence. Cross-phase communication is
always through state:

1. A rule sets a state flag during one phase
2. Another rule reads that flag during a later phase

Example: `advanced_move` status is applied during the movement phase. During the
shooting phase, a rule on `ShootingPhaseStarted` reads this status and adds a
prohibition preventing the unit from shooting.

The status carries the information; the events stay in their own sequences.

---

## Status Expiry

Two mechanisms for removing statuses:

### Engine-managed expiry (`expiresOn`)

A status may declare `expiresOn: EventId` when applied. The engine removes it
automatically when that event fires. Multiple rules can set the same status via
different code paths; the expiry is consistent regardless of origin.

### Rule-consumed

A status with no `expiresOn` must be explicitly removed by a rule effect. This
is used for statuses that should be consumed one-by-one during gameplay (e.g.,
`can_move` removed as each unit activates).

---

## Changelog

| Date | Change |
|---|---|
| 2026-04-02 | Initial version, derived from design spec Section 0 |
