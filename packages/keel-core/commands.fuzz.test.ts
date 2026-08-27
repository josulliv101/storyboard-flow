// Adversarial property fuzz over KEEL's mutation core.
//
// Every other test in this package is an AUTHOR-CHOSEN case: someone thought of
// a situation and wrote it down. That is the wrong shape of evidence for the
// claims this engine actually makes — "no accepted command can produce an
// invalid graph", "every patch inverts", "undo to any depth is identity" are
// statements about ALL inputs, and a hand-written case can only ever witness
// one. This file is the other half: random commands, most of them illegal, run
// against graphs that EVOLVE across steps so later commands act on arbitrary
// reachable states rather than on a fixture someone curated.
//
// The properties asserted here:
//
//   1. every accepted command yields a graph with NO invariant violation;
//   2. its patch round-trips — apply the inverse and the graph is structurally
//      the ORIGINAL, re-apply the patch and it is the post-state again;
//   3. a rejected command leaves the graph completely untouched, and so does an
//      accepted one (the input value is persistent, never mutated in place);
//   4. undo/redo to arbitrary depth and back is identity;
//   5. the four children states hold across load/markMissing sequences, and
//      loading is monotone;
//   6. quarantined nodes survive arbitrary structural churn and still re-emit
//      their original bytes.
//
// SEEDED. Every run of a given seed produces the same command sequence, so a
// failure is reproducible rather than a story about a run that once happened.
// Every property is wrapped so a failure prints the SEED and the full command
// journal that led to it — a raw `expect` diff on step 87 of a random walk is
// not a bug report.
//
// FIXTURES COME THROUGH THE REAL INGRESS. Graphs are built by
// `deserializeDocument` on generated wire documents rather than by a local
// node-assembler, so quarantine arises the way it does in production (an
// unregistered kind, data its own codec refuses) instead of being hand-planted
// — and the ingress door is fuzzed along with the reducer.

import { describe, expect, test } from "vitest";

import {
  defineNodeType,
  parseNodeId,
  type AnyNode,
  type ChildrenState,
  type Command,
  type EditOf,
  type EngineContext,
  type Graph,
  type HistoryEntry,
  type Issue,
  type NodeId,
  type Patch,
  type Rejection,
  type RejectionCode,
  type Result,
  type Seed,
  type SerializedDocument,
  type SerializedNode,
  type SummaryCodec,
} from "./types";
import {
  ancestorChain,
  buildRegistry,
  childrenStateOf,
  findInvariantViolation,
  getSubtreeRev,
  markMissing,
} from "./graph";
import { applyCommand } from "./commands";
import { applyPatch, invertPatch, verifyPatchApplies } from "./patches";
import { canRedo, canUndo, commitRedo, commitUndo, createHistory, pushHistory } from "./history";
import { deserializeDocument, loadChildrenInto, serializeGraph } from "./serialize";

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/**
 * mulberry32 — 32 bits of state, uniform enough for structure selection, and
 * (the only property that matters here) EXACTLY reproducible. `Math.random`
 * would make every failure a one-off anecdote.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seeds every property runs over. Deterministic, so a green run is green
 *  forever and a red one is red on every machine. */
const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6];

function randFor(seed: number): () => number {
  // A raw seed of 1..6 leaves mulberry32's early output visibly correlated
  // across seeds (the states differ by a constant), which would make six seeds
  // explore nearly one walk. Multiplying by a large odd constant decorrelates
  // them.
  return mulberry32(Math.imul(seed, 0x9e3779b1));
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const chosen = items[Math.floor(rand() * items.length)];
  // A generator that silently picked `undefined` would report a property
  // failure against a value it never actually chose. Fail as what it is: a bug
  // in this file, not in the engine.
  if (chosen === undefined) throw new Error("fuzz generator: pick() was given an empty list");
  return chosen;
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`fuzz harness: index ${index} is outside a ${items.length}-element list`);
  }
  return value;
}

/**
 * Re-throw with the seed and the full journal attached.
 *
 * The journal array is passed by reference and read at CATCH time, so it holds
 * every step up to and including the one that failed.
 */
function traced<T>(seed: number, journal: readonly string[], run: () => T): T {
  try {
    return run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const steps = journal.map((line, index) => `  [${index}] ${line}`).join("\n");
    throw new Error(
      `FUZZ FAILURE — reproduce with SEED ${seed}\n` +
        `command sequence (${journal.length} step(s)):\n${steps}\n\n${detail}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture node types
// ---------------------------------------------------------------------------

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string; seconds?: number }>;

/**
 * `parse` is deliberately STRICTER than `applyEdit`: it caps `seconds` at 100
 * while `applyEdit` does not. That asymmetry is the only way the fuzz reaches
 * the "the edit produced a value that no longer parses" branch without the
 * codec refusing the edit itself, and both branches are rejection paths the
 * property covers.
 */
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
    const seconds = record["seconds"];
    if (typeof title !== "string" || title.trim() === "") {
      return { ok: false, error: [{ path: "$.title", message: "title required" }] };
    }
    if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds < 0) {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds >= 0" }] };
    }
    if (seconds > 100) {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds <= 100" }] };
    }
    return { ok: true, value: { title: title.trim(), seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    const title = edit.title ?? data.title;
    if (title === "") {
      return { ok: false, error: { code: "empty-title", message: "title cannot be empty" } };
    }
    return { ok: true, value: { title, seconds: edit.seconds ?? data.seconds } };
  },
  contentKey(data): string | null {
    return `asset:${data.title}`;
  },
});

type Folder = Readonly<{ name: string; source: string | null }>;
type FolderEdit = Readonly<{ name?: string; source?: string | null }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    const source = record["source"];
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: [{ path: "$.name", message: "name required" }] };
    }
    if (source !== undefined && source !== null && typeof source !== "string") {
      return { ok: false, error: [{ path: "$.source", message: "source must be a string" }] };
    }
    return { ok: true, value: { name: name.trim(), source: source ?? null } };
  },
  serialize(data): unknown {
    return { name: data.name, source: data.source };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: {
        name: edit.name ?? data.name,
        source: edit.source === undefined ? data.source : edit.source,
      },
    };
  },
  contentKey(data): string | null {
    return `folder:${data.name}`;
  },
  /** Enables the single-owner rule, which is one of the rejection paths the
   *  generator deliberately aims at (`duplicate-owner`). */
  sourceKey(data): string | null {
    return data.source;
  },
});

const nodeTypes = [clipType, folderType] as const;
type Types = typeof nodeTypes;
type Summary = Readonly<{ label: string }>;

const summaryCodec: SummaryCodec<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const label = record["label"];
    if (typeof label !== "string") {
      return { ok: false, error: [{ path: "$.label", message: "label required" }] };
    }
    return { ok: true, value: { label } };
  },
  serialize(summary): unknown {
    return { label: summary.label };
  },
};

const registry = buildRegistry(nodeTypes);

/** The kind no build has ever heard of — the `unknown-kind` quarantine door. */
const MYSTERY_KIND = "mystery";
/** Declared on the wire so a quarantined mystery node carries a real version
 *  through the round-trip instead of the 0 an undeclared kind would get. */
const MYSTERY_SCHEMA_VERSION = 3;

type FuzzGraph = Graph<Types, Summary>;
type FuzzNode = AnyNode<Types, Summary>;
type FuzzCommand = Command<Types, Summary>;
type FuzzPatch = Patch<Types, Summary>;
type FuzzSeed = Seed<Types, Summary>;
type Ctx = EngineContext<Summary>;

function makeCtx(): Ctx {
  let minted = 0;
  return {
    engineId: Symbol("keel-fuzz"),
    registry,
    summary: summaryCodec,
    onUnknownKind: "quarantine",
    onParseFailure: "quarantine",
    mintId: () => {
      minted += 1;
      // Never reused, and disjoint from every generated document id — so a
      // "node-exists" replay rejection can only ever mean a real bug, not id
      // recycling by the harness.
      return `mint-${minted}`;
    },
    now: () => 1_700_000_000_000,
    devChecks: false,
  };
}

// ---------------------------------------------------------------------------
// Random wire documents — the fixtures, built through the real ingress
// ---------------------------------------------------------------------------

type IdMinter = Readonly<{ next: () => string }>;

function makeIdMinter(prefix: string): IdMinter {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${prefix}-${n}`;
    },
  };
}

