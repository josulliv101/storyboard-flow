// Capacity, configurability and observability of the fold memo table.
//
// Separate from folds.test.ts, which covers the cache's MECHANICS (key
// injectivity, LRU order, hit/miss union). What is covered here is the thing a
// review found by reading the source and no mechanics test could catch: the cap
// was `2048`, `createEngine` never passed one, and `EngineConfig` had no field
// for it — so a consumer could not raise it without editing the package.
//
// k folds over n nodes need k x n slots. Above that product the table stops
// helping and says nothing about it, which is why three of the four groups
// below are about a number being REACHABLE and MEASURABLE rather than about an
// answer being right. The fourth is the property that makes exposing the dial
// safe at all: because the key carries `subtreeRev`, eviction changes cost and
// never a result.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOLD_CACHE_LIMIT,
  computeFold,
  createFoldCache,
  foldMonoid,
  weakestCertainty,
  type FoldCacheStats,
} from "./folds";
import { documentOrder, getNode } from "./graph";
import { createEngine } from "./engine";
import { defineNodeType, parseNodeId } from "./types";
import type {
  Certainty,
  Command,
  EditOf,
  Engine,
  Fold,
  Folded,
  Graph,
  Issue,
  NodeId,
  Result,
  SummaryType,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture registry — two kinds, so every fold has to narrow on `node.kind`
// ---------------------------------------------------------------------------

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string; seconds?: number }>;
type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;
type Summary = Readonly<{ seconds: number }>;

function fail(path: string, message: string): readonly Issue[] {
  return [{ path, message }];
}

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: fail("$", "expected an object") };
    }
    if (!("title" in raw) || typeof raw.title !== "string") {
      return { ok: false, error: fail("$.title", "expected a string") };
    }
    if (!("seconds" in raw) || typeof raw.seconds !== "number") {
      return { ok: false, error: fail("$.seconds", "expected a number") };
    }
    return { ok: true, value: { title: raw.title, seconds: raw.seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: {
        title: edit.title ?? data.title,
        seconds: edit.seconds ?? data.seconds,
      },
    };
  },
});

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: fail("$", "expected an object") };
    }
    if (!("name" in raw) || typeof raw.name !== "string") {
      return { ok: false, error: fail("$.name", "expected a string") };
    }
    return { ok: true, value: { name: raw.name } };
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
type TestGraph = Graph<Types, Summary>;

const summary: SummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: fail("$", "expected an object") };
    }
    if (!("seconds" in raw) || typeof raw.seconds !== "number") {
      return { ok: false, error: fail("$.seconds", "expected a number") };
    }
    return { ok: true, value: { seconds: raw.seconds } };
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

// ---------------------------------------------------------------------------
// Fixture folds — THREE of them, because one fold cannot show the failure
//
// The collapse the review described is inter-fold: fold 3's walk evicts fold
// 1's entries and fold 1 then misses at its own root. A single-fold suite
// cannot reproduce it at any cap.
// ---------------------------------------------------------------------------

const durationFold = foldMonoid<Types, Summary, number>({
  key: "duration",
  empty: 0,
  leaf: (node) => (node.kind === "clip" ? node.data.seconds : 0),
  concat: (a, b) => a + b,
  placeholder: (node) => (node.summary === null ? undefined : node.summary.seconds),
});

const countFold = foldMonoid<Types, Summary, number>({
  key: "count",
  empty: 0,
  leaf: () => 1,
  concat: (a, b) => a + b,
});

const titlesFold: Fold<Types, Summary, readonly string[]> = {
  key: "titles",
  leaf(node) {
    return node.kind === "clip" ? [node.data.title] : [];
  },
  collection(_node, children) {
    const certainties: Certainty[] = [];
    const value: string[] = [];
    for (const child of children) {
      value.push(...child.value);
      certainties.push(child.certainty);
    }
    return { value, certainty: weakestCertainty(certainties) };
  },
  placeholder() {
    return { value: [], certainty: "estimated" };
  },
  missing() {
    return { value: [], certainty: "exact" };
  },
  quarantined() {
    return { value: [], certainty: "partial" };
  },
};

