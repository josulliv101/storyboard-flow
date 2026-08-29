// KEEL — every shared type in the engine core.
//
// PURE. No React, no DOM, no "use client", no dependencies. This module is
// imported by every other keel-core module AND by @storyboard/keel-react, so
// anything that lands here ships to a Node route handler as readily as to a
// browser bundle. That split is not stylistic: a `"use client"` module whose
// exports a route handler imports typechecks clean and 500s at request time,
// which is this repo's most expensive bug class.
//
// Layout:
//   1. Primitives      — NodeId, Result, Issue
//   2. Node types      — the per-kind codec registry and its factory
//   3. The graph       — nodes, children states, derived indexes
//   4. Commands        — the only user-intent mutation vocabulary
//   5. Patches         — the reversible record of a mutation
//   6. Rejections      — every Result-shaped failure, never thrown
//   7. Wire format     — serialization and ingress
//   8. Folds           — derived aggregates
//   9. History         — pure undo/redo values
//  10. Engine / Store  — the assembled surface
//  11. Boundary constructors — the only four places a cast is permitted

// ---------------------------------------------------------------------------
// 1. Primitives
// ---------------------------------------------------------------------------

declare const nodeIdBrand: unique symbol;

/**
 * Branded node id — a plain string at runtime, nominal at compile time.
 *
 * Engine-minted ONLY on the mutation paths: `insert-nodes` seeds carry values,
 * never ids, so a consumer cannot collide with a node it never saw. Ingress
 * paths (`deserialize`, `loadChildren`) adopt the ids on the wire.
 *
 * The brand is GLOBAL, not per-engine, so an id minted by engine A typechecks
 * against engine B. That residual hazard is covered at runtime by the
 * `engineId` check on every mutating call — reads stay unchecked because they
 * are the hot path. Documented, not fixed.
 */
export type NodeId = string & { readonly [nodeIdBrand]: true };

export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

/** One validation complaint. `path` is JSON-pointer-ish (`"$.durationSeconds"`). */
export type Issue = Readonly<{ path: string; message: string }>;

/**
 * Parse-or-throw for authoring-time-trusted ids — story fixtures, unit tests,
 * literals in consumer code that already holds the node. NEVER call this on
 * wire data; `tryParseNodeId` is the ingress door and it does not throw.
 *
 * The only rule is non-empty/non-whitespace: an id may contain ANY other
 * character. The predecessor engine string-sniffed a `"dup:"` prefix off ids
 * documented to permit anything, and shipped a bug where `scene/a` and
 * `timeline-e2e,comma` were misclassified and silently never loaded. Keel
 * carries no meaning in the id text at all — ownership is a node state
 * (`ChildrenState`), not a substring.
 */
export function parseNodeId(id: string): NodeId {
  const parsed = tryParseNodeId(id);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

/** The non-throwing form. Every ingress path uses this one. */
export function tryParseNodeId(id: string): Result<NodeId, Issue> {
  if (typeof id !== "string" || id.trim() === "") {
    return {
      ok: false,
      error: {
        path: "$.id",
        message: `Invalid NodeId: ${JSON.stringify(
          id,
        )} (must be a non-empty, non-whitespace string)`,
      },
    };
  }
  return { ok: true, value: id as NodeId };
}

// ---------------------------------------------------------------------------
// 2. Node types — the per-kind codec registry
// ---------------------------------------------------------------------------

/** Handed to `parse` so a codec can warn without failing, and can see whether
 *  the engine is about to treat this node as a container. */
export type ParseCtx = Readonly<{
  nodeId: NodeId;
  container: boolean;
  schemaVersion: number;
  warn(issue: Issue): void;
}>;

/**
 * One kind's codec: how its opaque `Data` is parsed, serialized, edited, and
 * (optionally) keyed for identity.
 *
 * ALL MEMBERS ARE METHOD SHORTHAND, NOT ARROW PROPERTIES. This is load-bearing
 * and it is verified, not assumed: under `strictFunctionTypes` an arrow
 * property is contravariant in its parameters, so `serialize: (data: Clip) =>
 * unknown` does NOT satisfy `serialize: (data: unknown) => unknown` and
 * `NodeType<"clip", Clip, ClipEdit>` would fail the `SomeNodeType` constraint
 * — every real node type rejected at the `createEngine` call. Method shorthand
 * stays bivariant, including through the `Readonly<>` wrapper (I compiled both
 * forms to confirm the wrapper preserves it). That bivariance is also what
 * lets the reducer call `type.applyEdit(node.data, edit.edit)` off an erased
 * `SomeNodeType` with no cast anywhere.
 *
 * The price is honest: bivariance is unsound, so a codec that lies about its
 * own Data type is not caught here. The trust boundary is enforceable; the
 * codec's interior is not.
 */
export type NodeType<K extends string, Data, Edit> = Readonly<{
  kind: K;
  /**
   * KIND-LEVEL and immutable — never a predicate over data. A kind that is
   * sometimes a container cannot have its children invariants checked, and
   * "does this node have children" would become a question about content.
   */
  container: boolean;
  schemaVersion: number;
  /**
   * Keyed by TARGET version, run BEFORE parse, never parse-then-migrate.
   * Applied in ascending order from the wire's version up to `schemaVersion`.
   * An arrow property is fine here only because neither parameter mentions
   * `Data`.
   */
  migrations?: Readonly<Record<number, (raw: unknown) => unknown>>;
  /**
   * Must CONSTRUCT a fresh value, never cast the input. The engine stores
   * exactly what this returns — it never reconstructs a node's data field by
   * field, which is what makes `Data` a real type parameter rather than a
   * whitelist the engine has to be taught. (The predecessor's field-by-field
   * reconstructor silently dropped every field it had not been taught.)
   */
  parse(raw: unknown, ctx: ParseCtx): Result<Data, readonly Issue[]>;
  serialize(data: Data): unknown;
  applyEdit(data: Data, edit: Edit): Result<Data, EditRejection>;
  /**
   * OPT-IN compaction, OFF by default. Undo works from whole-value
   * before/after pairs, which cannot be wrong; a wrong inverse corrupts
   * silently N undos later and is undetectable in production. Turn this on
   * when a profile demands it, not before. Dev-mode verifies it by checking
   * that `applyEdit(applyEdit(d, e).value, invertEdit(e, d))` deep-equals `d`.
   */
  invertEdit?(edit: Edit, before: Data): Edit;
  /** "Same asset" — enables the derived `placementsByContentKey` index. */
  contentKey?(data: Data): string | null;
  /**
   * "Same stored subtree" — enables the single-owner invariant. Two
   * placements of one collection are incoherent under lazy loading (the
   * shipped predecessor coped only by never loading the second one), so the
   * engine refuses a second non-`reference` placement for a `sourceKey`.
   */
  sourceKey?(data: Data): string | null;
}>;

/**
 * The erased registry element. Writable with `unknown` and no `any` ONLY
 * because of the method-shorthand rule above.
 */
export type SomeNodeType = NodeType<string, unknown, unknown>;

/**
 * CURRIED, and that is the whole point. `Edit` has exactly one inference site
 * (`applyEdit`'s second parameter), so an uncurried factory lets a codec whose
 * `applyEdit` ignores its edit argument silently infer `Edit = unknown` — at
 * which point every dispatched edit for that kind typechecks and the per-kind
 * edit typing is dead. Making `Data` and `Edit` explicit closes it while `K`
 * still infers as a string literal from the object.
 *
 *   const clipType = defineNodeType<Clip, ClipEdit>()({ kind: "clip", ... });
 */
export function defineNodeType<Data, Edit = never>(): <K extends string>(
  type: NodeType<K, Data, Edit>,
) => NodeType<K, Data, Edit> {
  return (type) => type;
}

/**
 * The runtime registry, keyed by kind. Built once by `createEngine`; duplicate
 * kinds are rejected there (see `buildRegistry` in ./graph).
 */
export type NodeTypeRegistry = ReadonlyMap<string, SomeNodeType>;

/** `S`'s own codec — the summary has its own lifecycle, separate from any kind. */
export type SummaryCodec<S> = Readonly<{
  parse(raw: unknown): Result<S, readonly Issue[]>;
  serialize(summary: S): unknown;
}>;

/** Every kind literal in the registry: `"clip" | "folder" | ...`. */
export type KindOf<Ts extends readonly unknown[]> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer K, infer _D, infer _E> ? K : never;
}[number];