type GeneratedDocument = Readonly<{
  document: SerializedDocument;
  nodeCount: number;
  /** Ids the generator expects to land as `QuarantinedNode`s, with the exact
   *  wire `data` they must re-emit. */
  quarantined: ReadonlyMap<string, unknown>;
}>;

/**
 * A structurally VALID document with adversarial CONTENT.
 *
 * Validity is deliberate: the structural error paths (dangling child,
 * multi-parent, unreachable node) belong to `serialize.test.ts`, which can
 * name the exact malformation it means. What this generator varies is the
 * shape the rest of the fuzz has to survive — all four children states, both
 * quarantine reasons, quarantined containers as well as leaves, and nesting.
 *
 * Recursion is fine here: the trees are authored by this file and depth-capped.
 * The engine's own walks use explicit stacks because THEIR depth is input.
 */
function randomDocument(
  rand: () => number,
  ids: IdMinter,
  options: Readonly<{ rootCount: number; maxDepth: number }>,
): GeneratedDocument {
  const nodes: SerializedNode[] = [];
  const quarantined = new Map<string, unknown>();

  const folderData = (id: string): Readonly<{ name: string; source: string | null }> => ({
    name: `folder ${id}`,
    // Derived from the id, so no two OWNING placements can collide at ingest.
    // The `duplicate-owner` rejection is reached later, on purpose, by seeds
    // and edits that reuse a key the graph already owns.
    source: rand() < 0.5 ? `src-${id}` : null,
  });

  const emit = (depth: number): string => {
    const id = ids.next();
    const roll = rand();

    if (depth > 0 && roll < 0.34) {
      const childCount = Math.floor(rand() * 4);
      const children: string[] = [];
      for (let i = 0; i < childCount; i += 1) children.push(emit(depth - 1));
      const summary = rand() < 0.4 ? { label: `sum-${id}` } : null;
      nodes.push(
        summary === null
          ? { id, kind: "folder", data: folderData(id), children }
          : { id, kind: "folder", data: folderData(id), children, summary },
      );
      return id;
    }
    if (roll < 0.34) {
      nodes.push({ id, kind: "folder", data: folderData(id), childrenState: "unloaded" });
      return id;
    }
    if (roll < 0.40) {
      // A `reference` owns nothing, so it may legally share a source key with
      // an owner — but it is structurally childless FOREVER, which is what
      // keeps the placement forest a tree.
      nodes.push({ id, kind: "folder", data: folderData(id), childrenState: "reference" });
      return id;
    }
    if (roll < 0.46) {
      nodes.push({
        id,
        kind: "folder",
        data: folderData(id),
        childrenState: "missing",
        missingReason: `gone-${id}`,
      });
      return id;
    }
    if (roll < 0.54) {
      // Unregistered kind WITH children on the wire ⇒ a quarantined CONTAINER
      // whose subtree stays addressable. Distinctive nested bytes so a lossy
      // re-emit cannot hide behind a scalar comparison.
      const childCount = depth > 0 ? Math.floor(rand() * 3) : 0;
      const children: string[] = [];
      for (let i = 0; i < childCount; i += 1) children.push(emit(depth - 1));
      const data = { blob: [1, 2, 3], nested: { deep: true, tag: id }, note: null };
      nodes.push({ id, kind: MYSTERY_KIND, data, children });
      quarantined.set(id, data);
      return id;
    }
    if (roll < 0.60) {
      const data = { unknownShape: `leaf-${id}`, list: [id, null, 7] };
      nodes.push({ id, kind: MYSTERY_KIND, data });
      quarantined.set(id, data);
      return id;
    }
    if (roll < 0.66) {
      // Registered kind, data its own codec refuses ⇒ `parse-failed`
      // quarantine. Byte-exact re-emit is the same promise either way.
      const data = { title: 42, seconds: "nope" };
      nodes.push({ id, kind: "clip", data });
      quarantined.set(id, data);
      return id;
    }
    nodes.push({
      id,
      kind: "clip",
      data: { title: `clip ${id}`, seconds: Math.floor(rand() * 60) },
    });
    return id;
  };

  const rootIds: string[] = [];
  for (let r = 0; r < options.rootCount; r += 1) {
    const id = ids.next();
    // At least three. A root with one leaf child produces a four-node graph in
    // which almost every generated command is refused for a structural reason,
    // and the walk never gets far enough to test anything — measured: one seed
    // accepted three commands out of forty.
    const childCount = 3 + Math.floor(rand() * 4);
    const children: string[] = [];
    for (let i = 0; i < childCount; i += 1) children.push(emit(options.maxDepth));
    // Roots must be containers for a whole-document load, and a registered
    // container kind keeps the root itself out of quarantine so the fuzz
    // always has a legal drop target to start from.
    nodes.push({ id, kind: "folder", data: { name: `root ${id}`, source: `src-${id}` }, children });
    rootIds.push(id);
  }

  return {
    document: {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1, [MYSTERY_KIND]: MYSTERY_SCHEMA_VERSION },
      rootIds,
      nodes,
    },
    nodeCount: nodes.length,
    quarantined,
  };
}

