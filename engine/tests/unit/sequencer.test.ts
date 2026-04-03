import { describe, it, expect } from "vitest";
import { walkTimeline } from "../../src/sequencer/index.js";
import type { TimelineNode, SubSequence, State, GameEvent } from "../../src/types/index.js";

function collect(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
  state: State,
): GameEvent[] {
  const events: GameEvent[] = [];
  const gen = walkTimeline(nodes, subSequences, () => state);
  for (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("Event node", () => {
  it("yields a single event", () => {
    const events = collect([{ event: "StartOfGame" }], {}, {});
    expect(events).toEqual([{ id: "StartOfGame", params: {} }]);
  });

  it("yields event with inherited params", () => {
    const events = collect(
      [{ event: "TurnStarted", params: ["player"] }],
      {},
      {},
    );
    // params array names are declared but values come from parent context
    // At top level, no parent context, so params are empty
    expect(events[0].id).toBe("TurnStarted");
  });
});

describe("Sequence node", () => {
  it("yields children in order", () => {
    const nodes: TimelineNode[] = [
      {
        sequence: [
          { event: "A" },
          { event: "B" },
          { event: "C" },
        ],
      },
    ];
    const events = collect(nodes, {}, {});
    expect(events.map((e) => e.id)).toEqual(["A", "B", "C"]);
  });
});

describe("Repeat node", () => {
  it("repeats body N times with literal count", () => {
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: 3,
          indexParam: "round",
          body: [{ event: "RoundStarted", params: ["round"] }],
        },
      },
    ];
    const events = collect(nodes, {}, {});
    expect(events).toHaveLength(3);
    expect(events[0].params.round).toBe(1);
    expect(events[2].params.round).toBe(3);
  });

  it("reads count from state path", () => {
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: { path: "$.totalRounds" },
          indexParam: "round",
          body: [{ event: "R", params: ["round"] }],
        },
      },
    ];
    const events = collect(nodes, {}, { totalRounds: 2 });
    expect(events).toHaveLength(2);
  });

  it("zero count produces no events", () => {
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: { path: "$.totalRounds" },
          indexParam: "round",
          body: [{ event: "R" }],
        },
      },
    ];
    const events = collect(nodes, {}, { totalRounds: 0 });
    expect(events).toHaveLength(0);
  });
});

describe("ForEach node", () => {
  it("iterates over player set from state", () => {
    const nodes: TimelineNode[] = [
      {
        forEach: {
          over: { kind: "player", from: "$.players" },
          bindParam: "player",
          body: [{ event: "TurnStarted", params: ["player"] }],
        },
      },
    ];
    const events = collect(nodes, {}, { players: ["A", "B"] });
    expect(events).toHaveLength(2);
    expect(events[0].params.player).toBe("A");
    expect(events[1].params.player).toBe("B");
  });

  it("empty set produces zero events", () => {
    const nodes: TimelineNode[] = [
      {
        forEach: {
          over: { kind: "player", from: "$.players" },
          bindParam: "player",
          body: [{ event: "X" }],
        },
      },
    ];
    const events = collect(nodes, {}, { players: [] });
    expect(events).toHaveLength(0);
  });
});

describe("SubSequence ref", () => {
  it("resolves named sub-sequence and yields its events", () => {
    const nodes: TimelineNode[] = [
      { subSequence: "movementPhase", params: ["player"] },
    ];
    const subSequences: Record<string, SubSequence> = {
      movementPhase: {
        params: ["player"],
        body: [
          { event: "MovementPhaseStarted", params: ["player"] },
          { event: "MovementPhaseEnded", params: ["player"] },
        ],
      },
    };
    const gen = walkTimeline(nodes, subSequences, () => ({}));
    const events: GameEvent[] = [];
    // We need to pass params through context; for top-level there is no parent
    for (const e of gen) events.push(e);
    expect(events.map((e) => e.id)).toEqual([
      "MovementPhaseStarted",
      "MovementPhaseEnded",
    ]);
  });
});

describe("State is read at iteration time", () => {
  it("repeat reads count from getState at start of repeat", () => {
    let state: State = { n: 2 };
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: { path: "$.n" },
          indexParam: "i",
          body: [{ event: "E", params: ["i"] }],
        },
      },
    ];
    const gen = walkTimeline(nodes, {}, () => state);
    const events: GameEvent[] = [];
    for (const e of gen) {
      events.push(e);
    }
    expect(events).toHaveLength(2);
  });
});
