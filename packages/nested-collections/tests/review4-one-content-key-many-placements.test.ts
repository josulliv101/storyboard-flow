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
// THOSE NUMBERS ARE A RECORD, NOT A GATE. A cost gate for this was written,
// verified against a deliberately reverted build, and then deleted when CI
// disproved it — the reasoning is on the `describe` below, and it is worth
// reading before writing a third one.
//
// What IS asserted here is the answer: the right placements, in document order,
// agreeing with a full rebuild. That is the half of "this optimisation is
// correct" that can be checked without a stopwatch.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

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

describe("one content key across many placements", () => {
  // THERE IS NO COST GATE HERE, and the second attempt at one is why.
  //
  // The differential was shared-key insert against unique-key insert: same
  // document size, same arrival count, same process, the only difference being
  // whether the placements share a content key. It discriminated locally —
  //
  //                      fixed     reverted to `includes`
  //    N = 4,000          1.13                       1.89
  //    N = 8,000          0.95                       2.19
  //
  // — and then failed on CI at 1.95 ON THE FIXED BUILD, which is the number the
  // reverted one produced here.
  //
  // Not flakiness. The gate's null hypothesis was never true. With a shared key
  // the merge really does build an N-element bucket and allocate an N-element
  // array; with unique keys every bucket holds one element and there is
  // essentially no merge at all. Those are different amounts of work BY
  // CONSTRUCTION, so a ratio near 1.0 was an artifact of this machine rather
  // than a property the correct implementation has. Widening the threshold
  // would only have hidden that.
  //
  // Growth-of-shared-key-cost-with-N was tried too, and does not separate them:
  // 1.07 / 1.50 fixed against 1.27 / 1.60 reverted, which overlaps.
  //
  // So the measurement lives in the header above, where it is checkable by
  // anyone who wants to re-run it, and the test below guards the ANSWER — which
  // is the part that can be asserted without a stopwatch. Two gates have now
  // been written for this round's cost findings and both were deleted for the
  // same reason: a gate that cannot reliably tell correct from incorrect is
  // worse than none, because it reads as coverage.

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