/** A sub-document for `loadChildrenInto`. Its roots need NOT be containers. */
function randomPayload(rand: () => number, ids: IdMinter): GeneratedDocument {
  const nodes: SerializedNode[] = [];
  const quarantined = new Map<string, unknown>();
  const rootIds: string[] = [];
  const count = 1 + Math.floor(rand() * 3);

  for (let i = 0; i < count; i += 1) {
    const id = ids.next();
    const roll = rand();
    if (roll < 0.25) {
      const data = { payloadBlob: id, arr: [1, null, "x"] };
      nodes.push({ id, kind: MYSTERY_KIND, data });
      quarantined.set(id, data);
    } else if (roll < 0.58) {
      // Payloads REPLENISH the unloaded pool on purpose. Loads and
      // `markMissing` both consume it, and a fixture's own ~8% share is
      // exhausted within a few dozen steps — measured: six accepted loads
      // across a whole run, which is one generator tweak away from zero.
      nodes.push({
        id,
        kind: "folder",
        data: { name: `lazy ${id}`, source: `src-${id}` },
        childrenState: "unloaded",
      });
    } else if (roll < 0.70) {
      nodes.push({ id, kind: "folder", data: { name: `box ${id}`, source: null }, children: [] });
    } else {
      nodes.push({
        id,
        kind: "clip",
        data: { title: `payload ${id}`, seconds: Math.floor(rand() * 20) },
      });
    }
    rootIds.push(id);
  }

  return {
    document: {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1, [MYSTERY_KIND]: MYSTERY_SCHEMA_VERSION },
      rootIds,
      nodes,
    },
    nodeCount: nodes.length,
    quarantined,
  };
}

function loadFixture(rand: () => number, ids: IdMinter, ctx: Ctx): FuzzGraph {
  const generated = randomDocument(rand, ids, {
    rootCount: 1 + Math.floor(rand() * 2),
    maxDepth: 3,
  });
  const built = deserializeDocument<Types, Summary>(generated.document, ctx);
  if (!built.ok) {
    // A fixture the ingress refuses is a bug in THIS file. Say so, rather than
    // letting it surface later as a mysterious property failure.
    throw new Error(
      `fuzz generator produced an unloadable document: ${built.error.code} — ${built.error.message}`,
    );
  }
  return built.value.graph;
}

// ---------------------------------------------------------------------------
// Structural shape — the comparison the round-trip properties are stated in
// ---------------------------------------------------------------------------

/**
 * `subtreeRevById` is DELIBERATELY ABSENT from the shape.
 *
 * Revisions are monotone counters: undo does not rewind them, it bumps them
 * forward again, because every ancestor's rollup genuinely changed meaning a
 * second time. Asserting revision equality across an undo would assert a
 * property the engine does not have and should not have — the render
 * subscription must fire on the way back too. `markMissing`'s own test below
 * checks the bumps directly, which is where that behaviour belongs.
 */
type NodeShape = Readonly<{
  id: string;
  kind: string;
  quarantined: boolean;
  container: boolean;
  childrenState: string | null;
  childIds: readonly string[] | null;
  data: string;
  summary: string;
  parent: string | null;
  quarantine: string | null;
}>;

type GraphShape = Readonly<{
  rootIds: readonly string[];
  nodes: readonly NodeShape[];
  childrenIndex: readonly (readonly [string, readonly string[]])[];
  parents: readonly (readonly [string, string | null])[];
  placements: readonly (readonly [string, readonly string[]])[];
  owners: readonly (readonly [string, string])[];
}>;

/** Wrapped so `undefined` and absence are both representable — a bare
 *  `JSON.stringify(undefined)` returns `undefined`, not a string. */
function stableJson(value: unknown): string {
  return JSON.stringify({ v: value });
}

function stateLabel(state: ChildrenState | null): string | null {
  if (state === null) return null;
  return state.status === "missing" ? `missing:${state.reason}` : state.status;
}

function nodeDataJson(node: FuzzNode): string {
  if (node.quarantined) return stableJson(node.raw);
  const type = registry.get(node.kind);
  // Compared on the SERIALIZED form for the same reason `verifyDataChanged`
  // does: a parsed value may carry identity its codec does not consider
  // meaningful, and the wire form is the codec's own statement of what the
  // value IS.
  return stableJson(type === undefined ? node.data : type.serialize(node.data));
}

function nodeSummaryJson(node: FuzzNode): string {
  if (node.quarantined) return stableJson(node.summary);
  if (!node.container) return "leaf";
  return node.summary === null ? "null" : stableJson(summaryCodec.serialize(node.summary));
}

function graphShape(graph: FuzzGraph): GraphShape {
  const ids = [...graph.nodesById.keys()].sort();
  const nodes: NodeShape[] = [];
  for (const id of ids) {
    const node = graph.nodesById.get(id);
    if (node === undefined) continue; // Unreachable: `id` came from this map.
    const childIds = graph.childrenById.get(id);
    nodes.push({
      id,
      kind: node.kind,
      quarantined: node.quarantined,
      container: node.container,
      childrenState: stateLabel(childrenStateOf(graph, id)),
      // `null` vs `[]` is the distinction the whole four-state design exists
      // for; collapsing them here would blind every round-trip assertion to it.
      childIds: childIds === undefined ? null : [...childIds],
      data: nodeDataJson(node),
      summary: nodeSummaryJson(node),
      parent: graph.parentById.get(id) ?? null,
      quarantine: node.quarantined ? `${node.reason}@${node.schemaVersion}` : null,
    });
  }

  const childrenIndex = [...graph.childrenById.entries()]
    .map(([id, kids]): readonly [string, readonly string[]] => [id, [...kids]])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const parents = [...graph.parentById.entries()]
    .map(([id, parent]): readonly [string, string | null] => [id, parent])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const placements = [...graph.placementsByContentKey.entries()]
    .map(([key, list]): readonly [string, readonly string[]] => [key, [...list]])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const owners = [...graph.ownerBySourceKey.entries()]
    .map(([key, owner]): readonly [string, string] => [key, owner])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return { rootIds: [...graph.rootIds], nodes, childrenIndex, parents, placements, owners };
}

function expectValid(graph: FuzzGraph, label: string): void {
  const violation = findInvariantViolation(graph, registry);
  if (violation !== null) {
    throw new Error(
      `${label}: invariant violation ${violation.code} — ${violation.message}` +
        (violation.nodeId === undefined ? "" : ` (node ${violation.nodeId})`),
    );
  }
}

// ---------------------------------------------------------------------------
// Random commands — mostly illegal, on purpose
// ---------------------------------------------------------------------------

type Labelled = Readonly<{ command: FuzzCommand; label: string }>;

function nodeIdList(ids: readonly NodeId[]): string {
  return `[${ids.join(",")}]`;
}

function randomSeed(rand: () => number, graph: FuzzGraph, depth: number): FuzzSeed {
  const roll = rand();

  if (roll < 0.40) {
    return {
      kind: "clip",
      data: { title: `c${Math.floor(rand() * 10000)}`, seconds: Math.floor(rand() * 40) },
    };
  }
  if (roll < 0.48) {
    // Data the kind's own `parse` refuses. A consumer CAN write this — `data`
    // is typed but a negative number is still a number — so the engine has to
    // catch it at the same door as wire data.
    return { kind: "clip", data: { title: "   ", seconds: -1 } };
  }
  if (roll < 0.54) {
    // `seconds` above the parse cap: legal to the type, refused by the codec.
    return { kind: "clip", data: { title: "too long", seconds: 500 } };
  }
  if (roll < 0.60) {
    // A LEAF seed carrying children. The `leaf-seed-with-children` rejection
    // exists only because a consumer can write exactly this.
    return {
      kind: "clip",
      data: { title: "leafy", seconds: 3 },
      children: [{ kind: "clip", data: { title: "kid", seconds: 1 } }],
    };
  }

  const children: FuzzSeed[] = [];
  if (depth > 0) {
    const count = Math.floor(rand() * 3);
    for (let i = 0; i < count; i += 1) children.push(randomSeed(rand, graph, depth - 1));
  }
  const owned = [...graph.ownerBySourceKey.keys()];
  const source =
    owned.length > 0 && rand() < 0.3
      ? // A key the graph ALREADY owns — the `duplicate-owner` path, which is
        // the invariant that stops two placements claiming one stored subtree.
        pick(rand, owned)
      : rand() < 0.6
        ? `seed-src-${Math.floor(rand() * 100000)}`
        : null;
  const summary = rand() < 0.3 ? { label: `seed-${Math.floor(rand() * 1000)}` } : null;
  return {
    kind: "folder",
    data: { name: `f${Math.floor(rand() * 10000)}`, source },
    children,
    summary,
  };
}

