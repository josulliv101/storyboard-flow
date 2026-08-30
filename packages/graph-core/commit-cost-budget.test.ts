// Graph — the second thing a graph outgrows.
//
// `fold-cache-capacity.test.ts` and `review3-the-two-default-ceilings-agree.ts`
// cover the memo table going past what it can hold. This covers the other
// silent size failure, which has no table and no eviction counter: a commit
// copies whole maps, so its cost is set by how many nodes the DOCUMENT holds
// and not at all by how small the edit was.
//
// MEASURED, one `edit-nodes` and one `insert-nodes`, best-of-25:
//
//    10,025 nodes   edit  1.21 ms   insert  2.33 ms   0.120 us/node
//    25,025 nodes   edit  3.26 ms   insert  6.28 ms   0.130 us/node
//    50,025 nodes   edit  7.59 ms   insert 14.92 ms   0.152 us/node
//   100,025 nodes   edit 17.06 ms   insert 33.89 ms   0.171 us/node
//
// `DEFAULT_MAX_NODES` is 100,000, the last row — where one keystroke is a whole
// 60Hz frame inside the reducer before React is asked to render anything. The
// engine's own default admits documents it cannot serve interactively, which is
// the same two-numbers-that-do-not-know-about-each-other shape the fold-cache
// round found, in a different pair.
//
// This file asserts the DIAGNOSTIC, never a duration. Wall-clock assertions
// pass on the author's laptop, fail on a loaded CI box, and earn a `.skip`
// within a month; the numbers above belong in a comment, and what is tested is
// that the engine says something when a graph crosses the line.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "./types";
import { DEFAULT_MAX_NODES } from "./serialize";
import { createEngine, DEFAULT_INTERACTIVE_NODE_BUDGET } from "./engine";

type Clip = Readonly<{ title: string; seconds: number }>;
const clipType = defineNodeType<Clip, Readonly<{ title?: string }>>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const seconds = record["seconds"];
    if (typeof title !== "string" || typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$", message: "shape" }] };
    }
    return { ok: true, value: { title, seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
});

