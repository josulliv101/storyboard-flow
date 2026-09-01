// Fourth review round — the audit had no production home.
//
// `findInvariantViolation` is the only thing that checks the ENGINE against
// itself. Ingress cannot do that job: a wire document has no opinion about
// `parentById`, `subtreeRevById` or the derived indexes, because ingress BUILDS
// all three rather than reading them. Every audit-only code — `parent-index-
// disagrees`, `missing-subtree-rev`, `derived-index-stale`,
// `loaded-collection-missing-children-entry` — is about state only our own
// mutation code can corrupt.
//
// And it ran nowhere in production. `EngineConfig.devChecks` is off by default,
// so the one check positioned to catch an engine bug was absent from every
// build where an engine bug would actually cost something.
//
// WHY THAT MATTERED. `serializeGraph` emits unreachable nodes deliberately —
// dropping them is the worse loss — so a corrupt graph SAVES CLEANLY and
// `deserialize` refuses the file afterwards, forever. The write succeeds and the
// document is gone. That is not hypothetical: it is what the cyclic move patch
// in #605 produced, and this test reproduces it through the public surface.
//
// WHY SAVE AND NOT EVERY COMMIT. The audit is a full pass — reachability, one
// `sourceKey` per node, and a complete rebuild of both derived indexes to
// compare. MEASURED against a single `edit-nodes` on the same graph:
//
//     10,501 nodes   commit  3.00 ms   audit   9.18 ms   3.1x
//     26,251 nodes   commit  6.05 ms   audit  21.05 ms   3.5x
//     52,501 nodes   commit 12.89 ms   audit  53.62 ms   4.2x
//
// Per keystroke that is a frame gone at the size `DEFAULT_INTERACTIVE_NODE_BUDGET`
// already calls expensive, and the multiple GROWS with the document. Per save it
// is 53 ms once, against a corruption that is otherwise permanent.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";
import { applyPatch, verifyPatchApplies } from "../patches";
import { buildRegistry } from "../graph";
import { DEFAULT_MAX_NODES } from "../serialize";

type Clip = Readonly<{ title: string }>;
type ClipEdit = Readonly<{ title?: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const title = ({ ...raw } as Record<string, unknown>)["title"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title } };
  },
  serialize(data): unknown {
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
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

const makeEngine = () =>
  createEngine<Types, Summary, {}>({ types, summary, folds: {} });

/** root -> [Y(folder,[y1]), X(folder,[x1])]. Two sibling folders. */
const twoSiblingFolders = {
  formatVersion: 1 as const,
  schemaVersions: { clip: 1, folder: 1 },
  rootIds: ["root"],
  nodes: [
    {
      id: "root",
      kind: "folder",
      data: { name: "Root" },
      children: ["Y", "X"],
    },
    { id: "Y", kind: "folder", data: { name: "Y" }, children: ["y1"] },
    { id: "y1", kind: "clip", data: { title: "y1" } },
    { id: "X", kind: "folder", data: { name: "X" }, children: ["x1"] },
    { id: "x1", kind: "clip", data: { title: "x1" } },
  ],
};

/**
 * A graph the engine itself produced and cannot load back.
 *
 * Built the only way it can be: `applyPatch` with a hand-built cyclic move. The
 * REDUCER refuses this (`would-create-cycle`), and since #605 so does
 * `verifyPatchApplies` — asserted below, because a corruption fixture that
 * silently stops corrupting is a test that passes for the wrong reason.
 */
function corruptedGraph() {
  const engine = makeEngine();
  const loaded = engine.deserialize(twoSiblingFolders);
  if (!loaded.ok) throw new Error("fixture failed to load");

  const ctx = {
    engineId: loaded.value.graph.engineId,
    registry: buildRegistry(types),
    summary,
    onUnknownKind: "seal" as const,
    onParseFailure: "seal" as const,
    maxNodes: DEFAULT_MAX_NODES,
    maxDepth: null,
    maxNodeIdLength: null,
    mintId: (): string => "minted",
    now: (): number => 0,
    devChecks: false,
  };

  // STEP 1, entirely legal: move Y into X. Through the reducer, so there is no
  // doubt it is a state the engine will really produce.
  const store = engine.createStore(loaded.value.graph);
  const moved = store.dispatch({
    type: "move-nodes",
    nodeIds: [parseNodeId("Y")],
    toParentId: parseNodeId("X"),
    toIndex: 0,
  });
  expect(moved.ok).toBe(true);
  const afterFirst = store.getGraph();

  // STEP 2: move X into Y, which now closes the ring. Both are CONTAINERS, so
  // the resulting graph's only fault is the cycle — an earlier draft of this
  // fixture moved X into a clip, and the audit reported `leaf-with-children`
  // first, which is a different mess and would have tested the wrong thing.
  const cyclicMove = {
    type: "moved" as const,
    moves: [
      {
        nodeId: parseNodeId("X"),
        fromParentId: parseNodeId("root"),
        fromIndex: 0,
        toParentId: parseNodeId("Y"),
        toIndex: 0,
      },
    ],
  };

  // The replay gate must still refuse it — that is #605's fix, and this fixture
  // has to go around it deliberately rather than by accident.
  const gated = verifyPatchApplies(afterFirst, cyclicMove, ctx);
  expect(gated.ok).toBe(false);

  return { engine, graph: applyPatch(afterFirst, cyclicMove, ctx) };
}

describe("a save can refuse a graph that will not load back", () => {
  it("the corruption really does save cleanly and then never load", () => {
    // The whole reason the checked door exists. Asserted first, so if
    // `serializeGraph` ever starts dropping unreachable nodes this test says so
    // rather than quietly protecting nothing.
    const { engine, graph } = corruptedGraph();

    expect(engine.findInvariantViolation(graph)).not.toBeNull();

    const wire = engine.serialize(graph);
    expect(wire.nodes.length).toBe(5);

    const reloaded = engine.deserialize(wire);
    expect(reloaded.ok).toBe(false);
    if (reloaded.ok) return;
    expect(reloaded.error.code).toBe("unreachable-node");
  });

  it("serializeChecked refuses it, and hands back the violation", () => {
    const { engine, graph } = corruptedGraph();

    const written = engine.serializeChecked(graph);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    // The violation itself, not a wrapper — the caller can report which node.
    expect(written.error.code).toBe("unreachable-node");
    expect(written.error.nodeId).toBeDefined();
  });

  it("serialize stays TOTAL, which is why the checked door is separate", () => {
    // "A save path that throws loses the user's document" is `serializeGraph`'s
    // own contract. Refusing is a save that did not happen, so the refusal has
    // to be opt-in and the default has to keep writing.
    const { engine, graph } = corruptedGraph();
    expect(() => engine.serialize(graph)).not.toThrow();
  });

  it("a sound graph passes through unchanged", () => {
    // The guard must not cost the traffic it sits in front of: same bytes as
    // `serialize`, so a caller can switch doors without changing what is stored.
    const engine = makeEngine();
    const loaded = engine.deserialize(twoSiblingFolders);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const written = engine.serializeChecked(loaded.value.graph);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value).toEqual(engine.serialize(loaded.value.graph));

    // And it round-trips, which is the property the whole door is protecting.
    expect(engine.deserialize(written.value).ok).toBe(true);
  });
});