/** The `Data` belonging to one kind — used by the React per-kind views. */
export type DataForKind<Ts extends readonly unknown[], K extends string> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer NK, infer D, infer _E>
    ? NK extends K
      ? D
      : never
    : never;
}[number];

/** The `Edit` belonging to one kind. */
export type EditForKind<Ts extends readonly unknown[], K extends string> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer NK, infer _D, infer E>
    ? NK extends K
      ? E
      : never
    : never;
}[number];

// ---------------------------------------------------------------------------
// 3. The graph
// ---------------------------------------------------------------------------

/**
 * FOUR states, not three, and not a boolean.
 *
 * The predecessor confesses the cost of collapsing them in its own source:
 * "No children in the graph means its document has not been loaded — or it is
 * genuinely empty, and the two are indistinguishable from here." Every
 * downstream compensation (an uncertainty flag threaded through preview
 * resolution, a defaulted `isKnownMissing` predicate that silently restores
 * the wrong behaviour when a call site forgets it, a 133-document branch stuck
 * at "no duration") is scar tissue from that one missing bit.
 *
 * `loaded` is the ONLY state with a `childrenById` entry. The other three have
 * none — checked BOTH ways by `findInvariantViolation`, so the two
 * representations cannot drift.
 */
export type ChildrenState =
  /** `childrenById` HAS an entry, possibly `[]`. This placement owns the subtree. */
  | Readonly<{ status: "loaded" }>
  /** No entry YET. This placement owns the subtree; `loadChildren` targets these. */
  | Readonly<{ status: "unloaded" }>
  /**
   * No entry EVER. Another placement owns this subtree. Structurally childless
   * forever, carrying only a summary — which is what makes the placement
   * forest a genuine tree and cycle detection decidable with no lazy-loading
   * caveat.
   */
  | Readonly<{ status: "reference" }>
  /**
   * Storage CONFIRMED gone ⇒ exactly empty. This is KNOWLEDGE, not absence of
   * it, which is why a subtree whose only gaps are `missing` folds to
   * certainty `"exact"`.
   */
  | Readonly<{ status: "missing"; reason: string }>;

/**
 * A childless node of some registered kind.
 *
 * Imprecision, called out so nobody chases it: this maps over the WHOLE
 * registry, so it names a `container: false` variant even for kinds declared
 * `container: true`. `container` is kind-level but not a literal type on
 * `NodeType`, so the tuple cannot be filtered on it. At runtime a container
 * kind never produces a `LeafNode`.
 */
export type LeafNode<Ts extends readonly unknown[]> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer K, infer D, infer _E>
    ? Readonly<{
        id: NodeId;
        /** Discriminant #1 of `AnyNode`. See the note on `AnyNode`. */
        quarantined: false;
        container: false;
        kind: K;
        data: D;
      }>
    : never;
}[number];

export type CollectionNode<Ts extends readonly unknown[], S> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer K, infer D, infer _E>
    ? Readonly<{
        id: NodeId;
        quarantined: false;
        container: true;
        kind: K;
        data: D;
        children: ChildrenState;
        /**
         * Present on EVERY collection, loaded or not — NOT only on
         * placeholders. Verified against the predecessor: a *loaded*
         * collection prefers its stored rollup in the uncertain case, so a
         * union that dropped this slot on load would delete the field that
         * rule needs and turn the write-back path into dead code.
         */
        summary: S | null;
      }>
    : never;
}[number];

/**
 * A migration that throws or returns garbage is reported as `"parse-failed"`
 * with an Issue at `$.schemaVersion` rather than earning a third reason — the
 * consumer-visible distinction that matters is "we could not build this", and
 * the Issue carries the detail.
 */
export type QuarantineReason = "unknown-kind" | "parse-failed";

/**
 * A node whose kind is unregistered, or whose parse failed.
 *
 * `raw` is the node's DATA only; its children stay in the flat tree, so
 * re-emit is byte-exact AND a child may still be moved out. Movable,
 * removable, undoable; NOT editable; poisons its ancestors' folds to
 * `"partial"`.
 *
 * Quarantine rather than rejection is the default because the alternative
 * shipped: one refused stored clip made a whole document unwritable forever,
 * and since the trash bin is rewritten on every delete, deleting *anything*
 * became impossible.
 *
 * `container` comes from the WIRE, not from a codec — there is no codec.
 */
export type QuarantinedNode = Readonly<{
  id: NodeId;
  quarantined: true;
  kind: string;
  container: boolean;
  schemaVersion: number;
  raw: unknown;
  reason: QuarantineReason;
  issues: readonly Issue[];
  /**
   * A quarantined CONTAINER still needs its load state, or a document that
   * round-trips through quarantine would forget that a subtree was unloaded.
   * `null` on a quarantined leaf.
   */
  children: ChildrenState | null;
  /** Carried through untouched — the summary codec is not the failing one. */
  summary: unknown;
}>;

/**
 * The read type. `QuarantinedNode` is a member ON PURPOSE: a consumer's
 * exhaustive switch does not compile until forward-incompatible data is
 * handled.
 *
 * DISCRIMINATE ON `quarantined` FIRST, THEN `container`:
 *
 *   if (node.quarantined) { ... }        // QuarantinedNode
 *   else if (node.container) { ... }     // CollectionNode
 *   else { ... }                         // LeafNode
 *
 * `container` alone cannot do it — it is `boolean` on the quarantined arm (it
 * comes off the wire), so it is not disjoint from the literal `true` / `false`
 * on the other two. That is why `LeafNode` and `CollectionNode` carry an
 * explicit `quarantined: false`.
 */
export type AnyNode<Ts extends readonly unknown[], S> =
  | LeafNode<Ts>
  | CollectionNode<Ts, S>
  | QuarantinedNode;

/**
 * The normalized graph — a pure value, replaced wholesale on every mutation.
 * Nothing here is mutated in place; `applyPatch` is the only code that
 * rewrites the indexes, so undo/redo cannot drift from forward application.
 */
export type Graph<Ts extends readonly unknown[], S> = Readonly<{
  /** Cross-instance guard. Checked on every mutating call and every ingress. */
  engineId: symbol;
  nodesById: ReadonlyMap<NodeId, AnyNode<Ts, S>>;
  /** EXACTLY the `loaded` collections — no other node has an entry. */
  childrenById: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** Total over `nodesById`. `null` for a root. */
  parentById: ReadonlyMap<NodeId, NodeId | null>;
  rootIds: readonly NodeId[];
  /**
   * ONE mechanism doing two jobs: aggregate cache key AND render
   * subscription. Bumped along the affected ancestor chains by EVERY
   * mutation — hydration, `markMissing` and `applyIngest` included, even
   * though those produce no patch.
   *
   * This closes a hole measured in the predecessor: its per-parent data
   * version deliberately did not bump for moves, on the reasoning that
   * "structure changes already announce themselves through the children
   * array's identity". True for a direct child list, FALSE for an ancestor's
   * rollup — move a node at depth 5 and no ancestor's children array changes
   * identity, so no ancestor rollup ever re-renders.
   *
   * TOTAL OVER `nodesById` AND NOTHING MORE: every live node has an entry, and
   * no id without a node does. A removed id's revision moves to `deadRevById`
   * rather than staying here — see there for why it is kept at all, and why
   * keeping it HERE cost a long session real time.
   */
  subtreeRevById: ReadonlyMap<NodeId, number>;
  /**
   * The revision each REMOVED id last held. A tombstone store.
   *
   * WHY THESE ARE KEPT. `subtreeRevById` is the fold cache's only invalidation
   * mechanism: an entry keyed (foldKey, nodeId, rev) is meant to become
   * unreachable once the rev moves past it, which is why nothing ever evicts
   * for correctness. Forgetting a removed id's revision restarts a re-inserted
   * id at 0, and the store then serves the DEAD lineage's cached values — a
   * wrong AGGREGATE at the root that does not self-heal. That shipped twice.
   *
   * WHY THEY LIVE HERE RATHER THAN BESIDE THE LIVE ONES. They used to sit in
   * `subtreeRevById`, which made it a superset of `nodesById` and — the part
   * that cost — put them inside the map every commit copies. Growth is exactly
   * one entry per ever-removed id, for the life of the store, so per-commit
   * cost tracked the number of nodes a session had ever DELETED rather than the
   * number it currently holds. MEASURED on one `edit-nodes`: 40us at zero
   * tombstones, 1.7ms at 20,000, 29.4ms at 200,400 — and confirmed to be the
   * copy, since a bare `new Map` on the same map tracked it at ratio ~1.0.
   *
   * Split out, the semantics are byte-for-byte what they were — same numbers,
   * same high-water rule, no eviction and no threshold — and the copy every
   * commit makes is proportional to LIVE nodes again. This map has exactly one
   * writer (`applyRemoved`) and is shared by reference by every commit that
   * removes nothing, which is nearly all of them.
   *
   * DISJOINT from `subtreeRevById` by construction: an id is live or dead,
   * never both. `getSubtreeRev` reads live first regardless, and invariant
   * check 6 asserts the disjointness rather than trusting it.
   */
  deadRevById: ReadonlyMap<NodeId, number>;
  /** Derived from `contentKey`. Values are in document order. */
  placementsByContentKey: ReadonlyMap<string, readonly NodeId[]>;
  /** Derived from `sourceKey`. At most one non-`reference` placement per key. */
  ownerBySourceKey: ReadonlyMap<string, NodeId>;
}>;

