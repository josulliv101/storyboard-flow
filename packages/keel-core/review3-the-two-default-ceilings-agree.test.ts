// Third review round, bounds sweep — two defaults that contradict each other,
// and a comment that claims they cannot.
//
// `DEFAULT_MAX_NODES` is 100,000. Its doc comment argues that number is safe
// partly because it sits "above the 16,384 the fold cache is sized to hold, so
// the two ceilings cannot contradict each other: no document that loads is one
// the memo table then silently refuses to serve."
//
// The premise IS the contradiction. The table holds `foldCacheLimit / folds`
// NODES, not 16,384 nodes unconditionally. `DEFAULT_FOLD_CACHE_LIMIT` is
// 8 x 16,384 = 131,072 ENTRIES, and ./folds names an 8-fold registry as
// realistic — so 16,384 nodes IS the default table's node capacity, and the
// node ceiling admits 6.1x that.
//
// MEASURED through the public surface, 8 folds, one root with N clip children,
// eight root `aggregate` reads performed twice:
//
//   16,000 nodes   evictions 0        second pass 8/8 hits     0.118 ms
//   20,001 nodes   evictions 188,944  second pass 0/8 hits     5,542 ms
//   20,001 nodes, cache sized to fit   evictions 0   8/8 hits  0.017 ms
//
// 20,001 nodes is FIVE TIMES UNDER the node ceiling and `deserialize` accepts
// it. The repeat costs 5.5 seconds instead of 17 microseconds, and it is worse
// than having no cache at all, because every `set` also runs the eviction loop.
// That is exactly the "LRU INVERTS" failure ./folds describes as the thing its
// sizing exists to prevent, on a document the engine's own default permits.
//
// The fix is a DIAGNOSTIC, not a new ceiling. `createEngine` is the one place
// both numbers are in hand — it already walks `config.folds` for the
// duplicate-key check — and raising either default would trade a silent stall
// for a silent memory cost. `stats()` exists because this failure has no other
// symptom; this makes it audible at construction instead of at 20,000 nodes.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type Issue,
  type Result,
  type SummaryCodec,
  defineNodeType,
  parseNodeId,
} from "./types";
import { foldMonoid, DEFAULT_FOLD_CACHE_LIMIT } from "./folds";
import { DEFAULT_MAX_NODES } from "./serialize";
import { createEngine } from "./engine";

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

