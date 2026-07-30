import { describe, expect, it } from "vitest";

import { buildGraph, verifyPatchApplies } from "@storyboard/ui/dnd-collections";
import type { CollectionsGraph, CollectionsPatch, HistoryEntry } from "@storyboard/ui/dnd-collections";

import { FORMAT_VERSION, parseEntries, serializeEntries } from "./graph-history-format";

// This module is the trust boundary between sessionStorage and the store.
// Replay's own guard (`verifyPatchApplies`) answers whether a patch still FITS
// the graph and assumes it is shaped like a patch — so anything malformed has
// to be stopped here or not at all. The "verifyPatchApplies throws" case below
// is what makes that concrete; delete this file's checks and that throw is
// what the user gets on their first Undo after a reload.

const entry = (patch: CollectionsPatch): HistoryEntry => ({
  command: { type: "move-nodes", nodeIds: [], toParentId: "root", toIndex: 0 },
  patch,
  at: 1_700_000_000_000,
} as unknown as HistoryEntry);

const movedPatch = (): CollectionsPatch =>
  ({
    type: "nodes-moved",
    moves: [
      { nodeId: "a", fromParentId: "root", fromIndex: 0, toParentId: "sub", toIndex: 0 },
    ],
  }) as unknown as CollectionsPatch;

/** A payload the OLD check accepted: right discriminant, no `moves`. */
const patchMissingItsArray = { type: "nodes-moved" };

const raw = (value: unknown) => JSON.stringify(value);

function emptyGraph(): CollectionsGraph {
  const built = buildGraph([{ kind: "collection", id: "root", name: "root", children: [] }]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

describe("history payload round-trip", () => {
  it("restores what it stored", () => {
    const entries = [entry(movedPatch())];
    expect(parseEntries(serializeEntries(entries))).toEqual(entries);
  });

  it("discards a payload written by another format version", () => {
    const stored = JSON.parse(serializeEntries([entry(movedPatch())])) as { v: number };
    stored.v = FORMAT_VERSION + 1;
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it("discards the pre-versioning bare array", () => {
    expect(parseEntries(raw([entry(movedPatch())]))).toEqual([]);
  });

  it("discards unparseable JSON rather than throwing", () => {
    expect(() => parseEntries("{not json")).not.toThrow();
    expect(parseEntries("{not json")).toEqual([]);
  });
});

describe("history payload validation", () => {
  it("REGRESSION: rejects a patch carrying its discriminant but not its array", () => {
    const stored = { v: FORMAT_VERSION, entries: [entry(patchMissingItsArray as CollectionsPatch)] };
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it("REGRESSION: that same patch throws inside replay's guard — which is the stake", () => {
    // Not a test of production behavior; it pins WHY the check above exists.
    // `verifyPatchApplies` does `for (const move of patch.moves)`, so letting
    // this reach the store turns the next Undo into a TypeError.
    expect(() =>
      verifyPatchApplies(emptyGraph(), patchMissingItsArray as CollectionsPatch),
    ).toThrow();
  });

  it.each([
    ["nodes-added", { type: "nodes-added" }],
    ["nodes-removed", { type: "nodes-removed" }],
    ["nodes-moved", { type: "nodes-moved" }],
    ["nodes-updated", { type: "nodes-updated" }],
  ])("rejects a %s patch with no payload array", (_label, patch) => {
    const stored = { v: FORMAT_VERSION, entries: [entry(patch as CollectionsPatch)] };
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it("rejects an unknown patch type", () => {
    const stored = { v: FORMAT_VERSION, entries: [entry({ type: "nodes-teleported" } as unknown as CollectionsPatch)] };
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it("rejects a move entry missing an endpoint", () => {
    const stored = {
      v: FORMAT_VERSION,
      entries: [entry({ type: "nodes-moved", moves: [{ nodeId: "a", fromParentId: "root" }] } as unknown as CollectionsPatch)],
    };
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it("rejects an add whose node has no id", () => {
    const stored = {
      v: FORMAT_VERSION,
      entries: [
        entry({
          type: "nodes-added",
          adds: [{ node: { kind: "media" }, parentId: "root", index: 0 }],
        } as unknown as CollectionsPatch),
      ],
    };
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it("rejects an update missing its before/after nodes", () => {
    const stored = {
      v: FORMAT_VERSION,
      entries: [entry({ type: "nodes-updated", updates: [{ nodeId: "a" }] } as unknown as CollectionsPatch)],
    };
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it.each([
    ["command", { patch: movedPatch(), at: 1 }],
    ["at", { command: { type: "move-nodes" }, patch: movedPatch() }],
  ])("rejects an entry with no %s", (_label, candidate) => {
    const stored = { v: FORMAT_VERSION, entries: [candidate] };
    expect(parseEntries(raw(stored))).toEqual([]);
  });

  it("discards the WHOLE stack when one entry is bad, never a stack with a hole", () => {
    // Undo replays in order; a stack missing a middle step describes a
    // sequence of edits that never happened.
    const stored = {
      v: FORMAT_VERSION,
      entries: [
        entry(movedPatch()),
        entry(patchMissingItsArray as CollectionsPatch),
        entry(movedPatch()),
      ],
    };
    expect(parseEntries(raw(stored))).toEqual([]);
  });
});
