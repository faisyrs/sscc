import type {
  TimelineNode,
  SubSequence,
  EventNode,
  SequenceNode,
  RepeatNode,
  ForEachNode,
  SubSequenceRefNode,
  State,
  GameEvent,
} from "../types/index.js";
import { get } from "../state/index.js";

/**
 * Walk a timeline node tree, yielding GameEvents in order.
 * The getState callback is called when the sequencer needs runtime values
 * (repeat counts, forEach sets).
 *
 * parentParams carries inherited parameter bindings from parent nodes.
 */
export function* walkTimeline(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
  getState: () => State,
  parentParams: Record<string, unknown> = {},
): Generator<GameEvent> {
  for (const node of nodes) {
    yield* walkNode(node, subSequences, getState, parentParams);
  }
}

function* walkNode(
  node: TimelineNode,
  subSequences: Record<string, SubSequence>,
  getState: () => State,
  parentParams: Record<string, unknown>,
): Generator<GameEvent> {
  // Event node
  if ("event" in node && typeof (node as EventNode).event === "string") {
    const eventNode = node as EventNode;
    const params: Record<string, unknown> = {};
    if (eventNode.params) {
      for (const paramName of eventNode.params) {
        if (paramName in parentParams) {
          params[paramName] = parentParams[paramName];
        }
      }
    }
    yield { id: eventNode.event, params };
    return;
  }

  // Sequence node
  if ("sequence" in node) {
    const seqNode = node as SequenceNode;
    yield* walkTimeline(seqNode.sequence, subSequences, getState, parentParams);
    return;
  }

  // Repeat node
  if ("repeat" in node) {
    const repeatNode = node as RepeatNode;
    const { count, indexParam, body } = repeatNode.repeat;
    let n: number;
    if (typeof count === "number") {
      n = count;
    } else {
      const val = get(getState(), count.path);
      n = typeof val === "number" ? val : 0;
    }
    for (let i = 1; i <= n; i++) {
      const iterParams = { ...parentParams, [indexParam]: i };
      yield* walkTimeline(body, subSequences, getState, iterParams);
    }
    return;
  }

  // ForEach node
  if ("forEach" in node) {
    const feNode = node as ForEachNode;
    const { over, bindParam, body } = feNode.forEach;
    const state = getState();
    const collection = get(state, over.from);
    if (!Array.isArray(collection)) return;
    for (const item of collection) {
      const iterParams = { ...parentParams, [bindParam]: item };
      yield* walkTimeline(body, subSequences, getState, iterParams);
    }
    return;
  }

  // SubSequence reference node
  if ("subSequence" in node) {
    const refNode = node as SubSequenceRefNode;
    const subSeq = subSequences[refNode.subSequence];
    if (!subSeq) {
      throw new Error(`Unknown subSequence: ${refNode.subSequence}`);
    }
    // Pass parent params through (sub-sequence inherits calling context)
    yield* walkTimeline(subSeq.body, subSequences, getState, parentParams);
    return;
  }

  throw new Error(`Unknown timeline node type: ${JSON.stringify(node)}`);
}

/**
 * Collect all event IDs that can appear in a timeline (for load-time validation).
 */
export function collectEventIds(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
): Set<string> {
  const ids = new Set<string>();
  collectEventIdsRecursive(nodes, subSequences, ids);
  return ids;
}

function collectEventIdsRecursive(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
  ids: Set<string>,
): void {
  for (const node of nodes) {
    if ("event" in node && typeof (node as EventNode).event === "string") {
      ids.add((node as EventNode).event);
    } else if ("sequence" in node) {
      collectEventIdsRecursive((node as SequenceNode).sequence, subSequences, ids);
    } else if ("repeat" in node) {
      collectEventIdsRecursive((node as RepeatNode).repeat.body, subSequences, ids);
    } else if ("forEach" in node) {
      collectEventIdsRecursive((node as ForEachNode).forEach.body, subSequences, ids);
    } else if ("subSequence" in node) {
      const subSeq = subSequences[(node as SubSequenceRefNode).subSequence];
      if (subSeq) {
        collectEventIdsRecursive(subSeq.body, subSequences, ids);
      }
    }
  }
}