// ---------------------------------------------------------------------------
// 4. Commands — the only user-intent mutation vocabulary
// ---------------------------------------------------------------------------

/**
 * A value to insert. The engine mints the id; the consumer supplies content,
 * which is what makes "an insert is undoable" true by construction rather than
 * by convention.
 *
 * `data` is typed as the kind's `D`, and the engine STILL runs `parse` on it
 * and stores parse's OUTPUT — so a normalizing codec normalizes inserts too,
 * and a consumer handing in a value that violates its own invariants is caught
 * at the same door as wire data.
 *
 * `children` is only meaningful for a container kind; supplying it on a leaf
 * kind is rejected (`"leaf-seed-with-children"`). Omitted on a container means
 * a `loaded` empty collection.
 */
export type Seed<Ts extends readonly unknown[], S> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer K, infer D, infer _E>
    ? Readonly<{
        kind: K;
        data: D;
        children?: readonly Seed<Ts, S>[];
        summary?: S | null;
      }>
    : never;
}[number];

/** One node's content edit, paired with its own kind's edit type. */
export type EditOf<Ts extends readonly unknown[]> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer K, infer _D, infer E>
    ? Readonly<{ nodeId: NodeId; kind: K; edit: E }>
    : never;
}[number];

/**
 * ONE gesture = ONE command = ONE patch = ONE history entry. A rename across
 * every placement of an asset is a single `edit-nodes` over all of them, which
 * is what keeps Ctrl-Z matching what the user thinks they did.
 */
export type Command<Ts extends readonly unknown[], S> =
  | Readonly<{
      type: "move-nodes";
      nodeIds: readonly NodeId[];
      toParentId: NodeId;
      /**
       * POST-REMOVAL index — the index in the target's children array AFTER
       * the moved nodes have been taken out of it. Computing this is the most
       * re-derived, most often wrong arithmetic in a DnD engine (the
       * predecessor silently appended on cut+paste for exactly this reason),
       * so `resolveDrop` is the ONLY place it is computed and everything else
       * consumes the answer.
       */
      toIndex: number;
    }>
  | Readonly<{
      type: "insert-nodes";
      seeds: readonly Seed<Ts, S>[];
      toParentId: NodeId;
      toIndex: number;
    }>
  | Readonly<{
      type: "remove-nodes";
      nodeIds: readonly NodeId[];
      /**
       * Required to remove a container whose children are not loaded. The
       * patch then records only the placeholder plus its summary, and the
       * change feed reports it so the consumer can defer the hard delete.
       */
      allowUnloaded?: boolean;
    }>
  | Readonly<{ type: "edit-nodes"; edits: readonly EditOf<Ts>[] }>;

/**
 * What a pointer gesture produced, in PRE-removal coordinates — the numbers a
 * view can actually measure. `resolveDrop` turns this into a `Command` and is
 * the one place the post-removal conversion happens.
 *
 * No anchors (`{ after: X }`) in v1: anchors are the right answer for rebasing
 * concurrent edits, which v1 does not do, so adding them now doubles the
 * intent surface and buys nothing.
 */
export type DropIntent<Ts extends readonly unknown[], S> =
  | Readonly<{
      type: "move";
      nodeIds: readonly NodeId[];
      toParentId: NodeId;
      /** Index in the target's children array AS THE VIEW SEES IT NOW. */
      toIndexBefore: number;
    }>
  | Readonly<{
      type: "insert";
      seeds: readonly Seed<Ts, S>[];
      toParentId: NodeId;
      toIndexBefore: number;
    }>;

// ---------------------------------------------------------------------------
// 5. Patches — the reversible record of a mutation
// ---------------------------------------------------------------------------

/**
 * One node's relocation. Both endpoints in their own state's coordinates, so
 * inverting is swapping them.
 *
 * `fromParentId` is not redundant with the graph: a move has TWO ancestor
 * chains to bump, and the source chain exists only in the PRE-state
 * `parentById`. Reading it off the patch is what lets `applyPatch` bump both
 * without holding the old graph.
 */
export type Move = Readonly<{
  nodeId: NodeId;
  fromParentId: NodeId;
  fromIndex: number;
  toParentId: NodeId;
  toIndex: number;
}>;

/**
 * One node at one position. The SAME payload serves insertion and removal,
 * which is what makes add/remove trivially invertible.
 *
 * `node` is the FULL node, so a removed subtree is restorable exactly —
 * including a quarantined node's byte-exact `raw`.
 */
export type Placement<Ts extends readonly unknown[], S> = Readonly<{
  node: AnyNode<Ts, S>;
  parentId: NodeId;
  index: number;
}>;

/** One node's DATA change, structure untouched. Whole values, so inverting is a swap. */
export type DataChange<Ts extends readonly unknown[]> = {
  [I in keyof Ts]: Ts[I] extends NodeType<infer K, infer D, infer _E>
    ? Readonly<{ nodeId: NodeId; kind: K; before: D; after: D }>
    : never;
}[number];

/**
 * A patch carries NO rollups and NO derived values. A rollup in a patch is a
 * lie the moment anything moves.
 *
 * ORDER IS PART OF THE CONTRACT, because `invertPatch` preserves array order
 * and only flips the tag:
 *   - `inserted` — DOCUMENT ORDER, parents before children. `applyPatch` walks
 *     it FORWARD, inserting each at its `index`.
 *   - `removed` — the exact mirror: same array, same order, same indices.
 *     `applyPatch` walks it BACKWARD, so children leave before parents and a
 *     later sibling's splice cannot invalidate an earlier one's index.
 */
export type Patch<Ts extends readonly unknown[], S> =
  | Readonly<{ type: "moved"; moves: readonly Move[] }>
  | Readonly<{ type: "inserted"; placements: readonly Placement<Ts, S>[] }>
  | Readonly<{ type: "removed"; placements: readonly Placement<Ts, S>[] }>
  | Readonly<{ type: "data-changed"; changes: readonly DataChange<Ts>[] }>;

// ---------------------------------------------------------------------------
// 6. Rejections — every failure is Result-shaped, never thrown
// ---------------------------------------------------------------------------

/**
 * Deliberately FLAT rather than a fifteen-member discriminated union: the code
 * is a literal union (so a `switch` over it is still exhaustive-checkable) and
 * the context fields are optional. Six modules construct these; a flat shape
 * has one way to be written and cannot drift per-variant.
 */
