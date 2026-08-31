// Fourth review round — a SUBTREE question answered with N ROOT-walks.
//
// `tallestSubtree` backs the depth ceiling on `move-nodes`. It called
// `ancestorChain` once per descendant — walking to the root, and allocating a
// chain array, for every node in the subtree — to learn a height that one
// descent already knows.
//
// MEASURED by counting `parentById.get` during a single depth-checked move of
// a caterpillar subtree (a spine of folders, five leaves hanging off each):
//
//     nodes   depth     reads before -> after
//       122      20          1,491 ->  9
//       242      40          5,371 ->  9
//       482      80         20,331 ->  9
//       962     160         79,051 ->  9
//
// Theta(N x depth) before, flat after. The 9 belong to the rest of the move —
// `planMove` and `depthOf(graph, toParentId)` — and depend on where the subtree
// is going, not on its size.
//
// Counted rather than timed: three wall-clock gates have been deleted from this
// repo for not surviving CI, and a read count is the same fact without the
// variance.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType, type Issue, type Result,
  defineNodeType, parseNodeId,
} from "../types";
import { createEngine } from "../engine";
import { applyCommand } from "../commands";
import { buildRegistry } from "../graph";
import { DEFAULT_MAX_NODES } from "../serialize";

type F = Readonly<{ name: string }>;
const folderType = defineNodeType<F, Readonly<{ name?: string }>>()({
  kind: "folder", container: true, schemaVersion: 1,
  parse(raw): Result<F, readonly Issue[]> {
    const n = ({ ...(raw as object) } as Record<string, unknown>)["name"];
    return typeof n === "string" ? { ok: true, value: { name: n } } : { ok: false, error: [{ path: "$", message: "n" }] };
  },
  serialize: (d) => ({ name: d.name }),
  applyEdit: (d, e) => ({ ok: true, value: { ...d, name: e.name ?? d.name } }),
});
const types = [folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;
const summary: ConsumerDefinedSummaryType<Summary> = {
  parse: (raw) => { const n = ({ ...(raw as object) } as Record<string, unknown>)["n"];
    return typeof n === "number" ? { ok: true, value: { n } } : { ok: false, error: [{ path: "$", message: "n" }] }; },
  serialize: (v) => ({ n: v.n }),
};

/** Spine of `depth` folders; each carries `branch` leaves. Height is `depth`. */
function caterpillar(depth: number, branch: number) {
  const nodes: unknown[] = [
    { id: "root", kind: "folder", data: { name: "R" }, children: ["dest", "s0"] },
    { id: "dest", kind: "folder", data: { name: "D" }, children: [] },
  ];
  for (let d = 0; d < depth; d += 1) {
    const kids = Array.from({ length: branch }, (_, b) => "l" + d + "-" + b);
    if (d + 1 < depth) kids.push("s" + (d + 1));
    nodes.push({ id: "s" + d, kind: "folder", data: { name: "s" + d }, children: kids });
    for (const k of kids) {
      if (k.startsWith("l")) nodes.push({ id: k, kind: "folder", data: { name: k }, children: [] });
    }
  }
  return { formatVersion: 1 as const, schemaVersions: { folder: 1 }, rootIds: ["root"], nodes };
}

/** Counts every `parentById` read the move performs. */
class CountingParents extends Map<string, string | null> {
  public reads = 0;
  override get(key: string): string | null | undefined {
    this.reads += 1;
    return super.get(key);
  }
}

/** `maxDepth` gates INGRESS too, so the fixture loads under a generous ceiling
 *  and the MOVE is checked against the tight one. */
function moveProbe(depth: number, branch: number, maxDepth: number) {
  const engine = createEngine<Types, Summary, {}>({
    types, summary, folds: {}, maxNodes: 500_000, maxDepth: 1_000_000,
  });
  const loaded = engine.deserialize(caterpillar(depth, branch));
  if (!loaded.ok) throw new Error("fixture failed to load");
  const graph = loaded.value.graph;
  const parents = new CountingParents(
    graph.parentById as ReadonlyMap<string, string | null>,
  );
  const probed = { ...graph, parentById: parents } as unknown as typeof graph;
  const ctx = {
    engineId: graph.engineId,
    registry: buildRegistry(types),
    summary,
    onUnknownKind: "quarantine" as const,
    onParseFailure: "quarantine" as const,
    maxNodes: DEFAULT_MAX_NODES,
    maxDepth,
    mintId: (): string => "x",
    now: (): number => 0,
    devChecks: false,
  };
  parents.reads = 0;
  const result = applyCommand<Types, Summary>(
    probed,
    { type: "move-nodes", nodeIds: [parseNodeId("s0")], toParentId: parseNodeId("dest"), toIndex: 0 },
    ctx,
  );
  return { result, reads: parents.reads, nodes: graph.nodesById.size };
}

describe("subtree height is one descent, not a root-walk per node", () => {
  it("parentById reads do not grow with the subtree", () => {
    // Sizes chosen so the OLD cost grows ~53x across the range (1,491 ->
    // 79,051) while the node count grows only 8x. A bound that a linear
    // implementation clears easily and a quadratic one cannot.
    const small = moveProbe(20, 5, 100_000);
    const large = moveProbe(160, 5, 100_000);
    expect(small.result.ok).toBe(true);
    expect(large.result.ok).toBe(true);

    // The real assertion. Before, this ratio was ~53; now both are 9.
    expect(large.reads).toBeLessThanOrEqual(small.reads * 2);

    // And an absolute ceiling, so "both got slower together" cannot pass:
    // nothing about answering this should scale with the 962-node subtree.
    expect(large.reads).toBeLessThan(large.nodes);
  }, 120_000);

  it("still REFUSES a move that would breach the ceiling, with the right depth", () => {
    // Correctness, not cost. `dest` sits at depth 2 (root, then dest). The
    // moved subtree is a spine of 12 folders whose leaves add one more, so its
    // height is 13 and the move lands at 15 — the arithmetic the descent has to
    // reproduce exactly, since an off-by-one here silently changes which
    // documents a consumer can build.
    const refused = moveProbe(12, 2, 14);
    expect(refused.result.ok).toBe(false);
    if (refused.result.ok) return;
    expect(refused.result.error.code).toBe("would-exceed-max-depth");
    expect(refused.result.error.actual).toBe(15);
    expect(refused.result.error.limit).toBe(14);
  });

  it("accepts the same move one level under the ceiling", () => {
    // The boundary from the other side — a height one too large would refuse
    // this, and one too small would have accepted the case above. Together they
    // pin the number rather than just its direction.
    const allowed = moveProbe(12, 2, 15);
    expect(allowed.result.ok).toBe(true);
  });

  it("a single leaf has height 1 wherever it sits", () => {
    // The degenerate case the loop has to get right: no children, so the
    // descent visits exactly one node and the initial `tallest` stands.
    const engine = createEngine<Types, Summary, {}>({
      types, summary, folds: {}, maxNodes: 1000, maxDepth: 3,
    });
    const loaded = engine.deserialize({
      formatVersion: 1 as const, schemaVersions: { folder: 1 }, rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: ["a", "b"] },
        { id: "a", kind: "folder", data: { name: "A" }, children: [] },
        { id: "b", kind: "folder", data: { name: "B" }, children: [] },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    // root(1) -> b(2) -> a(3) is exactly the ceiling, so this must pass.
    expect(store.dispatch({
      type: "move-nodes", nodeIds: [parseNodeId("a")], toParentId: parseNodeId("b"), toIndex: 0,
    }).ok).toBe(true);
  });
});
