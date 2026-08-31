// Graph — Wire shape parsing — the first of two trust boundaries.
//
// Split out of the former single-file `serialize.ts`; see ./index.ts.

import {
  describeValue,
  quoteFromWire,
  type Result,
  type SerializedDocument,
  type SerializedNode,
  type StructuralError,
} from "../types";



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
export type NodeDraft = {
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

export function fail(error: StructuralError): Result<never, StructuralError> {
  return { ok: false, error };
}

export function malformed(message: string): Result<never, StructuralError> {
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
          `schemaVersions[${quoteFromWire(kind)}] must be a finite number`,
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