function randomEdit(rand: () => number, graph: FuzzGraph, nodeId: NodeId): EditOf<Types> {
  const node = graph.nodesById.get(nodeId);
  const matchesNode = node !== undefined && !node.quarantined && rand() < 0.8;
  const asClip = matchesNode ? node.kind === "clip" : rand() < 0.5;

  if (asClip) {
    const roll = rand();
    if (roll < 0.15) {
      // The codec's own refusal — relayed as `edit-rejected`.
      return { nodeId, kind: "clip", edit: { title: "" } };
    }
    if (roll < 0.30) {
      // Accepted by `applyEdit`, refused by `parse` on the way back in.
      return { nodeId, kind: "clip", edit: { seconds: 500 } };
    }
    return {
      nodeId,
      kind: "clip",
      edit: { title: `e${Math.floor(rand() * 10000)}`, seconds: Math.floor(rand() * 60) },
    };
  }

  const owned = [...graph.ownerBySourceKey.keys()];
  const source =
    owned.length > 0 && rand() < 0.35
      ? pick(rand, owned)
      : rand() < 0.5
        ? `edit-src-${Math.floor(rand() * 100000)}`
        : null;
  return { nodeId, kind: "folder", edit: { name: `n${Math.floor(rand() * 10000)}`, source } };
}

/**
 * A drop target: USUALLY a legal one, sometimes anything at all.
 *
 * Both halves are load-bearing and the balance was measured, not guessed. Drawn
 * purely uniformly, the accept rate collapses — most ids are leaves or
 * non-loaded containers, so the walk spends its steps being refused and stops
 * evolving the graph, which is the one thing this fuzz is for. Drawn purely
 * legally, it never reaches `not-a-container`, `target-not-loaded` or
 * `would-create-cycle`, and those rejection paths are exactly where "a rejected
 * command leaves the graph untouched" has teeth.
 */
/** An id no graph has ever held. The `unknown-node` / `unknown-parent`
 *  rejections are unreachable without one, and they are the two the engine
 *  answers most often in practice (a stale selection, a re-sent command). */
function absentId(rand: () => number): NodeId {
  return parseNodeId(`absent-${Math.floor(rand() * 1000000)}`);
}

function pickTarget(rand: () => number, graph: FuzzGraph, allIds: readonly NodeId[]): NodeId {
  if (rand() < 0.04) return absentId(rand);
  if (rand() < 0.65) {
    const loadedContainers = allIds.filter(
      (id) => childrenStateOf(graph, id)?.status === "loaded",
    );
    if (loadedContainers.length > 0) return pick(rand, loadedContainers);
  }
  return pick(rand, allIds);
}

/** Usually a non-root — a root payload is always refused, and a walk made only
 *  of refusals never reaches an interesting state. */
function pickPayload(rand: () => number, graph: FuzzGraph, allIds: readonly NodeId[]): NodeId {
  if (rand() < 0.04) return absentId(rand);
  if (rand() < 0.7) {
    const nonRoots = allIds.filter((id) => {
      // `parentById` is TOTAL, and a root's entry is an explicit `null` rather
      // than an absent key — so `has` and `get` answer different questions and
      // only the value can distinguish a root here.
      const parent = graph.parentById.get(id);
      return parent !== null && parent !== undefined;
    });
    if (nonRoots.length > 0) return pick(rand, nonRoots);
  }
  return pick(rand, allIds);
}

/** Usually in range for the target, sometimes deliberately outside it
 *  (including negative — `index-out-of-range` has two sides). */
function pickIndex(rand: () => number, graph: FuzzGraph, targetId: NodeId): number {
  const length = graph.childrenById.get(targetId)?.length ?? 0;
  if (rand() < 0.6) return Math.floor(rand() * (length + 1));
  return Math.floor(rand() * 6) - 1;
}

function randomCommand(rand: () => number, graph: FuzzGraph): Labelled {
  const allIds = [...graph.nodesById.keys()];
  const roll = rand();

  if (roll < 0.05) {
    // The empty forms. A no-op patch has no honest inverse, so the engine
    // refuses rather than recording one.
    const empty = rand();
    if (empty < 0.34) {
      return {
        command: { type: "move-nodes", nodeIds: [], toParentId: pick(rand, allIds), toIndex: 0 },
        label: "move-nodes [] (empty)",
      };
    }
    if (empty < 0.67) {
      return {
        command: { type: "insert-nodes", seeds: [], toParentId: pick(rand, allIds), toIndex: 0 },
        label: "insert-nodes [] (empty)",
      };
    }
    return { command: { type: "edit-nodes", edits: [] }, label: "edit-nodes [] (empty)" };
  }

  if (roll < 0.38) {
    const count = 1 + Math.floor(rand() * 3);
    const nodeIds: NodeId[] = [];
    for (let i = 0; i < count; i += 1) nodeIds.push(pickPayload(rand, graph, allIds));
    const toParentId = pickTarget(rand, graph, allIds);
    const toIndex = pickIndex(rand, graph, toParentId);
    return {
      command: { type: "move-nodes", nodeIds, toParentId, toIndex },
      label: `move-nodes ${nodeIdList(nodeIds)} -> ${toParentId}@${toIndex}`,
    };
  }

  if (roll < 0.68) {
    // Inserts outweigh removals on purpose. A removal takes a whole subtree
    // while a seed batch adds one or two nodes, so an even split drains the
    // graph down to bare roots within a few dozen steps and the walk stops
    // exploring anything but `cannot-remove-root`.
    const count = 1 + Math.floor(rand() * 2);
    const seeds: FuzzSeed[] = [];
    for (let i = 0; i < count; i += 1) seeds.push(randomSeed(rand, graph, 2));
    const toParentId = pickTarget(rand, graph, allIds);
    const toIndex = pickIndex(rand, graph, toParentId);
    return {
      command: { type: "insert-nodes", seeds, toParentId, toIndex },
      label: `insert-nodes ${seeds.length} seed(s) -> ${toParentId}@${toIndex}`,
    };
  }

  if (roll < 0.83) {
    const count = 1 + Math.floor(rand() * 3);
    const nodeIds: NodeId[] = [];
    for (let i = 0; i < count; i += 1) nodeIds.push(pickPayload(rand, graph, allIds));
    const allowUnloaded = rand() < 0.5;
    return {
      command: { type: "remove-nodes", nodeIds, allowUnloaded },
      label: `remove-nodes ${nodeIdList(nodeIds)} allowUnloaded=${allowUnloaded}`,
    };
  }

  const count = 1 + Math.floor(rand() * 2);
  const edits: EditOf<Types>[] = [];
  for (let i = 0; i < count; i += 1) {
    edits.push(randomEdit(rand, graph, pickPayload(rand, graph, allIds)));
  }
  return {
    command: { type: "edit-nodes", edits },
    label: `edit-nodes [${edits.map((e) => `${e.nodeId}:${e.kind}`).join(",")}]`,
  };
}

