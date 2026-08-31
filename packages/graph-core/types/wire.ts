// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { ConsumerDefinedSummaryType, NodeTypeRegistry } from "./node-types";
import type { Issue, NodeId } from "./primitives";
import type { IngressError } from "./rejections";

// ---------------------------------------------------------------------------
// 7. Wire format
// ---------------------------------------------------------------------------

export type SerializedNode = Readonly<{
  id: string;
  kind: string;
  /** Present ⟺ `loaded`. Absent means read `childrenState`. */
  children?: readonly string[];
  /** Absent with `children` absent means `"unloaded"` — the migration-friendly
   *  default for documents written before the four states existed. */
  childrenState?: "unloaded" | "reference" | "missing";
  /** Only meaningful with `childrenState: "missing"`. */
  missingReason?: string;
  /**
   * The version THIS node's `data` was written at, overriding the document's
   * `schemaVersions` entry for its kind.
   *
   * Absent on every healthy node, and that is the point: a node that parsed
   * cleanly holds current data, so the document-level map already describes it
   * and writing a per-node copy on every node would bloat every document to
   * restate a fact it already carries.
   *
   * It exists for SEAL. A node sealed because its migration was
   * missing or threw still holds bytes from the version it was written at,
   * while `schemaVersions[kind]` says what the REGISTRY is at now. Re-emitting
   * those bytes under the registry's number is what made a sealed node
   * permanently unrepairable: the next build's `runMigrations` sees
   * `from >= to`, runs nothing, and hands old bytes to a new `parse`. This is
   * the escape hatch that keeps seal's promise — raw bytes AND the
   * version they belong to.
   */
  schemaVersion?: number;
  summary?: unknown;
  data: unknown;
}>;

/**
 * A FLAT node list — no recursion, no depth limit, and a sealed
 * container's children stay addressable and movable.
 *
 * Used for the whole graph AND for a lazily-loaded subtree. In the
 * sub-document case `rootIds` names the nodes that become the target's
 * children, and — unlike a top-level graph's roots — those need NOT be
 * containers. `loadChildren` takes a full document rather than a bare children
 * array precisely so MIGRATIONS RUN ON LAZY PAYLOADS TOO; the predecessor's
 * hydrate path silently skipped them.
 */
export type SerializedDocument = Readonly<{
  /** The ENGINE's structural format, not any kind's schema. */
  formatVersion: 1;
  /** PER KIND — one number cannot advance three independent schemas. */
  schemaVersions: Readonly<Record<string, number>>;
  rootIds: readonly string[];
  nodes: readonly SerializedNode[];
}>;

/**
 * Spec-compat alias for `SerializedDocument`.
 *
 * `SerializedDocument` now appears in exactly one signature — as what
 * `Engine.serialize` RETURNS, which graph constructs and can therefore vouch
 * for. The ingress doors take `unknown` and check, rather than taking this and
 * believing. That asymmetry is the point: this type is a guarantee on the way
 * out and would have been a fiction on the way in.
 */
export type SerializedGraph = SerializedDocument;

export type LoadReport = Readonly<{
  nodeCount: number;
  /** Nodes that landed as `SealedNode`. Empty is the happy path. */
  sealed: readonly IngressError[];
  migrated: readonly Readonly<{
    nodeId: NodeId;
    kind: string;
    from: number;
    to: number;
  }>[];
  /** Non-fatal complaints a node type raised via `ParseCtx.warn`. */
  warnings: readonly Readonly<{ nodeId: NodeId; issue: Issue }>[];
}>;

/**
 * Everything the pure modules need that is not the graph. Threading ONE bundle
 * instead of five loose parameters is the difference between six modules
 * agreeing and six modules drifting.
 */
export type EngineContext<S> = Readonly<{
  engineId: symbol;
  registry: NodeTypeRegistry;
  summary: ConsumerDefinedSummaryType<S>;
  onUnknownKind: "seal" | "reject";
  onParseFailure: "seal" | "reject";
  /** Ceiling on nodes in one document. See `EngineConfig.maxNodes`. */
  maxNodes: number;
  /** Ceiling on nesting depth, or `null` for unbounded. See
   *  `EngineConfig.maxDepth`. */
  maxDepth: number | null;
  mintId(): string;
  now(): number;
  /**
   * Enables the checks that are affordable in dev and not in prod. Every one is
   * REPORTED through `console.error` and never thrown, never turned into a
   * rejection, and never allowed to change what the engine stores: a document
   * that loads clean with this off must load clean with it on.
   *
   * WHAT ACTUALLY RUNS, and where — this list was aspirational for a long time
   * and named four audits the engine did not have (#590), so it is now written
   * as an inventory rather than an intention:
   *
   *   - DEEP-FREEZE of every parsed value, at `parseNodeData`'s success return
   *     and at the summary type. Catches a `serialize` that normalises its
   *     argument in place. Typed arrays are skipped — freezing one throws.
   *   - `parse(serialize(d))` ROUND-TRIP at those same two doors. Catches a
   *     `serialize` that drops a field `parse` keeps. Both sides of the
   *     comparison are parse OUTPUTS, so a normalising node type does not
   *     false-alarm.
   *   - UPSTREAM VS DOWNSTREAM at the edit door: what `applyEdit` returned
   *     against what the engine stored after its own round trip. Free, and
   *     strictly stronger there than the generic form, which cannot fail at
   *     that door.
   *   - THE OPT-IN `invertEdit`, verified as
   *     `applyEdit(applyEdit(d, e), invertEdit(e, d))` deep-equals `d`. A no-op
   *     for the many node types that declare no inverse.
   *   - THE SHADOW COLD REFOLD, on cache HITS ONLY and budgeted. A miss has
   *     nothing memoized to be wrong, so shadowing one buys a comparison that
   *     cannot fail — measured at 80% of executions before the rescope.
   *
   * A fifth audit runs behind this flag and is not one of the above: the graph
   * invariant walk after every commit. It predates the list.
   *
   * None of these can prove a consumer's node type actually validates — that is
   * genuinely unenforceable. Two further limits are worth knowing: the
   * comparator treats `Date`, `Map` and `Set` as `{}`, and freezing a `Map`
   * does not stop `map.set`.
   */
  devChecks: boolean;
}>;
