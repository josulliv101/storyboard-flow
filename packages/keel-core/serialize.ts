// KEEL — the wire, migrations, and the ingress trust boundary.
//
// PURE. No React, no DOM. Imports ./types and ./graph and nothing else.
//
// This module owns the only place untrusted content becomes typed `Data`.
// Every ingress in the engine funnels through `parseNodeData`: `deserialize`,
// `loadChildren`, `insert-nodes` seeds, and `applyIngest`. One door means one
// place migrations run, one place a node type's refusal is interpreted, and one
// place to look when forward-incompatible data shows up in production.
//
// TWO VERSION AXES, deliberately separate:
//   - `formatVersion` — the ENGINE's structural format (currently 1). It
//     describes the shape of the envelope: flat node list, rootIds, the
//     children encoding.
//   - `schemaVersions` — the CONSUMER's per-kind content schema. One number
//     per kind, because one number cannot advance three independent schemas
//     without forcing every node type to bump when any one of them changes.
//
// QUARANTINE, NOT REJECTION, IS THE DEFAULT. An unregistered kind or a failed
// parse becomes a `QuarantinedNode` that keeps its id, its position and its
// children, stays movable/removable/undoable, is NOT editable, poisons its
// ancestors' folds to `partial`, and re-emits its raw bytes exactly. This is
// not politeness — the alternative shipped: one refused stored clip made a
// whole document unwritable forever, and because the trash bin is rewritten
// on every delete, deleting *anything at all* became impossible. A document
// that will not load is a document the user cannot repair.
//
// Layout:
//   1. Shape parsing        — parseSerializedDocument
//   2. The content boundary — parseNodeData
//   3. Document building    — the shared pass both ingress doors run
//   4. deserializeDocument
//   5. serializeGraph
//   6. loadChildrenInto

import {
  describeThrown,
  deepFreezeBounded,
  structurallyEqualBounded,
  describeValue,
  makeCollectionNode,
  makeLeafNode,
  makeQuarantinedNode,
  tryParseNodeId,
  type GraphNode,
  type ChildrenState,
  type EngineContext,
  type Graph,
  type IngressError,
  type Issue,
  type LoadRejection,
  type LoadReport,
  type NodeId,
  type NodeTypeRegistry,
  type ParseCtx,
  type QuarantineReason,
  type Result,
  type SerializedDocument,
  type SerializedNode,
  type StructuralError,
} from "./types";

import {
  NO_DEAD_REVS,
  ancestorChain,
  ownsItsSubtree,
  bumpSubtreeRevs,
  childrenStateOf,
  documentOrder,
  getChildren,
  getNode,
  rebuildDerivedIndexes,
  sourceKeyOf,
} from "./graph";

// ---------------------------------------------------------------------------
// 1. Shape parsing
// ---------------------------------------------------------------------------

/** The three states the wire can spell. `loaded` is implied by a `children`
 *  array and is therefore never written here. */
type WireChildrenState = "unloaded" | "reference" | "missing";

/**
 * A mutable draft of `SerializedNode`. Optional keys are assigned only when
 * they were actually present, so a node that carried no `summary` re-emits
 * with no `summary` key rather than an explicit `undefined` — which matters
 * because the quarantine contract is byte-exact re-emit and a spurious key is
 * a byte.
 */
type NodeDraft = {
  id: string;
  kind: string;
  children?: readonly string[];
  childrenState?: WireChildrenState;
  missingReason?: string;
  /** Written only for a quarantined node — see `SerializedNode.schemaVersion`. */
  schemaVersion?: number;
  summary?: unknown;
  data: unknown;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  // `typeof null === "object"`, and an array is an object too. Both would slip
  // through a bare typeof check and then read as a document with every field
  // absent, which is a much more confusing failure than "malformed".
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWireChildrenState(value: unknown): value is WireChildrenState {
  return value === "unloaded" || value === "reference" || value === "missing";
}

/**
 * The default ceiling on nodes in one document.
 *
 * Sized from what this engine COSTS, not from a round number — the same
 * mistake `DEFAULT_FOLD_CACHE_LIMIT` was originally made of. Deserialize
 * measures at roughly a microsecond a node on the performance fixtures
 * (9.57 ms for 10,000), so 100,000 is where one document crosses ~100 ms of
 * blocking parse and becomes a visible hitch rather than a load. That is an
 * order of magnitude above the 10,000-node document those fixtures treat as
 * realistic.
 *
 * THIS NUMBER AND `DEFAULT_FOLD_CACHE_LIMIT` DO NOT AGREE, and an earlier
 * version of this comment claimed the opposite — that 100,000 sits "above the
 * 16,384 the fold cache is sized to hold, so the two ceilings cannot
 * contradict each other". The premise was the contradiction. That table holds
 * `foldCacheLimit / folds` NODES, not 16,384 unconditionally: the default is
 * 8 x 16,384 ENTRIES, and ./folds names an 8-fold registry as realistic, so
 * 16,384 nodes IS the default table's capacity and this ceiling admits 6.1x
 * it. MEASURED at 20,001 nodes with 8 folds — five times under this number,
 * and accepted by `deserialize`: 188,944 evictions, zero cache hits on an
 * identical repeat, 5,542 ms against 0.017 ms with the table sized to fit.
 *
 * The two are INDEPENDENT numbers describing one graph, and that is fine as
 * long as somebody notices when they disagree. `createEngine` compares them
 * and says so — see the diagnostic there. They are deliberately not derived
 * from one another: sizing the table from this ceiling would cost ~186 MB by
 * default, and lowering this ceiling to the table's capacity would refuse
 * documents that load today.
 *
 * A ceiling, not a target. It exists so that an unbounded payload cannot
 * decide this process's memory, and it should never fire on real data — a
 * consumer meeting it should raise `EngineConfig.maxNodes` and know what they
 * are buying, which is the whole reason it refuses loudly instead of trimming.
 */
export const DEFAULT_MAX_NODES = 100_000;

function fail(error: StructuralError): Result<never, StructuralError> {
  return { ok: false, error };
}

function malformed(message: string): Result<never, StructuralError> {
  return fail({ code: "malformed-document", message });
}

/**
 * Shape validator for an untrusted document. STRUCTURE ONLY — no node type runs
 * here, and no referential integrity is checked (dangling children, duplicate
 * ids, unreachable nodes and the forest condition all belong to
 * `deserializeDocument`, which needs the whole node set to judge them).
 *
 * It CONSTRUCTS a normalized document rather than asserting over the input,
 * for the same reason a node type's `parse` must construct: an assertion is a
 * promise the compiler cannot check, and a document that merely *looks* right
 * to a type predicate would then be indexed as if every field were the
 * declared type.
 */
export function parseSerializedDocument(
  raw: unknown,
  /**
   * Optional so the exported signature is unchanged for a consumer validating
   * a document on its own. `buildDocument` always passes one — that is the
   * path an untrusted payload takes.
   */
  bound?: Readonly<{ maxNodes: number; existingNodeCount: number }>,
): Result<SerializedDocument, StructuralError> {
  if (!isRecord(raw)) {
    return malformed(
      `Document must be an object, received ${raw === null ? "null" : typeof raw}`,
    );
  }

  // Checked before anything else: a future format may legally rearrange every
  // other field, so validating them against v1's rules would produce a
  // misleading complaint about a document we simply cannot read.
  if (raw.formatVersion !== 1) {
    return fail({
      code: "unsupported-format-version",
      message: `Unsupported formatVersion ${describeValue(raw.formatVersion)} (this engine reads 1)`,
    });
  }

  // NULL-PROTOTYPE, because the keys are consumer-chosen kind names arriving
  // off the wire. On a plain `{}`, `schemaVersions["__proto__"] = 1` does not
  // create an own property at all — the write is swallowed by the setter — and
  // `"constructor"`, `"toString"` and `"valueOf"` all READ as inherited
  // functions when nothing declared them, so an undeclared kind by any of
  // those names would answer with a function instead of `undefined`. A
  // document controls these names, so this is an ingress concern, not a
  // hypothetical.
  const schemaVersions: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  const rawVersions = raw.schemaVersions;
  // Absent is tolerated rather than fatal: a document may predate per-kind
  // versioning entirely, and `parseNodeData` has a defined answer for a kind
  // with no declared version. A present-but-wrong-shape value is fatal,
  // because that is a document claiming to declare versions and lying.
  if (rawVersions !== undefined) {
    if (!isRecord(rawVersions)) {
      return malformed("schemaVersions must be an object of kind -> number");
    }
    for (const [kind, value] of Object.entries(rawVersions)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return malformed(
          `schemaVersions[${JSON.stringify(kind)}] must be a finite number`,
        );
      }
      schemaVersions[kind] = value;
    }
  }

  if (!Array.isArray(raw.rootIds)) {
    return malformed("rootIds must be an array");
  }
  const rootIds: string[] = [];
  for (const rootId of raw.rootIds) {
    if (typeof rootId !== "string") {
      return malformed("rootIds must contain only strings");
    }
    rootIds.push(rootId);
  }

  if (!Array.isArray(raw.nodes)) {
    return malformed("nodes must be an array");
  }

  // THE SIZE BOUND, and this is the earliest point it can honestly live.
  //
  // It has to come after `formatVersion` (a document we cannot read at all is
  // not a size question) and after `nodes` is known to be an array, because
  // `.length` on a non-array means nothing. It has to come BEFORE the loop
  // below, which parses and copies every node — an earlier version of this
  // check sat in `buildDocument` AFTER this whole function had run, and its
  // comment claimed to be "before anything is allocated" while a hostile
  // payload had already been normalised in full. Measured at that time:
  // 199,999 nodes inspected before the refusal.
  //
  // `Array.prototype.length` is the O(1) fact the bound should be reading.
  if (bound !== undefined) {
    const total = bound.existingNodeCount + raw.nodes.length;
    if (total > bound.maxNodes) {
      return fail({
        code: "document-too-large",
        message:
          bound.existingNodeCount === 0
            ? `Document presents ${raw.nodes.length} nodes, above the ${bound.maxNodes} ceiling. ` +
              `Raise EngineConfig.maxNodes if this document is legitimate.`
            : `Loading ${raw.nodes.length} nodes into a graph of ${bound.existingNodeCount} would ` +
              `reach ${total}, above the ${bound.maxNodes} ceiling. Raise EngineConfig.maxNodes if ` +
              `this is legitimate.`,
        limit: bound.maxNodes,
        actual: total,
      });
    }
  }

  const nodes: SerializedNode[] = [];
  for (const rawNode of raw.nodes) {
    const parsed = parseSerializedNode(rawNode);
    if (!parsed.ok) return parsed;
    nodes.push(parsed.value);
  }

  return {
    ok: true,
    value: { formatVersion: 1, schemaVersions, rootIds, nodes },
  };
}