export type RejectionCode =
  /** The graph came from a different engine instance. */
  | "foreign-graph"
  /** Zero nodes / zero seeds / zero edits. A no-op patch has no honest inverse. */
  | "empty-command"
  | "unknown-node"
  | "unknown-parent"
  | "unknown-kind"
  | "not-a-container"
  /** Dropping into `unloaded` / `reference` / `missing`. A post-removal index
   *  into children you have never seen has no honest value. This is a
   *  graph-level truth, not something to push to an app-level policy. */
  | "target-not-loaded"
  /** The same id twice in one move list — one removal, two insertions, one
   *  node in two children arrays. A blind retry did exactly this in
   *  production. */
  | "duplicate-node-ids"
  | "index-out-of-range"
  | "would-create-cycle"
  | "cannot-move-root"
  | "cannot-remove-root"
  /** Removing a container with a non-`loaded` subtree without `allowUnloaded`. */
  | "unloaded-subtree"
  /** The store was destroyed. Every mutating call refuses rather than writing
   *  into a graph nothing is listening to — see `Store.destroy`. */
  | "store-destroyed"
  /** A second non-`reference` placement for one `sourceKey`. Insert a
   *  `reference` instead — that is the typed answer the consumer is meant to
   *  give. */
  | "duplicate-owner"
  /** Quarantined nodes move and delete, but do not edit. */
  | "node-quarantined"
  /** `edit.kind` does not match the target node's kind. */
  | "kind-mismatch"
  /** The codec's own `applyEdit` said no. See `editRejection`. */
  | "edit-rejected"
  /** A seed's data failed its own `parse`. See `issues`. */
  | "parse-failed"
  | "leaf-seed-with-children"
  /**
   * A gesture that would push the graph past `EngineConfig.maxNodes` or
   * `maxDepth`.
   *
   * Named to mirror `would-create-cycle` rather than the ingress pair
   * `document-too-large` / `document-too-deep`, because the subject is
   * different: those describe a DOCUMENT that is already too big, this
   * describes a COMMAND that has not happened. The ceilings used to live only
   * on the ingress doors, so the reducer could grow a graph that
   * `engine.serialize` then emitted and `engine.deserialize` refused — the
   * engine producing documents it cannot read back.
   */
  | "would-exceed-max-nodes"
  | "would-exceed-max-depth"
  /** The consumer's PRE-commit `commandPolicy` vetoed it. */
  | "policy-rejected";

export type Rejection = Readonly<{
  code: RejectionCode;
  message: string;
  nodeIds?: readonly NodeId[];
  parentId?: NodeId;
  index?: number;
  kind?: string;
  sourceKey?: string;
  /** The existing owner, on `"duplicate-owner"`. */
  ownerId?: NodeId;
  issues?: readonly Issue[];
  /** The codec's verbatim complaint, on `"edit-rejected"`. */
  editRejection?: EditRejection;
  /** The ceiling that was hit, on the two `would-exceed-*` codes. Named the
   *  same as `StructuralError`'s pair so a consumer reporting a limit to the
   *  user reads it the same way whichever door refused. */
  limit?: number;
  /** What the graph WOULD have reached. */
  actual?: number;
}>;

/**
 * A codec's own refusal. Consumer-authored, so `code` is a free string — the
 * engine only relays it.
 */
export type EditRejection = Readonly<{
  code: string;
  message: string;
  issues?: readonly Issue[];
}>;

/**
 * Why a DORMANT patch can no longer be applied. Loading grows the graph while
 * history entries sleep, so every undo/redo is gated by `verifyPatchApplies` —
 * the predecessor reproduced two real corruptions from omitting exactly this
 * check.
 */
export type ReplayRejectionCode =
  | "foreign-graph"
  | "node-missing"
  | "node-exists"
  | "parent-missing"
  | "parent-not-loaded"
  | "index-out-of-range"
  /** Undoing an insert whose node has gained children since. */
  | "node-not-empty"
  | "kind-mismatch"
  /** The recorded `before` is no longer what the node holds. */
  | "data-mismatch"
  /**
   * Replaying this patch would put a second owner on one `sourceKey`.
   *
   * Reachable only because `applyIngest` is a NON-UNDOABLE write: it can move a
   * live node onto a key a sleeping patch still carries, and the replay would
   * then re-install the original owner beside it. Mirrors `RejectionCode`'s
   * member of the same name so a consumer handling one handles the other.
   */
  | "duplicate-owner"
  /** The store was destroyed. Every mutating call refuses rather than writing
   *  into a graph nothing is listening to — see `Store.destroy`. */
  | "store-destroyed";

export type ReplayRejection = Readonly<{
  code: ReplayRejectionCode;
  message: string;
  nodeId?: NodeId;
  parentId?: NodeId;
  index?: number;
}>;

export type LoadRejectionCode =
  | "foreign-graph"
  | "unknown-node"
  | "not-a-container"
  /** Only `unloaded` may be loaded. `reference` never owns; `loaded` is done;
   *  `missing` is a confirmed answer, not a gap. */
  | "target-not-unloaded"
  /** The incoming document reuses an id the host graph already holds. */
  | "id-collision"
  | "malformed-document"
  /** The store was destroyed. Every mutating call refuses rather than writing
   *  into a graph nothing is listening to — see `Store.destroy`. */
  | "store-destroyed";

export type LoadRejection = Readonly<{
  code: LoadRejectionCode;
  message: string;
  nodeId?: NodeId;
  collidingIds?: readonly NodeId[];
  /** Present on `"malformed-document"` — the document's own failure. */
  cause?: StructuralError;
}>;

/** The whole document is unusable. Per-node content failures do NOT land here
 *  by default — they quarantine. */
export type StructuralErrorCode =
  | "malformed-document"
  | "unsupported-format-version"
  | "invalid-node-id"
  | "duplicate-node-id"
  | "dangling-child"
  /** One id in two children arrays. Combined with "roots appear as no one's
   *  child", this IS the forest condition — checked by counting, in one pass,
   *  with an explicit stack. Never recursion: depth is hostile input. */
  | "multi-parent"
  | "invalid-children-state"
  | "unknown-root"
  | "root-not-container"
  | "unreachable-node"
  | "leaf-with-children"
  | "duplicate-owner"
  | "summary-parse-failed"
  /** `onUnknownKind` / `onParseFailure` was set to `"reject"`. */
  | "ingress-rejected"
  /** More nodes than `EngineConfig.maxNodes`. See `DEFAULT_MAX_NODES`. */
  | "document-too-large"
  /** Nested deeper than `EngineConfig.maxDepth`, which is opt-in. */
  | "document-too-deep";

export type StructuralError = Readonly<{
  code: StructuralErrorCode;
  message: string;
  nodeId?: NodeId;
  /** Raw id text, when it was too malformed to brand. */
  rawId?: string;
  issues?: readonly Issue[];
  /** Present on `"ingress-rejected"`. */
  ingress?: readonly IngressError[];
  /** Present on the two bound refusals: the ceiling that was in force, and
   *  what the document actually presented. A consumer telling a person why
   *  their document was refused needs both, and parsing them back out of
   *  `message` is not an interface. */
  limit?: number;
  actual?: number;
}>;

/**
 * One node failed the content trust boundary. Reported in `LoadReport` when
 * quarantined, or lifted into `StructuralError.ingress` when the engine is
 * configured to reject.
 */
export type IngressError = Readonly<{
  nodeId: NodeId;
  kind: string;
  reason: QuarantineReason;
  issues: readonly Issue[];
}>;

/** What `findInvariantViolation` reports. Both directions of every children
 *  rule are here, so `loaded` and `childrenById` cannot drift apart. */
export type ViolationCode =
  | "empty-node-id"
  | "duplicate-node-id"
  | "dangling-child"
  | "multi-parent"
  | "cycle"
  | "unreachable-node"
  | "root-not-container"
  | "root-is-child"
  | "leaf-with-children"
  | "loaded-collection-missing-children-entry"
  | "unloaded-collection-with-children"
  | "parent-index-disagrees"
  | "missing-parent-entry"
  | "missing-subtree-rev"
  | "duplicate-owner"
  | "derived-index-stale";

export type Violation = Readonly<{
  code: ViolationCode;
  message: string;
  nodeId?: NodeId;
  parentId?: NodeId;
  otherNodeId?: NodeId;
  sourceKey?: string;
}>;

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
   * It exists for QUARANTINE. A node quarantined because its migration was
   * missing or threw still holds bytes from the version it was written at,
   * while `schemaVersions[kind]` says what the REGISTRY is at now. Re-emitting
   * those bytes under the registry's number is what made a quarantined node
   * permanently unrepairable: the next build's `runMigrations` sees
   * `from >= to`, runs nothing, and hands old bytes to a new `parse`. This is
   * the escape hatch that keeps quarantine's promise — raw bytes AND the
   * version they belong to.
   */
  schemaVersion?: number;
  summary?: unknown;
  data: unknown;
}>;

/**
 * A FLAT node list — no recursion, no depth limit, and a quarantined
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

/** Spec-compat alias. `SerializedDocument` is the name used in every signature. */
export type SerializedGraph = SerializedDocument;

