// Sixth review round — `Object.freeze` on a Map protects nothing.
//
// ./graph/constants holds three shared empties so that the hot accessors do not
// allocate: `getChildren` and its neighbours are read once per rendered row per
// frame, and a fresh `[]` or `new Map()` per call defeats every `useMemo` and
// `Object.is` downstream. `NO_IDS` is `Object.freeze([])` and a `.push` on it
// throws. Its two neighbours were bare `new Map()` — and freezing a Map would
// not have helped either, because its entries live in an internal slot that
// `Object.freeze` cannot reach.
//
// So they were protected in name only, and the gap was invisible because the
// declared type is `ReadonlyMap` and TypeScript will not let a well-behaved
// consumer try. MEASURED through the public surface, before the fix:
//
//   two independently built empty graphs shared the same map   true
//   a write through the ReadonlyMap succeeded                  true
//   it was visible in the OTHER graph                          true
//
// The file header argued these were safe because none is re-exported from
// `./index`. That is true of the BINDINGS and false of the VALUES: every empty
// graph publishes them as `placementsByContentKey` and `ownerBySourceKey`, and
// so does every graph whose registry declares no `contentKey` — the ordinary
// case, not an edge one. A guard on one door where the hazard has several is the
// shape review 3 kept finding.
//
// Reachable only by code that has already cast away `ReadonlyMap`, so this is
// defence in depth rather than a live bug. It is worth closing because the
// sibling constant already delivers it, and a rule that holds for two of three
// shared empties is the kind that gets relied on for the third.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  type NodeId,
  defineNodeType,
} from "../types";
import { createEngine } from "../engine";
import { emptyGraph } from "../graph";

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const name = ({ ...raw } as Record<string, unknown>)["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});

const types = [folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(): Result<Summary, readonly Issue[]> {
    return { ok: true, value: { n: 0 } };
  },
  serialize(): unknown {
    return { n: 0 };
  },
};

const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });

/** Through the PUBLIC graph, not the module constant: the values are what
 *  escape, and the door is what the finding was about. */
function emptyIndexes() {
  const graph = emptyGraph<Types, Summary>(engine.engineId);
  return {
    placements: graph.placementsByContentKey,
    owners: graph.ownerBySourceKey,
  };
}

/** What a consumer who cast away `ReadonlyMap` is holding. */
function asMutable<K, V>(map: ReadonlyMap<K, V>): Map<K, V> {
  return map as Map<K, V>;
}

describe("the shared empty indexes refuse a write", () => {
  it("refuses set, delete and clear on placementsByContentKey", () => {
    const { placements } = emptyIndexes();
    const mutable = asMutable(placements);
    expect(() => mutable.set("k", [])).toThrow(TypeError);
    expect(() => mutable.delete("k")).toThrow(TypeError);
    expect(() => mutable.clear()).toThrow(TypeError);
  });

  it("refuses set, delete and clear on ownerBySourceKey", () => {
    const { owners } = emptyIndexes();
    const mutable = asMutable(owners);
    expect(() => mutable.set("k", "n" as NodeId)).toThrow(TypeError);
    expect(() => mutable.delete("k")).toThrow(TypeError);
    expect(() => mutable.clear()).toThrow(TypeError);
  });

  it("names the field, so the message says which singleton was written to", () => {
    // Two constants share one helper, and "you wrote to a shared empty map" is
    // not enough to find the call site.
    let message = "";
    try {
      asMutable(emptyIndexes().placements).set("k", []);
    } catch (thrown) {
      message = thrown instanceof Error ? thrown.message : String(thrown);
    }
    expect(message).toContain("placementsByContentKey");
  });

  it("leaves nothing behind in another graph when a write is attempted", () => {
    // The reason this matters at all: these are process-wide singletons, so a
    // write was never local to the graph it went through.
    const first = emptyIndexes();
    try {
      asMutable(first.placements).set("poisoned", []);
    } catch {
      // Expected.
    }
    const second = emptyIndexes();
    expect(second.placements.has("poisoned")).toBe(false);
    expect(second.placements.size).toBe(0);
  });

  it("still SHARES them, which is the whole reason they exist", () => {
    // The fix must not be "stop sharing": a fresh empty map per call is what
    // defeats the identity comparisons these constants exist to preserve.
    const first = emptyIndexes();
    const second = emptyIndexes();
    expect(first.placements).toBe(second.placements);
    expect(first.owners).toBe(second.owners);
  });

  it("still reads like an ordinary empty map", () => {
    // A refusal that broke reading would be a worse bug than the one it closes.
    const { placements } = emptyIndexes();
    expect(placements.size).toBe(0);
    expect(placements.get("anything")).toBeUndefined();
    expect(placements.has("anything")).toBe(false);
    expect([...placements.keys()]).toEqual([]);
    expect([...placements.entries()]).toEqual([]);
    // And copying out of one — the sanctioned way to change an index — still
    // works, which is what every incremental updater in ./graph does.
    const copy = new Map(placements);
    copy.set("k", []);
    expect(copy.size).toBe(1);
    expect(placements.size).toBe(0);
  });

  it("keeps NO_IDS' protection too, so all three shared empties agree", () => {
    // The rule this file is about is "a shared empty refuses a write". It held
    // for the array and not for the two maps; asserting all three together is
    // what stops them drifting apart again.
    const graph = emptyGraph<Types, Summary>(engine.engineId);
    expect(() => (graph.rootIds as NodeId[]).push("x" as NodeId)).toThrow(
      TypeError,
    );
  });
});