function parseSerializedNode(
  raw: unknown,
): Result<SerializedNode, StructuralError> {
  if (!isRecord(raw)) return malformed("Each node must be an object");
  if (typeof raw.id !== "string") return malformed("node.id must be a string");
  if (typeof raw.kind !== "string") {
    return malformed(`node ${JSON.stringify(raw.id)}: kind must be a string`);
  }

  // A missing `data` key is READ AS `undefined`, not rejected. JSON.stringify
  // drops keys whose value is `undefined`, so a kind whose `serialize` returns
  // `undefined` (a marker node, a kind whose whole content is its id) would
  // round-trip through our own writer and then fail to load. Requiring the key
  // would make the engine unable to read documents it wrote itself. The
  // node type's `parse` is the thing that decides whether `undefined` is
  // acceptable content for that kind — that is its job, not ours.
  const draft: NodeDraft = {
    id: raw.id,
    kind: raw.kind,
    data: "data" in raw ? raw.data : undefined,
  };

  if (raw.children !== undefined) {
    if (!Array.isArray(raw.children)) {
      return malformed(`node ${JSON.stringify(raw.id)}: children must be an array`);
    }
    const children: string[] = [];
    for (const childId of raw.children) {
      if (typeof childId !== "string") {
        return malformed(
          `node ${JSON.stringify(raw.id)}: children must contain only strings`,
        );
      }
      children.push(childId);
    }
    draft.children = children;
  }

  if (raw.childrenState !== undefined) {
    if (!isWireChildrenState(raw.childrenState)) {
      return fail({
        code: "invalid-children-state",
        message: `node ${JSON.stringify(raw.id)}: childrenState must be "unloaded", "reference" or "missing", received ${describeValue(raw.childrenState)}`,
        rawId: raw.id,
      });
    }
    draft.childrenState = raw.childrenState;
  }

  // Off the wire, so validated like everything else there. A non-finite or
  // non-numeric version would flow straight into `runMigrations`' bounds.
  if (raw.schemaVersion !== undefined) {
    if (typeof raw.schemaVersion !== "number" || !Number.isFinite(raw.schemaVersion)) {
      return malformed(
        `node ${JSON.stringify(raw.id)}: schemaVersion must be a finite number`,
      );
    }
    draft.schemaVersion = raw.schemaVersion;
  }

  if (raw.missingReason !== undefined) {
    if (typeof raw.missingReason !== "string") {
      return malformed(
        `node ${JSON.stringify(raw.id)}: missingReason must be a string`,
      );
    }
    draft.missingReason = raw.missingReason;
  }

  // Preserved verbatim; the summary type runs later, per node, and a failure
  // there is per-node content, not a malformed document.
  if ("summary" in raw) draft.summary = raw.summary;

  return { ok: true, value: draft };
}

// ---------------------------------------------------------------------------
// 2. The content trust boundary
// ---------------------------------------------------------------------------

function ingressError(
  nodeId: NodeId,
  kind: string,
  reason: QuarantineReason,
  issues: readonly Issue[],
): Result<never, IngressError> {
  return { ok: false, error: { nodeId, kind, reason, issues } };
}

/**
 * Runs migrations (ascending, keyed by TARGET, BEFORE parse) and then the
 * kind's `parse`. THE one content trust boundary.
 *
 * `args.container` is what the engine is ABOUT to treat this node as, and is
 * simply forwarded into `ParseCtx`. This function does not cross-check it
 * against `nodeType.container` — the caller computes it from the registry (for a
 * registered kind) or from the wire (for an unregistered one) and owns that
 * decision, so a check here would either be a tautology or a second opinion
 * that can disagree with the node actually built.
 */
/**
 * The two content dev checks, run together because they share a value and an
 * order: FREEZE FIRST, then round-trip. Freezing first is what makes the
 * round-trip safe — the extra `serialize` call it introduces is consumer code,
 * and a node type that normalises in place would otherwise mutate a value the
 * engine is about to store, making the graph differ between `devChecks: true`
 * and `false`. Frozen, that mutation throws into the try/catch and is reported.
 *
 * REPORTED, NEVER THROWN, and never converted into an `IngressError`. A node
 * that quarantines under `devChecks: true` and loads clean under `false` would
 * make the flag change what the document IS, which is the one thing a
 * diagnostic must not do.
 *
 * RE-ENTRY, and nothing structural prevents it: `reparse` MUST call the
 * node type's own `parse` directly. Routing the second parse back through
 * `parseNodeData` reaches this same gate and recurses without bound, once per
 * node, on every load.
 */