const summary: SummaryCodec<Summary> = {
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

function foldsNamed(count: number) {
  const folds: Record<string, ReturnType<typeof foldMonoid<Types, Summary, number>>> = {};
  for (let i = 0; i < count; i += 1) {
    folds[`f${i}`] = foldMonoid<Types, Summary, number>({
      key: `f${i}`,
      empty: 0,
      leaf(node) {
        return node.kind === "clip" ? node.data.seconds : 0;
      },
      concat(a, b) {
        return a + b;
      },
    });
  }
  return folds;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function captureErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

function docOf(n: number) {
  const children: string[] = [];
  const nodes: unknown[] = [];
  for (let i = 0; i < n; i += 1) children.push(`c${i}`);
  nodes.push({ id: "root", kind: "folder", data: { name: "R" }, children });
  for (const id of children) {
    nodes.push({ id, kind: "clip", data: { title: id, seconds: 1 } });
  }
  return { formatVersion: 1, schemaVersions: { clip: 1, folder: 1 }, rootIds: ["root"], nodes };
}

function storeOf(
  foldCount: number,
  nodes: number,
  config?: Readonly<{ foldCacheLimit?: number }>,
) {
  const folds = foldsNamed(foldCount);
  const engine = createEngine<Types, Summary, typeof folds>({
    types,
    summary,
    folds,
    ...(config?.foldCacheLimit === undefined
      ? {}
      : { foldCacheLimit: config.foldCacheLimit }),
  });
  const loaded = engine.deserialize(docOf(nodes - 1));
  if (!loaded.ok) throw new Error("fixture failed to deserialize");
  return { engine, graph: loaded.value.graph };
}

describe("the store says so when the memo table cannot cover its graph", () => {
  it("warns when folds x nodes exceeds the table", () => {
    const { engine, graph } = storeOf(8, 20_001);
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).toHaveBeenCalled();
    const message = String(spy.mock.calls[0]?.[0] ?? "");
    // The number a consumer acts on is the size it comfortably covers, so the
    // message has to carry it rather than just saying "too small". 8,192, not
    // 16,384: the gate now allows headroom over `folds x nodes` because the
    // product is the working set's FLOOR and editing strands entries above it.
    expect(message).toContain("8192");
    expect(message).toContain("foldCacheLimit");
  });

  it("stays silent when the table covers the graph WITH headroom", () => {
    // 8 folds x 8,000 nodes x 2 = 128,000, inside the 131,072 default. At
    // 16,000 it would fit the bare product and still thrash, which is the
    // whole reason the multiple exists.
    const { engine, graph } = storeOf(8, 8_000);
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent for a small graph, whatever the CEILINGS say", () => {
    // The condition that produced twelve false positives: comparing maxNodes
    // against the table rather than the graph. A 200-node document with 8
    // folds is fine and must not be scolded, even though 8 x maxNodes is far
    // above the default table.
    const { engine, graph } = storeOf(8, 200);
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent whenever the consumer named the limit themselves", () => {
    // ./fold-cache-capacity.test.ts sets tiny limits on purpose to exercise
    // eviction. Those stores really do thrash — the warning would be TRUE and
    // useless, because thrashing is the point. A named number is a choice.
    const { engine, graph } = storeOf(8, 20_001, { foldCacheLimit: 4 });
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent when caching is deliberately disabled", () => {
    const { engine, graph } = storeOf(8, 20_001, { foldCacheLimit: 0 });
    const spy = captureErrors();
    engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent for a registry with no folds at all", () => {
    const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
    const loaded = engine.deserialize(docOf(20_000));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const spy = captureErrors();
    engine.createStore(loaded.value.graph);
    expect(spy).not.toHaveBeenCalled();
  });

  it("warns at most ONCE, however far the graph grows", () => {
    const { engine, graph } = storeOf(8, 20_001);
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

  it("warns when a graph GROWS past what the table covers", () => {
    // Under the default table at load, over it after a few inserts — the case
    // a load-time-only check would miss entirely. 8 folds and the headroom
    // multiple make the default comfortably cover 8,192 nodes, so this sits
    // just under it and then crosses.
    const { engine, graph } = storeOf(8, 8_190);
    const spy = captureErrors();
    const store = engine.createStore(graph);
    expect(spy).not.toHaveBeenCalled();
    for (let i = 0; i < 8; i += 1) {
      store.dispatch({
        type: "insert-nodes",
        toParentId: parseNodeId("root"),
        toIndex: 0,
        seeds: [{ kind: "clip", data: { title: `g${i}`, seconds: 1 } }],
      });
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the two package defaults do disagree at a realistic fold count", () => {
    // Stated as an executable fact rather than left in a comment, because the
    // comment that used to describe this relationship was wrong.
    const realisticFolds = 8;
    expect(realisticFolds * DEFAULT_MAX_NODES).toBeGreaterThan(
      DEFAULT_FOLD_CACHE_LIMIT,
    );
    expect(Math.floor(DEFAULT_FOLD_CACHE_LIMIT / realisticFolds)).toBe(16_384);
    // And the size it comfortably covers, once churn headroom is allowed for,
    // is half that. The gap between these two numbers is where a graph passes
    // the bare-product check and thrashes anyway.
    expect(Math.floor(DEFAULT_FOLD_CACHE_LIMIT / (realisticFolds * 2))).toBe(8_192);
  });
});

describe("historyLimit says what it does", () => {
  it("refuses a limit that is not a positive integer", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createEngine<Types, Summary, {}>({
          types,
          summary,
          folds: {},
          historyLimit: bad,
        }),
      ).toThrow(/historyLimit/);
    }
  });

  it("accepts a positive integer, and omission still means unbounded", () => {
    expect(() =>
      createEngine<Types, Summary, {}>({
        types,
        summary,
        folds: {},
        historyLimit: 3,
      }),
    ).not.toThrow();
    expect(() =>
      createEngine<Types, Summary, {}>({ types, summary, folds: {} }),
    ).not.toThrow();
  });
});
