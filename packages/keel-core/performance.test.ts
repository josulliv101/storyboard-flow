// KEEL — the performance harness.
//
// WHY THIS FILE EXISTS. Neither this package nor the shipped engine it replaces
// contained a single performance test: a grep for `performance.now` finds
// nothing in either. Every scaling claim made about KEEL so far — the memo
// table's whole justification, "explicit stack, never recursion", "O(cards
// mounted) rather than O(graph)" — has been an argument from reading the
// source. This file is the first measurement.
//
// WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
//
// It asserts SCALING PROPERTIES, never wall-clock milliseconds. A test that
// says "a reorder must finish in 2ms" is worse than no test at all: it passes
// on the author's laptop, fails on a loaded CI box, earns a `.skip` within a
// month, and the regression it was written to catch ships anyway. Two kinds of
// assertion are used instead, in this order of preference:
//
//   1. OPERATION COUNTS, which are exact and machine-independent. Every
//      consumer-supplied hook the engine calls is a probe: the index rebuild
//      asks each node it visits for its `contentKey`, the ingress runs `parse`
//      per node, and a fold runs its own `leaf`/`collection` per node actually
//      evaluated. Counting them measures the ENGINE's work rather than the
//      machine's speed, and the same number comes back on every box on earth.
//      Where a cost is claimed to be independent of graph size, that is
//      asserted by measuring it at 100, 1,000 and 10,000 nodes and requiring
//      the three numbers to be EQUAL — a per-size bound cannot tell a constant
//      apart from a number that happens to be small.
//   2. TIME RATIOS BETWEEN SIZES, against a CALIBRATED ceiling. A 10x graph
//      makes a linear operation ~10x slower in theory and 13-20x slower in
//      practice, because allocation and GC cost more per node at scale. So the
//      ceiling is not a guessed constant: a deliberately-linear reference is
//      timed on the same fixtures in the same process, and every ratio is held
//      to that plus slack, re-sampled per assertion. See
//      `measureLinearReferenceGrowth`.
//
// The one thing it does NOT assert is that any operation is FAST. Absolute
// numbers are printed at the end of the run (see `afterAll`) so a human can
// read them; nothing fails on them.
//
// TEST FILE, NOT ENGINE CODE. `node:perf_hooks` is imported here and nowhere
// else in keel-core — the package's purity rule is about what ships, and every
// `.test.ts` is excluded from the reachability walk. `performance` is not a
// global in @types/node@20, so the explicit import is what makes this typecheck
// under the package's own tsconfig.
import { afterAll, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";

import { createEngine } from "./engine";
import { createHistory } from "./history";
import { computeFold, createFoldCache, DEFAULT_FOLD_CACHE_LIMIT } from "./folds";
import {
  defineNodeType,
  parseNodeId,
  type Certainty,
  type Command,
  type DropIntent,
  type Fold,
  type FoldCache,
  type Graph,
  type Issue,
  type NodeId,
  type Result,
  type SerializedDocument,
  type SerializedNode,
  type SummaryCodec,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Probes — the consumer hooks the engine calls, wired to counters
// ---------------------------------------------------------------------------

/**
 * MUTABLE on purpose, and the only mutable module state in the file.
 *
 * Every field counts invocations of a hook the ENGINE decides to call. That is
 * what makes these numbers a measurement of the engine's algorithm rather than
 * of this machine: the derived-index maintenance asks each node it visits for
 * its `contentKey`, so counting that call reads out exactly HOW MANY NODES a
 * given mutation had to look at — the difference between a scoped re-index and
 * a whole-document rebuild, in one integer, identically on any hardware.
 */
type Counters = {
  contentKey: number;
  parse: number;
  serialize: number;
  applyEdit: number;
  foldLeaf: number;
  foldCollection: number;
  foldPlaceholder: number;
};

const counters: Counters = {
  contentKey: 0,
  parse: 0,
  serialize: 0,
  applyEdit: 0,
  foldLeaf: 0,
  foldCollection: 0,
  foldPlaceholder: 0,
};

function resetCounters(): void {
  counters.contentKey = 0;
  counters.parse = 0;
  counters.serialize = 0;
  counters.applyEdit = 0;
  counters.foldLeaf = 0;
  counters.foldCollection = 0;
  counters.foldPlaceholder = 0;
}

/** Reset, run ONE operation, snapshot. Counting a batch would only tell us the
 *  batch size back. */
function countOnce(run: () => void): Readonly<Counters> {
  resetCounters();
  run();
  return { ...counters };
}

/** Total fold-callback invocations — the number of nodes a fold actually
 *  evaluated, as opposed to skipped via a cache hit. */
function foldCalls(counts: Readonly<Counters>): number {
  return counts.foldLeaf + counts.foldCollection + counts.foldPlaceholder;
}

// ---------------------------------------------------------------------------
// 2. Node types
// ---------------------------------------------------------------------------

type Clip = Readonly<{ title: string; seconds: number; assetId: string }>;
type ClipEdit = Readonly<{ title?: string; seconds?: number }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    counters.parse += 1;
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const seconds = record["seconds"];
    const assetId = record["assetId"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    if (typeof assetId !== "string") {
      return { ok: false, error: [{ path: "$.assetId", message: "assetId" }] };
    }
    return { ok: true, value: { title, seconds, assetId } };
  },
  serialize(data): unknown {
    counters.serialize += 1;
    return { title: data.title, seconds: data.seconds, assetId: data.assetId };
  },
  applyEdit(data, edit) {
    counters.applyEdit += 1;
    return {
      ok: true,
      value: {
        title: edit.title ?? data.title,
        seconds: edit.seconds ?? data.seconds,
        assetId: data.assetId,
      },
    };
  },
  /**
   * THE PRIMARY PROBE. Whatever the engine does to keep `placementsByContentKey`
   * correct — a scoped re-index of one subtree, or a full walk of the document —
   * it has to ask each node it visits for its key, so this counter reports the
   * size of that visit exactly. Defining it is also what turns the index ON:
   * with no registered `contentKey` the index is permanently empty and the
   * engine skips the maintenance entirely, which would measure nothing.
   *
   * Realistic, too: the product really does key "same asset, placed twice" off
   * an asset id.
   */
  contentKey(data) {
    counters.contentKey += 1;
    return data.assetId;
  },
});

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    counters.parse += 1;
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
    counters.serialize += 1;
    return { name: data.name };
  },
  applyEdit(data, edit) {
    counters.applyEdit += 1;
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
  // Containers carry the probe too, so `counters.contentKey` after a mutation
  // is the count of EVERY reachable node and not just the leaves.
  contentKey(data) {
    counters.contentKey += 1;
    return `folder:${data.name}`;
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;

type Summary = Readonly<{ seconds: number }>;

const summary: SummaryCodec<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const seconds = record["seconds"];
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { seconds } };
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

/**
 * Written out by hand rather than built with `foldMonoid`, for one reason:
 * `foldMonoid` supplies `collection` itself, and `collection` is the callback
 * whose invocation count proves how much of the graph an incremental refold
 * actually re-walked. A convenience wrapper here would hide the measurement.
 *
 * The certainty accumulator is deliberately allocation-free (no array, no
 * `weakestCertainty` call) — this callback runs once per collection in the hot
 * loop, and an array per node would put the harness's own garbage into the
 * numbers it reports.
 */
const durationFold: Fold<Types, Summary, number> = {
  key: "duration",
  leaf(node) {
    counters.foldLeaf += 1;
    return node.kind === "clip" ? node.data.seconds : 0;
  },
  collection(_node, children) {
    counters.foldCollection += 1;
    let total = 0;
    let weakest: Certainty = "exact";
    for (const child of children) {
      total += child.value;
      if (child.certainty === "partial") weakest = "partial";
      else if (child.certainty === "estimated" && weakest === "exact") {
        weakest = "estimated";
      }
    }
    return { value: total, certainty: weakest };
  },
  placeholder(node) {
    counters.foldPlaceholder += 1;
    return {
      value: node.summary === null ? 0 : node.summary.seconds,
      certainty: "estimated",
    };
  },
  missing() {
    return { value: 0, certainty: "exact" };
  },
  quarantined() {
    return { value: 0, certainty: "partial" };
  },
};

const folds = { duration: durationFold };

/**
 * `devChecks: false` is not laziness — it is the only honest setting here. Dev
 * checks deep-freeze every parsed value, round-trip it through
 * `parse(serialize(d))`, and run a SHADOW COLD REFOLD beside every cached one.
 * With them on, this file would be measuring the audit rather than the engine,
 * and the memo table's numbers in particular would come out exactly inverted.
 */
const engine = createEngine<Types, Summary, typeof folds>({
  types,
  summary,
  folds,
  devChecks: false,
  now: () => 0,
});

type G = Graph<Types, Summary>;

// ---------------------------------------------------------------------------
// 3. Fixtures
// ---------------------------------------------------------------------------

/**
 * Index with a real check.
 *
 * `noUncheckedIndexedAccess` is on and this repo does not paper over it with
 * `!`. Throwing is right HERE and only here: a broken fixture is a bug in the
 * harness, not a rejection the engine should model, and the failure it prevents
 * is the worst one a benchmark can have — silently measuring an early return
 * out of an operation that never ran.
 */
function at<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`keel performance fixture: ${what}[${index}] is missing`);
  }
  return item;
}