function runContentDevChecks(
  devChecks: boolean,
  what: string,
  value: unknown,
  serializeValue: () => unknown,
  reparse: (raw: unknown) => Result<unknown, readonly Issue[]>,
  skipRoundTrip: boolean,
): void {
  // FIRST STATEMENT, before any allocation — the same discipline `auditIfDev`
  // follows in ./engine. Everything below is dev-only cost.
  if (!devChecks) return;

  deepFreezeBounded(value);
  if (skipRoundTrip) return;

  let wire: unknown;
  try {
    wire = serializeValue();
  } catch (thrown) {
    console.error(
      `keel dev check: ${what} threw while serializing during the round-trip audit. ` +
        `Nothing is stored differently; the audit is skipped for this value. ` +
        describeThrown(thrown),
    );
    return;
  }

  let again: Result<unknown, readonly Issue[]>;
  try {
    again = reparse(wire);
  } catch (thrown) {
    console.error(
      `keel dev check: ${what} threw while re-parsing its own serialize output. ` +
        describeThrown(thrown),
    );
    return;
  }
  if (!again.ok) {
    console.error(
      `keel dev check: ${what} produced serialize output its own parse refuses. ` +
        `Its serialize and its parse disagree — the value stored is the ORIGINAL parse, ` +
        `so nothing is corrupted, but this document will not survive a save/load cycle.`,
      again.error,
    );
    return;
  }

  const verdict = structurallyEqualBounded(value, again.value);
  // "unknown" is silence. A comparator that could not see the whole value has
  // not found a violation, and reporting one would train the reader to ignore
  // this message.
  if (verdict !== false) return;
  // WORDING MATTERS: a non-idempotent `parse` produces this too, and it is a
  // different bug from a lossy `serialize`. Say what was observed, print both
  // halves, and let the reader decide which.
  console.error(
    `keel dev check: ${what} did not survive a parse(serialize(d)) round trip. ` +
      `Either serialize drops something parse keeps, or parse is not idempotent. ` +
      `before=${describeValue(value)} after=${describeValue(again.value)}`,
  );
}

export function parseNodeData<S>(
  ctx: EngineContext<S>,
  args: Readonly<{
    nodeId: NodeId;
    kind: string;
    container: boolean;
    /** The version the document declares for this kind. */
    schemaVersion: number;
    raw: unknown;
    /**
     * DEV CHECKS ONLY. Set by the edit door, where `raw` is already this
     * node type's own `serialize` output rather than wire data. The generic
     * `parse(serialize(d))` comparison is provably vacuous there — it would
     * re-derive a value from the same bytes it just came from — and costs two
     * consumer node-type calls per edited node on the interactive path. The edit
     * door runs its own, stronger comparison instead.
     */
    rawIsSerializeOutput?: boolean;
  }>,
): Result<
  Readonly<{
    data: unknown;
    migratedFrom: number | null;
    warnings: readonly Issue[];
  }>,
  IngressError
> {
  const nodeType = ctx.registry.get(args.kind);
  if (nodeType === undefined) {
    return ingressError(args.nodeId, args.kind, "unknown-kind", [
      {
        path: "$.kind",
        message: `No node type is registered for kind ${JSON.stringify(args.kind)}`,
      },
    ]);
  }

  const migration = runMigrations(
    args.raw,
    args.schemaVersion,
    nodeType.schemaVersion,
    nodeType.migrations,
  );
  if (!migration.ok) {
    return ingressError(args.nodeId, args.kind, "parse-failed", [
      migration.error,
    ]);
  }

  const warnings: Issue[] = [];
  const parseCtx: ParseCtx = {
    nodeId: args.nodeId,
    container: args.container,
    schemaVersion: nodeType.schemaVersion,
    warn(issue: Issue): void {
      warnings.push(issue);
    },
  };

  // A node type is consumer code, and an ingress door that throws takes the whole
  // document down — the exact failure quarantine exists to prevent. A thrown
  // parse is reported as the refusal it evidently is.
  let parsed: Result<unknown, readonly Issue[]>;
  try {
    parsed = nodeType.parse(migration.value.data, parseCtx);
  } catch (thrown) {
    return ingressError(args.nodeId, args.kind, "parse-failed", [
      {
        path: "$",
        message: `parse threw: ${describeThrown(thrown)}`,
      },
    ]);
  }

  if (!parsed.ok) {
    return ingressError(args.nodeId, args.kind, "parse-failed", parsed.error);
  }

  // Captured, not re-read inside the closures: TypeScript loses the `parsed.ok`
  // narrowing across a callback boundary, and the ternary that works around it
  // reads as though the failure case were reachable here. It is not.
  const parsedValue: unknown = parsed.value;
  runContentDevChecks(
    ctx.devChecks,
    `the ${JSON.stringify(args.kind)} node type (node ${JSON.stringify(args.nodeId)})`,
    parsedValue,
    () => nodeType.serialize(parsedValue),
    // DIRECTLY, never through `parseNodeData` — see the re-entry note above.
    // The second parse gets a THROWAWAY warn sink: reusing `warnings` would
    // double the entries `LoadReport.warnings` receives, so the report itself
    // would differ between dev-check modes.
    (raw) =>
      nodeType.parse(raw, {
        nodeId: args.nodeId,
        container: args.container,
        schemaVersion: nodeType.schemaVersion,
        warn: () => undefined,
      }),
    args.rawIsSerializeOutput === true,
  );

  return {
    ok: true,
    value: {
      data: parsed.value,
      migratedFrom: migration.value.migratedFrom,
      warnings,
    },
  };
}

/**
 * Applies every migration whose TARGET version lies in `(from, to]`, in
 * ascending order.
 *
 * The keys are collected and sorted rather than counted up from `from + 1`:
 * version numbers are consumer-chosen and may be sparse (1, 2, 7) or large
 * (a date-shaped 20260101), and a counting loop over a large gap would hang
 * the load path on a document that is merely unusual.
 */
function runMigrations(
  raw: unknown,
  from: number,
  to: number,
  migrations: Readonly<Record<number, (raw: unknown) => unknown>> | undefined,
): Result<Readonly<{ data: unknown; migratedFrom: number | null }>, Issue> {
  // `from > to` means the document was written by a NEWER build than this one.
  // No migration can walk backwards, so nothing runs and the value goes
  // straight to `parse` — a node type that tolerates unknown additive fields reads
  // it fine, and one that does not quarantines the node loudly. Refusing here
  // instead would turn every rolling deploy into a document that will not open.
  if (migrations === undefined || from >= to) {
    return { ok: true, value: { data: raw, migratedFrom: null } };
  }

  const targets: number[] = [];
  for (const key of Object.keys(migrations)) {
    const target = Number(key);
    if (!Number.isFinite(target)) continue;
    if (target > from && target <= to) targets.push(target);
  }
  if (targets.length === 0) {
    return { ok: true, value: { data: raw, migratedFrom: null } };
  }
  targets.sort((a, b) => a - b);

  let data = raw;
  for (const target of targets) {
    const migrate = migrations[target];
    if (migrate === undefined) continue;
    try {
      data = migrate(data);
    } catch (thrown) {
      // Reported as a parse failure with an Issue at `$.schemaVersion` rather
      // than earning a third `QuarantineReason`: the consumer-visible fact is
      // "we could not build this node", and the Issue carries which step lost.
      return {
        ok: false,
        error: {
          path: "$.schemaVersion",
          message: `Migration to version ${target} threw: ${describeThrown(thrown)}`,
        },
      };
    }
  }

  return { ok: true, value: { data, migratedFrom: from } };
}