// ---------------------------------------------------------------------------
// Property 1 — accepted commands are valid, and their patches round-trip
// ---------------------------------------------------------------------------

describe("fuzz: command -> patch -> inverse", () => {
  test("random command sequences preserve invariants, invert cleanly, and never mutate the input graph", () => {
    const acceptedByType = new Map<string, number>();
    const rejectionCodes = new Set<RejectionCode>();
    let accepted = 0;
    let rejected = 0;

    for (const seed of SEEDS) {
      const rand = randFor(seed);
      const ctx = makeCtx();
      const ids = makeIdMinter(`s${seed}`);
      const journal: string[] = [];
      let graph = loadFixture(rand, ids, ctx);

      traced(seed, journal, () => {
        expectValid(graph, "fixture");

        for (let step = 0; step < 120; step += 1) {
          const { command, label } = randomCommand(rand, graph);
          const before = graphShape(graph);
          const result = applyCommand<Types, Summary>(graph, command, ctx);

          // The input graph is a PERSISTENT value. This holds on BOTH branches
          // and is asserted on both: a reducer that mutated a shared map in
          // place would still return a correct-looking new graph, and only the
          // untouched-input check would catch it. It is also, on the rejection
          // branch, the "a rejected command is identity" property.
          expect(graphShape(graph)).toEqual(before);

          if (!result.ok) {
            journal.push(`${label} => reject:${result.error.code}`);
            rejected += 1;
            rejectionCodes.add(result.error.code);
            continue;
          }

          journal.push(`${label} => ok`);
          accepted += 1;
          acceptedByType.set(command.type, (acceptedByType.get(command.type) ?? 0) + 1);

          const next = result.value.graph;
          const patch: FuzzPatch = result.value.patch;
          expectValid(next, "post-command graph");

          // The inverse must be applicable IMMEDIATELY. If it is not, undo is
          // broken for this command the moment it lands, before any dormancy
          // is involved.
          const inverse = invertPatch(patch);
          const undoGate = verifyPatchApplies(next, inverse, ctx);
          if (!undoGate.ok) {
            throw new Error(
              `inverse of a just-applied ${command.type} does not verify: ` +
                `${undoGate.error.code} — ${undoGate.error.message}`,
            );
          }

          const undone = applyPatch(next, inverse, ctx);
          expectValid(undone, "undone graph");
          expect(graphShape(undone)).toEqual(before);

          const redoGate = verifyPatchApplies(undone, patch, ctx);
          if (!redoGate.ok) {
            throw new Error(
              `re-applying a ${command.type} patch to the undone graph does not verify: ` +
                `${redoGate.error.code} — ${redoGate.error.message}`,
            );
          }
          const redone = applyPatch(undone, patch, ctx);
          expectValid(redone, "redone graph");
          expect(graphShape(redone)).toEqual(graphShape(next));

          // EVOLVE. Later steps then run against arbitrary reachable states
          // rather than against six fixed fixtures.
          graph = next;
        }
      });
    }

    // ANTI-VACUITY. A fuzz where nothing is accepted proves only that the
    // reducer can say no; a fuzz where nothing is rejected never exercises the
    // identity property. Neither failure announces itself — the suite stays
    // green — so the coverage the walk actually reached is asserted here.
    //
    // Measured on these six seeds: 224 accepted (move 53, remove 62, insert 59,
    // edit 50), 496 rejected, 17 distinct rejection codes. The bounds sit at
    // roughly half of each, so ordinary generator tuning does not trip them but
    // a change that silently stops reaching a whole path does. Everything here
    // is seeded, so these are exact facts about this file, not flaky averages.
    expect(accepted).toBeGreaterThan(150);
    expect(rejected).toBeGreaterThan(300);
    for (const type of ["move-nodes", "insert-nodes", "remove-nodes", "edit-nodes"]) {
      expect(acceptedByType.get(type) ?? 0).toBeGreaterThan(20);
    }
    // 17 of the 20 `RejectionCode`s. The three never reached from here, and
    // where each IS covered — checked, not assumed:
    //   `foreign-graph`   needs a second engine instance — commands.test.ts
    //   `unknown-kind`    needs a seed naming a kind outside the registry,
    //                     which the `Seed` type forbids — commands.test.ts
    //   `policy-rejected` raised by the engine wrapper's pre-commit veto, never
    //                     by the reducer this file drives — engine.test.ts
    expect(rejectionCodes.size).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// Property 2 — undo/redo to arbitrary depth and back is identity
// ---------------------------------------------------------------------------

describe("fuzz: undo/redo to arbitrary depth", () => {
  test("a full LIFO unwind restores every earlier graph, and redo replays them exactly", () => {
    for (const seed of SEEDS) {
      const rand = randFor(seed);
      const ctx = makeCtx();
      const ids = makeIdMinter(`u${seed}`);
      const journal: string[] = [];
      let graph = loadFixture(rand, ids, ctx);
      let history = createHistory<Types, Summary>();
      // shapes[i] is the graph after i accepted commands.
      const shapes: GraphShape[] = [graphShape(graph)];
      /**
       * The shallowest depth whose recorded shape is still comparable.
       *
       * A load produces NO PATCH — loading is monotone and v1 has no `unload` —
       * so undo cannot take one back. Every shape recorded BEFORE a load is
       * therefore permanently unreachable by undo, and comparing against it
       * would be asserting a property the engine deliberately does not have.
       * Undo still runs past this floor (the LIFO order, the `verifyPatchApplies`
       * gate and the invariants are all checked at every depth); only the
       * exact-shape comparison stops.
       */
      let shapeFloor = 0;

      traced(seed, journal, () => {
        for (let step = 0; step < 60; step += 1) {
          // Loads are interleaved so history entries go DORMANT across a graph
          // that grew underneath them — the exact condition `verifyPatchApplies`
          // exists for, and the one the predecessor reproduced two corruptions
          // from omitting.
          if (rand() < 0.12) {
            const unloaded = [...graph.nodesById.keys()].filter(
              (id) => childrenStateOf(graph, id)?.status === "unloaded",
            );
            if (unloaded.length > 0) {
              const targetId = pick(rand, unloaded);
              const payload = randomPayload(rand, ids);
              const loaded = loadChildrenInto<Types, Summary>(
                graph,
                targetId,
                payload.document,
                ctx,
              );
              if (loaded.ok) {
                journal.push(`load ${targetId} <- ${payload.nodeCount} node(s) => ok`);
                graph = loaded.value;
                expectValid(graph, "post-load graph");
                // Every shape recorded so far predates these nodes.
                shapeFloor = shapes.length - 1;
                shapes[shapeFloor] = graphShape(graph);
              } else {
                journal.push(`load ${targetId} => reject:${loaded.error.code}`);
              }
              continue;
            }
          }

          const { command, label } = randomCommand(rand, graph);
          const result = applyCommand<Types, Summary>(graph, command, ctx);
          if (!result.ok) {
            journal.push(`${label} => reject:${result.error.code}`);
            continue;
          }
          journal.push(`${label} => ok`);
          graph = result.value.graph;
          expectValid(graph, "post-command graph");
          const entry: HistoryEntry<Types, Summary> = {
            command,
            patch: result.value.patch,
            at: ctx.now(),
          };
          history = pushHistory(history, entry);
          shapes.push(graphShape(graph));
        }

        // A stack of one is not a depth test.
        expect(history.past.length).toBeGreaterThan(5);
        expect(shapes.length).toBe(history.past.length + 1);

        // --- Unwind, all the way to the fixture ------------------------------
        let depth = history.past.length;
        while (canUndo(history)) {
          const step = commitUndo(history);
          if (step === null) throw new Error("canUndo was true but commitUndo returned null");
          const inverse = invertPatch(step.entry.patch);
          const gate = verifyPatchApplies(graph, inverse, ctx);
          if (!gate.ok) {
            throw new Error(
              `undo at depth ${depth} refused: ${gate.error.code} — ${gate.error.message}`,
            );
          }
          graph = applyPatch(graph, inverse, ctx);
          history = step.history;
          depth -= 1;
          expectValid(graph, `undo to depth ${depth}`);
          // The graph after undoing back to depth N must BE the graph that
          // existed after N commands. Structural, not referential: undo
          // reconstructs nodes for a data change rather than restoring the old
          // object.
          if (depth >= shapeFloor) expect(graphShape(graph)).toEqual(at(shapes, depth));
        }
        expect(depth).toBe(0);
        expect(canUndo(history)).toBe(false);

        // --- And all the way forward again -----------------------------------
        while (canRedo(history)) {
          const step = commitRedo(history);
          if (step === null) throw new Error("canRedo was true but commitRedo returned null");
          const gate = verifyPatchApplies(graph, step.entry.patch, ctx);
          if (!gate.ok) {
            throw new Error(
              `redo at depth ${depth} refused: ${gate.error.code} — ${gate.error.message}`,
            );
          }
          graph = applyPatch(graph, step.entry.patch, ctx);
          history = step.history;
          depth += 1;
          expectValid(graph, `redo to depth ${depth}`);
          if (depth >= shapeFloor) expect(graphShape(graph)).toEqual(at(shapes, depth));
        }
        expect(depth).toBe(shapes.length - 1);
        expect(canRedo(history)).toBe(false);
      });
    }
  });

  test("undo/redo of an arbitrary partial depth returns to the same graph", () => {
    for (const seed of SEEDS) {
      const rand = randFor(seed + 100);
      const ctx = makeCtx();
      const ids = makeIdMinter(`p${seed}`);
      const journal: string[] = [];
      let graph = loadFixture(rand, ids, ctx);
      let history = createHistory<Types, Summary>();

      traced(seed, journal, () => {
        for (let step = 0; step < 40; step += 1) {
          const { command, label } = randomCommand(rand, graph);
          const result = applyCommand<Types, Summary>(graph, command, ctx);
          if (!result.ok) {
            journal.push(`${label} => reject:${result.error.code}`);
            continue;
          }
          journal.push(`${label} => ok`);
          graph = result.value.graph;
          history = pushHistory(history, {
            command,
            patch: result.value.patch,
            at: ctx.now(),
          });
        }

        const settled = graphShape(graph);
        const stackDepth = history.past.length;
        expect(stackDepth).toBeGreaterThan(3);

        // A random partial depth, not "all of it" — a bug that only shows when
        // the redo branch is non-empty (redo must NOT clear it, and must not
        // coalesce) is invisible to a full unwind.
        const k = 1 + Math.floor(rand() * (stackDepth - 1));
        journal.push(`unwind ${k} of ${stackDepth}`);

        let working = graph;
        for (let i = 0; i < k; i += 1) {
          const step = commitUndo(history);
          if (step === null) throw new Error("commitUndo returned null mid-unwind");
          const inverse = invertPatch(step.entry.patch);
          const gate = verifyPatchApplies(working, inverse, ctx);
          if (!gate.ok) {
            throw new Error(`partial undo ${i} refused: ${gate.error.code} — ${gate.error.message}`);
          }
          working = applyPatch(working, inverse, ctx);
          history = step.history;
          expectValid(working, `partial undo ${i}`);
        }
        expect(history.future.length).toBe(k);

        for (let i = 0; i < k; i += 1) {
          const step = commitRedo(history);
          if (step === null) throw new Error("commitRedo returned null mid-replay");
          const gate = verifyPatchApplies(working, step.entry.patch, ctx);
          if (!gate.ok) {
            throw new Error(`partial redo ${i} refused: ${gate.error.code} — ${gate.error.message}`);
          }
          working = applyPatch(working, step.entry.patch, ctx);
          history = step.history;
          expectValid(working, `partial redo ${i}`);
        }

        expect(graphShape(working)).toEqual(settled);
        expect(history.past.length).toBe(stackDepth);
        expect(history.future.length).toBe(0);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Property 3 — the four children states, across load / markMissing sequences
// ---------------------------------------------------------------------------

describe("fuzz: four-state children invariants under load / markMissing", () => {
  test("loaded-ness and childrenById never drift, and loading is monotone", () => {
    let loadsAccepted = 0;
    let missingApplied = 0;
    let missingNoops = 0;

    for (const seed of SEEDS) {
      const rand = randFor(seed + 200);
      const ctx = makeCtx();
      const ids = makeIdMinter(`c${seed}`);
      const journal: string[] = [];
      let graph = loadFixture(rand, ids, ctx);

      traced(seed, journal, () => {
        /** Both directions of the rule, in one place: a node has a
         *  `childrenById` entry IF AND ONLY IF its state is `loaded`. */
        const expectStatesAgree = (g: FuzzGraph, label: string): void => {
          for (const id of g.nodesById.keys()) {
            const state = childrenStateOf(g, id);
            const hasEntry = g.childrenById.has(id);
            if (hasEntry !== (state !== null && state.status === "loaded")) {
              throw new Error(
                `${label}: node ${id} has childrenById entry=${hasEntry} but state=${
                  stateLabel(state) ?? "none"
                }`,
              );
            }
          }
        };

        expectValid(graph, "fixture");
        expectStatesAgree(graph, "fixture");

        for (let step = 0; step < 80; step += 1) {
          const previous = graph;
          const roll = rand();

          if (roll < 0.3) {
            // --- markMissing --------------------------------------------------
            const candidates = [...graph.nodesById.keys()];
            // Weighted toward the two states that actually CHANGE — `unloaded`
            // and `missing`. Drawn uniformly the sample is almost all no-ops
            // (measured: 117 no-ops to 6 applied), which tests the identity
            // branch thoroughly and the applied branch barely.
            const changeable = candidates.filter((id) => {
              const state = childrenStateOf(graph, id);
              return state !== null && (state.status === "unloaded" || state.status === "missing");
            });
            // An id the graph does not hold is one of the documented no-ops, so
            // it belongs in the sample too.
            const targetId =
              rand() < 0.08
                ? absentId(rand)
                : changeable.length > 0 && rand() < 0.5
                  ? pick(rand, changeable)
                  : pick(rand, candidates);
            const reason = rand() < 0.5 ? "storage-404" : `gone-${step}`;
            const stateBefore = childrenStateOf(graph, targetId);
            const next = markMissing<Types, Summary>(graph, targetId, reason);
            journal.push(
              `markMissing ${targetId} "${reason}" (was ${stateLabel(stateBefore) ?? "none"})`,
            );

            const isNoop =
              stateBefore === null ||
              stateBefore.status === "reference" ||
              stateBefore.status === "loaded" ||
              (stateBefore.status === "missing" && stateBefore.reason === reason);

            if (isNoop) {
              // Identity, not merely equality. A no-op that rebuilt the graph
              // would bump every subscriber for nothing.
              expect(next).toBe(graph);
              missingNoops += 1;
            } else {
              missingApplied += 1;
              expect(childrenStateOf(next, targetId)).toEqual({ status: "missing", reason });
              expect(next.childrenById.has(targetId)).toBe(false);
              expect(next.nodesById.size).toBe(graph.nodesById.size);
              // The one observable side effect besides the state: the target
              // AND every ancestor is bumped, because every ancestor's rollup
              // just changed meaning. A deep node whose ancestors did not bump
              // is the "rollup never re-renders" hole.
              expect(getSubtreeRev(next, targetId)).toBe(getSubtreeRev(graph, targetId) + 1);
              for (const ancestorId of ancestorChain(graph, targetId)) {
                expect(getSubtreeRev(next, ancestorId)).toBe(
                  getSubtreeRev(graph, ancestorId) + 1,
                );
              }
            }
            graph = next;
          } else if (roll < 0.55) {
            // --- loadChildrenInto ---------------------------------------------
            // Weighted toward an actually-loadable target. Drawn uniformly,
            // `unloaded` containers are rare enough that a whole run can finish
            // with ZERO accepted loads — measured, and the reason the
            // anti-vacuity counter below exists.
            const allIds = [...graph.nodesById.keys()];
            const unloaded = allIds.filter(
              (id) => childrenStateOf(graph, id)?.status === "unloaded",
            );
            const targetId =
              unloaded.length > 0 && rand() < 0.75 ? pick(rand, unloaded) : pick(rand, allIds);
            const stateBefore = childrenStateOf(graph, targetId);
            const collide = rand() < 0.15;
            const payload = randomPayload(rand, ids);
            const document: SerializedDocument = collide
              ? {
                  ...payload.document,
                  // Reuse an id the graph already holds. `id-collision` must
                  // refuse the whole payload — a partial merge would leave the
                  // graph holding two different nodes under one id.
                  nodes: payload.document.nodes.map((node, index) =>
                    index === 0 ? { ...node, id: targetId } : node,
                  ),
                  rootIds: payload.document.rootIds.map((id, index) =>
                    index === 0 ? targetId : id,
                  ),
                }
              : payload.document;

            const before = graphShape(graph);
            const loaded = loadChildrenInto<Types, Summary>(graph, targetId, document, ctx);
            journal.push(
              `load ${targetId} (was ${stateLabel(stateBefore) ?? "none"}${
                collide ? ", colliding" : ""
              }) => ${loaded.ok ? "ok" : `reject:${loaded.error.code}`}`,
            );

            if (!loaded.ok) {
              // A refusal must be total: nothing of the payload landed.
              expect(graphShape(graph)).toEqual(before);
              // And the code must be the one the PRE-STATE justifies. This is
              // the part a hand-written test cannot cover exhaustively.
              if (stateBefore === null) {
                expect(loaded.error.code).toBe("not-a-container");
              } else if (stateBefore.status !== "unloaded") {
                expect(loaded.error.code).toBe("target-not-unloaded");
              } else {
                expect(loaded.error.code).toBe("id-collision");
              }
            } else {
              loadsAccepted += 1;
              expect(stateBefore?.status).toBe("unloaded");
              expect(childrenStateOf(loaded.value, targetId)?.status).toBe("loaded");
              expect(loaded.value.childrenById.get(targetId)).toEqual(
                payload.document.rootIds,
              );
              expect(loaded.value.nodesById.size).toBe(
                graph.nodesById.size + payload.nodeCount,
              );
              // Nothing already resident may be displaced by a load.
              for (const id of graph.nodesById.keys()) {
                expect(loaded.value.nodesById.has(id)).toBe(true);
              }
              graph = loaded.value;
            }
          } else {
            // --- structural churn ---------------------------------------------
            const { command, label } = randomCommand(rand, graph);
            const result = applyCommand<Types, Summary>(graph, command, ctx);
            journal.push(`${label} => ${result.ok ? "ok" : `reject:${result.error.code}`}`);
            if (result.ok) graph = result.value.graph;
          }

          expectValid(graph, `step ${step}`);
          expectStatesAgree(graph, `step ${step}`);

          // LOADING IS MONOTONE IN V1 — the single property that makes dormant
          // history sound. A surviving node that was `loaded` must still be
          // `loaded`; nothing (not markMissing, not a command, not another
          // load) may demote it.
          for (const id of previous.nodesById.keys()) {
            if (!graph.nodesById.has(id)) continue; // removed by a command
            if (childrenStateOf(previous, id)?.status !== "loaded") continue;
            const after = childrenStateOf(graph, id);
            if (after?.status !== "loaded") {
              throw new Error(
                `step ${step}: node ${id} was loaded and is now ${stateLabel(after) ?? "none"} — ` +
                  `loading must be monotone`,
              );
            }
          }
        }
      });
    }

    // ANTI-VACUITY. Both branches of `markMissing` and the accepting branch of
    // `loadChildrenInto` all actually ran. Measured on these six seeds: 10
    // accepted loads, 27 applied `markMissing`s, 122 no-ops.
    expect(loadsAccepted).toBeGreaterThanOrEqual(5);
    expect(missingApplied).toBeGreaterThanOrEqual(10);
    expect(missingNoops).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// Property 4 — quarantine survives churn and re-emits its original bytes
// ---------------------------------------------------------------------------

describe("fuzz: quarantined nodes under structural churn", () => {
  test("a quarantined node keeps its bytes through moves, removals, undo and loads", () => {
    let churnedQuarantineChecks = 0;
    let editRefusals = 0;

    for (const seed of SEEDS) {
      const rand = randFor(seed + 300);
      const ctx = makeCtx();
      const ids = makeIdMinter(`q${seed}`);
      const journal: string[] = [];

      // Built by hand rather than by `loadFixture`, because this property needs
      // the ORIGINAL wire bytes to compare against, and only the generator has
      // them.
      const generated = randomDocument(rand, ids, { rootCount: 2, maxDepth: 3 });
      const built = deserializeDocument<Types, Summary>(generated.document, ctx);
      if (!built.ok) {
        throw new Error(`fuzz generator produced an unloadable document: ${built.error.code}`);
      }
      let graph = built.value.graph;
      let history = createHistory<Types, Summary>();

      // Expected bytes, keyed by id, captured BEFORE anything touches them.
      const expectedBytes = new Map<string, string>();
      for (const [id, data] of generated.quarantined) expectedBytes.set(id, stableJson(data));

      traced(seed, journal, () => {
        // The generator is probabilistic; a run with nothing quarantined would
        // pass this test vacuously. Skip rather than assert, and let the
        // aggregate counter below prove the property was exercised overall.
        if (expectedBytes.size === 0) {
          journal.push("no quarantined nodes generated for this seed");
          return;
        }

        // Ingress agrees with the generator about WHICH nodes quarantined.
        for (const id of expectedBytes.keys()) {
          const node = graph.nodesById.get(parseNodeId(id));
          if (node === undefined || !node.quarantined) {
            throw new Error(`generator expected ${id} to quarantine; ingress did not`);
          }
        }

        /** Every surviving quarantined node still holds — and still WRITES —
         *  exactly the bytes it arrived with. */
        const checkBytes = (g: FuzzGraph, label: string): void => {
          const document = serializeGraph<Types, Summary>(g, ctx);
          const emitted = new Map<string, SerializedNode>();
          for (const node of document.nodes) emitted.set(node.id, node);

          for (const [rawId, bytes] of expectedBytes) {
            const id = parseNodeId(rawId);
            const node = g.nodesById.get(id);
            if (node === undefined) continue; // legitimately removed by churn
            if (!node.quarantined) {
              throw new Error(`${label}: node ${rawId} lost its quarantine`);
            }
            if (stableJson(node.raw) !== bytes) {
              throw new Error(
                `${label}: quarantined node ${rawId} no longer holds its original raw data\n` +
                  `  expected ${bytes}\n  actual   ${stableJson(node.raw)}`,
              );
            }
            if (node.schemaVersion !== MYSTERY_SCHEMA_VERSION && node.kind === MYSTERY_KIND) {
              throw new Error(
                `${label}: node ${rawId} lost the schemaVersion the document declared`,
              );
            }
            const wire = emitted.get(rawId);
            if (wire === undefined) {
              throw new Error(`${label}: quarantined node ${rawId} was not emitted by serialize`);
            }
            if (stableJson(wire.data) !== bytes) {
              throw new Error(
                `${label}: re-emitted bytes for ${rawId} differ from the original\n` +
                  `  expected ${bytes}\n  actual   ${stableJson(wire.data)}`,
              );
            }
            if (wire.kind !== node.kind) {
              throw new Error(`${label}: re-emitted kind for ${rawId} changed`);
            }
            churnedQuarantineChecks += 1;
          }
        };

        checkBytes(graph, "after ingest");

        // --- Phase A: loads only ---------------------------------------------
        //
        // Loads come FIRST and are kept out of the churn phase, because a load
        // produces NO PATCH — loading is monotone and there is no `unload` in
        // v1 — so undo cannot take one back. Interleaving them with the
        // commands would make the "a full unwind restores the starting graph"
        // assertion below simply false, and weakening that assertion to
        // accommodate them would throw away the strongest check in this test.
        // Running them first still puts every quarantined node through a graph
        // that grew underneath it.
        for (let load = 0; load < 4; load += 1) {
          const unloaded = [...graph.nodesById.keys()].filter(
            (id) => childrenStateOf(graph, id)?.status === "unloaded",
          );
          if (unloaded.length === 0) break;
          const targetId = pick(rand, unloaded);
          const payload = randomPayload(rand, ids);
          const loaded = loadChildrenInto<Types, Summary>(graph, targetId, payload.document, ctx);
          journal.push(`load ${targetId} => ${loaded.ok ? "ok" : `reject:${loaded.error.code}`}`);
          if (loaded.ok) graph = loaded.value;
          expectValid(graph, `load ${load}`);
          checkBytes(graph, `load ${load}`);
        }

        // The unwind target: the graph as it stands with every load applied.
        const settledShape = graphShape(graph);

        // --- Phase B: structural churn, all of it undoable ---------------------
        for (let step = 0; step < 60; step += 1) {
          const roll = rand();

          if (roll < 0.2) {
            // Editing a quarantined node must always be refused: it holds
            // `raw`, not parsed data, and writing to it would destroy exactly
            // the byte-exactness this test asserts.
            const quarantinedIds = [...expectedBytes.keys()]
              .map((rawId) => parseNodeId(rawId))
              .filter((id) => graph.nodesById.has(id));
            if (quarantinedIds.length > 0) {
              const targetId = pick(rand, quarantinedIds);
              const command: FuzzCommand = {
                type: "edit-nodes",
                edits: [{ nodeId: targetId, kind: "clip", edit: { title: "hijacked" } }],
              };
              const result = applyCommand<Types, Summary>(graph, command, ctx);
              journal.push(
                `edit-nodes [${targetId}] (quarantined) => ${
                  result.ok ? "ok" : `reject:${result.error.code}`
                }`,
              );
              if (result.ok) {
                throw new Error(`editing quarantined node ${targetId} was accepted`);
              }
              expect(result.error.code).toBe("node-quarantined");
              editRefusals += 1;
              continue;
            }
          }

          const { command, label } = randomCommand(rand, graph);
          const result = applyCommand<Types, Summary>(graph, command, ctx);
          journal.push(`${label} => ${result.ok ? "ok" : `reject:${result.error.code}`}`);
          if (result.ok) {
            graph = result.value.graph;
            history = pushHistory(history, {
              command,
              patch: result.value.patch,
              at: ctx.now(),
            });
          }
          expectValid(graph, `step ${step}`);
          checkBytes(graph, `step ${step}`);
        }

        // Unwind everything. A quarantined node that was REMOVED during churn
        // has to come back byte-exact too — the patch records the whole node,
        // `raw` included, which is what makes "delete then undo" safe for data
        // no codec in this build can read.
        while (canUndo(history)) {
          const stepBack = commitUndo(history);
          if (stepBack === null) break;
          const inverse = invertPatch(stepBack.entry.patch);
          const gate = verifyPatchApplies(graph, inverse, ctx);
          if (!gate.ok) {
            throw new Error(`unwind refused: ${gate.error.code} — ${gate.error.message}`);
          }
          graph = applyPatch(graph, inverse, ctx);
          history = stepBack.history;
          expectValid(graph, "unwind");
        }

        for (const rawId of expectedBytes.keys()) {
          if (!graph.nodesById.has(parseNodeId(rawId))) {
            throw new Error(`after a full unwind, quarantined node ${rawId} did not come back`);
          }
        }
        checkBytes(graph, "after full unwind");
        expect(graphShape(graph)).toEqual(settledShape);
      });
    }

    // ANTI-VACUITY. Measured on these six seeds: 904 byte comparisons against a
    // surviving quarantined node, 75 refused edits.
    expect(churnedQuarantineChecks).toBeGreaterThan(400);
    expect(editRefusals).toBeGreaterThanOrEqual(20);
  });
});