export type LoadReport = Readonly<{
  nodeCount: number;
  /** Nodes that landed as `QuarantinedNode`. Empty is the happy path. */
  quarantined: readonly IngressError[];
  migrated: readonly Readonly<{
    nodeId: NodeId;
    kind: string;
    from: number;
    to: number;
  }>[];
  /** Non-fatal complaints a codec raised via `ParseCtx.warn`. */
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
  summary: SummaryCodec<S>;
  onUnknownKind: "quarantine" | "reject";
  onParseFailure: "quarantine" | "reject";
  /** Ceiling on nodes in one document. See `EngineConfig.maxNodes`. */
  maxNodes: number;
  /** Ceiling on nesting depth, or `null` for unbounded. See
   *  `EngineConfig.maxDepth`. */
  maxDepth: number | null;
  mintId(): string;
  now(): number;
  /**
   * Enables the checks that are affordable in dev and not in prod: the
   * `parse(serialize(d))` round-trip, deep-freezing parsed values, verifying
   * an opt-in `invertEdit`, and the shadow cold refold. None of them can prove
   * a consumer's codec actually validates — that is genuinely unenforceable —
   * but they catch a lossy `serialize` and a wrong inverse.
   */
  devChecks: boolean;
}>;

// ---------------------------------------------------------------------------
// 8. Folds — derived aggregates
// ---------------------------------------------------------------------------

export type Certainty = "exact" | "estimated" | "partial";

/**
 * A UNION, not a flat `{ value; certainty: Certainty }` — a correction to the
 * spec's published shape, made because I compiled both.
 *
 * The persistence gate is `summaryFrom(f: ExactFolded<A>)`. With a flat
 * object, `Extract<Folded<A>, { certainty: "exact" }>` evaluates to `never`
 * (nothing to extract from a non-union), and `if (f.certainty === "exact")`
 * narrows the PROPERTY but not the object — so the gate cannot be called at
 * all and the whole mechanism is dead code. As a union, both work.
 *
 * It costs fold authors nothing: TypeScript distributes an object over a
 * discriminated-union target, so `{ value, certainty }` with a computed
 * `Certainty` still assigns (verified, fresh literal and pre-typed variable
 * alike).
 */
export type Folded<A> =
  | Readonly<{ value: A; certainty: "exact" }>
  | Readonly<{ value: A; certainty: "estimated" }>
  | Readonly<{ value: A; certainty: "partial" }>;

/** The only member `summaryFrom` accepts. */
export type ExactFolded<A> = Extract<Folded<A>, { certainty: "exact" }>;

/** A child's folded value plus the two facts a position-sensitive parent needs. */
export type FoldedChild<A> = Folded<A> &
  Readonly<{
    id: NodeId;
    /** `true` for `unloaded` / `reference` — the child is a stand-in, and its
     *  POSITION in the list is what decides whether that matters. */
    placeholder: boolean;
  }>;

/**
 * NOT a monoid. Three independent lines of evidence killed the monoid and the
 * decisive one was measured:
 *
 *  - `measure(data) => A` cannot express a subtree VETO (a container's own
 *    `disabled` flag dropping its whole subtree) or an empty-collection FLOOR,
 *    because by the time `concat` runs the vetoed subtree is already summed in
 *    and indistinguishable.
 *  - Weakest-wins certainty is position-blind, and the real rule is
 *    position-SENSITIVE: an unloaded branch AFTER the first media leaves the
 *    result correct, so the live answer still wins. Weakest-wins would discard
 *    a perfectly good live result — and with it a just-made edit — in favour
 *    of the stored summary.
 *  - A realistic `previews` monoid violates its own laws the moment a pending
 *    value is an unbounded array: `concat(empty, x)` truncates, `concat(x,
 *    empty)` does not.
 *
 * `collection` sees its own data (veto), the ORDERED children with each one's
 * certainty and `placeholder` flag (position-sensitivity), and
 * `children.length === 0` explicitly (the floor). All four expressible.
 *
 * GRAPH-BLIND is the load-bearing invariant, not a convenience: a node's value
 * depends only on its own data and its children's values, which is what makes
 * "invalidate the changed nodes and their ancestor chains" provably
 * sufficient. A fold handed the graph would make "drop everything" the only
 * correct invalidation.
 *
 * Method shorthand for the same reason as `NodeType`: `children` is a
 * PARAMETER mentioning `A`, so arrow properties would sink the
 * `Fold<Ts, S, unknown>` registry constraint.
 */
export type Fold<Ts extends readonly unknown[], S, A> = Readonly<{
  key: string;
  /** A leaf is always `"exact"` — only placeholders and quarantine introduce
   *  uncertainty, so the evaluator wraps this without asking. */
  leaf(node: LeafNode<Ts>): A;
  collection(
    node: CollectionNode<Ts, S>,
    children: readonly FoldedChild<A>[],
  ): Folded<A>;
  /** `unloaded` | `reference`. Reads `node.summary`. */
  placeholder(node: CollectionNode<Ts, S>): Folded<A>;
  /** MUST return certainty `"exact"`: confirmed-gone is knowledge. */
  missing(node: CollectionNode<Ts, S>): Folded<A>;
  /** REQUIRED — no default. Forward-incompatible data must be answered for. */
  quarantined(node: QuarantinedNode): Folded<A>;
}>;

export type SomeFold<Ts extends readonly unknown[], S> = Fold<Ts, S, unknown>;

export type FoldRegistry<Ts extends readonly unknown[], S> = Readonly<
  Record<string, SomeFold<Ts, S>>
>;

/** The `A` of a fold — `Folded<FoldValue<F["duration"]>>` is what `aggregate`
 *  returns. */
export type FoldValue<X> = X extends Fold<
  infer _Ts extends readonly unknown[],
  infer _S,
  infer A
>
  ? A
  : never;

/** Spec-compat alias for `FoldValue`. */
export type ValueOf<X> = FoldValue<X>;

/**
 * Cache slot keyed by `(foldKey, nodeId, subtreeRev)`. A stale entry is
 * therefore UNREACHABLE rather than wrong, which is what lets this be a plain
 * LRU beside the store while `Graph` stays a pure value.
 *
 * `get` returns a hit/miss union rather than `unknown | undefined` — those
 * collapse to `unknown`, and a legitimately-cached `undefined` would be
 * indistinguishable from a miss.
 */
export type FoldCache = Readonly<{
  get(
    foldKey: string,
    nodeId: NodeId,
    subtreeRev: number,
  ): Readonly<{ hit: true; value: unknown }> | Readonly<{ hit: false }>;
  set(foldKey: string, nodeId: NodeId, subtreeRev: number, value: unknown): void;
  clear(): void;
  size(): number;
}>;

// ---------------------------------------------------------------------------
// 9. History — pure values
// ---------------------------------------------------------------------------

/**
 * `command` is `null` for an entry the engine synthesized rather than a user
 * issuing it (currently only a coalesced merge, whose original commands no
 * longer describe the merged patch).
 */
export type HistoryEntry<Ts extends readonly unknown[], S> = Readonly<{
  command: Command<Ts, S> | null;
  patch: Patch<Ts, S>;
  /** Milliseconds since epoch, for display/inspection only. */
  at: number;
  /** Set by `dispatch(cmd, { coalesceKey })`; merges with the top entry when it
   *  matches — keeping the OLDEST `before` and the NEWEST `after`. */
  coalesceKey?: string;
}>;

/**
 * A PURE VALUE, unlike the predecessor's mutable handle. It has to be:
 * `applyIngest` rewrites both stacks and returns the new history alongside the
 * new graph, and a mutable history would make that operation unobservable and
 * untestable.
 */
export type History<Ts extends readonly unknown[], S> = Readonly<{
  /** Oldest first; the newest applied entry is LAST. */
  past: readonly HistoryEntry<Ts, S>[];
  /** The most-recently-undone entry is LAST (it is what `redo` takes next). */
  future: readonly HistoryEntry<Ts, S>[];
  /** Oldest entries fall off past this. `Number.POSITIVE_INFINITY` = unbounded. */
  limit: number;
}>;

// ---------------------------------------------------------------------------
// 10. Engine and Store
// ---------------------------------------------------------------------------

/**
 * What the persistence feed sees. `applyIngest`, `loadChildren` and
 * `markMissing` emit NOTHING here — they are IO landing, and the consumer
 * already knows about the write it just performed.
 */