type Folder = Readonly<{ name: string }>;
const folderType = defineNodeType<Folder, Readonly<{ name?: string }>>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
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

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const n = record["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

function captureErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

/** A root with `total - 1` clip children, so `nodesById.size === total`. */
function docOf(total: number) {
  const children: string[] = [];
  const nodes: unknown[] = [];
  for (let i = 0; i < total - 1; i += 1) children.push(`c${i}`);
  nodes.push({ id: "root", kind: "folder", data: { name: "R" }, children });
  for (const id of children) {
    nodes.push({ id, kind: "clip", data: { title: id, seconds: 1 } });
  }
  return { formatVersion: 1, schemaVersions: { clip: 1, folder: 1 }, rootIds: ["root"], nodes };
}

type Options = Readonly<{ interactiveNodeBudget?: number; maxNodes?: number }>;

function storeOf(nodes: number, options: Options = {}) {
  const engine = createEngine<Types, Summary, {}>({
    types,
    summary,
    folds: {},
    ...(options.interactiveNodeBudget === undefined
      ? {}
      : { interactiveNodeBudget: options.interactiveNodeBudget }),
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
  });
  const loaded = engine.deserialize(docOf(nodes));
  if (!loaded.ok) throw new Error(`fixture failed to load: ${loaded.error.message}`);
  if (loaded.value.graph.nodesById.size !== nodes) {
    throw new Error(
      `fixture is ${loaded.value.graph.nodesById.size} nodes, wanted ${nodes}`,
    );
  }
  return { engine, graph: loaded.value.graph };
}

describe("a store says so when its commits stop fitting a frame", () => {
  it("warns for a graph past the budget", () => {
    const { engine, graph } = storeOf(201, { interactiveNodeBudget: 200 });
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).toHaveBeenCalled();
    const message = String(spy.mock.calls[0]?.[0] ?? "");
    // The two numbers a consumer acts on: how big this graph actually is, and
    // the knob that silences the message once they have priced it.
    expect(message).toContain("201");
    expect(message).toContain("interactiveNodeBudget");
  });

  it("stays silent AT the budget, not just under it", () => {
    // Off-by-one in the comparison is the likeliest way this check goes wrong,
    // and it goes wrong quietly in both directions.
    const { engine, graph } = storeOf(200, { interactiveNodeBudget: 200 });
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent for a small graph", () => {
    const { engine, graph } = storeOf(50, { interactiveNodeBudget: 200 });
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent when the consumer set the budget to zero", () => {
    const { engine, graph } = storeOf(5_000, { interactiveNodeBudget: 0 });
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("warns at most ONCE, however many commits follow", () => {
    const { engine, graph } = storeOf(201, { interactiveNodeBudget: 200 });
    const spy = captureErrors();
    const store = engine.createStore(graph);
    for (let i = 0; i < 3; i += 1) {
      store.dispatch({
        type: "insert-nodes",
        toParentId: parseNodeId("root"),
        toIndex: 0,
        seeds: [{ kind: "clip", data: { title: `x${i}`, seconds: 1 } }],
      });
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warns when a graph GROWS past the budget", () => {
    // The case a load-time-only check cannot see, and the reason this is
    // re-checked on commit: a document that loads comfortably and is edited
    // past the line one insert at a time.
    const { engine, graph } = storeOf(198, { interactiveNodeBudget: 200 });
    const spy = captureErrors();
    const store = engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i += 1) {
      store.dispatch({
        type: "insert-nodes",
        toParentId: parseNodeId("root"),
        toIndex: 0,
        seeds: [{ kind: "clip", data: { title: `g${i}`, seconds: 1 } }],
      });
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("is NOT silenced by a consumer who named maxNodes", () => {
    // The one place this departs from the fold-cache warning, which does go
    // quiet when `foldCacheLimit` is named. `foldCacheLimit` and the table it
    // sizes answer the same question, so naming one IS choosing. `maxNodes`
    // does not: it is a trust boundary against hostile payloads, and a
    // consumer who bounded allocation at 50,000 has said nothing at all about
    // what they will accept per keystroke. Reading their security number as a
    // performance opinion would silence exactly the deployment most likely to
    // need this.
    const { engine, graph } = storeOf(201, {
      interactiveNodeBudget: 200,
      maxNodes: 500,
    });
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).toHaveBeenCalled();
  });

  it("uses the measured default when the consumer names no budget", () => {
    // The expensive test, and the only one that proves the DEFAULT is wired
    // rather than the parameter. A budget that defaults to `undefined` and
    // compares as `NaN` would pass every test above and warn for nothing, ever.
    const { engine, graph } = storeOf(DEFAULT_INTERACTIVE_NODE_BUDGET + 1);
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0] ?? "")).toContain(
      String(DEFAULT_INTERACTIVE_NODE_BUDGET),
    );
  });
});

describe("the two size defaults disagree, and that is the point", () => {
  it("maxNodes admits documents past the interactive budget", () => {
    // Executable rather than prose, because the comment that used to describe
    // the relationship between `maxNodes` and the fold table was wrong, and
    // this is the same claim about a different pair.
    expect(DEFAULT_MAX_NODES).toBeGreaterThan(DEFAULT_INTERACTIVE_NODE_BUDGET);
    // 4x. A document at the node ceiling costs about four times per keystroke
    // what one at the budget does — worse than 4x in fact, because the measured
    // per-node cost rises with size.
    expect(DEFAULT_MAX_NODES / DEFAULT_INTERACTIVE_NODE_BUDGET).toBe(4);
  });

  it("the interactive budget is a diagnostic, not a ceiling", () => {
    // A graph well past the budget still LOADS and still COMMITS. If this ever
    // starts throwing or rejecting, the diagnostic has become a gate and the
    // trust boundary has quietly moved.
    const { engine, graph } = storeOf(2_000, { interactiveNodeBudget: 200 });
    const spy = captureErrors();
    const store = engine.createStore(graph);
    const result = store.dispatch({
      type: "insert-nodes",
      toParentId: parseNodeId("root"),
      toIndex: 0,
      seeds: [{ kind: "clip", data: { title: "still works", seconds: 1 } }],
    });
    expect(result.ok).toBe(true);
    expect(store.getGraph().nodesById.size).toBe(2_001);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
