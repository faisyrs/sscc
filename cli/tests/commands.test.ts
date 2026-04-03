import { describe, it, expect } from "vitest";
import { parseInput } from "../src/commands.js";

describe("parseInput", () => {
  it("parses choice selection", () => {
    expect(parseInput("1")).toEqual({ type: "choice", index: 1 });
    expect(parseInput("3")).toEqual({ type: "choice", index: 3 });
  });

  it("parses 0 as pass", () => {
    expect(parseInput("0")).toEqual({ type: "pass" });
  });

  it("parses f as pass", () => {
    expect(parseInput("f")).toEqual({ type: "pass" });
  });

  it("parses dice selection (space-separated)", () => {
    expect(parseInput("5 6")).toEqual({ type: "dice", indices: [5, 6] });
    expect(parseInput("0 1 2")).toEqual({ type: "dice", indices: [0, 1, 2] });
  });

  it("parses empty input as advance", () => {
    expect(parseInput("")).toEqual({ type: "advance" });
  });

  it("parses undo", () => {
    expect(parseInput("undo")).toEqual({ type: "undo" });
  });

  it("parses log with default count", () => {
    expect(parseInput("log")).toEqual({ type: "log", count: 20 });
  });

  it("parses log with custom count", () => {
    expect(parseInput("log 50")).toEqual({ type: "log", count: 50 });
  });

  it("parses rules command", () => {
    expect(parseInput("rules")).toEqual({ type: "rules" });
  });

  it("parses state with path", () => {
    expect(parseInput("state $.units.foo")).toEqual({ type: "state", path: "$.units.foo" });
  });

  it("parses step toggle", () => {
    expect(parseInput("step")).toEqual({ type: "step" });
  });

  it("parses help", () => {
    expect(parseInput("help")).toEqual({ type: "help" });
  });

  it("parses quit", () => {
    expect(parseInput("quit")).toEqual({ type: "quit" });
  });

  it("returns unknown for unrecognized input", () => {
    expect(parseInput("xyzzy")).toEqual({ type: "unknown", raw: "xyzzy" });
  });
});