export type Change<Ts extends readonly unknown[], S> = Readonly<{
  patch: Patch<Ts, S>;
  source: "command" | "undo" | "redo";
  /**
   * Removed containers whose subtrees were not loaded, so the consumer can
   * defer the hard delete instead of orphaning storage it never read.
   */
  detachedSubtrees: readonly NodeId[];
  at: number;
}>;

/**
 * A SEPARATE subscription slice. Never in the graph, never in a patch, never
 * undoable — but engine-owned all the same, because range-select needs
 * document order and removal must prune it. A selection change must NOT notify
 * graph subscribers.
 */
export type SelectionSlice = Readonly<{
  get(): readonly NodeId[];
  has(id: NodeId): boolean;
  set(ids: readonly NodeId[]): void;
  toggle(id: NodeId): void;
  clear(): void;
  /** Inclusive, in DOCUMENT order — which is why this lives beside the graph. */
  selectRange(anchorId: NodeId, toId: NodeId): void;
  anchor(): NodeId | null;
  subscribe(listener: () => void): () => void;
}>;

export type Store<
  Ts extends readonly unknown[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  getGraph(): Graph<Ts, S>;
  /** Fires when that node's `subtreeRev` changes — a primitive, so a selector
   *  store can compare it without touching the node. */
  subscribeToNode(id: NodeId, listener: () => void): () => void;
  subscribeToGraph(listener: () => void): () => void;
  /** The persistence feed. */
  subscribeToChanges(listener: (change: Change<Ts, S>) => void): () => void;
  dispatch(
    command: Command<Ts, S>,
    options?: Readonly<{ coalesceKey?: string }>,
  ): Result<Patch<Ts, S>, Rejection>;
  resolveDrop(intent: DropIntent<Ts, S>): Result<Command<Ts, S>, Rejection>;
  undo(): Result<Patch<Ts, S>, ReplayRejection>;
  redo(): Result<Patch<Ts, S>, ReplayRejection>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The non-undoable content write. Returns the ids whose history was scrubbed. */
  ingest(edits: readonly EditOf<Ts>[]): Result<readonly NodeId[], Rejection>;
  load(id: NodeId, doc: SerializedDocument): Result<void, LoadRejection>;
  markMissing(id: NodeId, reason: string): void;
  /** `undefined` when the node is gone — routine in React, where a card can
   *  outlive its node by a frame. */
  aggregate<K extends keyof F>(
    key: K,
    id: NodeId,
  ): Folded<FoldValue<F[K]>> | undefined;
  selection: SelectionSlice;
  destroy(): void;
}>;

/**
 * `undefined as never` at runtime — these exist so a consumer can write
 * `typeof engine.types.Node` instead of restating the registry tuple. Reading
 * one at runtime yields `undefined`; nothing should.
 */
export type PhantomTypes<
  Ts extends readonly unknown[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  Node: AnyNode<Ts, S>;
  Leaf: LeafNode<Ts>;
  Collection: CollectionNode<Ts, S>;
  Graph: Graph<Ts, S>;
  Command: Command<Ts, S>;
  Patch: Patch<Ts, S>;
  Edit: EditOf<Ts>;
  Seed: Seed<Ts, S>;
  Intent: DropIntent<Ts, S>;
  History: History<Ts, S>;
  Store: Store<Ts, S, F>;
  Summary: S;
  Kind: KindOf<Ts>;
  /**
   * The fold registry itself, and it is LOAD-BEARING rather than one more
   * convenience alias.
   *
   * `Engine` is a type ALIAS, so it is structurally expanded when TypeScript
   * infers against it — and everywhere else in `Engine` (and in `Store`, and in
   * the rest of this object) `F` appears only as `keyof F` or `F[K]`, which are
   * NON-INFERRABLE positions. Without one direct occurrence somewhere,
   * `createReactBindings(engine)` finds no candidate for `F` at all and falls
   * back to its constraint, at which point `keyof F` collapses to `string`,
   * `FoldValue<F[K]>` collapses to `unknown`, and every `useFold("duration", id)`
   * in every consumer returns `Folded<unknown>` — silently, with no error at the
   * definition site. `createEngine` is unaffected because it infers `F` from
   * `EngineConfig.folds`, which is a direct position; only downstream factories
   * taking a finished `Engine` are hit.
   *
   * This one property is that direct occurrence. Verified by compiling both.
   */
  Folds: F;
}>;

export type EngineConfig<
  Ts extends readonly SomeNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  /** Duplicate `kind` is REJECTED at runtime — it THROWS, because a duplicate
   *  is a programmer error at module init, not a recoverable condition. Two
   *  codecs claiming one kind means one silently wins at the trust boundary
   *  and the discriminant is dead. */
  types: Ts;
  summary: SummaryCodec<S>;
  folds: F;
  /** Default `"quarantine"`. */
  onUnknownKind?: "quarantine" | "reject";
  /** Default `"quarantine"`. */
  onParseFailure?: "quarantine" | "reject";
  /**
   * PRE-commit veto — it stops the pipeline before anything is pushed. A
   * post-commit veto corrupts redo: the push clears the redo branch, then the
   * subsequent undo pushes the REFUSED command onto it.
   */
  commandPolicy?(command: Command<Ts, S>, graph: Graph<Ts, S>): Rejection | null;
  mintId?(): string;
  /** Injectable so tests get deterministic `HistoryEntry.at`. Defaults to `Date.now`. */
  now?(): number;
  historyLimit?: number;
  /**
   * Ceiling on how many nodes ONE document may present to `deserialize`.
   * Defaults to `DEFAULT_MAX_NODES`.
   *
   * A payload arrives from storage or from the wire, which makes its size
   * hostile input rather than a known quantity, and every pass below builds
   * maps sized by it. Unbounded, a single malformed or malicious document
   * decides how much memory this process allocates.
   *
   * REFUSES, never truncates. A document half-loaded is a document with
   * silently missing children, and the whole point of the four-state
   * `ChildrenState` is that "we have not looked" is a state the engine can
   * name — a truncating loader would produce collections that claim to be
   * `loaded` and are not, which is the exact ambiguity that cost the
   * predecessor 40-second duration errors.
   */
  maxNodes?: number;
  /**
   * Live-node count past which each store warns ONCE that its commits no
   * longer fit an interactive frame. Defaults to
   * `DEFAULT_INTERACTIVE_NODE_BUDGET`; `0` silences it.
   *
   * NOT A CEILING, and specifically not `maxNodes` by another name. `maxNodes`
   * is a trust boundary on one incoming payload — it refuses hostile input so a
   * document cannot decide this process's memory. This is a property of ANY
   * graph however it got that big, including one that loaded at 900 nodes and
   * grew past the budget an insert at a time, which no load-time check can see.
   *
   * Set it when you know your documents are large and you have accepted what a
   * commit costs there — the number in `DEFAULT_INTERACTIVE_NODE_BUDGET` is
   * measured, not guessed, and a consumer who names their own has named THE
   * budget. Setting `0` is the same statement, said louder.
   */
  interactiveNodeBudget?: number;
  /**
   * Ceiling on nesting depth. Defaults to UNBOUNDED, deliberately.
   *
   * Depth is not a correctness risk here and a default would be a fiction:
   * every walk in this package uses an explicit stack, and the performance
   * suite loads, folds, moves, undoes and redoes a 10,000-level chain without
   * overflowing. What depth costs is ancestor-chain work, which is linear in
   * it — a real cost, but the consumer's to price, not this package's to
   * guess. Set it when your shape has a known ceiling and a deeper document
   * means corrupt data rather than unusual data.
   */
  maxDepth?: number;
  /**
   * Ceiling on EACH STORE's fold memo table. Defaults to
   * `DEFAULT_FOLD_CACHE_LIMIT`.
   *
   * The number that matters is `registered folds x nodes folded over`, not a
   * round one: `computeFold` commits an entry per node it walks, and every fold
   * in the registry shares its store's single cache. Below that product the LRU
   * inverts — the last fold's walk evicts the first fold's entries, and every
   * mounted card refolds its subtree from scratch, which is the un-memoized
   * behaviour the table exists to beat. Raise this when `onFoldCacheStats`
   * shows evictions climbing while hits do not.
   *
   * `0` or less disables memoization entirely (every write is a no-op) — what a
   * shadow-refold check that must not be answered from cache wants. Non-finite
   * falls back to the default rather than growing without bound.
   *
   * Safe to expose at all only because the cache key carries `subtreeRev`: an
   * evicted entry costs a recomputation and can never change an answer.
   */
  foldCacheLimit?: number;
  /**
   * Called ONCE per `createStore`, synchronously, with a reader for THAT
   * store's cache counters.
   *
   * Per store because the caches are per store — two divergent lineages must
   * never share one — so there is no engine-wide number to hand out instead.
   *
   * A reader, not the cache: a consumer that could WRITE to the table is the
   * one way to make a rev-keyed slot wrong rather than merely stale, and
   * observability does not need that power. It exists because a memo table that
   * has silently stopped helping is indistinguishable from one that never
   * helped — same answers, more work — so an undersized `foldCacheLimit` has no
   * other symptom.
   *
   * The parameter shape is spelled out here instead of importing
   * `FoldCacheStats` from ./folds: this module is the base of the package and
   * imports nothing, so a types -> folds edge would be a cycle. The two are
   * structurally identical and must stay so.
   */
  onFoldCacheStats?(
    readStats: () => Readonly<{
      /** Lifetime reads answered from the table. */
      hits: number;
      /** Lifetime reads that had to fold. */
      misses: number;
      /** Entries dropped FOR CAPACITY only — never by `clear()`. */
      evictions: number;
      /** Entries held right now. */
      size: number;
      /** The effective ceiling, after flooring and the non-finite fallback. */
      limit: number;
    }>,
  ): void;
  devChecks?: boolean;
}>;