type WideFixture = Readonly<{
  label: string;
  nodeCount: number;
  /** root -> folder -> clip. Held constant so a size ratio isolates node count. */
  depth: number;
  doc: SerializedDocument;
  graph: G;
  rootId: NodeId;
  folderIds: readonly NodeId[];
  clipIdsByFolder: readonly (readonly NodeId[])[];
}>;

type DeepFixture = Readonly<{
  label: string;
  nodeCount: number;
  depth: number;
  doc: SerializedDocument;
  graph: G;
  rootId: NodeId;
  /** The single clip at the bottom of the chain. */
  deepestClipId: NodeId;
}>;

const WIDE_FANOUT = 20;

/**
 * PRODUCT-SHAPED: one root, folders of `WIDE_FANOUT` clips. Depth is held at 3
 * across every size, so a size-to-size ratio isolates the effect of NODE COUNT
 * and nothing else. Depth gets its own fixture below, because depth and breadth
 * break different things.
 */
function makeWideFixture(nodeCount: number): WideFixture {
  const nodes: SerializedNode[] = [];
  const folderIdStrings: string[] = [];
  const clipIdStringsByFolder: string[][] = [];

  let made = 1; // the root itself
  let folderIndex = 0;
  while (made < nodeCount) {
    made += 1;
    const clips: string[] = [];
    while (made < nodeCount && clips.length < WIDE_FANOUT) {
      clips.push(`c${folderIndex}-${clips.length}`);
      made += 1;
    }
    folderIdStrings.push(`f${folderIndex}`);
    clipIdStringsByFolder.push(clips);
    folderIndex += 1;
  }

  nodes.push({
    id: "root",
    kind: "folder",
    data: { name: "root" },
    children: folderIdStrings,
  });
  for (let i = 0; i < folderIdStrings.length; i += 1) {
    const folderId = at(folderIdStrings, i, "folderIdStrings");
    const clips = at(clipIdStringsByFolder, i, "clipIdStringsByFolder");
    nodes.push({
      id: folderId,
      kind: "folder",
      data: { name: folderId },
      children: clips,
    });
    for (let j = 0; j < clips.length; j += 1) {
      const clipId = at(clips, j, "clips");
      nodes.push({
        id: clipId,
        kind: "clip",
        data: {
          title: clipId,
          seconds: 1 + (j % 7),
          assetId: `asset-${clipId}`,
        },
      });
    }
  }

  const doc: SerializedDocument = {
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes,
  };

  const loaded = engine.deserialize(doc);
  if (!loaded.ok) {
    throw new Error(
      `keel performance fixture: wide/${nodeCount} failed to load: ${loaded.error.message}`,
    );
  }
  if (loaded.value.report.nodeCount !== nodes.length) {
    throw new Error(
      `keel performance fixture: wide/${nodeCount} loaded ` +
        `${loaded.value.report.nodeCount} of ${nodes.length} nodes`,
    );
  }

  return {
    label: `wide/${nodeCount}`,
    nodeCount: nodes.length,
    depth: 3,
    doc,
    graph: loaded.value.graph,
    rootId: parseNodeId("root"),
    folderIds: folderIdStrings.map((id) => parseNodeId(id)),
    clipIdsByFolder: clipIdStringsByFolder.map((ids) =>
      ids.map((id) => parseNodeId(id)),
    ),
  };
}

/**
 * A CHAIN: `depth` nested folders with one clip at the bottom.
 *
 * Depth is the input that kills recursion, and every walk in this engine claims
 * an explicit stack in its comments. Nobody had run one deep enough to find out.
 */
function makeDeepFixture(depth: number): DeepFixture {
  const nodes: SerializedNode[] = [];
  const clipId = "deep-clip";
  for (let level = 0; level < depth; level += 1) {
    const childId = level === depth - 1 ? clipId : `d${level + 1}`;
    nodes.push({
      id: `d${level}`,
      kind: "folder",
      data: { name: `d${level}` },
      children: [childId],
    });
  }
  nodes.push({
    id: clipId,
    kind: "clip",
    data: { title: clipId, seconds: 3, assetId: `asset-${clipId}` },
  });

  const doc: SerializedDocument = {
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["d0"],
    nodes,
  };

  const loaded = engine.deserialize(doc);
  if (!loaded.ok) {
    throw new Error(
      `keel performance fixture: deep/${depth} failed to load: ${loaded.error.message}`,
    );
  }

  return {
    label: `deep/${depth}`,
    nodeCount: nodes.length,
    depth,
    doc,
    graph: loaded.value.graph,
    rootId: parseNodeId("d0"),
    deepestClipId: parseNodeId(clipId),
  };
}

// Built once, at module load, and shared by every test. Rebuilding them per
// test would dominate the file's runtime and measure the fixture, not the
// engine.
const wide100 = makeWideFixture(100);
const wide1k = makeWideFixture(1_000);
const wide10k = makeWideFixture(10_000);
const wideSizes: readonly WideFixture[] = [wide100, wide1k, wide10k];

const deep1k = makeDeepFixture(1_000);
const DEEP_STACK_PROBE_LEVELS = 10_000;
const deep10k = makeDeepFixture(DEEP_STACK_PROBE_LEVELS);

// ---------------------------------------------------------------------------
// 4. The timer
// ---------------------------------------------------------------------------

const MIN_BATCH_MS = 20;
const MAX_OPS_PER_BATCH = 50_000;
const BATCHES = 3;
const WARMUP_MS = 5;
const MAX_WARMUP_OPS = 200;

type Timing = Readonly<{ opsPerBatch: number; nsPerOp: number }>;

/**
 * Time one operation, defensively. Three things here are not decoration:
 *
 *   WARMUP. V8 runs the first few hundred invocations in the interpreter. Time
 *   the smallest graph first without warming up and it looks slower than the
 *   largest one, which turns every ratio computed against it into fiction.
 *
 *   AUTO-SCALED BATCHES. `performance.now()` has finite resolution and the OS
 *   scheduler has no obligations to us. Growing the batch until it spans at
 *   least `MIN_BATCH_MS` puts both of those below the noise floor instead of
 *   inside the measurement.
 *
 *   BEST OF N, not the mean. A GC pause or a preemption can only ADD time,
 *   never remove it, so the minimum is the closest available estimate of the
 *   work the operation actually does — and it is the single biggest reason this
 *   file will not start failing on a loaded CI box.
 */
function timeOp(op: () => void): Timing {
  const warmupStarted = performance.now();
  let warmupOps = 0;
  while (
    warmupOps < MAX_WARMUP_OPS &&
    performance.now() - warmupStarted < WARMUP_MS
  ) {
    op();
    warmupOps += 1;
  }

  let opsPerBatch = 1;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const started = performance.now();
    for (let i = 0; i < opsPerBatch; i += 1) op();
    const elapsed = performance.now() - started;
    if (elapsed >= MIN_BATCH_MS || opsPerBatch >= MAX_OPS_PER_BATCH) break;
    // A zero reading means the batch fell under the clock's resolution, so
    // there is no rate to extrapolate from — step up blind instead.
    const growth = elapsed <= 0 ? 8 : (MIN_BATCH_MS * 1.5) / elapsed;
    const next = Math.ceil(opsPerBatch * Math.min(64, Math.max(2, growth)));
    opsPerBatch = Math.min(MAX_OPS_PER_BATCH, next);
  }

  let bestNsPerOp = Number.POSITIVE_INFINITY;
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < opsPerBatch; i += 1) op();
    const elapsed = performance.now() - started;
    const nsPerOp = (elapsed * 1e6) / opsPerBatch;
    if (nsPerOp < bestNsPerOp) bestNsPerOp = nsPerOp;
  }

  return { opsPerBatch, nsPerOp: bestNsPerOp };
}

// ---------------------------------------------------------------------------
// 5. The report
// ---------------------------------------------------------------------------