// ---------------------------------------------------------------------------
// 3. Document building — the pass both ingress doors share
// ---------------------------------------------------------------------------

/**
 * A validated, content-parsed document, not yet a `Graph`. `parentById` maps
 * this document's own roots to `null`; `loadChildrenInto` re-points them at
 * the target it is filling.
 */
type BuiltDocument<Ts extends readonly unknown[], S> = Readonly<{
  /** Pre-order, parents first. Also the order the report is written in. */
  order: readonly NodeId[];
  rootIds: readonly NodeId[];
  nodesById: ReadonlyMap<NodeId, GraphNode<Ts, S>>;
  childrenById: ReadonlyMap<NodeId, readonly NodeId[]>;
  parentById: ReadonlyMap<NodeId, NodeId | null>;
  report: LoadReport;
}>;

/**
 * Walks an untrusted document into nodes, in passes, with an EXPLICIT STACK.
 * Never recursion: depth is hostile input, and a stack overflow inside a load
 * path is indistinguishable from a crash.
 *
 * `rootsMustBeContainers` is the one behavioural difference between the two
 * doors. A graph's roots are containers by definition; a lazily-loaded
 * sub-document's `rootIds` name the nodes that BECOME some target's children,
 * and a child may perfectly well be a leaf.
 */
function buildDocument<Ts extends readonly unknown[], S>(
  raw: unknown,
  ctx: EngineContext<S>,
  options: Readonly<{
    rootsMustBeContainers: boolean;
    /**
     * Nodes the destination graph ALREADY holds, which the incoming document's
     * own count is added to before the ceiling is applied. Zero for a fresh
     * `deserialize`; the live graph's size for a lazy load.
     *
     * The lazy door is why this exists. Bounding each payload on its own left
     * the ceiling trivially walkable — two loads of eight nodes each, under a
     * ceiling of ten, produced a graph of nineteen. That is the same shape
     * `MAX_CLOSURE_DOCUMENTS` guards in the predecessor, where the thing that
     * runs away is a closure walk accumulating documents and no single read is
     * ever the one that is too big.
     */
    existingNodeCount?: number;
    /**
     * How deep the payload's own roots already sit in the HOST graph.
     *
     * The exact companion to `existingNodeCount`, and it was missing for the
     * same reason that one was needed: `maxDepth` counted from each payload's
     * own roots and ignored where they were being attached, so the lazy door
     * walked straight past the ceiling. MEASURED before this existed: a
     * `maxDepth` of 3, then twelve successive one-node `store.load` calls each
     * attaching to the last, produced a graph 13 levels deep. Every one of
     * those payloads was legally 1 level deep on its own.
     *
     * 1 for the eager door, where the roots ARE the graph's roots.
     */
    existingDepth?: number;
  }>,
): Result<BuiltDocument<Ts, S>, StructuralError> {
  const parsed = parseSerializedDocument(raw, {
    maxNodes: ctx.maxNodes,
    existingNodeCount: options.existingNodeCount ?? 0,
  });
  if (!parsed.ok) return parsed;
  const doc = parsed.value;


  // --- Pass A: adopt the wire's ids -----------------------------------------
  const wireById = new Map<NodeId, SerializedNode>();
  for (const node of doc.nodes) {
    const id = tryParseNodeId(node.id);
    if (!id.ok) {
      return fail({
        code: "invalid-node-id",
        message: id.error.message,
        rawId: node.id,
        issues: [id.error],
      });
    }
    if (wireById.has(id.value)) {
      return fail({
        code: "duplicate-node-id",
        message: `Node id ${JSON.stringify(node.id)} appears more than once in nodes`,
        nodeId: id.value,
      });
    }
    wireById.set(id.value, node);
  }

  // --- Pass B: roots --------------------------------------------------------
  const rootIds: NodeId[] = [];
  const rootSet = new Set<NodeId>();
  for (const rawRootId of doc.rootIds) {
    const id = tryParseNodeId(rawRootId);
    if (!id.ok) {
      return fail({
        code: "invalid-node-id",
        message: id.error.message,
        rawId: rawRootId,
        issues: [id.error],
      });
    }
    if (!wireById.has(id.value)) {
      return fail({
        code: "unknown-root",
        message: `rootIds names ${JSON.stringify(rawRootId)}, which is not in nodes`,
        nodeId: id.value,
      });
    }
    if (rootSet.has(id.value)) {
      return fail({
        code: "duplicate-node-id",
        message: `rootIds names ${JSON.stringify(rawRootId)} more than once`,
        nodeId: id.value,
      });
    }
    rootSet.add(id.value);
    rootIds.push(id.value);
  }

  // --- Pass C: container-ness and children state ----------------------------
  const containerById = new Map<NodeId, boolean>();
  const stateById = new Map<NodeId, ChildrenState>();
  /** Leaf kinds that arrived carrying children. Quarantined in Pass F. */
  const shapeMismatchById = new Map<NodeId, Issue>();
  for (const [id, node] of wireById) {
    const nodeType = ctx.registry.get(node.kind);
    const hasChildren = node.children !== undefined;

    // For a REGISTERED kind the registry is the sole authority: `container` is
    // kind-level and immutable, never a predicate over data, so a wire that
    // disagrees is wrong rather than informative.
    //
    // For an UNREGISTERED kind there is no node type to ask, so the wire decides —
    // and the rule is "a children array or an explicit childrenState makes it
    // a container", NOT the "default to unloaded" rule below. That asymmetry
    // is what keeps quarantine round-tripping: `serializeGraph` writes an
    // explicit `childrenState: "unloaded"` for every non-loaded container, so
    // a quarantined node arriving with neither signal really was a leaf, and
    // guessing "unloaded container" would silently grow it a subtree it never
    // had.
    const container =
      nodeType !== undefined
        ? nodeType.container
        : hasChildren || node.childrenState !== undefined;

    if (!container) {
      // A LEAF KIND ARRIVING WITH CHILDREN IS QUARANTINED, NOT REJECTED.
      //
      // This was the last shape failure that took the whole document down,
      // while a node whose DATA failed to parse quarantined and everything
      // around it loaded. Nothing justified the asymmetry: both are one node's
      // wire form disagreeing with this build, and `QuarantineReason`'s own
      // doc already carried the argument — "one refused stored clip made a
      // whole document unwritable forever."
      //
      // HELD AS A CONTAINER, deliberately, and this is the part that matters.
      // The node declared children; they exist in the flat tree and something
      // must own them. Recording it as a leaf here would leave every one of
      // them parentless, which is the single thing this engine refuses to
      // produce. `QuarantinedNode` carries both `container` and a
      // `ChildrenState` precisely so this case has somewhere to land.
      const mismatch = hasChildren
        ? `carries a children array while kind ${JSON.stringify(node.kind)} is registered as a leaf`
        : node.childrenState !== undefined
          ? `carries childrenState ${JSON.stringify(node.childrenState)} while kind ${JSON.stringify(node.kind)} is registered as a leaf`
          : null;
      if (mismatch === null) {
        containerById.set(id, false);
        continue;
      }
      shapeMismatchById.set(id, {
        path: "$",
        message: `Node ${JSON.stringify(node.id)} ${mismatch}`,
      });
      // Fall through to the container arm below, so the declared children are
      // walked, counted and attached exactly as a real container's would be.
      // Pass F reads `containerById` and `stateById`, so the quarantined node
      // it builds gets both.
    }

    containerById.set(id, true);
    // A `children` array present means `loaded` and OUTRANKS `childrenState` —
    // the array is evidence, the tag is a claim. Both absent defaults to
    // `unloaded`, which is the migration-friendly reading for documents
    // written before the four states existed: it says "we have not looked",
    // which is true, rather than "it is empty", which would be a guess.
    const state: ChildrenState = hasChildren
      ? { status: "loaded" }
      : node.childrenState === "reference"
        ? { status: "reference" }
        : node.childrenState === "missing"
          ? { status: "missing", reason: node.missingReason ?? "" }
          : { status: "unloaded" };
    stateById.set(id, state);
  }

  // --- Pass D: child references, and the forest condition -------------------
  const childrenById = new Map<NodeId, readonly NodeId[]>();
  const parentById = new Map<NodeId, NodeId | null>();
  for (const [id, node] of wireById) {
    if (node.children === undefined) continue;
    const kids: NodeId[] = [];
    for (const rawChildId of node.children) {
      const child = tryParseNodeId(rawChildId);
      if (!child.ok) {
        return fail({
          code: "invalid-node-id",
          message: child.error.message,
          rawId: rawChildId,
          issues: [child.error],
        });
      }
      if (!wireById.has(child.value)) {
        return fail({
          code: "dangling-child",
          message: `Node ${JSON.stringify(node.id)} names child ${JSON.stringify(rawChildId)}, which is not in nodes`,
          nodeId: child.value,
        });
      }
      // "Each id appears at most once as a child" plus "roots appear as no
      // one's child" plus "every node is reachable" IS the forest condition —
      // it is checked by counting, in one pass, with no cycle walk. A cycle
      // among non-roots survives both of these checks and is caught by
      // reachability in pass E, because nothing in a cycle is reachable from a
      // root.
      if (parentById.has(child.value)) {
        return fail({
          code: "multi-parent",
          message: `Node ${JSON.stringify(rawChildId)} appears as a child more than once`,
          nodeId: child.value,
        });
      }
      if (rootSet.has(child.value)) {
        return fail({
          code: "multi-parent",
          message: `Node ${JSON.stringify(rawChildId)} is a root and also a child of ${JSON.stringify(node.id)}`,
          nodeId: child.value,
        });
      }
      parentById.set(child.value, id);
      kids.push(child.value);
    }
    childrenById.set(id, kids);
  }
  for (const id of rootIds) parentById.set(id, null);

  if (options.rootsMustBeContainers) {
    for (const id of rootIds) {
      if (containerById.get(id) !== true) {
        return fail({
          code: "root-not-container",
          message: `Root ${JSON.stringify(id)} is not a container`,
          nodeId: id,
        });
      }
    }
  }

  // --- Pass E: reachability, explicit stack, pre-order ----------------------
  const order: NodeId[] = [];
  const seen = new Set<NodeId>();
  const stack: NodeId[] = [];
  // A parallel array rather than pushing `{ id, depth }` objects: this walk
  // visits every node in the document, and one allocation per node to carry a
  // number is a cost the bound is supposed to be cheap enough to justify.
  const depths: number[] = [];
  for (let i = rootIds.length - 1; i >= 0; i -= 1) {
    const root = rootIds[i];
    if (root !== undefined) {
      stack.push(root);
      depths.push(options.existingDepth ?? 1);
    }
  }
  while (stack.length > 0) {
    const id = stack.pop();
    const depth = depths.pop();
    if (id === undefined || depth === undefined) break;
    if (seen.has(id)) continue;
    // Checked as the walk descends rather than by measuring afterwards, so a
    // document nested past the ceiling stops costing at the ceiling instead of
    // being fully walked and then refused.
    if (ctx.maxDepth !== null && depth > ctx.maxDepth) {
      return fail({
        code: "document-too-deep",
        message:
          `Document nests at least ${depth} levels, above the ${ctx.maxDepth} ceiling. ` +
          `Raise or clear EngineConfig.maxDepth if this document is legitimate.`,
        nodeId: id,
        limit: ctx.maxDepth,
        actual: depth,
      });
    }
    seen.add(id);
    order.push(id);
    const kids = childrenById.get(id);
    if (kids === undefined) continue;
    // Pushed in reverse so they pop in document order.
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      if (kid !== undefined) {
        stack.push(kid);
        depths.push(depth + 1);
      }
    }
  }
  if (seen.size !== wireById.size) {
    for (const node of doc.nodes) {
      const id = tryParseNodeId(node.id);
      if (id.ok && !seen.has(id.value)) {
        return fail({
          code: "unreachable-node",
          message: `Node ${JSON.stringify(node.id)} is not reachable from any root`,
          nodeId: id.value,
        });
      }
    }
    return malformed("Document contains nodes unreachable from any root");
  }

  // --- Pass F: content -----------------------------------------------------
  const nodesById = new Map<NodeId, GraphNode<Ts, S>>();
  const quarantined: IngressError[] = [];
  const migrated: {
    nodeId: NodeId;
    kind: string;
    from: number;
    to: number;
  }[] = [];
  const warnings: { nodeId: NodeId; issue: Issue }[] = [];

  for (const id of order) {
    const wire = wireById.get(id);
    if (wire === undefined) continue; // `order` came from `wireById`; unreachable.
    const container = containerById.get(id) === true;
    const state = stateById.get(id) ?? { status: "unloaded" };
    const nodeType = ctx.registry.get(wire.kind);

    // A SHAPE MISMATCH SHORT-CIRCUITS THE CONTENT PASSES. There is no point
    // migrating or parsing data for a node already known not to fit its own
    // kind, and running `parse` on it would report a second, derived failure
    // that tells the reader nothing about the real one.
    const shapeIssue = shapeMismatchById.get(id);

    // An UNDECLARED version is read as "this build's current version", not 0.
    // Guessing 0 replays every migration over data that may already be
    // current, which corrupts it silently and permanently. Guessing current
    // means genuinely old data reaches `parse` unmigrated, fails, and
    // QUARANTINES — loud, byte-exact, and repairable. Between a silent
    // corruption and a loud refusal, take the refusal.
    const declaredVersion =
      // THE NODE'S OWN VERSION WINS. Present only on a node re-emitted from
      // quarantine, where the document-level entry describes the registry
      // rather than these bytes. Absent everywhere else, so the map below stays
      // the answer for every healthy node.
      wire.schemaVersion ??
      // BELT AND BRACES, and unreachable today — verified by mutation: with the
      // null-prototype initializer in `parseSerializedDocument` in place,
      // reverting this guard fails nothing, because every `doc` reaching here
      // was built by that function. `SerializedDocument.schemaVersions` is
      // typed `Readonly<Record<string, number>>` though, so a refactor that let
      // a caller supply the document directly would reintroduce the hole
      // silently. Kept for that, not claimed as live.
      (Object.hasOwn(doc.schemaVersions, wire.kind)
        ? doc.schemaVersions[wire.kind]
        : undefined) ??
      nodeType?.schemaVersion ??
      0;

    let failure: IngressError | null =
      shapeIssue === undefined
        ? null
        : {
            nodeId: id,
            kind: wire.kind,
            reason: "shape-mismatch",
            issues: [shapeIssue],
          };
    let summaryFailed = false;
    let data: unknown = undefined;
    let summary: S | null = null;

    const parsedData = shapeIssue !== undefined
      ? null
      : parseNodeData(ctx, {
      nodeId: id,
      kind: wire.kind,
      container,
      schemaVersion: declaredVersion,
      raw: wire.data,
    });

    if (parsedData === null) {
      // A shape mismatch, already recorded above. Its DATA is never parsed:
      // running the node type on a node known not to fit its own kind reports a
      // second, derived failure that tells the reader nothing about the real
      // one. `raw` is carried through byte-exact, as with every quarantine.
    } else if (!parsedData.ok) {
      failure = parsedData.error;
    } else {
      data = parsedData.value.data;
      for (const issue of parsedData.value.warnings) {
        warnings.push({ nodeId: id, issue });
      }
      if (parsedData.value.migratedFrom !== null && nodeType !== undefined) {
        migrated.push({
          nodeId: id,
          kind: wire.kind,
          from: parsedData.value.migratedFrom,
          to: nodeType.schemaVersion,
        });
      }

      // A summary belongs to a collection; a leaf has nothing to summarize.
      // `null` and absent are BOTH read as "no summary" without calling the
      // node type: our own writer omits the key for a null summary, but a
      // hand-written or reformatted document spells it out, and handing `null`
      // to a node type that expects `S` would quarantine a node for the crime of
      // having no rollup yet.
      if (container && wire.summary !== undefined && wire.summary !== null) {
        // WRAPPED, exactly as `parseNodeData` wraps a node type's `parse`. The
    // summary type is consumer-supplied and runs on untrusted bytes, so a
    // throw here is the same class of event as a throw there — and it used to
    // take the whole `deserialize` down instead of quarantining one node,
    // which is the failure quarantine exists to prevent.
    let parsedSummary: Result<S, readonly Issue[]>;
    try {
      parsedSummary = ctx.summary.parse(wire.summary);
    } catch (thrown) {
      parsedSummary = {
        ok: false,
        error: [
          { path: "$", message: `summary parse threw: ${describeThrown(thrown)}` },
        ],
      };
    }
        if (!parsedSummary.ok) {
          // A failed summary is PER-NODE CONTENT, so it quarantines like any
          // other content failure rather than killing the document. The node
          // keeps its raw summary verbatim, its children stay addressable, and
          // the user can still delete or move it — which is the whole point of
          // quarantine.
          summaryFailed = true;
          failure = {
            nodeId: id,
            kind: wire.kind,
            reason: "parse-failed",
            issues: parsedSummary.error.map((issue) => ({
              path: `$.summary${issue.path.startsWith("$") ? issue.path.slice(1) : `.${issue.path}`}`,
              message: issue.message,
            })),
          };
        } else {
          summary = parsedSummary.value;
          runContentDevChecks(
            ctx.devChecks,
            `the summary type (node ${JSON.stringify(id)})`,
            parsedSummary.value,
            () => ctx.summary.serialize(parsedSummary.value),
            (raw) => ctx.summary.parse(raw),
            false,
          );
        }
      }
    }

    if (failure !== null) {
      const policy =
        failure.reason === "unknown-kind"
          ? ctx.onUnknownKind
          : ctx.onParseFailure;
      if (policy === "reject") {
        return fail({
          code: summaryFailed ? "summary-parse-failed" : "ingress-rejected",
          message: `Node ${JSON.stringify(wire.id)} (kind ${JSON.stringify(wire.kind)}) failed ingress: ${failure.reason}`,
          nodeId: id,
          issues: failure.issues,
          ingress: [failure],
        });
      }
      quarantined.push(failure);
      nodesById.set(
        id,
        makeQuarantinedNode({
          id,
          kind: wire.kind,
          container,
          // Carried from the wire so a round-trip through quarantine re-emits
          // the version the document actually declared, even for a kind this
          // build has never heard of.
          schemaVersion: declaredVersion,
          // `raw` is the node's DATA only, byte-exact. Its children live in
          // the flat tree, which is what keeps them addressable and movable.
          raw: wire.data,
          reason: failure.reason,
          issues: failure.issues,
          // A quarantined CONTAINER still needs its load state, or a document
          // that round-trips through quarantine forgets that a subtree was
          // unloaded. `null` on a quarantined leaf.
          children: container ? state : null,
          summary: wire.summary,
        }),
      );
      continue;
    }

    nodesById.set(
      id,
      container
        ? makeCollectionNode<Ts, S>(id, wire.kind, data, state, summary)
        : makeLeafNode<Ts>(id, wire.kind, data),
    );
  }

  return {
    ok: true,
    value: {
      order,
      rootIds,
      nodesById,
      childrenById,
      parentById,
      report: {
        nodeCount: order.length,
        quarantined,
        migrated,
        warnings,
      },
    },
  };
}