export type Engine<
  Ts extends readonly unknown[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  engineId: symbol;

  // ---- untrusted doors: every one runs migrations, then parse ----
  deserialize(
    raw: unknown,
  ): Result<
    Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
    StructuralError
  >;
  serialize(graph: Graph<Ts, S>): SerializedDocument;

  // ---- the pure core ----
  applyCommand(
    graph: Graph<Ts, S>,
    command: Command<Ts, S>,
  ): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection>;
  /** THE ONE index rewriter — forward application and undo share it. */
  applyPatch(graph: Graph<Ts, S>, patch: Patch<Ts, S>): Graph<Ts, S>;
  invertPatch(patch: Patch<Ts, S>): Patch<Ts, S>;
  verifyPatchApplies(
    graph: Graph<Ts, S>,
    patch: Patch<Ts, S>,
  ): Result<void, ReplayRejection>;
  findInvariantViolation(graph: Graph<Ts, S>): Violation | null;
  /** THE ONLY place a post-removal insertion index is computed. */
  resolveDrop(
    graph: Graph<Ts, S>,
    intent: DropIntent<Ts, S>,
  ): Result<Command<Ts, S>, Rejection>;

  // ---- IO landing: no patch, no history entry, no change-feed event ----
  loadChildren(
    graph: Graph<Ts, S>,
    id: NodeId,
    doc: SerializedDocument,
  ): Result<Graph<Ts, S>, LoadRejection>;
  markMissing(graph: Graph<Ts, S>, id: NodeId, reason: string): Graph<Ts, S>;
  /**
   * THE NON-UNDOABLE CONTENT WRITE — the door no competing design had, and the
   * reason "one data field, no side table" survives contact with a real
   * consumer. Roughly half the fields on a realistic item have a writer that is
   * not user intent (a thumbnail arriving, a server stamping provenance). If
   * the only door into `data` is a command, then either Ctrl-Z undoes a
   * thumbnail, or a dormant whole-value `before` silently clobbers a server
   * write.
   *
   * It SCRUBS the history: for every ingested id, that node's entry is removed
   * from every `data-changed` patch in BOTH stacks, and the captured `data` for
   * that node is rewritten inside every dormant `inserted` / `removed`
   * placement. Content changes are per-node independent within a patch, so
   * surgical removal leaves every other change perfectly invertible. Structural
   * patches are untouched.
   *
   * The user loses undo of THEIR OWN edit to that one node — correct, the
   * server has since overwritten it — and keeps everything else. No clobber, no
   * stack truncation, no version mismatch that nukes the whole history.
   */
  applyIngest(
    graph: Graph<Ts, S>,
    history: History<Ts, S>,
    edits: readonly EditOf<Ts>[],
  ): Result<
    Readonly<{
      graph: Graph<Ts, S>;
      history: History<Ts, S>;
      scrubbed: readonly NodeId[];
    }>,
    Rejection
  >;

  aggregate<K extends keyof F>(
    graph: Graph<Ts, S>,
    key: K,
    id: NodeId,
  ): Folded<FoldValue<F[K]>> | undefined;
  createStore(graph: Graph<Ts, S>): Store<Ts, S, F>;
  types: PhantomTypes<Ts, S, F>;
}>;

// ---------------------------------------------------------------------------
// 11. Boundary constructors
// ---------------------------------------------------------------------------
//
// FOUR functions, and they are the ONLY place in keel-core where a cast is
// permitted.
//
// The soundness argument is the same for all four and worth stating once: the
// caller has just looked a codec up in the registry — where it is erased to
// `NodeType<string, unknown, unknown>` — and run its `parse`. The value in hand
// IS that kind's `Data`; the compiler simply cannot see through the erasure to
// prove it, because the registry is a `Map` and the mapped tuple is a
// compile-time-only correspondence.
//
// Concentrating that step here means the other seven modules construct nodes
// with no cast at all, and there is exactly one place to look when a node comes
// out shaped wrong. Casts go through `unknown`, never `any`.

/** Build a leaf whose `data` has already been through `parse`. */
export function makeLeafNode<Ts extends readonly unknown[]>(
  id: NodeId,
  kind: string,
  data: unknown,
): LeafNode<Ts> {
  const node: Readonly<{
    id: NodeId;
    quarantined: false;
    container: false;
    kind: string;
    data: unknown;
  }> = { id, quarantined: false, container: false, kind, data };
  return node as unknown as LeafNode<Ts>;
}

/** Build a collection whose `data` has already been through `parse`. */
export function makeCollectionNode<Ts extends readonly unknown[], S>(
  id: NodeId,
  kind: string,
  data: unknown,
  children: ChildrenState,
  summary: S | null,
): CollectionNode<Ts, S> {
  const node: Readonly<{
    id: NodeId;
    quarantined: false;
    container: true;
    kind: string;
    data: unknown;
    children: ChildrenState;
    summary: S | null;
  }> = {
    id,
    quarantined: false,
    container: true,
    kind,
    data,
    children,
    summary,
  };
  return node as unknown as CollectionNode<Ts, S>;
}

/**
 * A quarantined node needs no cast — `QuarantinedNode` is not generic, since
 * there is no codec and therefore no `Data`. Present for symmetry, and to keep
 * `raw` construction in one place: `raw` MUST be the value exactly as it
 * arrived, or re-emit stops being byte-exact.
 */
export function makeQuarantinedNode(
  args: Readonly<{
    id: NodeId;
    kind: string;
    container: boolean;
    schemaVersion: number;
    raw: unknown;
    reason: QuarantineReason;
    issues: readonly Issue[];
    children: ChildrenState | null;
    summary: unknown;
  }>,
): QuarantinedNode {
  return { quarantined: true, ...args };
}

/**
 * Re-brand a `Folded<unknown>` as the fold's own value type.
 *
 * Same erasure argument as the node constructors, one level up: `FoldRegistry`
 * is `Record<string, Fold<Ts, S, unknown>>`, so a fold looked up by key has
 * already lost its `A` — `computeFold` can only return `Folded<unknown>`, while
 * `aggregate<K>` promises `Folded<FoldValue<F[K]>>`. The correspondence between
 * the key and the fold's `A` is real but compile-time only, exactly as with a
 * kind and its `Data`.
 *
 * It takes a whole `Folded<unknown>` rather than a value and a certainty so the
 * certainty cannot be reconstructed wrongly at the one place the compiler has
 * stopped watching — `summaryFrom` gates persistence on that discriminant.
 */
export function makeFolded<A>(folded: Folded<unknown>): Folded<A> {
  return folded as unknown as Folded<A>;
}

