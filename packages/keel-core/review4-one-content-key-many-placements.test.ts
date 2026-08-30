// Fourth review round — the axis every cost fixture holds constant.
//
// `performance.test.ts` assigns `assetId: asset-${clipId}`, so every content
// bucket in every one of its fixtures has length ONE. That is a realistic
// document and a blind spot at the same time: the incremental index updaters
// are keyed BY content key, and a bucket of one exercises none of the work they
// do per bucket member. A cost that is quadratic in bucket size is invisible to
// a suite where the size is always one.
//
// `placementsAfterInsert`'s survivor tail was exactly that. It walks the
// incumbents that outlive the merge and asked `ordered.includes(incumbent)` for
// each — O(incumbents x arrivals), and the tail carries the WHOLE bucket
// whenever the arrivals sort first, which is what inserting at index 0 does.
// Measured end to end through `store.dispatch`, 2,000 arrivals:
//
//   incumbents      includes      Set
//        2,000      11.77 ms    8.53 ms
//        4,000      14.99 ms    9.11 ms
//        8,000      24.03 ms   13.69 ms      <- 1.76x
//
// The gesture is ordinary: paste N copies of one asset into a strip that
// already holds many of them.
//
// THE GATE BELOW IS A DIFFERENTIAL, not a budget, and it was checked against a
// deliberately reverted implementation before being trusted — the last cost gate
// this round produced passed on the broken code and had to be deleted, so the
// standard is that a gate must be SEEN to fail:
//
//                     fixed      reverted to `includes`
//   N = 4,000          1.13                        1.89
//   N = 8,000          0.95                        2.19
//
// Same document size, same arrival count, same machine, same run — the only
// difference is whether the placements share one content key. A linear
// implementation makes the two indistinguishable; a quadratic one cannot.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "./types";
import { createEngine } from "./engine";

type Clip = Readonly<{ title: string; asset: string }>;
type ClipEdit = Readonly<{ title?: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const asset = record["asset"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof asset !== "string") {
      return { ok: false, error: [{ path: "$.asset", message: "asset" }] };
    }
    return { ok: true, value: { title, asset } };
  },
  serialize(data): unknown {
    return { title: data.title, asset: data.asset };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
  // THE POINT OF THIS FIXTURE. A registry that declares `contentKey` at all, and
  // a document that lets many placements share one.
  contentKey(data) {
    return data.asset;
  },
});

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
    return { ok: true, value: { ...data, name: edit.name ?? data.name } };
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const n = ({ ...raw } as Record<string, unknown>)["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

const rootId = parseNodeId("root");

/**
 * Build a flat strip of `N` clips, then time `insert + undo` of `arrivals` more
 * at index 0 — the position that makes every incumbent survive into the tail.
 *
 * `shared` is the only thing that varies between the two runs the gate compares:
 * one content key for everything, or one per clip.
 */
function insertCostMs(N: number, arrivals: number, shared: boolean): number {
  const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
  const nodes: unknown[] = [];
  const childIds: string[] = [];
  for (let i = 0; i < N; i += 1) {
    childIds.push(`c${i}`);
    nodes.push({
      id: `c${i}`,
      kind: "clip",
      data: { title: `c${i}`, asset: shared ? "SHARED" : `asset-${i}` },
    });
  }
  nodes.unshift({
    id: "root",
    kind: "folder",
    data: { name: "R" },
    children: childIds,
  });

  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes,
  });
  if (!loaded.ok) throw new Error("fixture failed to load");
  const store = engine.createStore(loaded.value.graph);

  const seeds = Array.from({ length: arrivals }, (_, i) => ({
    kind: "clip" as const,
    data: { title: `n${i}`, asset: shared ? "SHARED" : `fresh-${i}` },
  }));

  const reps = 8;
  const started = performance.now();
  for (let r = 0; r < reps; r += 1) {
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds,
    });
    if (!inserted.ok) throw new Error(`insert refused: ${inserted.error.code}`);
    const undone = store.undo();
    if (!undone.ok) throw new Error(`undo refused: ${undone.error.code}`);
  }
  const ms = (performance.now() - started) / reps;
  store.destroy();
  return ms;
}

describe("one content key across many placements", () => {
  it("costs about what the same insert costs with unique keys", () => {
    // THE WORST of the two sizes, not each in turn. The quadratic grows with N
    // and the noise does not, so the larger size carries the signal — and
    // asserting the max means one unlucky small-N reading cannot decide the
    // verdict in either direction. A first draft asserted each size separately
    // and failed the reverted build by 6% (1.59 against 1.5), which is a margin
    // thin enough to flip the other way on a loaded box.
    const ratios: number[] = [];
    for (const N of [4_000, 8_000]) {
      const shared = insertCostMs(N, 2_000, true);
      const unique = insertCostMs(N, 2_000, false);
      ratios.push(shared / unique);
    }
    const worst = Math.max(...ratios);
    // Measured 1.13 / 0.95 with the fix and 1.89 / 2.19 without it. 1.4 leaves
    // the fix ~24% of headroom and still sits well under the reverted build.
    // Unlike an absolute budget, a ratio of two runs on the SAME box in the
    // SAME process survives a loaded CI machine.
    expect(worst).toBeLessThan(1.4);
  }, 300_000);

  it("still produces the right index, which is what the speed is in service of", () => {
    // A cost gate that does not also check the answer is how an optimisation
    // gets faster by being wrong.
    const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "R" },
          children: ["a", "b", "c"],
        },
        { id: "a", kind: "clip", data: { title: "a", asset: "SHARED" } },
        { id: "b", kind: "clip", data: { title: "b", asset: "other" } },
        { id: "c", kind: "clip", data: { title: "c", asset: "SHARED" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [
        { kind: "clip", data: { title: "n1", asset: "SHARED" } },
        { kind: "clip", data: { title: "n2", asset: "SHARED" } },
      ],
    });
    expect(inserted.ok).toBe(true);

    const after = store.getGraph();
    const bucket = after.placementsByContentKey.get("SHARED") ?? [];
    // Five placements now, and IN DOCUMENT ORDER — the two arrivals at the
    // front because they were inserted at index 0, then the two incumbents the
    // survivor tail carried over.
    expect(bucket).toHaveLength(4);
    expect(bucket.slice(0, 2)).toEqual(after.childrenById.get(rootId)?.slice(0, 2));
    // And the incremental answer agrees with a full rebuild, which is the rule
    // ./graph/incremental-indexes exists under.
    expect(engine.findInvariantViolation(after)).toBeNull();

    expect(store.undo().ok).toBe(true);
    expect(store.getGraph().placementsByContentKey.get("SHARED")).toHaveLength(2);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });
});