/**
 * The single-owner rule, checked over a whole graph.
 *
 * Two placements of one stored subtree are incoherent under lazy loading — the
 * predecessor coped only by never loading the second one, which is why a
 * complete branch could sit at "no duration" indefinitely. `sourceKey` makes
 * ownership a declared fact, and the engine refuses the second owner instead
 * of discovering it later.
 *
 * Leaves are exempt: `childrenStateOf` returns `null` for them, and a node
 * with no subtree cannot own one. Quarantined nodes are exempt too —
 * `sourceKeyOf` returns `null` for them, since the key comes from a node type that
 * by definition did not run.
 */
function findDuplicateOwner<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): StructuralError | null {
  const owners = new Map<string, NodeId>();
  for (const [id, node] of graph.nodesById) {
    // DELEGATED, not re-derived. This site had the RIGHT answer about leaves
    // and the other two did not; sharing one predicate is what stops that being
    // rediscovered a third time.
    if (!ownsItsSubtree(node)) continue;
    const key = sourceKeyOf(registry, node);
    if (key === null) continue;
    const existing = owners.get(key);
    if (existing !== undefined) {
      return {
        code: "duplicate-owner",
        message: `sourceKey ${JSON.stringify(key)} is owned by both ${JSON.stringify(existing)} and ${JSON.stringify(id)}; the second placement must be a reference`,
        nodeId: id,
      };
    }
    owners.set(key, id);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. deserializeDocument
// ---------------------------------------------------------------------------

/**
 * Whole-document load. Structural failures are fatal and return a
 * `StructuralError`; per-node content failures quarantine by default, keeping
 * id, position, children and byte-exact `raw`.
 */
export function deserializeDocument<Ts extends readonly unknown[], S>(
  raw: unknown,
  ctx: EngineContext<S>,
): Result<
  Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
  StructuralError
> {
  const built = buildDocument<Ts, S>(raw, ctx, { rootsMustBeContainers: true });
  if (!built.ok) return built;
  const doc = built.value;

  // Every node starts at revision 0. `subtreeRevById` is TOTAL over
  // `nodesById` — a missing entry would read as 0 through `getSubtreeRev` and
  // then never appear to change, so a card bound to it would never re-render.
  const subtreeRevById = new Map<NodeId, number>();
  for (const id of doc.order) subtreeRevById.set(id, 0);

  const base: Graph<Ts, S> = {
    engineId: ctx.engineId,
    nodesById: doc.nodesById,
    childrenById: doc.childrenById,
    parentById: doc.parentById,
    rootIds: doc.rootIds,
    subtreeRevById,
    // A freshly deserialized document has removed nothing.
    deadRevById: NO_DEAD_REVS,
    placementsByContentKey: new Map(),
    ownerBySourceKey: new Map(),
  };

  // Checked before the derived indexes are built, because
  // `rebuildDerivedIndexes` keeps one owner per key by construction and would
  // therefore make a second owner look like it never existed.
  const duplicate = findDuplicateOwner(base, ctx.registry);
  if (duplicate !== null) return fail(duplicate);

  return {
    ok: true,
    value: {
      graph: { ...base, ...rebuildDerivedIndexes(base, ctx.registry) },
      report: doc.report,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. serializeGraph
// ---------------------------------------------------------------------------

/**
 * Emits the flat wire form. TOTAL — it cannot fail, because a save path that
 * throws loses the user's document.
 *
 * NOTE: this serializes `node.summary` AS IT STANDS. It does NOT compute one.
 * A consumer that wants to refresh a stored summary computes a fold and passes
 * it through `summaryFrom`, which refuses anything but `exact` — persisting an
 * estimate compounds it on every save, which is how empty collections came to
 * store a duration that was never a measurement.
 */
export function serializeGraph<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  ctx: EngineContext<S>,
): SerializedDocument {
  // Null-prototype for the same reason the ingress side is — see
  // `parseSerializedDocument`. A kind named "constructor" must not read as
  // already-declared here.
  const schemaVersions: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  for (const [kind, nodeType] of ctx.registry) {
    schemaVersions[kind] = nodeType.schemaVersion;
  }

  const nodes: SerializedNode[] = [];
  const emitted = new Set<NodeId>();

  const writeChildren = (draft: NodeDraft, id: NodeId, state: ChildrenState | null): void => {
    if (state === null) return;
    if (state.status === "loaded") {
      draft.children = [...getChildren(graph, id)];
      return;
    }
    // Written EXPLICITLY even for "unloaded", which the reader would otherwise
    // default to anyway. The tag is what tells the reader this node is a
    // container at all when its kind is unregistered — without it, a
    // quarantined unloaded container reloads as a quarantined leaf and its
    // subtree becomes unreachable forever.
    draft.childrenState = state.status;
    if (state.status === "missing") draft.missingReason = state.reason;
  };

  const serializeData = (kind: string, data: unknown): unknown => {
    const nodeType = ctx.registry.get(kind);
    // Unreachable: a non-quarantined node was built by a node type found in this
    // very registry. Falling back to the live value rather than throwing keeps
    // this function total — an unserializable node should cost one node's
    // fidelity, never the whole save.
    if (nodeType === undefined) return data;
    // The SAME fallback, for the reachable version of the same problem. The
    // branch above handles a node type that is missing; this one handles a node type
    // that is present and throws, which is consumer code and therefore not
    // hypothetical. Leaving it bare contradicted this function's own policy one
    // line up and, worse, the module's promise that `serializeGraph` is TOTAL
    // "because a save path that throws loses the user's document".
    //
    // The live value is the best remaining representation: it is what the node type
    // was asked to encode, it is usually near-identical to the wire form, and
    // on reload it either parses or quarantines loudly. Both outcomes beat
    // losing the whole save.
    try {
      return nodeType.serialize(data);
    } catch (thrown) {
      console.error(
        `keel: ${JSON.stringify(kind)}.serialize threw while writing a node for save. ` +
          `That node is being written in its live form instead, which may not round-trip. ` +
          `The rest of the document is unaffected.`,
        thrown,
      );
      return data;
    }
  };

  const emit = (id: NodeId): void => {
    const node = graph.nodesById.get(id);
    if (node === undefined) return;
    emitted.add(id);

    if (node.quarantined) {
      const draft: NodeDraft = { id, kind: node.kind, data: node.raw };
      // A kind this build does not know still has a version, and it is the one
      // the document declared. First writer wins so the output is deterministic
      // in document order; a registered kind's registry version always wins,
      // because it was written above and is not overwritten here.
      if (!Object.hasOwn(schemaVersions, node.kind)) {
        schemaVersions[node.kind] = node.schemaVersion;
      }
      // AND on the node itself, unconditionally, because the document-level
      // entry above is only reachable for an UNREGISTERED kind — a registered
      // one had the registry's current version written before any node was
      // examined, and it wins. That is precisely the case that made quarantine
      // a one-way door: a node quarantined at v1 because the v2 migration threw
      // was re-emitted labelled v2, so the fixed build's `runMigrations` saw
      // `from >= to`, ran nothing, and handed v1 bytes to a v2 `parse`. The
      // node quarantined again, forever, and the mechanism that existed to
      // preserve it is what destroyed it.
      draft.schemaVersion = node.schemaVersion;
      if (node.summary !== undefined) draft.summary = node.summary;
      writeChildren(draft, id, node.children);
      nodes.push(draft);
      return;
    }

    const draft: NodeDraft = {
      id,
      kind: node.kind,
      data: serializeData(node.kind, node.data),
    };
    if (node.container) {
      // `null` is written as an absent key, and read back as `null`. Emitting
      // an explicit null would round-trip too, but only if the summary type
      // tolerated being handed one.
      if (node.summary !== null) {
        // Guarded like `serializeData`, and for the same reason: the summary
        // type is consumer code on the same footing as a node type, and its
        // `parse` half is already wrapped at ingress. A summary is a DERIVED
        // rollup, so dropping it costs strictly less than dropping a node —
        // the next reader sees an unloaded container with no stored estimate,
        // which is honest, where a thrown save loses everything.
        try {
          draft.summary = ctx.summary.serialize(node.summary);
        } catch (thrown) {
          console.error(
            `keel: the summary type's serialize threw while writing node ${JSON.stringify(id)} for save. ` +
              `Its stored summary is being omitted; the rest of the document is unaffected.`,
            thrown,
          );
        }
      }
      writeChildren(draft, id, node.children);
    }
    nodes.push(draft);
  };

  for (const id of documentOrder(graph)) emit(id);

  // Anything `documentOrder` could not reach is emitted anyway. An unreachable
  // node is an invariant violation the graph should never have contained, but
  // dropping it here would turn a detectable bug into silent data loss on
  // save; emitted, it makes the next load fail loudly with "unreachable-node".
  for (const id of graph.nodesById.keys()) {
    if (!emitted.has(id)) emit(id);
  }

  return {
    formatVersion: 1,
    schemaVersions,
    rootIds: [...graph.rootIds],
    nodes,
  };
}

// ---------------------------------------------------------------------------
// 6. loadChildrenInto
// ---------------------------------------------------------------------------

function loadRejection(error: LoadRejection): Result<never, LoadRejection> {
  return { ok: false, error };
}

/**
 * IO landing for a lazily-loaded subtree.
 *
 * Takes a FULL document rather than a bare children array, so MIGRATIONS RUN
 * ON LAZY PAYLOADS TOO — the predecessor's hydrate path silently skipped them,
 * which meant a subtree loaded on demand was parsed by rules its own document
 * had already outgrown.
 *
 * `doc` is `unknown` because it came from IO. The Engine method's
 * `SerializedDocument` parameter is the consumer's assertion, not a guarantee,
 * and re-validating here is the difference between a typed claim and a checked
 * one.
 *
 * Produces NO patch, NO history entry, NO change-feed event; bumps
 * `subtreeRev` along the target's chain so ancestor rollups re-render.
 *
 * LOADING IS MONOTONE — there is no `unload` in v1. That single property is
 * what makes `verifyPatchApplies` cheap and dormant history sound: a node that
 * existed when a patch was recorded still exists when it replays.
 */
export function loadChildrenInto<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
  doc: unknown,
  ctx: EngineContext<S>,
): Result<Graph<Ts, S>, LoadRejection> {
  if (graph.engineId !== ctx.engineId) {
    return loadRejection({
      code: "foreign-graph",
      message: "Graph was produced by a different engine instance",
      nodeId: id,
    });
  }

  const target = getNode(graph, id);
  if (target === undefined) {
    return loadRejection({
      code: "unknown-node",
      message: `No node ${JSON.stringify(id)} in this graph`,
      nodeId: id,
    });
  }

  // `childrenStateOf` returns null for a leaf, an unknown node, or a
  // QUARANTINED leaf — which is exactly the set that cannot be loaded into. A
  // quarantined CONTAINER can be: its kind failed to parse, but its subtree is
  // still real, still addressable, and refusing to load it would strand every
  // node underneath it.
  const state = childrenStateOf(graph, id);
  if (state === null) {
    return loadRejection({
      code: "not-a-container",
      message: `Node ${JSON.stringify(id)} is not a container`,
      nodeId: id,
    });
  }
  if (state.status !== "unloaded") {
    return loadRejection({
      code: "target-not-unloaded",
      message: `Node ${JSON.stringify(id)} is ${state.status}, not unloaded; only an unloaded owner can be filled`,
      nodeId: id,
    });
  }

  const built = buildDocument<Ts, S>(doc, ctx, {
    rootsMustBeContainers: false,
    existingNodeCount: graph.nodesById.size,
    // The payload's roots become THIS target's children, so they land one level
    // below it. `ancestorChain` excludes `id` itself, hence the +2: one for the
    // target, one for the children about to hang off it.
    existingDepth: ancestorChain(graph, id).length + 2,
  });
  if (!built.ok) {
    return loadRejection({
      code: "malformed-document",
      message: `Payload for ${JSON.stringify(id)} is not a usable document: ${built.error.message}`,
      nodeId: id,
      cause: built.error,
    });
  }
  const payload = built.value;

  const colliding: NodeId[] = [];
  for (const incoming of payload.order) {
    if (graph.nodesById.has(incoming)) colliding.push(incoming);
  }
  if (colliding.length > 0) {
    return loadRejection({
      code: "id-collision",
      message: `Payload for ${JSON.stringify(id)} reuses ${colliding.length} id(s) the graph already holds`,
      nodeId: id,
      collidingIds: colliding,
    });
  }

  const nodesById = new Map(graph.nodesById);
  for (const [incomingId, node] of payload.nodesById) {
    nodesById.set(incomingId, node);
  }
  nodesById.set(id, withLoadedChildren<Ts, S>(target, id));

  const childrenById = new Map(graph.childrenById);
  for (const [incomingId, kids] of payload.childrenById) {
    childrenById.set(incomingId, kids);
  }
  childrenById.set(id, payload.rootIds);

  const parentById = new Map(graph.parentById);
  for (const [incomingId, parent] of payload.parentById) {
    // The payload's own roots become THIS target's children.
    parentById.set(incomingId, parent === null ? id : parent);
  }

  const subtreeRevById = new Map(graph.subtreeRevById);
  // SEEDED ABOVE ANY TOMBSTONE, never unconditionally at 0 — the same rule
  // `applyInserted` follows with `if (!revs.has(node.id))`, and for the same
  // reason. `applyRemoved` leaves a removed id's revision behind deliberately,
  // because `subtreeRevById` is the fold cache's ONLY invalidation mechanism:
  // an entry keyed (foldKey, nodeId, rev) is meant to become unreachable once
  // the rev moves past it, so nothing ever has to evict.
  //
  // Writing 0 here walked a returning id back onto revisions its DEAD lineage
  // had already cached under different data. The `id-collision` guard above
  // does not catch it — that one rejects ids the graph CURRENTLY holds, and a
  // removed id is absent from `nodesById` while still present here. The gesture
  // is: read a clip's rollup, edit it, delete it, then have the server report
  // it inside a not-yet-loaded folder. Measured before this fix: the store
  // answered the dead clip's 4 while the truth was 999, at the clip AND at
  // every ancestor rollup, and it did not self-heal — each later edit landed on
  // the next already-poisoned rev.
  for (const incomingId of payload.order) {
    // The tombstone now lives in its own store, so this reads there rather than
    // in the live map — but the RULE is unchanged: an id that has lived here
    // before resumes strictly above every revision its previous lifetime could
    // have cached.
    //
    // The dead entry is NOT removed as the id returns. `applyRemoved` is the
    // only writer of that store, and leaving it alone is what keeps that true —
    // a returning id simply has a live entry that `getSubtreeRev` reads first,
    // and the stale dead number can only ever be overwritten upward by a later
    // removal of the same id.
    const tombstone = graph.deadRevById.get(incomingId);
    subtreeRevById.set(incomingId, tombstone === undefined ? 0 : tombstone + 1);
  }

  const base: Graph<Ts, S> = {
    engineId: graph.engineId,
    nodesById,
    // Shared by reference: a load removes nothing, so the tombstone store is
    // exactly the one the previous graph published.
    deadRevById: graph.deadRevById,
    childrenById,
    parentById,
    rootIds: graph.rootIds,
    // Bumped against the PRE-load graph on purpose: the ancestor chain is read
    // from `parentById`, and the target's ancestors are unchanged by loading.
    // The arriving nodes need no bump of their own — the loop above has already
    // seeded each one at 0, or above its tombstone if the id has lived here
    // before.
    subtreeRevById: bumpSubtreeRevs(subtreeRevById, graph, [id]),
    placementsByContentKey: new Map(),
    ownerBySourceKey: new Map(),
  };

  // Checked over the MERGED graph: the payload may name a sourceKey some other
  // placement already owns, which is a conflict that only exists once the two
  // documents are in the same graph.
  const duplicate = findDuplicateOwner(base, ctx.registry);
  if (duplicate !== null) {
    return loadRejection({
      code: "malformed-document",
      message: duplicate.message,
      nodeId: duplicate.nodeId ?? id,
      cause: duplicate,
    });
  }

  return {
    ok: true,
    value: { ...base, ...rebuildDerivedIndexes(base, ctx.registry) },
  };
}

/**
 * Rebuilds the target with `children: { status: "loaded" }`. Enumerated field
 * by field rather than spread: `QuarantinedNode` carries a `quarantined: true`
 * that `makeQuarantinedNode` adds itself, and the boundary constructors are
 * the only sanctioned way to mint a node.
 */
function withLoadedChildren<Ts extends readonly unknown[], S>(
  node: GraphNode<Ts, S>,
  id: NodeId,
): GraphNode<Ts, S> {
  if (node.quarantined) {
    return makeQuarantinedNode({
      id,
      kind: node.kind,
      container: node.container,
      schemaVersion: node.schemaVersion,
      raw: node.raw,
      reason: node.reason,
      issues: node.issues,
      children: { status: "loaded" },
      summary: node.summary,
    });
  }
  if (node.container) {
    return makeCollectionNode<Ts, S>(
      id,
      node.kind,
      node.data,
      { status: "loaded" },
      node.summary,
    );
  }
  // Unreachable: the caller established a non-null ChildrenState, which a leaf
  // never has.
  return node;
}