const folds = {
  duration: durationFold,
  count: countFold,
  titles: titlesFold,
};

const FOLD_KEYS = ["duration", "count", "titles"] as const;

type EngineOptions = Readonly<{
  foldCacheLimit?: number;
  onFoldCacheStats?(read: () => FoldCacheStats): void;
}>;

function makeEngine(options: EngineOptions = {}) {
  return createEngine<Types, Summary, typeof folds>({
    types,
    summary,
    folds,
    now: () => 1234,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const id = (raw: string): NodeId => parseNodeId(raw);
const rootId = id("root");

type WireNode = Readonly<{
  id: string;
  kind: string;
  data: unknown;
  children?: readonly string[];
  childrenState?: string;
  missingReason?: string;
  summary?: unknown;
}>;

/**
 * `folders` x `clipsPerFolder` under one root. `extras` adds one node of every
 * `computeFold` dispatch arm — unloaded (placeholder), missing, quarantined and
 * an empty loaded collection — so the eviction-invariance property is checked
 * over every arm rather than over sums alone.
 */
function buildDocument(
  spec: Readonly<{ folders: number; clipsPerFolder: number; extras?: boolean }>,
): unknown {
  const nodes: WireNode[] = [];
  const rootChildren: string[] = [];

  for (let f = 0; f < spec.folders; f += 1) {
    const folderId = `folder-${f}`;
    const clipIds: string[] = [];
    for (let c = 0; c < spec.clipsPerFolder; c += 1) {
      const clipId = `clip-${f}-${c}`;
      clipIds.push(clipId);
      nodes.push({
        id: clipId,
        kind: "clip",
        data: { title: clipId, seconds: c + 1 },
      });
    }
    nodes.push({
      id: folderId,
      kind: "folder",
      data: { name: folderId },
      children: clipIds,
    });
    rootChildren.push(folderId);
  }

  if (spec.extras === true) {
    nodes.push({
      id: "unloaded",
      kind: "folder",
      data: { name: "unloaded" },
      childrenState: "unloaded",
      summary: { seconds: 30 },
    });
    nodes.push({
      id: "gone",
      kind: "folder",
      data: { name: "gone" },
      childrenState: "missing",
      missingReason: "404",
    });
    // No node type is registered for this kind, so it lands quarantined.
    nodes.push({ id: "mystery", kind: "mystery", data: { opaque: true } });
    nodes.push({ id: "empty", kind: "folder", data: { name: "empty" }, children: [] });
    rootChildren.push("unloaded", "gone", "mystery", "empty");
  }

  nodes.push({
    id: "root",
    kind: "folder",
    data: { name: "root" },
    children: rootChildren,
  });

  return {
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes,
  };
}

/**
 * The graph MUST come from the engine that will own the store.
 *
 * `NodeId` is branded globally, so a graph deserialized by one engine
 * typechecks perfectly against another and is refused at runtime with
 * `foreign-graph`. `computeFold` has no such guard — it is a read path — so a
 * mismatch here does not fail loudly, it just makes every `dispatch` in the
 * test a no-op and the comparison it feeds vacuous. This suite caught exactly
 * that while being written.
 */
function loadGraphWith(
  engine: Engine<Types, Summary, typeof folds>,
  document: unknown,
): TestGraph {
  const loaded = engine.deserialize(document);
  // A fixture that will not load would make every assertion below vacuous, so
  // this asserts rather than early-returns.
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value.graph;
}

/** For the pure `computeFold` tests, which never dispatch and so never care. */
const pureEngine = makeEngine();

function loadGraph(document: unknown): TestGraph {
  return loadGraphWith(pureEngine, document);
}

// ---------------------------------------------------------------------------
// 1. The cap is reachable
// ---------------------------------------------------------------------------

describe("fold cache capacity", () => {
  it("defaults to a folds x nodes product rather than a round number", () => {
    // The finding: 2048 reads as "plenty" and is one fold over 2k nodes. With
    // the six-to-eight folds a real registry carries it collapsed in the low
    // hundreds.
    //
    // Asserted as a PRODUCT rather than as the literal constant, so revising
    // the factors upward stays a one-line change while quietly dropping back to
    // a round number does not. The floor is one realistic registry over the
    // document size this package's performance fixtures treat as real.
    const realisticFolds = 8;
    const realisticNodes = 10000;
    expect(DEFAULT_FOLD_CACHE_LIMIT).toBeGreaterThanOrEqual(
      realisticFolds * realisticNodes,
    );
  });

  it("never exceeds its limit while folding a graph much larger than it", () => {
    const graph = loadGraph(buildDocument({ folders: 12, clipsPerFolder: 8 }));
    const nodeCount = graph.nodesById.size;
    expect(nodeCount).toBeGreaterThan(100);

    const cache = createFoldCache(16);
    const result = computeFold(graph, durationFold, rootId, cache);

    // Correct answer, undersized cache — the two are independent, which is the
    // whole point of group 4 below.
    expect(result?.certainty).toBe("exact");
    expect(cache.size()).toBeLessThanOrEqual(16);

    const stats = cache.stats();
    expect(stats.limit).toBe(16);
    // Every node is committed exactly once per walk, so what survives plus what
    // was evicted has to account for all of them. A cap that silently failed to
    // evict would show up here as a mismatch rather than as memory growth
    // nobody notices until a tab dies.
    expect(stats.size + stats.evictions).toBe(nodeCount);
    expect(stats.evictions).toBeGreaterThan(0);
  });

  it("is configurable from createEngine, which is where a consumer stands", () => {
    // Before the fix this test could not be written: `createEngine` called
    // `createFoldCache()` with no argument and `EngineConfig` had no field.
    let readSmall: (() => FoldCacheStats) | undefined;
    const small = makeEngine({
      foldCacheLimit: 4,
      onFoldCacheStats: (read) => {
        readSmall = read;
      },
    });
    const document = buildDocument({ folders: 6, clipsPerFolder: 4 });
    const smallStore = small.createStore(loadGraphWith(small, document));

    expect(readSmall).toBeDefined();
    if (readSmall === undefined) return;
    expect(readSmall().limit).toBe(4);

    smallStore.aggregate("duration", rootId);
    expect(readSmall().size).toBeLessThanOrEqual(4);
    expect(readSmall().evictions).toBeGreaterThan(0);

    const nodeCount = loadGraph(document).nodesById.size;
    let readRoomy: (() => FoldCacheStats) | undefined;
    const roomy = makeEngine({
      foldCacheLimit: FOLD_KEYS.length * nodeCount,
      onFoldCacheStats: (read) => {
        readRoomy = read;
      },
    });
    const roomyStore = roomy.createStore(loadGraphWith(roomy, document));
    expect(readRoomy).toBeDefined();
    if (readRoomy === undefined) return;

    for (const key of FOLD_KEYS) roomyStore.aggregate(key, rootId);
    // At exactly k x n the whole working set fits and nothing is evicted. This
    // is the number the default has to be a plausible instance of.
    expect(readRoomy().evictions).toBe(0);
    expect(readRoomy().size).toBe(FOLD_KEYS.length * nodeCount);
  });

  it("turns a second frame free at k x n and into a refold below it", () => {
    // The review's actual claim, measured rather than argued: below the product
    // the LRU does not degrade, it inverts. Same graph, same three folds, two
    // caps.
    const document = buildDocument({ folders: 8, clipsPerFolder: 6 });
    const nodeCount = loadGraph(document).nodesById.size;

    const readFrames = (limit: number): Readonly<{ first: number; second: number }> => {
      let read: (() => FoldCacheStats) | undefined;
      const engine = makeEngine({
        foldCacheLimit: limit,
        onFoldCacheStats: (r) => {
          read = r;
        },
      });
      const store = engine.createStore(loadGraphWith(engine, document));
      if (read === undefined) throw new Error("no stats reader was handed out");

      for (const key of FOLD_KEYS) store.aggregate(key, rootId);
      const first = read().misses;
      for (const key of FOLD_KEYS) store.aggregate(key, rootId);
      return { first, second: read().misses - first };
    };

    const roomy = readFrames(FOLD_KEYS.length * nodeCount);
    // Three root reads, three hits, no walk at all.
    expect(roomy.second).toBe(0);

    // One fold's worth of slots for three folds: each walk evicts the last
    // one's entries, so the second frame costs as much as the first.
    const thrashing = readFrames(nodeCount);
    expect(thrashing.second).toBeGreaterThan(roomy.second);
    expect(thrashing.second).toBeGreaterThan(nodeCount);
  });
});

// ---------------------------------------------------------------------------
// 2. The cache can be seen working, or not working
// ---------------------------------------------------------------------------

describe("fold cache observability", () => {
  it("counts a miss, then a hit, and reports the effective limit", () => {
    const cache = createFoldCache(2.9);
    expect(cache.stats()).toEqual({
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      // Floored, and it is the EFFECTIVE ceiling that is reported — a consumer
      // diagnosing a zero hit rate needs the number the cache is using, not
      // the number they passed.
      limit: 2,
    });

    expect(cache.get("k", id("n"), 1).hit).toBe(false);
    cache.set("k", id("n"), 1, 7);
    expect(cache.get("k", id("n"), 1).hit).toBe(true);

    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().size).toBe(1);
  });

  it("counts an eviction only for capacity, never for a clear", () => {
    const cache = createFoldCache(2);
    cache.set("k", id("a"), 1, 1);
    cache.set("k", id("b"), 1, 2);
    expect(cache.stats().evictions).toBe(0);

    cache.set("k", id("c"), 1, 3);
    expect(cache.stats().evictions).toBe(1);

    expect(cache.get("k", id("c"), 1).hit).toBe(true);
    expect(cache.get("k", id("a"), 1).hit).toBe(false);

    // Two entries dropped, zero evictions added: conflating a deliberate reset
    // with cache pressure would destroy the only number that says the limit is
    // too low.
    cache.clear();
    expect(cache.stats().size).toBe(0);
    expect(cache.stats().evictions).toBe(1);
    // And the lifetime read counters survive it, so a consumer that clears on
    // every document swap does not see a permanently healthy cache.
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  it("explains a disabled cache by its limit rather than by phantom evictions", () => {
    const off = createFoldCache(0);
    off.set("k", id("n"), 1, 1);
    expect(off.get("k", id("n"), 1).hit).toBe(false);
    const stats = off.stats();
    expect(stats.limit).toBe(0);
    expect(stats.size).toBe(0);
    // Nothing was ever admitted, so nothing was evicted for capacity. A count
    // here would read as pressure that a bigger limit fixes, and it is not.
    expect(stats.evictions).toBe(0);
    expect(stats.misses).toBe(1);
  });

  it("gives each store its own reader, because each store owns its own cache", () => {
    // Two stores from one engine are two lineages; sharing a cache between them
    // would be the one way a rev-keyed entry becomes wrong rather than stale,
    // so there is no engine-wide number to hand out instead.
    const readers: (() => FoldCacheStats)[] = [];
    const engine = makeEngine({
      onFoldCacheStats: (read) => {
        readers.push(read);
      },
    });
    const graph = loadGraphWith(engine, buildDocument({ folders: 3, clipsPerFolder: 3 }));

    const first = engine.createStore(graph);
    const second = engine.createStore(graph);
    expect(readers.length).toBe(2);

    const readFirst = readers[0];
    const readSecond = readers[1];
    expect(readFirst).toBeDefined();
    expect(readSecond).toBeDefined();
    if (readFirst === undefined || readSecond === undefined) return;

    first.aggregate("duration", rootId);
    expect(readFirst().size).toBeGreaterThan(0);
    expect(readSecond().size).toBe(0);

    second.aggregate("duration", rootId);
    expect(readSecond().size).toBeGreaterThan(0);
  });

  it("keeps reading after destroy, reporting an emptied table and lifetime counts", () => {
    let read: (() => FoldCacheStats) | undefined;
    const engine = makeEngine({
      onFoldCacheStats: (r) => {
        read = r;
      },
    });
    const store = engine.createStore(
      loadGraphWith(engine, buildDocument({ folders: 2, clipsPerFolder: 2 })),
    );
    if (read === undefined) throw new Error("no stats reader was handed out");

    store.aggregate("duration", rootId);
    const before = read().misses;
    expect(before).toBeGreaterThan(0);

    store.destroy();
    expect(read().size).toBe(0);
    expect(read().misses).toBe(before);
    expect(read().evictions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. A hit skips the subtree walk
// ---------------------------------------------------------------------------

type CountingFold = Readonly<{
  fold: Fold<Types, Summary, number>;
  leafCalls(): number;
  collectionCalls(): number;
}>;

function countingDuration(): CountingFold {
  let leafCalls = 0;
  let collectionCalls = 0;
  const fold: Fold<Types, Summary, number> = {
    key: "counting-duration",
    leaf(node) {
      leafCalls += 1;
      return node.kind === "clip" ? node.data.seconds : 0;
    },
    collection(_node, children) {
      collectionCalls += 1;
      let total = 0;
      const certainties: Certainty[] = [];
      for (const child of children) {
        total += child.value;
        certainties.push(child.certainty);
      }
      return { value: total, certainty: weakestCertainty(certainties) };
    },
    placeholder() {
      return { value: 0, certainty: "partial" };
    },
    missing() {
      return { value: 0, certainty: "exact" };
    },
    quarantined() {
      return { value: 0, certainty: "partial" };
    },
  };
  return {
    fold,
    leafCalls: () => leafCalls,
    collectionCalls: () => collectionCalls,
  };
}

describe("a cache hit skips the subtree walk", () => {
  const spec = { folders: 3, clipsPerFolder: 4 } as const;

  it("does not re-enter a subtree already folded at its rev", () => {
    const graph = loadGraph(buildDocument(spec));
    const cache = createFoldCache();
    const counting = countingDuration();

    // Warm ONE branch. 4 leaves, 1 collection.
    computeFold(graph, counting.fold, id("folder-0"), cache);
    expect(counting.leafCalls()).toBe(4);
    expect(counting.collectionCalls()).toBe(1);

    // Now the root, measured as a DELTA. Totals would prove nothing here: the
    // warm-up already paid for `folder-0`, so a cache that skipped nothing
    // would land on the same cumulative numbers.
    const leavesBefore = counting.leafCalls();
    const collectionsBefore = counting.collectionCalls();
    computeFold(graph, counting.fold, rootId, cache);

    // `folder-0` is answered from the table at its unchanged rev, so neither
    // its collection step nor any of its four leaves runs again — the walk
    // never descends into it. Only `folder-1`, `folder-2` and the root itself
    // are folded.
    expect(counting.leafCalls() - leavesBefore).toBe(8);
    expect(counting.collectionCalls() - collectionsBefore).toBe(3);

    // The control that gives those two numbers meaning: cold, the same root
    // read touches every clip and every collection.
    const cold = countingDuration();
    computeFold(graph, cold.fold, rootId, createFoldCache());
    expect(cold.leafCalls()).toBe(12);
    expect(cold.collectionCalls()).toBe(4);
  });

  it("costs nothing on a repeat read of the same root", () => {
    const graph = loadGraph(buildDocument(spec));
    const cache = createFoldCache();
    const counting = countingDuration();

    computeFold(graph, counting.fold, rootId, cache);
    const leaves = counting.leafCalls();
    const collections = counting.collectionCalls();
    expect(leaves).toBe(12);
    expect(collections).toBe(4);

    computeFold(graph, counting.fold, rootId, cache);
    expect(counting.leafCalls()).toBe(leaves);
    expect(counting.collectionCalls()).toBe(collections);

    // And the second read was a SINGLE lookup, not a walk that happened to hit
    // at every node — which is the difference between the rev-keyed design and
    // a per-node memo.
    expect(cache.stats().hits).toBe(1);
  });

  it("still skips the subtree when the cap is too small to hold the leaves", () => {
    // A hit at a collection is worth more than a hit at a leaf, and under
    // pressure the collection entry is what a root read touches most recently.
    const graph = loadGraph(buildDocument(spec));
    const cache = createFoldCache(6);
    const counting = countingDuration();

    computeFold(graph, counting.fold, rootId, cache);
    const first = counting.leafCalls();
    computeFold(graph, counting.fold, rootId, cache);

    // Whatever eviction did to the interior, the root's own entry survived a
    // walk that wrote only 16 entries into 6 slots, so the second read is free.
    expect(counting.leafCalls()).toBe(first);
    expect(cache.stats().evictions).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Eviction changes cost, never a result
//
// The property the rev-in-the-key design exists to guarantee, and the one that
// makes `foldCacheLimit` safe to expose at all: a consumer can set it to
// anything, including 0, and be wrong only about speed.
// ---------------------------------------------------------------------------

/** xorshift32. Deterministic so a failure reproduces from the seed alone. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function pick<T>(items: readonly T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

function idsByKind(graph: TestGraph): Readonly<{
  clips: readonly NodeId[];
  folders: readonly NodeId[];
}> {
  const clips: NodeId[] = [];
  const folders: NodeId[] = [];
  for (const nodeId of documentOrder(graph)) {
    const node = getNode(graph, nodeId);
    if (node === undefined) continue;
    if (node.quarantined) continue;
    if (!node.container) {
      if (node.kind === "clip") clips.push(nodeId);
      continue;
    }
    if (node.children.status === "loaded") folders.push(nodeId);
  }
  return { clips, folders };
}

describe("eviction changes cost, never a result", () => {
  const document = buildDocument({ folders: 5, clipsPerFolder: 4, extras: true });

  it("agrees with the uncached answer at every limit, at every node", () => {
    const graph = loadGraph(document);
    const nodeIds = documentOrder(graph);
    expect(nodeIds.length).toBeGreaterThan(20);

    // Cold oracle: no cache at all.
    const oracle = new Map<string, Folded<unknown> | undefined>();
    for (const nodeId of nodeIds) {
      oracle.set(`duration|${nodeId}`, computeFold(graph, durationFold, nodeId));
      oracle.set(`count|${nodeId}`, computeFold(graph, countFold, nodeId));
      oracle.set(`titles|${nodeId}`, computeFold(graph, titlesFold, nodeId));
    }

    // 0 disables the table outright; 1 makes every write evict the last; the
    // rest straddle the k x n product for this graph.
    for (const limit of [0, 1, 2, 3, 7, 13, 64, 100000]) {
      const cache = createFoldCache(limit);
      // Interleaved and then repeated: the second pass reads slots the other
      // two folds have been evicting the whole time, which is where a key that
      // did not carry the rev — or carried the wrong one — would answer with a
      // neighbour's value.
      for (let pass = 0; pass < 2; pass += 1) {
        for (const nodeId of nodeIds) {
          expect(computeFold(graph, durationFold, nodeId, cache)).toEqual(
            oracle.get(`duration|${nodeId}`),
          );
          expect(computeFold(graph, countFold, nodeId, cache)).toEqual(
            oracle.get(`count|${nodeId}`),
          );
          expect(computeFold(graph, titlesFold, nodeId, cache)).toEqual(
            oracle.get(`titles|${nodeId}`),
          );
        }
      }
    }
  });

  /**
   * A store being edited, with the engine's UNCACHED `aggregate` over the
   * store's own graph as the oracle. Any drift between the two is a stale entry
   * answering.
   *
   * Run at SEVERAL limits on purpose, and the roomy one is not padding — it is
   * the only setting that can catch a key that forgot the rev. This suite
   * originally ran the loop at `1` alone and a deliberately broken `cacheKey`
   * (rev replaced by a constant) passed all fifteen tests: at a limit of one,
   * every stale entry is evicted before anything can read it, so thrash HIDES
   * staleness. Verified by mutating ./folds and watching this loop go red only
   * once the roomy limit was added.
   */
  const runMutationSequence = (limit: number): number => {
    const engine = makeEngine({ foldCacheLimit: limit });
    const store = engine.createStore(loadGraphWith(engine, document));
    const rng = makeRng(20260827);

    let applied = 0;
    let minted = 0;

    for (let step = 0; step < 60; step += 1) {
      const graph = store.getGraph();
      const { clips, folders } = idsByKind(graph);
      const roll = rng();
      let command: Command<Types, Summary> | null = null;

      if (roll < 0.4) {
        const target = pick(clips, rng);
        if (target !== undefined) {
          const edit: EditOf<Types> = {
            nodeId: target,
            kind: "clip",
            edit: { seconds: Math.floor(rng() * 50) + 1 },
          };
          command = { type: "edit-nodes", edits: [edit] };
        }
      } else if (roll < 0.65) {
        const parent = pick(folders, rng);
        if (parent !== undefined) {
          minted += 1;
          command = {
            type: "insert-nodes",
            seeds: [
              {
                kind: "clip",
                data: { title: `minted-${minted}`, seconds: minted },
              },
            ],
            toParentId: parent,
            toIndex: 0,
          };
        }
      } else if (roll < 0.85) {
        const target = pick(clips, rng);
        // Only leaves are removed: a container with unloaded children needs
        // `allowUnloaded`, and this loop is about cache agreement, not about
        // re-testing the reducer's guards.
        if (target !== undefined) command = { type: "remove-nodes", nodeIds: [target] };
      } else {
        const moving = pick(clips, rng);
        const parent = pick(folders, rng);
        if (moving !== undefined && parent !== undefined) {
          // Through `resolveDrop`, so the post-removal index is the engine's
          // own arithmetic rather than this test's.
          const resolved = store.resolveDrop({
            type: "move",
            nodeIds: [moving],
            toParentId: parent,
            toIndexBefore: 0,
          });
          if (resolved.ok) command = resolved.value;
        }
      }

      if (command !== null && store.dispatch(command).ok) applied += 1;

      // Occasional undo/redo: a replay rewinds revs along a chain the cache is
      // still holding entries for.
      if (rng() < 0.2) store.undo();
      if (rng() < 0.1) store.redo();

      const next = store.getGraph();
      for (const nodeId of documentOrder(next)) {
        for (const key of FOLD_KEYS) {
          expect(store.aggregate(key, nodeId)).toEqual(
            engine.aggregate(next, key, nodeId),
          );
        }
      }
    }

    return applied;
  };

  it("agrees with the uncached answer across a mutation sequence, at any limit", () => {
    // 1 evicts on every write; 12 holds a fraction of one fold's working set;
    // 100000 never evicts at all, so every stale entry survives to be read.
    for (const limit of [1, 12, 100000]) {
      // Guards against a vacuous pass: if nothing was ever dispatched the loop
      // compares a static graph to itself sixty times.
      expect(runMutationSequence(limit)).toBeGreaterThan(20);
    }
  });

  it("gives a removed node the same undefined a cold fold does", () => {
    // A cached entry for a node that has since been removed must not resurface.
    // The rev of an absent node reads as 0, so this is the one case where the
    // key's third component is not merely stale but naming a node that is gone.
    const engine = makeEngine({ foldCacheLimit: 1000 });
    const store = engine.createStore(loadGraphWith(engine, document));
    const victim = id("clip-0-0");

    expect(store.aggregate("duration", victim)).toBeDefined();
    expect(store.dispatch({ type: "remove-nodes", nodeIds: [victim] }).ok).toBe(true);

    expect(store.aggregate("duration", victim)).toBeUndefined();
    expect(engine.aggregate(store.getGraph(), "duration", victim)).toBeUndefined();

    // And undo brings back the same answer the cold path gives.
    expect(store.undo().ok).toBe(true);
    expect(store.aggregate("duration", victim)).toEqual(
      engine.aggregate(store.getGraph(), "duration", victim),
    );
  });
});