type Sample = Readonly<{
  op: string;
  shape: string;
  nodeCount: number;
  nsPerOp: number;
  opsPerBatch: number;
}>;

type CountSample = Readonly<{
  op: string;
  shape: string;
  nodeCount: number;
  metric: string;
  count: number;
}>;

const samples: Sample[] = [];
const countSamples: CountSample[] = [];

function measure(
  op: string,
  fixtureLabel: string,
  nodeCount: number,
  run: () => void,
): number {
  const timing = timeOp(run);
  samples.push({
    op,
    shape: fixtureLabel,
    nodeCount,
    nsPerOp: timing.nsPerOp,
    opsPerBatch: timing.opsPerBatch,
  });
  return timing.nsPerOp;
}

function noteCount(
  op: string,
  fixtureLabel: string,
  nodeCount: number,
  metric: string,
  count: number,
): number {
  countSamples.push({ op, shape: fixtureLabel, nodeCount, metric, count });
  return count;
}

function fmtNs(ns: number): string {
  if (!Number.isFinite(ns)) return "n/a";
  if (ns < 1_000) return `${ns.toFixed(0)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} us`;
  return `${(ns / 1_000_000).toFixed(2)} ms`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

/**
 * Printed, never asserted. Absolute timings belong in a human's hands, not in
 * an `expect` — that is the whole distinction this file is built on.
 */
afterAll(() => {
  const lines: string[] = [];
  lines.push("");
  lines.push("KEEL performance — measured, not argued");
  lines.push("=".repeat(78));
  lines.push(
    pad("operation", 32) +
      pad("shape", 14) +
      padStart("nodes", 8) +
      padStart("per op", 14) +
      padStart("reps", 10),
  );
  lines.push("-".repeat(78));
  for (const sample of samples) {
    lines.push(
      pad(sample.op, 32) +
        pad(sample.shape, 14) +
        padStart(String(sample.nodeCount), 8) +
        padStart(fmtNs(sample.nsPerOp), 14) +
        padStart(String(sample.opsPerBatch), 10),
    );
  }
  lines.push("");
  // The RANGE, not a number: the reference is re-sampled at every assertion, so
  // a single figure here would be the last one and would hide exactly the
  // spread that made a module-load reference unusable.
  if (observedReferences.length === 0) {
    lines.push("linear reference (serialize, 1k -> 10k): not sampled this run");
  } else {
    const lo = Math.min(...observedReferences);
    const hi = Math.max(...observedReferences);
    lines.push(
      `linear reference (serialize, 1k -> 10k), re-sampled per assertion: ` +
        `${lo.toFixed(1)}x - ${hi.toFixed(1)}x over ${observedReferences.length} samples` +
        `   |   ceiling = max(${SUBQUADRATIC_RATIO_LIMIT}, reference x ${LINEAR_REFERENCE_SLACK}) = ` +
        `${Math.max(SUBQUADRATIC_RATIO_LIMIT, lo * LINEAR_REFERENCE_SLACK).toFixed(1)}x - ` +
        `${Math.max(SUBQUADRATIC_RATIO_LIMIT, hi * LINEAR_REFERENCE_SLACK).toFixed(1)}x`,
    );
  }
  lines.push("");
  lines.push("Operation counts — exact, machine-independent");
  lines.push("=".repeat(78));
  lines.push(
    pad("operation", 32) +
      pad("shape", 14) +
      pad("metric", 14) +
      padStart("count", 10),
  );
  lines.push("-".repeat(78));
  for (const sample of countSamples) {
    lines.push(
      pad(sample.op, 32) +
        pad(sample.shape, 14) +
        pad(sample.metric, 14) +
        padStart(String(sample.count), 10),
    );
  }
  lines.push("");
  console.log(lines.join("\n"));
});

// ---------------------------------------------------------------------------
// 6. Thresholds
// ---------------------------------------------------------------------------

/**
 * 10x the nodes. A LINEAR operation lands near 10 in theory — and near 13-20 in
 * practice, because at 10,000 nodes the allocator, the Map rehashing and the
 * garbage collector all cost more per node than they do at 1,000. That gap is
 * real and it is NOT algorithmic, which is why a fixed threshold here is a trap:
 * set it at 25 and this file fails on a busy machine, set it at 90 and a genuine
 * O(n^2) walks straight through.
 *
 * So the ceiling is calibrated instead — see `measureLinearReferenceGrowth`.
 * This is
 * the FLOOR under that calibration: a clean, fast box measures a linear
 * reference near 10, and nothing should be held to a tighter bound than this
 * whatever the reference says.
 *
 * WAS 30, AND 30 FLAKED. The failure this number now encodes, measured rather
 * than argued: run this file ALONE and the linear reference measures ~16, so
 * `ref x SLACK` (40) is the binding ceiling and the calibration is doing its
 * job. Run it inside the real gate — `vitest --project=unit`, 55 files across
 * parallel workers — and the reference is measured at MODULE LOAD, in whatever
 * quiet moment the scheduler happened to give this worker, while `deserialize`
 * is measured later under full contention. Over 10 full-suite runs on a Windows
 * dev box the reference came back 9.1 / 10.2 / 10.6 / 10.9 / 11.0 / 11.5 / 11.7
 * — so `ref x 2.5` was 22.7-29.2, ALWAYS below 30, and the "calibrated" ceiling
 * was in practice this constant. `deserialize` over the same runs came back
 * 16.4 / 19.5 / 20.5 / 27.8 / 31.4 / 31.8 / 32.8. Three of ten breached 30.
 *
 * Note the direction: the two worst `deserialize` runs are paired with the two
 * LOWEST references. Contention that inflates the operation cannot inflate a
 * reference already taken, so under load the calibration moves the ceiling the
 * wrong way and the floor is all that is left. 40 clears the worst observed
 * ratio (31.8) by 26%, hands back over to the calibration as soon as the
 * reference exceeds 16 — i.e. on any box slower than this one — and a real
 * O(n^2), which is the reference times ~10, is nowhere near it.
 *
 * This is the coarse net, not the instrument. What actually pins `deserialize`
 * against an algorithmic regression is the exact `parse`-call count beside it
 * (one per node, at all three sizes), which no amount of machine noise moves.
 */
const SUBQUADRATIC_RATIO_LIMIT = 40;

// There was a CAP here (`QUADRATIC_SIGNATURE_FLOOR = 60`), removed rather than
// tuned. It read "a 10x graph making an operation more than 60x slower is not a
// constant factor", which is true only while the linear reference is near 10.
// Under a 20-way CPU burn the reference itself measured 48, and the cap then
// fired on four operations at 60-76 whose ratio TO THAT REFERENCE was 1.25-1.6
// — i.e. it called linear growth quadratic. An absolute ceiling over a relative
// measurement cannot survive a machine slow enough to need the relative one.

/** How much slack a real operation gets over the linear reference measured on
 *  the same fixtures, in the same process, on the same hardware. */
const LINEAR_REFERENCE_SLACK = 2.5;

/**
 * A DELIBERATELY LINEAR operation, timed on the same two fixtures every ratio
 * below is computed from.
 *
 * `serialize` emits one object per node and touches every one of them exactly
 * once, so its 1k -> 10k ratio is what "linear, on THIS machine, under THIS
 * memory pressure, right now" actually costs. Calibrating against it is what
 * lets the assertions below stay tight on a quiet box and stay quiet on a
 * loaded one, without anyone having to guess a number.
 *
 * MEASURED PER ASSERTION, ADJACENT IN TIME TO THE OPERATION IT CALIBRATES —
 * not once at module load, which is what it used to be and what made this file
 * flake. The whole claim of a calibrated ceiling is "linear, on this machine,
 * under this memory pressure, RIGHT NOW", and a reference taken at module load
 * is none of those things by the time the eighth test runs: under the real gate
 * (`vitest --project=unit`, 55 files across parallel workers) the reference was
 * sampled in whatever quiet moment this worker happened to get, while the
 * operation was timed later under contention. Measured that way over 10 runs,
 * the reference came back 9.1-11.7 while `deserialize` came back 16.4-32.8, and
 * — the tell — the two WORST operation samples were paired with the two LOWEST
 * references. Contention cannot inflate a number already taken, so the stale
 * reference moved the ceiling the wrong way exactly when it was needed most.
 *
 * Re-measuring here puts numerator and denominator in the same contention
 * window, which is the property that has always made the cold/warm fold ratio
 * below robust. Under a deliberate 20-way CPU burn on a 24-core box the
 * adjacent reference reads ~48 while the operations read 60-76 — a ratio of
 * 1.25-1.6, comfortably inside `LINEAR_REFERENCE_SLACK`, where the stale
 * reference had read 12 against an operation at 106.
 *
 * It costs two `timeOp` calls (~0.2-0.3s) per assertion site. That is the price
 * of a gate that does not fail on a busy machine.
 */
function measureLinearReferenceGrowth(): number {
  const small = timeOp(() => {
    engine.serialize(wide1k.graph);
  });
  const large = timeOp(() => {
    engine.serialize(wide10k.graph);
  });
  return large.nsPerOp / small.nsPerOp;
}

/** Every reference actually sampled this run, so the summary can print the
 *  spread rather than one number that was only true once. */
const observedReferences: number[] = [];

/** How much cheaper a fully-warm fold must be than a cold one. The measured
 *  number is three orders of magnitude; this is the floor a regression has to
 *  break before anyone hears about it. */
const WARM_FOLD_SPEEDUP_FLOOR = 20;

// ---------------------------------------------------------------------------
// 7. Operation builders
// ---------------------------------------------------------------------------

function firstFolder(fx: WideFixture): NodeId {
  return at(fx.folderIds, 0, `${fx.label}.folderIds`);
}

function firstFolderClips(fx: WideFixture): readonly NodeId[] {
  return at(fx.clipIdsByFolder, 0, `${fx.label}.clipIdsByFolder`);
}

/**
 * THE COMMONEST GESTURE IN THE PRODUCT: drag a card within the list it is
 * already in. Index 0 -> the last slot, which is a real move (never the
 * `empty-command` no-op the reducer refuses) and stays inside one parent, so
 * nothing about the gesture itself is proportional to the graph.
 */
function reorderCommand(fx: WideFixture): Command<Types, Summary> {
  const clips = firstFolderClips(fx);
  return {
    type: "move-nodes",
    nodeIds: [at(clips, 0, "clips")],
    toParentId: firstFolder(fx),
    toIndex: clips.length - 1,
  };
}

/** The same gesture as the view produces it, before `resolveDrop` converts the
 *  view's index into a post-removal one. */
function reorderIntent(fx: WideFixture): DropIntent<Types, Summary> {
  const clips = firstFolderClips(fx);
  return {
    type: "move",
    nodeIds: [at(clips, 0, "clips")],
    toParentId: firstFolder(fx),
    toIndexBefore: clips.length - 1,
  };
}

/**
 * How many nodes `crossParentMoveCommand` actually relocates: it names one clip,
 * and a clip is a leaf, so the subtree that travels is that one node.
 *
 * Named rather than written as a bare `1` at the assertion, because it is the
 * quantity the cross-parent re-index is allowed to be proportional to. If this
 * fixture ever moves a folder instead, this constant is what changes — and the
 * assertion stays a statement about the moved subtree rather than becoming a
 * magic number that has to be re-derived from scratch.
 */
const CROSS_PARENT_MOVED_SUBTREE = 1;

function crossParentMoveCommand(fx: WideFixture): Command<Types, Summary> {
  const clips = firstFolderClips(fx);
  return {
    type: "move-nodes",
    nodeIds: [at(clips, 0, "clips")],
    toParentId: at(fx.folderIds, 1, `${fx.label}.folderIds`),
    toIndex: 0,
  };
}

function editCommand(fx: WideFixture): Command<Types, Summary> {
  const clips = firstFolderClips(fx);
  return {
    type: "edit-nodes",
    edits: [
      { nodeId: at(clips, 0, "clips"), kind: "clip", edit: { seconds: 99 } },
    ],
  };
}

/** Run a command against a fixed graph and hand back the next graph, refusing
 *  to let a rejected command be mistaken for a fast one. */
function applyOrThrow(
  graph: G,
  command: Command<Types, Summary>,
  what: string,
): G {
  const applied = engine.applyCommand(graph, command);
  if (!applied.ok) {
    throw new Error(
      `keel performance fixture: ${what} was rejected ` +
        `(${applied.error.code}): ${applied.error.message}`,
    );
  }
  return applied.value.graph;
}

/**
 * Assert the operation SUCCEEDS before it is timed.
 *
 * The worst failure mode available to a benchmark is measuring an early return:
 * a rejected command is very fast and completely meaningless, and without this
 * check the file would happily report a 40ns "reorder" that never touched the
 * graph.
 */
function assertProducesWork(
  command: Command<Types, Summary>,
  fx: WideFixture,
): void {
  const applied = engine.applyCommand(fx.graph, command);
  expect(applied.ok).toBe(true);
}

/** ns/op at 10k divided by ns/op at 1k — the 10x-size ratio every scaling
 *  assertion in this file is written against. */
function growth(perOp: ReadonlyMap<string, number>): number {
  const small = perOp.get(wide1k.label);
  const large = perOp.get(wide10k.label);
  if (small === undefined || large === undefined || small <= 0) {
    throw new Error("keel performance: missing a size sample for the ratio");
  }
  return large / small;
}

/**
 * The one time-based assertion in this file, written once so every caller gets
 * the same calibration and the same failure message.
 *
 * The ceiling is the linear reference plus slack, floored so a fast box cannot
 * make it absurdly tight and capped so a slow one cannot make it useless. The
 * message carries the reference, because "this got 22x slower" is not
 * actionable on its own and "this got 22x slower while a linear operation on
 * the same data got 19x slower" is.
 */
function expectSubQuadratic(perOp: ReadonlyMap<string, number>, what: string): void {
  expectSubQuadraticRatio(growth(perOp), what);
}

/**
 * The same gate, for a measurement whose two samples are NOT the wide 1k/10k
 * fixtures.
 *
 * `growth` reads those two labels specifically, which is right for everything
 * that scales with NODE COUNT. A multi-select delete does not: its cost is
 * driven by how many SIBLINGS one parent holds, and the wide fixture caps that
 * at `WIDE_FANOUT`. Split out rather than duplicated so both callers share one
 * calibration and one failure message.
 */
function expectSubQuadraticRatio(ratio: number, what: string): void {
  // Sampled HERE, immediately after the operation above, so a slow stretch of
  // wall clock inflates both or neither.
  const reference = measureLinearReferenceGrowth();
  observedReferences.push(reference);
  // NO ABSOLUTE CAP over the calibration. There used to be one — 60, reasoned
  // from "a quadratic lands near 100" — and under a 20-way CPU burn it was the
  // sole cause of four failures: the reference itself measured 48, so the cap
  // was asserting that a provably LINEAR operation had grown quadratically.
  // "Quadratic" is only meaningful relative to what linear costs right now,
  // which is what `reference` is, and `LINEAR_REFERENCE_SLACK` already states
  // the whole claim: no more than 2.5x the growth of an operation known to be
  // linear over the same two fixtures. A genuine O(n^2) is `reference` x ~10.
  //
  // The residual risk is the other direction — a reference inflated by a GC
  // pause raises the ceiling and lets a regression through for one run. That
  // trade is deliberate: a missed regression is recoverable and this file's ten
  // exact operation-COUNT assertions catch algorithmic change with no timing
  // component at all, whereas a gate that fails on a busy machine gets muted.
  const ceiling = Math.max(
    SUBQUADRATIC_RATIO_LIMIT,
    reference * LINEAR_REFERENCE_SLACK,
  );
  expect(
    ratio,
    `${what}: 10x the nodes made it ${ratio.toFixed(1)}x slower. ` +
      `A linear reference on the same fixtures, timed immediately afterwards, ` +
      `moved ${reference.toFixed(1)}x, so the ceiling was ${ceiling.toFixed(1)}x.`,
  ).toBeLessThan(ceiling);
}

/**
 * A STRONGER time claim than sub-quadratic: this cost does not track the size at
 * all.
 *
 * `expectSubQuadraticRatio` is the right gate for work that IS linear and must
 * not become quadratic. It is the wrong gate for work that should be constant —
 * a regression from O(1) to O(n) lands around the linear reference (~15x), sails
 * under a ceiling of 40, and ships. This one sits a third of the way up the
 * reference instead: far above the noise a genuinely constant operation
 * produces (~1x), far below what linear would.
 *
 * Floored at 4 so a machine whose reference measures unusually low cannot make
 * the gate tighter than measurement noise.
 */
function expectConstantTime(ratio: number, what: string): void {
  const reference = measureLinearReferenceGrowth();
  observedReferences.push(reference);
  const ceiling = Math.max(4, reference / 3);
  expect(
    ratio,
    `${what}: 10x the size made it ${ratio.toFixed(1)}x slower, and it should ` +
      `not have moved at all. A linear reference, timed immediately afterwards, ` +
      `moved ${reference.toFixed(1)}x, so the ceiling was ${ceiling.toFixed(1)}x.`,
  ).toBeLessThan(ceiling);
}

/**
 * The strongest claim this file can make, and the only one that survives being
 * run on somebody else's hardware: an operation count that is IDENTICAL at 100,
 * 1,000 and 10,000 nodes does not depend on graph size. Not "grows slowly" —
 * does not depend on it.
 *
 * Collected per size and compared at the end rather than asserted inside the
 * loop, because a per-size bound cannot tell a constant apart from a number
 * that happens to be small at the size being examined.
 */
function expectIndependentOfGraphSize(
  counts: ReadonlyMap<string, number>,
  what: string,
): number {
  const distinct = new Set(counts.values());
  expect(
    distinct.size,
    `${what} should not depend on graph size; saw ${JSON.stringify([...counts])}`,
  ).toBe(1);
  const only = [...distinct][0];
  if (only === undefined) {
    throw new Error(`keel performance: no samples collected for ${what}`);
  }
  return only;
}

// ---------------------------------------------------------------------------
// 8. Ingress
// ---------------------------------------------------------------------------

describe("deserialize", () => {
  it("parses each node exactly once and scales sub-quadratically", () => {
    const perOp = new Map<string, number>();

    for (const fx of wideSizes) {
      const counts = countOnce(() => {
        const loaded = engine.deserialize(fx.doc);
        expect(loaded.ok).toBe(true);
      });

      // ONE parse per node. A door that parsed twice — validate-then-build, or
      // a migration pass that re-entered parse — would double the cost of every
      // page load and would be entirely invisible to a correctness suite.
      expect(
        noteCount("deserialize", fx.label, fx.nodeCount, "parse", counts.parse),
      ).toBe(fx.nodeCount);

      // Ingress does NOT touch the codec's `serialize`. Round-tripping to
      // normalise would be a plausible implementation and would silently double
      // the work; asserting zero pins the choice.
      expect(counts.serialize).toBe(0);

      // `rebuildDerivedIndexes` runs once for the finished graph, not per node.
      expect(
        noteCount(
          "deserialize",
          fx.label,
          fx.nodeCount,
          "contentKey",
          counts.contentKey,
        ),
      ).toBe(fx.nodeCount);

      perOp.set(
        fx.label,
        measure("deserialize", fx.label, fx.nodeCount, () => {
          engine.deserialize(fx.doc);
        }),
      );
    }

    expectSubQuadratic(perOp, "deserialize");
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 9. The three mutations
// ---------------------------------------------------------------------------

describe("mutations", () => {
  it("a same-parent reorder does not re-index the graph it lives in", () => {
    const perOp = new Map<string, number>();
    const resolvePerOp = new Map<string, number>();
    const reindexed = new Map<string, number>();

    for (const fx of wideSizes) {
      const command = reorderCommand(fx);
      assertProducesWork(command, fx);

      const counts = countOnce(() => {
        engine.applyCommand(fx.graph, command);
      });

      // THE HEADLINE NUMBER, and the one the commonest gesture in the product
      // lives or dies on. `placementsByContentKey` is in DOCUMENT ORDER, so a
      // pure reorder genuinely does move it — the naive answer is to rebuild
      // the index by walking the whole graph, and the naive answer would make
      // every drag on a strip cost the entire document.
      //
      // It does not. The count is the moved node's PARENT SUBTREE and nothing
      // else, and it is the same number at 100 nodes and at 10,000.
      reindexed.set(
        fx.label,
        noteCount(
          "reorder (same parent)",
          fx.label,
          fx.nodeCount,
          "contentKey",
          counts.contentKey,
        ),
      );

      // A move carries no content, so no codec is consulted about data. If this
      // ever fires, a structural command has started re-parsing the graph.
      expect(counts.parse).toBe(0);
      expect(counts.applyEdit).toBe(0);

      perOp.set(
        fx.label,
        measure("reorder (same parent)", fx.label, fx.nodeCount, () => {
          engine.applyCommand(fx.graph, command);
        }),
      );

      const intent = reorderIntent(fx);
      expect(engine.resolveDrop(fx.graph, intent).ok).toBe(true);
      resolvePerOp.set(
        fx.label,
        measure("resolveDrop (same parent)", fx.label, fx.nodeCount, () => {
          engine.resolveDrop(fx.graph, intent);
        }),
      );
    }

    // Independent of graph size, and bounded by the sibling list the gesture
    // actually happened in. Both halves matter: the first says the cost does
    // not track the document, the second says the constant is the right one and
    // not merely a repeated accident.
    const perReorder = expectIndependentOfGraphSize(
      reindexed,
      "reorder content-key lookups",
    );
    expect(perReorder).toBeLessThanOrEqual(WIDE_FANOUT + 1);

    // Time still grows, and that is worth stating plainly rather than hiding
    // behind the count above: `applyMoved` copies `subtreeRevById`, which holds
    // one entry per NODE, so the wall clock of a reorder tracks the document
    // even though the re-indexing does not. The printed table shows it.
    expectSubQuadratic(perOp, "same-parent reorder");
    // `resolveDrop` walks document order once to rank the moved ids. Same
    // guard: linear is the cost, quadratic is the regression.
    expectSubQuadratic(resolvePerOp, "resolveDrop (same parent)");
  }, 120_000);

  it("a cross-parent move re-indexes what travelled, not the document", () => {
    const perOp = new Map<string, number>();
    const reindexed = new Map<string, number>();

    for (const fx of wideSizes) {
      const command = crossParentMoveCommand(fx);
      assertProducesWork(command, fx);

      const counts = countOnce(() => {
        engine.applyCommand(fx.graph, command);
      });

      // THE OTHER HALF OF THE STORY, and it used to be a much worse half. This
      // bound was `<= fx.nodeCount` — a whole-document rebuild — on the
      // reasoning that a cross-parent move has no single subtree its
      // permutation is confined to, since the lowest common ancestor of two
      // collections is the root. True about the LCA, and the wrong scope: the
      // scope of a move is what MOVED. Two nodes that both stayed put cannot
      // have changed order relative to each other, so only buckets holding
      // something that travelled can need touching.
      //
      // So the count is the moved subtree, and here that is one clip. It is the
      // same number at 100 nodes and at 10,000, which is the claim; the bound
      // below is what says the constant is the right one rather than a
      // coincidence that happens to be flat.
      reindexed.set(
        fx.label,
        noteCount(
          "move (cross parent)",
          fx.label,
          fx.nodeCount,
          "contentKey",
          counts.contentKey,
        ),
      );
      expect(counts.parse).toBe(0);

      perOp.set(
        fx.label,
        measure("move (cross parent)", fx.label, fx.nodeCount, () => {
          engine.applyCommand(fx.graph, command);
        }),
      );
    }

    const perMove = expectIndependentOfGraphSize(
      reindexed,
      "cross-parent move content-key lookups",
    );
    // The command moves ONE leaf clip, so one key is the whole cost. Written as
    // the moved subtree size rather than a bare 1 so that the day this fixture
    // moves a folder instead, the number that changes is the fixture's and not
    // a magic constant nobody can source.
    expect(perMove).toBeLessThanOrEqual(CROSS_PARENT_MOVED_SUBTREE);

    expectSubQuadratic(perOp, "cross-parent move");
  }, 120_000);

  /**
   * MULTI-SELECT DELETE, which is select-all-then-Delete on a strip.
   *
   * `applyRemoved` called `spliceOut` once per removed placement, and
   * `spliceOut` is three O(siblings) passes — `indexOf`, `slice`, `splice` —
   * with a fresh array allocated each time. Removing K of N siblings therefore
   * cost O(K x N). The constant is a memcpy, which is exactly what let it hide:
   * invisible below a thousand siblings, and 5.2 SECONDS measured at 40,000.
   *
   * ITS OWN FIXTURE, because the wide one cannot see this. The cost is driven
   * by how many siblings ONE parent holds, and `makeWideFixture` caps that at
   * `WIDE_FANOUT` (20) no matter how large the document gets — the first
   * version of this test used it, passed on the unfixed engine, and proved
   * nothing. A flat parent is the shape the gesture actually happens on.
   */
  it("a multi-select delete is linear in the siblings it removes", () => {
    const flatSizes = [1_000, 10_000] as const;
    const ratioSamples: number[] = [];

    for (const siblings of flatSizes) {
      const childIds: string[] = [];
      const nodes: SerializedNode[] = [];
      for (let i = 0; i < siblings; i += 1) childIds.push(`flat-${i}`);
      nodes.push({
        id: "root",
        kind: "folder",
        data: { name: "root" },
        children: childIds,
      });
      for (const id of childIds) {
        nodes.push({ id, kind: "clip", data: { title: id, seconds: 1 } });
      }
      const loaded = engine.deserialize({
        formatVersion: 1,
        schemaVersions: { folder: 1, clip: 1 },
        rootIds: ["root"],
        nodes,
      });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const graph = loaded.value.graph;

      const command: Command<Types, Summary> = {
        type: "remove-nodes",
        nodeIds: childIds.map((id) => parseNodeId(id)),
      };
      // The op must actually succeed, or this times a rejection path.
      expect(engine.applyCommand(graph, command).ok).toBe(true);

      ratioSamples.push(
        measure(
          "multi-select delete",
          `flat${siblings}`,
          siblings + 1,
          () => {
            engine.applyCommand(graph, command);
          },
        ),
      );
    }

    const small = ratioSamples[0];
    const large = ratioSamples[1];
    expect(small !== undefined && large !== undefined && small > 0).toBe(true);
    if (small === undefined || large === undefined || small <= 0) return;
    expectSubQuadraticRatio(large / small, "multi-select delete");
  }, 120_000);

  /**
   * SELECTION MEMBERSHIP, which `useIsSelected` calls once per mounted card
   * every time the selection changes.
   *
   * It was `selectedIds.includes(id)` — O(selected) — so one render pass across
   * N cards with M selected was O(N x M). Measured before the fix: 0.28ms for
   * 500 cards all selected, 3.7ms for 2,000, and 63ms for 8,000. Four dropped
   * frames on every selection change, on a board the engine is explicitly built
   * to handle.
   *
   * Gated as CONSTANT rather than sub-quadratic on purpose: the regression this
   * guards against is a return to a linear scan, which a sub-quadratic ceiling
   * would happily let through.
   */
  it("selection membership does not depend on how much is selected", () => {
    const samples: number[] = [];

    for (const size of [1_000, 10_000] as const) {
      const childIds: string[] = [];
      const nodes: SerializedNode[] = [];
      for (let i = 0; i < size; i += 1) childIds.push(`sel-${i}`);
      nodes.push({
        id: "root",
        kind: "folder",
        data: { name: "root" },
        children: childIds,
      });
      for (const id of childIds) {
        nodes.push({ id, kind: "clip", data: { title: id, seconds: 1 } });
      }
      const loaded = engine.deserialize({
        formatVersion: 1,
        schemaVersions: { folder: 1, clip: 1 },
        rootIds: ["root"],
        nodes,
      });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;

      const store = engine.createStore(loaded.value.graph);
      const ids = childIds.map((id) => parseNodeId(id));
      store.selection.set(ids);
      expect(store.selection.get().length).toBe(size);

      // The LAST id, which is where a linear scan costs the most — a probe near
      // the front would hide the very regression this is written to catch.
      const probe = at(ids, size - 1, "selection probe");
      expect(store.selection.has(probe)).toBe(true);

      samples.push(
        measure("selection.has", `sel${size}`, size + 1, () => {
          store.selection.has(probe);
        }),
      );
    }

    const small = samples[0];
    const large = samples[1];
    expect(small !== undefined && large !== undefined && small > 0).toBe(true);
    if (small === undefined || large === undefined || small <= 0) return;
    expectConstantTime(large / small, "selection.has");
  }, 120_000);

  it("a content edit consults exactly one codec, whatever the graph size", () => {
    const perOp = new Map<string, number>();
    const reindexed = new Map<string, number>();

    for (const fx of wideSizes) {
      const command = editCommand(fx);
      assertProducesWork(command, fx);

      const counts = countOnce(() => {
        engine.applyCommand(fx.graph, command);
      });

      // ONE node edited => ONE `applyEdit`, plus one `serialize` and one `parse`
      // for the reducer's re-validation of the codec's own output. These are
      // CONSTANTS: they do not move when the graph grows 100x, and that is the
      // property worth pinning.
      expect(
        noteCount(
          "edit (one node)",
          fx.label,
          fx.nodeCount,
          "applyEdit",
          counts.applyEdit,
        ),
      ).toBe(1);
      expect(counts.serialize).toBe(1);
      expect(counts.parse).toBe(1);

      // The re-index is a constant too, and it is not obvious that it could be:
      // a `contentKey` can MOVE with the data, so an edit really can change
      // which bucket a node sits in. Reading the key off the before-value and
      // the after-value is enough to find out, and the graph is never walked.
      reindexed.set(
        fx.label,
        noteCount(
          "edit (one node)",
          fx.label,
          fx.nodeCount,
          "contentKey",
          counts.contentKey,
        ),
      );

      perOp.set(
        fx.label,
        measure("edit (one node)", fx.label, fx.nodeCount, () => {
          engine.applyCommand(fx.graph, command);
        }),
      );
    }

    const perEdit = expectIndependentOfGraphSize(
      reindexed,
      "edit content-key lookups",
    );
    // One node edited: its key before, its key after. Anything more means the
    // edit path started consulting nodes it did not change.
    expect(perEdit).toBeLessThanOrEqual(2);

    expectSubQuadratic(perOp, "content edit");
  }, 120_000);

  /**
   * AN INSERT RE-INDEXES WHAT ARRIVED, NOT THE DOCUMENT.
   *
   * `applyInserted` fell back to a whole-document `rebuildDerivedIndexes`
   * whenever ANY arriving node carried a content or source key — the gate
   * short-circuits on the first keyed node, so one keyed seed condemned the
   * whole batch. MEASURED, counting `contentKey`:
   *
   *   board      insert 1 keyless   insert 1 KEYED   remove 1 keyed
   *    1,000            0                1,002              1
   *   10,000            0               10,002              1
   *   40,000            0               40,002              1
   *
   * The removal direction has been incremental since it shipped
   * (`derivedIndexesAfterRemoval`) and costs ONE. Undo of a delete inverts to an
   * `inserted` patch and paid the full 40,001.
   *
   * The bound below is `arrivals + 1`, not `arrivals`: the `+1` is the gate
   * itself asking the first arrival for its key before deciding.
   */
  it("an insert re-indexes what arrived, not the document", () => {
    const reindexed = new Map<string, number>();

    for (const fx of wideSizes) {
      const command: Command<Types, Summary> = {
        type: "insert-nodes",
        toParentId: firstFolder(fx),
        toIndex: 0,
        seeds: [
          {
            kind: "clip",
            data: { title: "arrival", seconds: 3, assetId: "arriving-asset" },
          },
        ],
      };
      expect(engine.applyCommand(fx.graph, command).ok).toBe(true);

      const counts = countOnce(() => {
        engine.applyCommand(fx.graph, command);
      });
      reindexed.set(
        fx.label,
        noteCount(
          "insert (one keyed node)",
          fx.label,
          fx.nodeCount,
          "contentKey",
          counts.contentKey,
        ),
      );
    }

    // INDEPENDENCE at three sizes, because a per-size bound cannot tell a
    // constant from a number that happens to be small at the size examined.
    const perInsert = expectIndependentOfGraphSize(
      reindexed,
      "insert content-key lookups",
    );
    // One arriving node, plus the gate's own look at it.
    expect(perInsert).toBeLessThanOrEqual(2);
  }, 120_000);

  /**
   * THE SERVER-WRITE PATH, held to the same bill as the user-intent one.
   *
   * `applyIngestEdits` rebuilt BOTH derived indexes unconditionally, ignoring
   * the check `applyPatch`'s data arm has used since it shipped. Its comment
   * claimed parity with that arm — "the same thing `applyPatch` does after a
   * 'data-changed' patch" — which stopped being true when the arm gained its
   * guard, so the comment had become a description of the defect.
   *
   * MEASURED before the guard, counting `contentKey` on a key-preserving
   * one-node write: ingest asked 1,000 / 10,000 / 40,000 times at those three
   * sizes — exactly the reachable node count, a full document-order DFS — while
   * `edit-nodes` asked 2, flat. Per CALL, not per edit: a batch of twenty still
   * cost one whole walk.
   *
   * This is the path a thumbnail lands on.
   */
  it("a key-preserving ingest re-indexes no more than the equivalent command", () => {
    const ingestReindexed = new Map<string, number>();
    const editReindexed = new Map<string, number>();

    for (const fx of wideSizes) {
      const clips = firstFolderClips(fx);
      const target = at(clips, 0, "clips");
      // `seconds` is not what `contentKey` reads, so this write cannot move
      // either index — the shape of a duration or a thumbnail arriving.
      const edits = [
        { nodeId: target, kind: "clip", edit: { seconds: 99 } },
      ] as const;

      const ingestCounts = countOnce(() => {
        engine.applyIngest(fx.graph, createHistory<Types, Summary>(), edits);
      });
      ingestReindexed.set(
        fx.label,
        noteCount(
          "ingest (key-preserving)",
          fx.label,
          fx.nodeCount,
          "contentKey",
          ingestCounts.contentKey,
        ),
      );

      const editCounts = countOnce(() => {
        engine.applyCommand(fx.graph, { type: "edit-nodes", edits: [...edits] });
      });
      editReindexed.set(fx.label, editCounts.contentKey);
    }

    // The claim is INDEPENDENCE, asserted at three sizes, because a per-size
    // bound cannot tell a constant apart from a number that happens to be small
    // at the size being looked at.
    const perIngest = expectIndependentOfGraphSize(
      ingestReindexed,
      "ingest content-key lookups",
    );
    // Two per edited node — its key before and after — which is exactly what
    // the command path above is already held to.
    expect(perIngest).toBeLessThanOrEqual(2);

    // And stated as a relationship, not two separate numbers: the IO door must
    // not cost more than the user-intent door for the same write.
    for (const fx of wideSizes) {
      expect(ingestReindexed.get(fx.label)).toBeLessThanOrEqual(
        editReindexed.get(fx.label) ?? 0,
      );
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 10. Undo and redo
// ---------------------------------------------------------------------------

describe("undo and redo", () => {
  it("verification is O(patch) and replay re-indexes no more than the command did", () => {
    const roundTripPerOp = new Map<string, number>();
    const verifyPerOp = new Map<string, number>();
    const reindexed = new Map<string, number>();

    for (const fx of wideSizes) {
      const command = reorderCommand(fx);
      const store = engine.createStore(fx.graph);
      const dispatched = store.dispatch(command);
      expect(dispatched.ok).toBe(true);
      if (!dispatched.ok) return;

      // Both directions must actually work before either is timed — an undo
      // that rejects is fast and worthless as a measurement.
      expect(store.undo().ok).toBe(true);
      expect(store.redo().ok).toBe(true);

      const inverse = engine.invertPatch(dispatched.value);

      // `verifyPatchApplies` builds a LAZY children overlay: it copies only the
      // arrays the patch names, never the graph. This is the assertion that
      // pins that — if somebody replaces the overlay with a full copy, this
      // ratio moves from ~1 to ~10 and the test says so.
      expect(engine.verifyPatchApplies(store.getGraph(), inverse).ok).toBe(true);
      verifyPerOp.set(
        fx.label,
        measure("verifyPatchApplies (undo)", fx.label, fx.nodeCount, () => {
          engine.verifyPatchApplies(store.getGraph(), inverse);
        }),
      );

      const counts = countOnce(() => {
        engine.applyPatch(store.getGraph(), inverse);
      });
      reindexed.set(
        fx.label,
        noteCount(
          "applyPatch (undo)",
          fx.label,
          fx.nodeCount,
          "contentKey",
          counts.contentKey,
        ),
      );
      // Replay must never re-run a codec: the patch stores whole values, which
      // is exactly what makes an inverse impossible to get wrong.
      expect(counts.parse).toBe(0);
      expect(counts.applyEdit).toBe(0);

      // The real store path, both directions, as one repeatable round trip:
      // after undo+redo the graph and both stacks are back where they started.
      roundTripPerOp.set(
        fx.label,
        measure("undo + redo (store)", fx.label, fx.nodeCount, () => {
          store.undo();
          store.redo();
        }),
      );

      store.destroy();
    }

    // Undo goes through THE SAME index rewriter as the forward command — the
    // whole reason `applyPatch` is "the one index rewriter" — so the inverse of
    // a same-parent reorder inherits the same scoped re-index. If undo ever
    // costs more than the command it reverses, this is where it shows up.
    const perUndo = expectIndependentOfGraphSize(
      reindexed,
      "undo content-key lookups",
    );
    expect(perUndo).toBeLessThanOrEqual(WIDE_FANOUT + 1);

    expectSubQuadratic(roundTripPerOp, "undo + redo round trip");
    expectSubQuadratic(verifyPerOp, "verifyPatchApplies");
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 11. Folds — the memo table's whole claim
// ---------------------------------------------------------------------------

describe("folds", () => {
  it("a cold fold visits every node exactly once", () => {
    const perOp = new Map<string, number>();

    for (const fx of wideSizes) {
      const counts = countOnce(() => {
        expect(computeFold(fx.graph, durationFold, fx.rootId)).not.toBeUndefined();
      });

      // Exactly once. Not once per parent-child edge, and not twice for the
      // two-phase expand/collapse frames — the `results` map is what stops a
      // second visit re-entering the callback, and this is the assertion that
      // says so.
      expect(
        noteCount(
          "fold cold (no cache)",
          fx.label,
          fx.nodeCount,
          "foldCalls",
          foldCalls(counts),
        ),
      ).toBe(fx.nodeCount);

      perOp.set(
        fx.label,
        measure("fold cold (no cache)", fx.label, fx.nodeCount, () => {
          computeFold(fx.graph, durationFold, fx.rootId);
        }),
      );
    }

    expectSubQuadratic(perOp, "cold fold");
  }, 120_000);

  it("a warm fold is a single cache hit, at any size", () => {
    for (const fx of wideSizes) {
      // Sized to hold the whole graph. The DEFAULT limit is smaller than that
      // for a real document, and the next test measures what that costs — but
      // the memo's CLAIM is about a cache that can hold its subject, so that is
      // what gets asserted here.
      const cache: FoldCache = createFoldCache(fx.nodeCount * 4);
      const cold = countOnce(() => {
        computeFold(fx.graph, durationFold, fx.rootId, cache);
      });
      expect(foldCalls(cold)).toBe(fx.nodeCount);

      const warm = countOnce(() => {
        computeFold(fx.graph, durationFold, fx.rootId, cache);
      });

      // ZERO. The root's entry is keyed by its `subtreeRev`, nothing below it
      // moved, so the walk stops at the first frame and no callback runs at all.
      expect(
        noteCount(
          "fold warm (whole graph)",
          fx.label,
          fx.nodeCount,
          "foldCalls",
          foldCalls(warm),
        ),
      ).toBe(0);

      const coldNs = measure(
        "fold cold (fresh cache)",
        fx.label,
        fx.nodeCount,
        () => {
          computeFold(
            fx.graph,
            durationFold,
            fx.rootId,
            createFoldCache(fx.nodeCount * 4),
          );
        },
      );
      const warmNs = measure(
        "fold warm (whole graph)",
        fx.label,
        fx.nodeCount,
        () => {
          computeFold(fx.graph, durationFold, fx.rootId, cache);
        },
      );

      expect(coldNs / warmNs).toBeGreaterThan(WARM_FOLD_SPEEDUP_FLOOR);
    }
  }, 120_000);

  it("an incremental refold costs the ancestor chain, not the graph", () => {
    const refolded = new Map<string, number>();

    for (const fx of wideSizes) {
      const cache: FoldCache = createFoldCache(fx.nodeCount * 4);
      computeFold(fx.graph, durationFold, fx.rootId, cache);

      const edited = applyOrThrow(fx.graph, editCommand(fx), `${fx.label} edit`);

      const counts = countOnce(() => {
        expect(
          computeFold(edited, durationFold, fx.rootId, cache),
        ).not.toBeUndefined();
      });

      // THE MEMO TABLE'S WHOLE JUSTIFICATION, in one number. Editing one clip
      // bumps that clip and its ancestors and nothing else, so the refold
      // recomputes exactly: the clip, its folder, the root. Every other folder
      // is a cache hit at an unchanged revision, and its twenty children are
      // never looked at.
      //
      // The graph-blind `Fold` contract is what makes this SOUND rather than
      // lucky: a node's value depends only on its own data and its children's
      // values, so "invalidate the changed node and its ancestors" is provably
      // sufficient. A fold handed the graph could read anything, and the only
      // correct invalidation would then be "drop everything".
      refolded.set(
        fx.label,
        noteCount(
          "fold refold (1 leaf edited)",
          fx.label,
          fx.nodeCount,
          "foldCalls",
          foldCalls(counts),
        ),
      );
    }

    // The clip, its folder, the root — three, and the SAME three whether the
    // graph holds 100 nodes or 10,000. A per-size bound could not tell that
    // apart from a number that happens to be small; the equality across sizes
    // can.
    const perRefold = expectIndependentOfGraphSize(
      refolded,
      "incremental refold callbacks",
    );
    expect(perRefold).toBe(wide10k.depth);
  }, 120_000);

  it("the default cache holds a 10,000-node document; an undersized one falls off a cliff", () => {
    const fx = wide10k;
    const edited = applyOrThrow(fx.graph, editCommand(fx), "wide/10000 edit");

    // THE PROPERTY THE MEMO ACTUALLY DEPENDS ON, and it is a property of a
    // NUMBER rather than of an algorithm — which is exactly why it needs a test
    // holding it down. Every incremental-refold guarantee above assumes the
    // unchanged siblings are still IN the cache. The default limit has to clear
    // a realistic document or the guarantee quietly stops applying at the size
    // where it started to matter.
    expect(DEFAULT_FOLD_CACHE_LIMIT).toBeGreaterThanOrEqual(fx.nodeCount);

    const defaultCache: FoldCache = createFoldCache();
    expect(foldCalls(countOnce(() => {
      computeFold(fx.graph, durationFold, fx.rootId, defaultCache);
    }))).toBe(fx.nodeCount);
    // Nothing was evicted, so the whole graph is resident.
    expect(defaultCache.size()).toBe(fx.nodeCount);

    const defaultRefold = noteCount(
      "fold refold (default cache)",
      fx.label,
      fx.nodeCount,
      "foldCalls",
      foldCalls(
        countOnce(() => {
          computeFold(edited, durationFold, fx.rootId, defaultCache);
        }),
      ),
    );
    expect(defaultRefold).toBe(fx.depth);

    // AND THE CLIFF, built explicitly rather than by hoping the default is too
    // small. A cache that cannot hold its subject evicts the siblings the
    // incremental refold was going to skip, so the refold walks them again.
    //
    // The magnitude is REPORTED, not asserted: a bound like "this must cost
    // thousands of calls" would fail the day somebody makes eviction
    // subtree-aware, which is an improvement. What IS asserted is the only
    // direction that can never be an improvement — a cache must not make a
    // refold cost more than having no cache at all.
    const undersized: FoldCache = createFoldCache(512);
    expect(foldCalls(countOnce(() => {
      computeFold(fx.graph, durationFold, fx.rootId, undersized);
    }))).toBe(fx.nodeCount);
    expect(undersized.size()).toBe(512);

    const evictedRefold = noteCount(
      "fold refold (512-entry cache)",
      fx.label,
      fx.nodeCount,
      "foldCalls",
      foldCalls(
        countOnce(() => {
          computeFold(edited, durationFold, fx.rootId, undersized);
        }),
      ),
    );
    expect(evictedRefold).toBeLessThanOrEqual(fx.nodeCount);
    expect(evictedRefold).toBeGreaterThan(0);

    measure("fold cold+refold (512 cache)", fx.label, fx.nodeCount, () => {
      const scratch = createFoldCache(512);
      computeFold(fx.graph, durationFold, fx.rootId, scratch);
      computeFold(edited, durationFold, fx.rootId, scratch);
    });
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 12. Depth
// ---------------------------------------------------------------------------

describe("depth", () => {
  it("a 1,000-level chain loads, folds, moves, undoes and redoes", () => {
    const fx = deep1k;
    expect(fx.nodeCount).toBe(fx.depth + 1);

    const loadCounts = countOnce(() => {
      expect(engine.deserialize(fx.doc).ok).toBe(true);
    });
    expect(
      noteCount("deserialize", fx.label, fx.nodeCount, "parse", loadCounts.parse),
    ).toBe(fx.nodeCount);
    measure("deserialize", fx.label, fx.nodeCount, () => {
      engine.deserialize(fx.doc);
    });

    const foldCounts = countOnce(() => {
      expect(computeFold(fx.graph, durationFold, fx.rootId)).toEqual({
        value: 3,
        certainty: "exact",
      });
    });
    expect(
      noteCount(
        "fold cold (no cache)",
        fx.label,
        fx.nodeCount,
        "foldCalls",
        foldCalls(foldCounts),
      ),
    ).toBe(fx.nodeCount);
    measure("fold cold (no cache)", fx.label, fx.nodeCount, () => {
      computeFold(fx.graph, durationFold, fx.rootId);
    });

    // Hoisting the deepest clip to the root is the worst move this shape
    // admits: `isSameOrAncestor` walks the full chain for the cycle check and
    // `bumpSubtreeRevs` walks it again for the source side.
    const command: Command<Types, Summary> = {
      type: "move-nodes",
      nodeIds: [fx.deepestClipId],
      toParentId: fx.rootId,
      toIndex: 1,
    };
    const moved = engine.applyCommand(fx.graph, command);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(engine.findInvariantViolation(moved.value.graph)).toBeNull();

    const moveCounts = countOnce(() => {
      engine.applyCommand(fx.graph, command);
    });
    expect(
      noteCount(
        "move (deepest to root)",
        fx.label,
        fx.nodeCount,
        "contentKey",
        moveCounts.contentKey,
      ),
    ).toBeLessThanOrEqual(fx.nodeCount);
    measure("move (deepest to root)", fx.label, fx.nodeCount, () => {
      engine.applyCommand(fx.graph, command);
    });

    const store = engine.createStore(fx.graph);
    expect(store.dispatch(command).ok).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(true);
    measure("undo + redo (store)", fx.label, fx.nodeCount, () => {
      store.undo();
      store.redo();
    });
    store.destroy();

    // An edit at the bottom of a 1,000-level chain invalidates 1,000 ancestors,
    // so "an incremental refold is cheap" is a statement about DEPTH, not about
    // node count. This is the shape where it costs the whole graph — reported
    // plainly rather than dressed up.
    const cache: FoldCache = createFoldCache(fx.nodeCount * 4);
    computeFold(fx.graph, durationFold, fx.rootId, cache);
    const editedDeep = applyOrThrow(
      fx.graph,
      {
        type: "edit-nodes",
        edits: [
          { nodeId: fx.deepestClipId, kind: "clip", edit: { seconds: 42 } },
        ],
      },
      "deep edit",
    );
    const refoldCounts = countOnce(() => {
      computeFold(editedDeep, durationFold, fx.rootId, cache);
    });
    const refold = noteCount(
      "fold refold (1 leaf edited)",
      fx.label,
      fx.nodeCount,
      "foldCalls",
      foldCalls(refoldCounts),
    );
    // THE HONEST LIMIT OF THE MEMO TABLE, stated as a number. In a chain, the
    // deepest node's ancestor chain IS every other node, so "recompute the
    // changed node and its ancestors" recomputes the entire graph. The cache
    // buys nothing here, and no cache keyed on subtree revision ever could —
    // every revision on the path really did change.
    //
    // This is a property of the SHAPE, not a defect: it is the same 3 calls in
    // the product-shaped fixtures above. Worth measuring precisely because the
    // wide numbers are the ones people quote.
    expect(refold).toBe(fx.nodeCount);
  }, 120_000);

  it("10,000 levels do not overflow the stack on any walk", () => {
    const fx = deep10k;
    expect(fx.depth).toBe(DEEP_STACK_PROBE_LEVELS);

    // Every walk in this engine says "explicit stack, never recursion" in its
    // comments, and nobody had run one deep enough to find out. A recursive
    // implementation of any of these blows V8's stack well before 10,000
    // frames, and a `RangeError` thrown out of a React render is not
    // recoverable — which is why the assertion is that nothing throws, not that
    // anything is fast.
    expect(fx.graph.nodesById.size).toBe(fx.nodeCount);

    expect(computeFold(fx.graph, durationFold, fx.rootId)).toEqual({
      value: 3,
      certainty: "exact",
    });

    expect(engine.serialize(fx.graph).nodes.length).toBe(fx.nodeCount);
    expect(engine.findInvariantViolation(fx.graph)).toBeNull();

    const command: Command<Types, Summary> = {
      type: "move-nodes",
      nodeIds: [fx.deepestClipId],
      toParentId: fx.rootId,
      toIndex: 1,
    };
    expect(engine.applyCommand(fx.graph, command).ok).toBe(true);

    const store = engine.createStore(fx.graph);
    expect(store.dispatch(command).ok).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(true);
    // `selectRange` walks document order for a 10,000-deep chain — the one
    // selection path that touches the whole tree.
    store.selection.selectRange(fx.rootId, fx.deepestClipId);
    expect(store.selection.get().length).toBe(fx.nodeCount);
    store.destroy();

    measure("fold cold (no cache)", fx.label, fx.nodeCount, () => {
      computeFold(fx.graph, durationFold, fx.rootId);
    });
    measure("move (deepest to root)", fx.label, fx.nodeCount, () => {
      engine.applyCommand(fx.graph, command);
    });
  }, 180_000);
});
