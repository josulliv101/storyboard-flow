import { describe, expect, test } from "vitest";
import { createHistory, type HistoryEntry } from "./history";
import { parseNodeId } from "./graph";
import { type CollectionsPatch } from "./patches";

function entry(marker: number): HistoryEntry {
  const patch: CollectionsPatch = {
    type: "nodes-moved",
    moves: [
      {
        nodeId: parseNodeId(`n${marker}`),
        fromParentId: parseNodeId("a"),
        fromIndex: marker,
        toParentId: parseNodeId("b"),
        toIndex: 0,
      },
    ],
  };
  return {
    command: { type: "move-nodes", nodeIds: [parseNodeId(`n${marker}`)], toParentId: parseNodeId("b"), toIndex: 0 },
    patch,
    at: marker,
  };
}

describe("createHistory", () => {
  test("undo returns the inverse of the most recent patch", () => {
    const history = createHistory();
    history.push(entry(1));

    const undone = history.undo();
    // Inverted: from/to swapped.
    expect(undone?.type).toBe("nodes-moved");
    const undoneMove = undone?.type === "nodes-moved" ? undone.moves[0] : undefined;
    expect(undoneMove).toMatchObject({ fromParentId: "b", toParentId: "a", toIndex: 1 });
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  test("redo replays the original patch", () => {
    const history = createHistory();
    history.push(entry(1));
    history.undo();

    const redone = history.redo();
    const redoneMove = redone?.type === "nodes-moved" ? redone.moves[0] : undefined;
    expect(redoneMove).toMatchObject({ fromParentId: "a", toParentId: "b" });
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  test("a new push invalidates the redo branch", () => {
    const history = createHistory();
    history.push(entry(1));
    history.push(entry(2));
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.push(entry(3));
    expect(history.canRedo()).toBe(false);
    expect(history.entries().map((e) => e.at)).toEqual([1, 3]);
  });

  test("undo/redo on empty stacks return null", () => {
    const history = createHistory();
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });
});

describe("createHistory maxEntries", () => {
  test("oldest entries fall off past the cap and stop being undoable", () => {
    const history = createHistory({ maxEntries: 2 });
    history.push(entry(1));
    history.push(entry(2));
    history.push(entry(3));
    expect(history.entries().map((e) => e.at)).toEqual([2, 3]);
    history.undo();
    history.undo();
    expect(history.canUndo()).toBe(false); // entry 1 is gone for good
  });

  test("invalid caps (0, negative, fractional, NaN) fall back to unbounded", () => {
    for (const maxEntries of [0, -3, 2.5, Number.NaN]) {
      const history = createHistory({ maxEntries });
      for (let i = 1; i <= 5; i++) history.push(entry(i));
      // Nothing was dropped: all five remain and stay undoable.
      expect(history.entries().map((e) => e.at)).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