/** Build a `DataChange` from values the registry erased. Same argument as above. */
export function makeDataChange<Ts extends readonly unknown[]>(
  nodeId: NodeId,
  kind: string,
  before: unknown,
  after: unknown,
): DataChange<Ts> {
  const change: Readonly<{
    nodeId: NodeId;
    kind: string;
    before: unknown;
    after: unknown;
  }> = { nodeId, kind, before, after };
  return change as unknown as DataChange<Ts>;
}

// ---------------------------------------------------------------------------
// Describing a throw
// ---------------------------------------------------------------------------

/**
 * The message to put in an `Issue` when consumer code threw instead of
 * returning.
 *
 * It lives HERE, in the module that imports nothing, because all four modules
 * that call into a consumer codec need it — ./serialize wraps `parse` and the
 * summary codec, ./commands wraps `applyEdit` and `serialize`, ./patches wraps
 * the `serialize` pair that replay verification compares on. One
 * implementation, so the three cannot drift into describing the same throw
 * three different ways.
 *
 * NOT re-exported from ./index: a consumer never calls this, it only ever reads
 * the strings it produces.
 *
 * `String(thrown)` rather than `JSON.stringify`: a thrown value is arbitrary,
 * `stringify` is recursive and can itself throw on a cycle or a BigInt, and a
 * helper whose whole job is to describe a failure must not have a failure mode
 * of its own.
 */
/**
 * `describeThrown`'s sibling, for an untrusted VALUE rather than a thrown one.
 *
 * `JSON.parse` is ITERATIVE in V8 and `JSON.stringify` is RECURSIVE, so a
 * payload that parsed perfectly well can still blow the stack while the engine
 * composes the refusal that rejects it — a throw out of a function whose whole
 * contract is a `Result`. It does not take an exotic input: ~6,000 levels is a
 * 12 KB request body, and the failure lands on the trust boundary where every
 * hostile document arrives.
 *
 * Also CLAMPED, which is a second and smaller problem the same edit closes: an
 * unclamped describer echoes a 5 MB string straight into a message a consumer
 * will log.
 *
 * NOT re-exported from ./index — a consumer reads the strings it produces and
 * never calls it.
 */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  // Primitives cannot nest, so they need no walk. `String` is safe on a symbol
  // where a template literal is not, and a function's source can be long, so
  // everything here still goes through the same clamp.
  if (typeof value !== "object" && typeof value !== "string") {
    return clamp(String(value));
  }
  try {
    const text = JSON.stringify(value);
    // `stringify` answers `undefined` for a function or a bare symbol.
    if (text === undefined) return typeof value;
    return clamp(text);
  } catch {
    // Stack exhaustion, or a cycle. Either way the shape is all that can be
    // said safely, and the stack is fully usable again once the frame unwinds.
    return Array.isArray(value) ? "[deeply nested array]" : "[deeply nested object]";
  }
}

const DESCRIBE_LIMIT = 120;

function clamp(text: string): string {
  return text.length > DESCRIBE_LIMIT
    ? `${text.slice(0, DESCRIBE_LIMIT - 3)}...`
    : text;
}

export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
}

// ---------------------------------------------------------------------------
// Dev-check primitives — bounded, total, and deliberately NOT the production
// versions of the same ideas
// ---------------------------------------------------------------------------

/**
 * Default step budget for the two helpers below. Large enough that no honest
 * timeline payload reaches it, small enough that a pathological one costs
 * microseconds rather than seconds.
 */
export const DEV_CHECK_BUDGET = 20_000;

/**
 * Structural equality that is allowed to say "I don't know".
 *
 * WHY THIS IS NOT `deepEqual` FROM ./patches, and why ~35 lines of deliberate
 * duplication is the right price. That function has one production caller —
 * `verifyPatchApplies` — which needs a DEFINITE verdict: a budget bail there
 * would surface as a spurious `data-mismatch` refusal of a legitimate undo,
 * which is a production behaviour change made by a dev-check refactor. The
 * audit needs a comparator that can abstain; production needs one that cannot.
 * They are different functions and must stay so.
 *
 * BOUNDED, and that is the whole point. A PARSED value may legitimately hold a
 * back-pointer, and the unbounded walk does not terminate on one — measured, a
 * verbatim transcription of `deepEqual` ran 2,000,000 iterations on `a.self=a`
 * vs `b.self=b` without finishing. The step counter is simultaneously the cycle
 * guard and the cost bound.
 *
 * `"unknown"` is SILENCE at every call site, never a report. A check that
 * cannot see the whole value has not found a violation.
 *
 * KNOWN BLIND SPOT, documented rather than fixed: `Date`, `Map`, `Set` and
 * class instances all present as `{}` here, so two different `Date`s compare
 * EQUAL. Timeline payloads are wire-shaped — JSON scalars, arrays and plain
 * objects — and widening this to structural equality over host types is a
 * bigger contract than a dev check should own.
 */
export function structurallyEqualBounded(
  a: unknown,
  b: unknown,
  budget: number = DEV_CHECK_BUDGET,
): true | false | "unknown" {
  // Explicit stack, never recursion: the same rule ./patches states for the
  // production comparator — nesting depth is hostile input.
  const stack: Readonly<{ left: unknown; right: unknown }>[] = [
    { left: a, right: b },
  ];
  let steps = 0;
  while (stack.length > 0) {
    if (++steps > budget) return "unknown";
    const frame = stack.pop();
    if (frame === undefined) break;
    const { left, right } = frame;
    // Object.is, not ===, so a codec that legitimately stores NaN compares
    // equal to itself.
    if (Object.is(left, right)) continue;

    const leftIsArray = Array.isArray(left);
    if (leftIsArray || Array.isArray(right)) {
      if (!leftIsArray || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        stack.push({ left: left[i], right: right[i] });
      }
      continue;
    }

    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    for (const key of leftKeys) {
      // An own-key check rather than an undefined test: `{a: undefined}` and
      // `{}` have different serialized shapes and a codec may care.
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      stack.push({ left: left[key], right: right[key] });
    }
  }
  return true;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Freeze a parsed value and everything reachable from it. Returns `false` when
 * the budget ran out before the walk finished, so a caller can say "partially
 * frozen" rather than imply a guarantee it does not have.
 *
 * FOUR GUARDS, each of which was found by execution rather than by reading:
 *
 *  1. TYPED ARRAYS ARE SKIPPED. `Object.freeze(new Uint8Array([1]))` THROWS
 *     "Cannot freeze array buffer views with elements". A codec returning
 *     binary data is conforming, and without this line turning `devChecks` on
 *     takes the ingress door down.
 *  2. FREEZE BEFORE RECURSING, and skip anything already frozen. That is the
 *     cycle guard and the idempotence guard at once, and it is measurably
 *     faster than a fresh `WeakSet` per call.
 *  3. DESCRIPTOR WALK, never `Object.values` or `for..in`. Reading a value
 *     through a getter INVOKES it — a lazy or side-effecting accessor would
 *     otherwise run inside an audit that is supposed to observe nothing.
 *  4. A STEP BUDGET, because cost here is O(PAYLOAD), not O(nodes). Measured
 *     across plausible timeline shapes the per-node cost spans 0.39us to
 *     66.75us — a 170x spread — and a 40,000-node document with 200 keyframes
 *     per clip reaches 2.67 SECONDS at load without one.
 *
 * KNOWN BLIND SPOTS, documented rather than fixed. `Object.isFrozen` reads
 * true while `map.set(...)`, `set.add(...)` and `date.setFullYear(...)` all
 * still mutate — measured, a frozen Map went from size 1 to 2. And a consumer
 * module in SLOPPY mode writing to a frozen object no-ops silently with no
 * TypeError, so the mutation is prevented but not reported. Both are real
 * gaps; neither is a reason to skip the eighty percent this does catch.
 */
export function deepFreezeBounded(
  root: unknown,
  budget: number = DEV_CHECK_BUDGET,
): boolean {
  const stack: unknown[] = [root];
  let steps = 0;
  while (stack.length > 0) {
    if (++steps > budget) return false;
    const value = stack.pop();
    if (typeof value !== "object" || value === null) continue;
    // GUARD 1 — see above. This must precede the freeze, not follow it.
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    // GUARD 2 — freeze first, then walk, so a cycle terminates.
    if (Object.isFrozen(value)) continue;
    Object.freeze(value);
    // GUARD 3 — descriptors, so getters are never invoked.
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) continue;
      stack.push(descriptor.value);
    }
  }
  return true;
}
