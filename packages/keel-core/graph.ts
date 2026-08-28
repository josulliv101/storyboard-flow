// KEEL — graph structure, queries, derived indexes and invariants.
//
// PURE. Imports `./types` and nothing else — not even a sibling keel module.
// This is the bottom of the dependency order: patches, commands, folds and
// serialize all sit on top of it, so anything imported here is imported by
// every one of them.
//
// Three things live here and nowhere else:
//
//   1. The QUERIES. Every one is TOTAL — an unknown id yields an empty/neutral
//      answer, never a throw. React reads the graph, and in React a card can
//      outlive its node by a frame; a query that throws on that turns a routine
//      race into a crashed subtree.
//   2. The DERIVED INDEXES (`placementsByContentKey`, `ownerBySourceKey`) and
//      the subtree-revision bump. `walkDerivedIndexes` is the one definition of
//      what those maps contain, so `applyPatch` and `findInvariantViolation`
//      cannot hold two different opinions. The incremental updaters
//      (`reindexPlacementsWithinSubtree`, `derivedIndexesAfterRemoval`, and the
//      two `...LeavesDerivedIndexesIntact` predicates) live HERE, beside that
//      definition, for the same reason: an incremental update that drifts from
//      the rebuild is a stale index nothing detects until check 9 fires in a
//      dev build, or a rename-everywhere silently misses a placement in a
//      production one.
//   3. `findInvariantViolation`, the structural audit. It is the executable
//      form of the rules the rest of the engine assumes without re-checking.

import type {
  AnyNode,
  ChildrenState,
  CollectionNode,
  Graph,
  NodeId,
  NodeTypeRegistry,
  QuarantinedNode,
  SomeNodeType,
  Violation,
} from "./types";

// ---------------------------------------------------------------------------
// Shared empties
// ---------------------------------------------------------------------------
//
// Frozen module-level constants rather than a fresh `[]` / `new Map()` per
// call. `getChildren` is called once per rendered row per frame, and a fresh
// array each time defeats every `useMemo` / `Object.is` comparison downstream —
// the caller sees a new identity and re-renders even though nothing changed.

const NO_IDS: readonly NodeId[] = Object.freeze([]);
const NO_PLACEMENTS: ReadonlyMap<string, readonly NodeId[]> = new Map();
const NO_OWNERS: ReadonlyMap<string, NodeId> = new Map();
/** Shared empty tombstone store. A graph that has never removed anything holds
 *  this one, by reference. */
export const NO_DEAD_REVS: ReadonlyMap<NodeId, number> = new Map();

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Build the kind -> codec map.
 *
 * THROWS on a duplicate kind, and this is the only function in keel-core that
 * throws. It is a module-init programmer error, not a recoverable condition:
 * two codecs claiming one kind means one of them silently wins at the trust
 * boundary, so `switch (node.kind)` narrows `data` to a type the node does not
 * hold and the whole discriminated union is quietly a lie. There is no
 * partial-success answer worth returning — the consumer's module graph is
 * wrong, and it is wrong before any data has been read.
 */
export function buildRegistry(types: readonly SomeNodeType[]): NodeTypeRegistry {
  const registry = new Map<string, SomeNodeType>();
  for (const type of types) {
    if (registry.has(type.kind)) {
      throw new Error(
        `keel: duplicate node kind ${JSON.stringify(type.kind)} in ` +
          `createEngine({ types }). Each kind may be claimed by exactly one codec.`,
      );
    }
    registry.set(type.kind, type);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function emptyGraph<Ts extends readonly unknown[], S>(
  engineId: symbol,
): Graph<Ts, S> {
  return {
    engineId,
    nodesById: new Map(),
    childrenById: new Map(),
    parentById: new Map(),
    rootIds: NO_IDS,
    subtreeRevById: new Map(),
    deadRevById: NO_DEAD_REVS,
    placementsByContentKey: NO_PLACEMENTS,
    ownerBySourceKey: NO_OWNERS,
  };
}

/**
 * Assemble a graph from an already-parsed node set.
 *
 * Not part of the cross-module signature contract — `deserializeDocument`,
 * `loadChildrenInto` and the tests are the callers. It exists so the two
 * derived facts every ingress path has to get right — `parentById` TOTAL over
 * `nodesById`, and both derived indexes consistent with the node set — are
 * computed in one place instead of being re-derived per ingress. The
 * predecessor re-derived them per path and they drifted.
 *
 * It does NOT validate. `findInvariantViolation` is the audit, and running it
 * here would make every ingress pay for a check the caller may want once at the
 * end, or only under `devChecks`.
 *
 * `subtreeRevs` carries revisions forward when a graph is rebuilt around
 * existing nodes; a node with no carried revision starts at 0.
 */
export function buildGraph<Ts extends readonly unknown[], S>(
  args: Readonly<{
    engineId: symbol;
    nodesById: ReadonlyMap<NodeId, AnyNode<Ts, S>>;
    childrenById: ReadonlyMap<NodeId, readonly NodeId[]>;
    rootIds: readonly NodeId[];
    registry: NodeTypeRegistry;
    subtreeRevs?: ReadonlyMap<NodeId, number>;
    /** Carried forward when a graph is rebuilt around existing nodes, so a
     *  rebuild does not forget what has been removed. */
    deadRevs?: ReadonlyMap<NodeId, number>;
  }>,
): Graph<Ts, S> {
  const parentById = new Map<NodeId, NodeId | null>();
  for (const [parentId, childIds] of args.childrenById) {
    for (const childId of childIds) parentById.set(childId, parentId);
  }
  // TOTAL over `nodesById`: anything not claimed as a child is a root, and a
  // root's entry is an explicit `null` rather than an absent key. `has()` and
  // `get()` therefore answer different questions, and check 5 of
  // `findInvariantViolation` is written against the first one.
  const subtreeRevById = new Map<NodeId, number>();
  for (const id of args.nodesById.keys()) {
    if (!parentById.has(id)) parentById.set(id, null);
    subtreeRevById.set(id, args.subtreeRevs?.get(id) ?? 0);
  }

  const skeleton: Graph<Ts, S> = {
    engineId: args.engineId,
    nodesById: args.nodesById,
    childrenById: args.childrenById,
    parentById,
    rootIds: args.rootIds,
    subtreeRevById,
    // Ingress builds a graph from a node set; nothing has been removed from it.
    deadRevById: args.deadRevs ?? NO_DEAD_REVS,
    placementsByContentKey: NO_PLACEMENTS,
    ownerBySourceKey: NO_OWNERS,
  };
  // The indexes are derived from a walk, so they need a walkable graph — the
  // skeleton is exactly that, and the two placeholder maps it carries are never
  // read by `rebuildDerivedIndexes`.
  return { ...skeleton, ...rebuildDerivedIndexes(skeleton, args.registry) };
}

// ---------------------------------------------------------------------------
// Queries — all TOTAL, none throw
// ---------------------------------------------------------------------------

export function getNode<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): AnyNode<Ts, S> | undefined {
  return graph.nodesById.get(id);
}

/**
 * The children of a `loaded` collection, `[]` for everything else.
 *
 * CALLERS MUST NOT READ THIS TO DECIDE "IS IT EMPTY". An unloaded collection
 * and a genuinely empty one both answer `[]`, and collapsing those two is the
 * exact ambiguity this engine exists to remove — the predecessor confesses it
 * in its own source, and every downstream uncertainty flag it grew is scar
 * tissue from that one missing bit. Use `childrenStateOf`.
 */
export function getChildren<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): readonly NodeId[] {
  return graph.childrenById.get(id) ?? NO_IDS;
}

export function getParent<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): NodeId | null {
  return graph.parentById.get(id) ?? null;
}

/** 0 for an unknown node, so a subscriber comparing revisions across a removal
 *  sees a change rather than an exception. */
export function getSubtreeRev<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): number {
  // LIVE FIRST. The two maps are disjoint, so the order is not what makes this
  // correct — it is what makes it cheap, since the live map is the one every
  // read of a present node hits. A dead id answers with the revision it held
  // when it was removed, which is what keeps a re-inserted id from landing back
  // on a revision its previous lifetime already cached.
  return graph.subtreeRevById.get(id) ?? graph.deadRevById.get(id) ?? 0;
}

/** `null` for a leaf, an unknown node, or a QUARANTINED leaf — the three cases
 *  where "what is this subtree's load state" has no answer, because there is no
 *  subtree. */
export function childrenStateOf<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): ChildrenState | null {
  const node = graph.nodesById.get(id);
  if (node === undefined) return null;
  // Discriminate on `quarantined` FIRST: `container` is a plain `boolean` on
  // the quarantined arm (it comes off the wire), so it is not disjoint from the
  // literal `true` / `false` on the other two and cannot discriminate alone.
  if (node.quarantined) return node.children;
  if (node.container) return node.children;
  return null;
}

/**
 * True for every collection AND every quarantined node.
 *
 * The quarantined half looks over-broad until you check the alternative. The
 * declared predicate narrows the FALSE branch to `LeafNode`, so returning
 * `node.container` alone would let a quarantined node whose wire `container`
 * was `false` land in that branch and be read as a parsed leaf — with a `data`
 * field it does not have. `quarantined || container` is the only implementation
 * sound in both branches, and it reads as "may own children", which is what
 * every call site actually wants to know.
 */
export function isCollection<Ts extends readonly unknown[], S>(
  node: AnyNode<Ts, S>,
): node is CollectionNode<Ts, S> | QuarantinedNode {
  return node.quarantined || node.container;
}

export function isLoaded<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): boolean {
  return childrenStateOf(graph, id)?.status === "loaded";
}

/**
 * Does this placement own the subtree beneath it?
 *
 * `loaded`, `unloaded` and `missing` all own it — `missing` included, because
 * confirmed-gone is knowledge about a subtree you own, not a handoff to someone
 * else. Only `reference` disclaims ownership, and that single fact is what
 * makes the placement forest a genuine tree: a reference is structurally
 * childless forever, so no walk can descend through one into a cycle.
 */
export function ownsSubtree(state: ChildrenState): boolean {
  return state.status !== "reference";
}

/**
 * Parent-first up to the root, EXCLUDING `id`. `[]` for a root or an unknown
 * node.
 *
 * No visiting set. In a valid graph one is unnecessary — references are leaves,
 * so the placement forest is a forest and a chain cannot revisit; the
 * predecessor's three `visiting` guards existed only because following a
 * duplicate's pointer could re-enter a node already on the stack. The step
 * budget below is not that guard under another name: it is a TERMINATION guard
 * for a graph that is already corrupt, so a bad `parentById` fails finitely
 * instead of hanging a render loop. `findInvariantViolation` is what names the
 * corruption.
 */
export function ancestorChain<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): readonly NodeId[] {
  if (!graph.nodesById.has(id)) return NO_IDS;
  const budget = graph.nodesById.size;
  const chain: NodeId[] = [];
  let current = graph.parentById.get(id) ?? null;
  while (current !== null && chain.length < budget) {
    chain.push(current);
    current = graph.parentById.get(current) ?? null;
  }
  return chain;
}

/**
 * Backs the cycle check on `move-nodes`: moving a node into itself or into one
 * of its own descendants is the one structural mutation that can break the
 * forest.
 *
 * Deliberately does NOT check that either id exists. Equality is equality, and
 * the caller has already resolved both nodes by the time it asks — adding a
 * lookup here would only make an unknown id answer "no relation", which is the
 * more dangerous answer for a cycle test to give.
 */
export function isSameOrAncestor<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  maybeAncestorId: NodeId,
  id: NodeId,
): boolean {
  if (maybeAncestorId === id) return true;
  const budget = graph.nodesById.size;
  let steps = 0;
  let current = graph.parentById.get(id) ?? null;
  while (current !== null && steps < budget) {
    if (current === maybeAncestorId) return true;
    current = graph.parentById.get(current) ?? null;
    steps += 1;
  }
  return false;
}

/**
 * Pre-order walk from `roots`, children in array order.
 *
 * EXPLICIT STACK, never recursion: depth is hostile input — a document is a
 * flat node list off the wire, so nothing bounds nesting except whoever wrote
 * the document.
 *
 * The `budget` is the same termination guard as `ancestorChain`'s. In a valid
 * graph it is never reached: every reachable id is a node and each is reached
 * once, so the walk length is exactly the number of reachable nodes. It bounds
 * the damage when the graph is not valid.
 */
function walkPreOrder<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  roots: readonly NodeId[],
): NodeId[] {
  const out: NodeId[] = [];
  const budget = graph.nodesById.size;
  const stack: NodeId[] = [];
  // Pushed in reverse so the first root pops first.
  for (let i = roots.length - 1; i >= 0; i -= 1) {
    const rootId = roots[i];
    if (rootId !== undefined) stack.push(rootId);
  }
  while (stack.length > 0 && out.length < budget) {
    const current = stack.pop();
    if (current === undefined) break;
    out.push(current);
    const childIds = graph.childrenById.get(current);
    if (childIds === undefined) continue;
    for (let i = childIds.length - 1; i >= 0; i -= 1) {
      const childId = childIds[i];
      if (childId !== undefined) stack.push(childId);
    }
  }
  return out;
}

/** Pre-order, INCLUDES `id`. `[]` for an unknown node — an id the graph does
 *  not hold has no subtree, not a one-element one. */
export function subtreeIds<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): readonly NodeId[] {
  if (!graph.nodesById.has(id)) return NO_IDS;
  return walkPreOrder(graph, [id]);
}

/** Pre-order across every root, in `rootIds` order. Backs `selectRange`, which
 *  is inclusive in DOCUMENT order — the reason selection is engine-owned rather
 *  than a consumer concern. */
export function documentOrder<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
): readonly NodeId[] {
  return walkPreOrder(graph, graph.rootIds);
}

// ---------------------------------------------------------------------------
// Identity keys
// ---------------------------------------------------------------------------
//
// Both return `null` for a quarantined node, and that is not a shortcut. A
// quarantined node holds `raw`, not parsed `Data`; no codec is willing to vouch
// for it, so handing `raw` to `contentKey` would ask a function typed against
// `Data` to read something that failed to become `Data`. A node whose content
// could not be understood has no content identity.
//
// Neither wraps the codec call in try/catch. A throwing `contentKey` is a
// consumer bug, and swallowing it into `null` would silently disable the
// single-owner rule — the invariant that stops two placements from both
// claiming one stored subtree, which is the condition the predecessor's server
// had to answer with a 409 because nothing upstream enforced it.

export function contentKeyOf<Ts extends readonly unknown[], S>(
  registry: NodeTypeRegistry,
  node: AnyNode<Ts, S>,
): string | null {
  if (node.quarantined) return null;
  const type = registry.get(node.kind);
  if (type === undefined || type.contentKey === undefined) return null;
  return type.contentKey(node.data);
}

export function sourceKeyOf<Ts extends readonly unknown[], S>(
  registry: NodeTypeRegistry,
  node: AnyNode<Ts, S>,
): string | null {
  if (node.quarantined) return null;
  return sourceKeyOfKindData(registry, node.kind, node.data);
}

/**
 * The same `sourceKey` call, for a caller holding a value the node does not
 * hold YET.
 *
 * `verifyDataChanged` needs exactly this: it must know what key a patch's
 * `after` would claim before deciding whether replaying it is safe, and the
 * node in the graph still carries the old value. Split out rather than
 * duplicated so the two cannot disagree about which codec hook answers, and so
 * the deliberate absence of a try/catch stays in ONE place — see the block
 * comment above `contentKeyOf` for why a throwing key function is not swallowed
 * into `null`.
 */
export function sourceKeyOfKindData(
  registry: NodeTypeRegistry,
  kind: string,
  data: unknown,
): string | null {
  const type = registry.get(kind);
  if (type === undefined || type.sourceKey === undefined) return null;
  return type.sourceKey(data);
}

/**
 * Is this node the OWNING placement for its `sourceKey`?
 *
 * THE SINGLE ANSWER. Three call sites used to decide this independently — this
 * one, `owningSourceKey` in ./commands, and `findDuplicateOwner` in ./serialize
 * — and they did not agree about leaves. The first two said a leaf owns; the
 * third said it does not. The consequence was a document that `deserialize`
 * ACCEPTED, `findInvariantViolation` then condemned as `duplicate-owner`, and
 * the reducer refused every edit to: it loaded, failed its own audit, and could
 * not be repaired through the API. All three now call this.
 *
 * A LEAF OWNS NOTHING, which reverses what this function used to return.
 * The earlier reading was that "a placement that cannot be a reference is an
 * owner by default", and that is exactly backwards once you follow it through:
 *
 *   - `sourceKey` is "same stored SUBTREE", and the rejection it produces tells
 *     the consumer to insert a `reference` instead. A leaf has no
 *     `ChildrenState`, so it can never BE a reference placement — the rule was
 *     unsatisfiable for leaves, with no escape hatch in the command vocabulary.
 *   - `contentKey` already answers the question a repeated clip is actually
 *     asking ("same asset"), and it permits many placements by design.
 *   - The alternative fix — making ingress agree with the other two — would
 *     have made a stored document stop loading, which is the failure quarantine
 *     exists to prevent and which this repo has already paid for once.
 *
 * A quarantined node owns nothing either: its key would have to come from a
 * codec that by definition did not run, so `sourceKeyOf` already answers `null`
 * for it. Stated here as well so the predicate is total on its own terms rather
 * than relying on a caller having checked first.
 */
export function ownsItsSubtree<Ts extends readonly unknown[], S>(
  node: AnyNode<Ts, S>,
): boolean {
  if (node.quarantined) return false;
  if (!node.container) return false;
  return ownsSubtree(node.children);
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/**
 * Bump `id` AND every ancestor of it, for each id in `fromIds`.
 *
 * THE TRAP, and it has already been paid for once: `graph` supplies the
 * `parentById` the chain is read from, and A MOVE HAS TWO CHAINS. The source
 * chain exists only in the PRE-state graph. `applyPatch` must therefore call
 * this TWICE for a `"moved"` patch — once against the pre-state graph with
 * `move.fromParentId`, once against the post-state graph with
 * `move.toParentId`. Getting it wrong is invisible in every test that watches
 * the moved node: the node updates, and the OLD ancestors' rollups silently
 * never re-render again.
 *
 * Ids absent from `graph` are bumped anyway, with no chain. That is deliberate:
 * filtering them would turn "caller passed the wrong-state graph" into a
 * SILENTLY DROPPED NOTIFICATION, which is precisely the failure mode above. A
 * stray revision entry for an id that no longer exists is inert by comparison —
 * nothing reads a revision for a node it cannot find.
 */
export function bumpSubtreeRevs<Ts extends readonly unknown[], S>(
  revs: ReadonlyMap<NodeId, number>,
  graph: Graph<Ts, S>,
  fromIds: readonly NodeId[],
): ReadonlyMap<NodeId, number> {
  // Identity is preserved on a no-op so a caller can compare maps to decide
  // whether to notify at all.
  if (fromIds.length === 0) return revs;
  const next = new Map(revs);
  bumpSubtreeRevsInto(next, graph, fromIds);
  return next;
}

/**
 * The same bump, written into a map the caller PRIVATELY OWNS.
 *
 * Same contract as `bumpSubtreeRevs` in every other respect — it is the single
 * implementation, and the copying form above is a two-line wrapper over it, so
 * the two cannot drift.
 *
 * It exists because `applyPatch` was paying for the rev map TWICE per commit:
 * every arm cloned `subtreeRevById` to edit it and then handed the clone to
 * `bumpSubtreeRevs`, which cloned it again. A move paid three whole-graph map
 * copies before this split (children, parents, revs x2). The caller must not
 * pass a map that any surviving graph still references — writing into one would
 * retroactively change a value the PREVIOUS graph published, which is the
 * mutation the immutable-graph contract exists to forbid.
 *
 * The walk is INLINE rather than through `ancestorChain`, and that is the second
 * half of the fix: `ancestorChain` materialises the whole chain to the root
 * before the caller can look at it, so a batch of N siblings walked to the root
 * N times and allocated N arrays to discover that all but the first walk was
 * redundant. Breaking at the first already-bumped id makes the cost proportional
 * to the NEW part of each chain.
 */
export function bumpSubtreeRevsInto<Ts extends readonly unknown[], S>(
  revs: Map<NodeId, number>,
  graph: Graph<Ts, S>,
  fromIds: readonly NodeId[],
): void {
  if (fromIds.length === 0) return;

  // Scoped to THIS call: `revs` already holds values, so it cannot answer
  // "did I bump this one already". The set is proportional to the touched
  // chains, never to the graph.
  const bumped = new Set<NodeId>();
  const budget = graph.nodesById.size;

  for (const startId of fromIds) {
    let current: NodeId | null = startId;
    let steps = 0;
    while (current !== null) {
      // Ancestor chains are prefix-closed upward: if this one is already
      // collected then so is everything above it, so stopping here is an exact
      // short-circuit rather than an approximation.
      if (bumped.has(current)) break;
      bumped.add(current);
      revs.set(current, (revs.get(current) ?? 0) + 1);
      // The same TERMINATION guard `ancestorChain` carries — a corrupt
      // `parentById` must fail finitely rather than hang a render loop.
      if (steps >= budget) break;
      steps += 1;
      current = graph.parentById.get(current) ?? null;
    }
  }
}

/** The derived pair, as `applyPatch` splices it onto a graph. */
export type DerivedIndexes<Ts extends readonly unknown[], S> = Pick<
  Graph<Ts, S>,
  "placementsByContentKey" | "ownerBySourceKey"
>;

/** Which halves of the derived pair the registered codecs can populate AT ALL. */
export type DerivedIndexNeed = Readonly<{ content: boolean; source: boolean }>;

/**
 * Ask the REGISTRY, once per commit, whether either index can hold anything.
 *
 * `contentKey` and `sourceKey` are both optional on `NodeType`, so a consumer
 * that opts into neither has two permanently empty maps — and used to pay a
 * full document-order DFS, plus a registry lookup per node, to rediscover that
 * on every single mutation. The cost of asking is proportional to the number of
 * registered KINDS, which is a handful; the cost it replaces is proportional to
 * the graph.
 */
export function derivedIndexNeed(registry: NodeTypeRegistry): DerivedIndexNeed {
  let content = false;
  let source = false;
  for (const type of registry.values()) {
    if (type.contentKey !== undefined) content = true;
    if (type.sourceKey !== undefined) source = true;
    if (content && source) break;
  }
  return { content, source };
}

/**
 * The one walk both rebuild entry points share, so "what is in these indexes"
 * still has exactly one definition.
 *
 * `want` narrows the work, never the meaning: a half that is not wanted comes
 * back as the SHARED empty map, so a caller that carries the other half forward
 * by reference is splicing in a value that is both correct and identity-stable.
 *
 * Only REACHABLE nodes are indexed. In a valid graph that is every node; in an
 * invalid one, indexing an orphan would give a detached subtree a vote on
 * ownership.
 */
function walkDerivedIndexes<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  want: DerivedIndexNeed,
): DerivedIndexes<Ts, S> {
  if (!want.content && !want.source) {
    // The whole DFS is dead work. Returning the shared empties (rather than two
    // fresh Maps) also keeps the graph's derived fields reference-stable across
    // commits, so a consumer memoising on them sees no churn.
    return { placementsByContentKey: NO_PLACEMENTS, ownerBySourceKey: NO_OWNERS };
  }

  const placementsByContentKey = want.content ? new Map<string, NodeId[]>() : null;
  const ownerBySourceKey = want.source ? new Map<string, NodeId>() : null;

  for (const id of documentOrder(graph)) {
    const node = graph.nodesById.get(id);
    if (node === undefined) continue;

    if (placementsByContentKey !== null) {
      const contentKey = contentKeyOf(registry, node);
      if (contentKey !== null) {
        const bucket = placementsByContentKey.get(contentKey);
        if (bucket === undefined) placementsByContentKey.set(contentKey, [id]);
        else bucket.push(id);
      }
    }

    if (ownerBySourceKey === null) continue;
    const sourceKey = sourceKeyOf(registry, node);
    if (sourceKey === null) continue;
    if (!ownsItsSubtree(node)) continue;
    // FIRST owner in document order wins, deterministically. A second one is a
    // violation, but saying so is `findInvariantViolation`'s job — this
    // function runs on every mutation and must not have an opinion it could
    // impose mid-command.
    if (!ownerBySourceKey.has(sourceKey)) ownerBySourceKey.set(sourceKey, id);
  }

  return {
    placementsByContentKey: placementsByContentKey ?? NO_PLACEMENTS,
    ownerBySourceKey: ownerBySourceKey ?? NO_OWNERS,
  };
}

/**
 * Recompute both derived indexes from scratch, in DOCUMENT order.
 *
 * The fallback, not the default path. `applyPatch` reaches for it only when the
 * cheaper answers below decline — an insert or an edit that really can move a
 * key, or a move too general to scope. Every ingress (`buildGraph`,
 * `deserializeDocument`) still uses it, because there is no previous index to
 * update from.
 *
 * Incremental IS possible for the arms that update instead, and each one carries
 * the argument for why. What is NOT possible is incremental in general: one
 * `edit-nodes` command can change `contentKey` on any node in the batch, and a
 * stale placement index is invisible until a rename-everywhere silently misses a
 * placement. So the rule is: update only where the patch's own shape PROVES what
 * cannot have moved, and rebuild otherwise.
 */
export function rebuildDerivedIndexes<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): DerivedIndexes<Ts, S> {
  return walkDerivedIndexes(graph, registry, derivedIndexNeed(registry));
}

/**
 * `placementsByContentKey` alone, from scratch — the fallback for a move.
 *
 * WHY A MOVE NEEDS ONLY THIS HALF. A move rewrites `childrenById` and
 * `parentById` and NOTHING else: no node's `data` changes, so no node's
 * `sourceKey` changes; no node's `ChildrenState` changes, so `isOwningPlacement`
 * is identical for every node; and no node leaves the forest, so the reachable
 * set is identical. The SET of owning placements per key is therefore the set it
 * already was, and `applyPatch` hands `ownerBySourceKey` straight through.
 *
 * Only the tie-break could differ — a rebuild awards a key to the FIRST owner in
 * document order — and a key with two owners to choose between is
 * `duplicate-owner`, which `findInvariantViolation` refuses at check 8, BEFORE
 * check 9 ever compares this index. So on any graph where carrying the map
 * forward could disagree with a rebuild, the audit already names the real defect
 * rather than a derived-index-stale symptom of it.
 *
 * `placementsByContentKey` gets no such reprieve: its values are in DOCUMENT
 * order, so a pure reorder moves it even though no data did.
 */
export function rebuildPlacementIndex<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): ReadonlyMap<string, readonly NodeId[]> {
  const need = derivedIndexNeed(registry);
  return walkDerivedIndexes(graph, registry, { content: need.content, source: false })
    .placementsByContentKey;
}

/**
 * Reorder `previous` for a permutation confined to ONE subtree, without walking
 * the graph.
 *
 * PRECONDITION, and the whole reason this is sound: the caller has established
 * that the mutation only permuted nodes INSIDE `subtree(scopeRootId)` — same
 * membership, same `data`, same reachability. Then for any node inside the scope
 * and any node outside it, their relative document order is what it was, so the
 * SLOTS a bucket devotes to scope members are exactly the slots it devoted
 * before. Rewriting those slots in the new intra-scope order is the complete
 * update; every other entry, and every other bucket, is untouched.
 *
 * Returns `previous` BY IDENTITY when no bucket actually reordered — the common
 * case when content keys are per-node unique, where a drag changes the index not
 * at all and must not allocate a map the size of the key space to say so.
 *
 * Returns `null` for "no incremental answer", not for "invalid": if the counts
 * disagree with `previous`, this function's precondition did not hold and it
 * refuses to guess. The caller rebuilds. It is deliberately NOT `Result`-shaped
 * — nothing here is a rejection the engine reports; it is an optimisation
 * declining to apply.
 */
export function reindexPlacementsWithinSubtree<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, readonly NodeId[]>,
  scopeRootId: NodeId,
): ReadonlyMap<string, readonly NodeId[]> | null {
  if (!graph.nodesById.has(scopeRootId)) return null;

  const scopeIds = new Set<NodeId>();
  const runByKey = new Map<string, NodeId[]>();
  // POST-state pre-order of the scope: `subtreeIds` includes the root itself,
  // which is correct — a pre-order root precedes all of its descendants before
  // and after, so its slot is stable and it belongs in its own run.
  for (const id of subtreeIds(graph, scopeRootId)) {
    scopeIds.add(id);
    const node = graph.nodesById.get(id);
    if (node === undefined) continue;
    const contentKey = contentKeyOf(registry, node);
    if (contentKey === null) continue;
    const run = runByKey.get(contentKey);
    if (run === undefined) runByKey.set(contentKey, [id]);
    else run.push(id);
  }
  if (runByKey.size === 0) return previous;

  const rewritten = new Map<string, readonly NodeId[]>();
  for (const [contentKey, run] of runByKey) {
    const bucket = previous.get(contentKey);
    // The scope holds a node with this key but `previous` has no bucket for it:
    // `previous` was not built from this node set. Decline.
    if (bucket === undefined) return null;

    let cursor = 0;
    let differs = false;
    for (const id of bucket) {
      if (!scopeIds.has(id)) continue;
      const replacement = run[cursor];
      cursor += 1;
      if (replacement === undefined) return null;
      if (replacement !== id) differs = true;
    }
    // Fewer scope members in the bucket than the walk found: same conclusion.
    if (cursor !== run.length) return null;
    if (!differs) continue;

    const nextBucket = bucket.slice();
    let write = 0;
    for (let i = 0; i < nextBucket.length; i += 1) {
      const id = nextBucket[i];
      // `noUncheckedIndexedAccess` — a real check, not a `!`. The loop bounds
      // make this unreachable; TypeScript cannot see that and neither should a
      // reader.
      if (id === undefined || !scopeIds.has(id)) continue;
      const replacement = run[write];
      write += 1;
      if (replacement !== undefined) nextBucket[i] = replacement;
    }
    rewritten.set(contentKey, nextBucket);
  }

  // Nothing moved. Hand the map back by reference rather than allocating a copy
  // of the whole key space to express "no change".
  if (rewritten.size === 0) return previous;

  const next = new Map(previous);
  for (const [contentKey, bucket] of rewritten) next.set(contentKey, bucket);
  return next;
}

/**
 * Compare two ids by document order, amortised across many comparisons.
 *
 * Returns `null` for "cannot say" rather than a guess: a node absent from its
 * own parent's children means `parentById` and `childrenById` disagree, and the
 * one thing an ordering primitive must never do in that state is invent an
 * answer that reads as authoritative. Callers decline and rebuild.
 *
 * Two caches, both scoped to one call. Paths are built once per id — the
 * comparison itself allocates nothing — and slot maps once per parent, which is
 * what keeps a merge over a bucket from turning into `indexOf` per comparison
 * over a wide collection. The slot maps are the honest bound here: a bucket
 * whose members are spread across many parents pays each parent's width once,
 * so the pathological shape — one content key placed in EVERY collection —
 * costs the same order as the rebuild it replaces. It is never worse than the
 * rebuild, and for every realistic bucket it is not close.
 */
export function documentOrderComparator<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
): (a: NodeId, b: NodeId) => number | null {
  const pathCache = new Map<NodeId, readonly NodeId[]>();
  // Keyed by parent, with `null` standing for the root list — roots are ordered
  // by `rootIds` and have no parent to be looked up in.
  const slotCache = new Map<NodeId | null, ReadonlyMap<NodeId, number>>();

  const pathOf = (id: NodeId): readonly NodeId[] => {
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;
    // `ancestorChain` is parent-first and excludes `id`; a document-order
    // comparison wants root-first and inclusive, so this reverses and appends.
    const chain = ancestorChain(graph, id);
    const path: NodeId[] = [];
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const ancestor = chain[i];
      if (ancestor !== undefined) path.push(ancestor);
    }
    path.push(id);
    pathCache.set(id, path);
    return path;
  };

  const slotsIn = (parentId: NodeId | null): ReadonlyMap<NodeId, number> => {
    const cached = slotCache.get(parentId);
    if (cached !== undefined) return cached;
    const siblings =
      parentId === null ? graph.rootIds : (graph.childrenById.get(parentId) ?? NO_IDS);
    const slots = new Map<NodeId, number>();
    for (let i = 0; i < siblings.length; i += 1) {
      const sibling = siblings[i];
      if (sibling !== undefined) slots.set(sibling, i);
    }
    slotCache.set(parentId, slots);
    return slots;
  };

  return (a, b) => {
    if (a === b) return 0;
    const pathA = pathOf(a);
    const pathB = pathOf(b);
    const shared = Math.min(pathA.length, pathB.length);
    let depth = 0;
    while (depth < shared && pathA[depth] === pathB[depth]) depth += 1;
    // One path is a prefix of the other, so one node is an ancestor of the
    // other, and pre-order puts an ancestor first: the shorter path wins.
    if (depth === shared) return pathA.length - pathB.length;
    const parentId = depth === 0 ? null : (pathA[depth - 1] ?? null);
    const slots = slotsIn(parentId);
    const branchA = pathA[depth];
    const branchB = pathB[depth];
    if (branchA === undefined || branchB === undefined) return null;
    const slotA = slots.get(branchA);
    const slotB = slots.get(branchB);
    if (slotA === undefined || slotB === undefined) return null;
    return slotA - slotB;
  };
}

/**
 * The placement index after a move, repositioning only what travelled.
 *
 * The scope of a move is the MOVED SUBTREES, never a subtree containing both
 * parents. That distinction is the whole function: an earlier version of this
 * file reasoned that a cross-parent scope would have to be the lowest common
 * ancestor of the two parents — the root, in the shape this engine is built for
 * — and concluded that scoping therefore bought nothing, so every cross-parent
 * drag rebuilt the whole index. The reasoning was sound about the LCA and wrong
 * about the scope.
 *
 * WHY THE MOVED SET IS THE RIGHT ONE. Take any two nodes, neither of them in a
 * moved subtree. Their relative document order is decided where their
 * root-paths diverge, by the sibling slots of two branches under one common
 * parent. A move relinks only the moved node and rewrites only the source and
 * destination child arrays — and the moved node is a CHILD of the source, never
 * a sibling of it, so no ancestor's own slot moves. Neither branch slot can
 * change, so their order cannot. `derivedIndexesAfterRemoval` already states
 * the removal half of this argument; this is the same argument carried through
 * the reinsertion.
 *
 * So the survivors in every bucket are still in order, and the complete update
 * is to lift out the ids that travelled and merge them back at their new
 * positions. A bucket holding nothing that moved cannot change at all — which
 * is why the common shape, a content key placed exactly once so that every
 * bucket holds one id, settles in a handful of codec calls and no comparisons
 * at all, against a full document walk before.
 *
 * Returns `previous` BY IDENTITY when nothing reordered, and `null` for
 * "declined" — never for "invalid" — on the same terms as
 * `reindexPlacementsWithinSubtree`: if `previous` disagrees with the graph it
 * was supposedly built from, this refuses to guess and the caller rebuilds.
 */
export function reindexPlacementsAcrossMove<Ts extends readonly unknown[], S>(
  post: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, readonly NodeId[]>,
  movedIds: readonly NodeId[],
): ReadonlyMap<string, readonly NodeId[]> | null {
  // A move carries whole subtrees, so a descendant travelled exactly as far as
  // the node the patch names. POST-state, because that is where the moved node
  // now lives and its subtree membership is what the move left behind.
  const travelled = new Set<NodeId>();
  for (const id of movedIds) {
    if (!post.nodesById.has(id)) return null;
    for (const descendant of subtreeIds(post, id)) travelled.add(descendant);
  }
  if (travelled.size === 0) return previous;

  // The ONLY codec calls this function makes: one per node that actually
  // travelled. Every other node's key is not merely unchanged but irrelevant —
  // `contentKey` reads `data`, and a move does not touch `data`.
  const moversByKey = new Map<string, NodeId[]>();
  for (const id of travelled) {
    const node = post.nodesById.get(id);
    if (node === undefined) return null;
    const contentKey = contentKeyOf(registry, node);
    if (contentKey === null) continue;
    const movers = moversByKey.get(contentKey);
    if (movers === undefined) moversByKey.set(contentKey, [id]);
    else movers.push(id);
  }
  if (moversByKey.size === 0) return previous;

  const compare = documentOrderComparator(post);
  const rewritten = new Map<string, readonly NodeId[]>();

  for (const [contentKey, movers] of moversByKey) {
    const bucket = previous.get(contentKey);
    // The graph holds a node with this key and `previous` has no bucket for it:
    // `previous` was not built from this node set. Decline.
    if (bucket === undefined) return null;
    // A bucket of one cannot be out of order with itself. Worth its own line
    // rather than falling out of the merge below, because it is the common case
    // — a content key names an asset, and most assets are placed once — and
    // this is the line where that case costs nothing at all.
    if (bucket.length <= 1) continue;

    const moved = new Set(movers);
    const survivors: NodeId[] = [];
    let found = 0;
    for (const id of bucket) {
      if (moved.has(id)) found += 1;
      else survivors.push(id);
    }
    // Fewer of this key's movers in the bucket than the graph holds: the same
    // disagreement as above, and the same answer.
    if (found !== movers.length) return null;

    // Survivors are already in order and stay that way; the movers are sorted
    // among themselves and merged back in. Both facts come from the argument
    // above, and a batch that moves several subtrees is why the movers need
    // sorting at all rather than being appended in walk order.
    let declined = false;
    const ordered = movers.slice().sort((a, b) => {
      const verdict = compare(a, b);
      if (verdict === null) {
        declined = true;
        return 0;
      }
      return verdict;
    });
    if (declined) return null;

    const merged: NodeId[] = [];
    let left = 0;
    let right = 0;
    while (left < survivors.length && right < ordered.length) {
      const survivor = survivors[left];
      const mover = ordered[right];
      if (survivor === undefined || mover === undefined) return null;
      const verdict = compare(survivor, mover);
      if (verdict === null) return null;
      if (verdict <= 0) {
        merged.push(survivor);
        left += 1;
      } else {
        merged.push(mover);
        right += 1;
      }
    }
    for (; left < survivors.length; left += 1) {
      const survivor = survivors[left];
      if (survivor !== undefined) merged.push(survivor);
    }
    for (; right < ordered.length; right += 1) {
      const mover = ordered[right];
      if (mover !== undefined) merged.push(mover);
    }

    let differs = merged.length !== bucket.length;
    for (let i = 0; !differs && i < merged.length; i += 1) {
      if (merged[i] !== bucket[i]) differs = true;
    }
    if (differs) rewritten.set(contentKey, merged);
  }

  // Nothing reordered. Hand the map back by reference rather than allocating a
  // copy of the whole key space to say so.
  if (rewritten.size === 0) return previous;

  const next = new Map(previous);
  for (const [contentKey, bucket] of rewritten) next.set(contentKey, bucket);
  return next;
}

/**
 * `placementsByContentKey` after an INSERT, updated rather than rebuilt.
 *
 * The mirror of `reindexPlacementsAcrossMove`, minus its lift-out step: an
 * arriving node is not in `previous` at all, so there are no survivors to
 * separate from movers — only arrivals to merge into buckets that are already
 * in order.
 *
 * Sound for the same reason the move case is: an insert cannot REORDER anything
 * that was already there. Splicing an id into a children array shifts later
 * siblings within document order but preserves every pre-existing node's order
 * relative to every other, so each existing bucket stays sorted and the only
 * new entries are the arrivals' own.
 *
 * ONE DIFFERENCE FROM THE MOVE CASE, and it is the only place the two diverge:
 * an absent bucket here means a brand-new key, which is ordinary and gets set.
 * There, an absent bucket meant `previous` disagreed with the graph, and the
 * answer was to decline.
 *
 * `null` is "declined", on the same terms as its neighbours — a comparator that
 * cannot rank two ids, or an arriving id already sitting in the bucket, which
 * would mean this was not an insert of new nodes.
 */
export function placementsAfterInsert<Ts extends readonly unknown[], S>(
  post: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, readonly NodeId[]>,
  arrived: readonly AnyNode<Ts, S>[],
): ReadonlyMap<string, readonly NodeId[]> | null {
  // THE ONLY codec calls this function makes: one per ARRIVING node. Every
  // other node's key is not merely unchanged but irrelevant — `contentKey`
  // reads `data`, and an insert does not touch anybody else's.
  const arrivalsByKey = new Map<string, NodeId[]>();
  for (const node of arrived) {
    const contentKey = contentKeyOf(registry, node);
    if (contentKey === null) continue;
    const bucket = arrivalsByKey.get(contentKey);
    if (bucket === undefined) arrivalsByKey.set(contentKey, [node.id]);
    else bucket.push(node.id);
  }
  // Nothing arriving carries a key, so the index is exactly what it was. By
  // reference, which is what `insertLeavesDerivedIndexesIntact` bought before
  // this function existed and is worth keeping.
  if (arrivalsByKey.size === 0) return previous;

  const compare = documentOrderComparator(post);
  const rewritten = new Map<string, readonly NodeId[]>();

  for (const [contentKey, arrivals] of arrivalsByKey) {
    let declined = false;
    const ordered = arrivals.slice().sort((a, b) => {
      const verdict = compare(a, b);
      if (verdict === null) {
        declined = true;
        return 0;
      }
      return verdict;
    });
    if (declined) return null;

    const bucket = previous.get(contentKey);
    if (bucket === undefined) {
      // A key nothing held before. Ordinary for an insert.
      rewritten.set(contentKey, ordered);
      continue;
    }

    const merged: NodeId[] = [];
    let left = 0;
    let right = 0;
    while (left < bucket.length && right < ordered.length) {
      const incumbent = bucket[left];
      const arrival = ordered[right];
      if (incumbent === undefined || arrival === undefined) break;
      // An arriving id already in the bucket means this was not an insert of
      // new nodes, and merging would duplicate it.
      if (incumbent === arrival) return null;
      const verdict = compare(incumbent, arrival);
      if (verdict === null) return null;
      if (verdict <= 0) {
        merged.push(incumbent);
        left += 1;
      } else {
        merged.push(arrival);
        right += 1;
      }
    }
    for (; left < bucket.length; left += 1) {
      const incumbent = bucket[left];
      if (incumbent === undefined) continue;
      if (ordered.includes(incumbent)) return null;
      merged.push(incumbent);
    }
    for (; right < ordered.length; right += 1) {
      const arrival = ordered[right];
      if (arrival !== undefined) merged.push(arrival);
    }
    rewritten.set(contentKey, merged);
  }

  const next = new Map(previous);
  for (const [contentKey, bucket] of rewritten) next.set(contentKey, bucket);
  return next;
}

/**
 * `ownerBySourceKey` after an INSERT, updated rather than rebuilt.
 *
 * The mirror of `derivedIndexesAfterRemoval`'s owner half. Only a node that
 * OWNS its subtree can claim a key — the same `ownsItsSubtree` predicate
 * `walkDerivedIndexes` applies, so the incremental answer and the from-scratch
 * one cannot disagree about who counts.
 *
 * An arrival colliding with an incumbent owner is `duplicate-owner`, which
 * invariant check 8 refuses AHEAD of check 9's index comparison — the identical
 * reprieve `rebuildPlacementIndex` and `derivedIndexesAfterRemoval` already
 * take. So on any graph where carrying the map forward could disagree with a
 * rebuild, the audit already names the real defect rather than a stale-index
 * symptom of it.
 */
export function ownersAfterInsert<Ts extends readonly unknown[], S>(
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, NodeId>,
  arrived: readonly AnyNode<Ts, S>[],
): ReadonlyMap<string, NodeId> {
  let next: Map<string, NodeId> | null = null;
  for (const node of arrived) {
    if (!ownsItsSubtree<Ts, S>(node)) continue;
    const sourceKey = sourceKeyOf<Ts, S>(registry, node);
    if (sourceKey === null) continue;
    if (previous.has(sourceKey)) continue;
    if (next === null) next = new Map(previous);
    if (!next.has(sourceKey)) next.set(sourceKey, node.id);
  }
  // Nothing claimed, so the map is what it was — by reference.
  return next ?? previous;
}

/**
 * Both indexes after a removal, updated rather than rebuilt.
 *
 * Sound because a removal cannot REORDER anything: dropping ids leaves every
 * survivor's document position relative to every other survivor exactly as it
 * was, so each affected bucket only needs its dead ids filtered out. Ownership
 * transfers are impossible for the same reason moves cannot change ownership —
 * a key with a second owner waiting to inherit is `duplicate-owner`, refused by
 * check 8.
 *
 * Takes the PRE-state graph and reads each key off the LIVE node, never off the
 * patch's recorded copy: `applyIngest` is a non-undoable content write, so a
 * dormant removal patch can carry a `node` whose `data` — and therefore whose
 * `contentKey` — is no longer what the graph holds. Deleting under the recorded
 * key would leave the real bucket holding a dead id.
 */
export function derivedIndexesAfterRemoval<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  removedIds: readonly NodeId[],
): DerivedIndexes<Ts, S> {
  const previous: DerivedIndexes<Ts, S> = {
    placementsByContentKey: graph.placementsByContentKey,
    ownerBySourceKey: graph.ownerBySourceKey,
  };
  if (removedIds.length === 0) return previous;

  const removed = new Set<NodeId>(removedIds);
  const touchedContentKeys = new Set<string>();
  const orphanedSourceKeys = new Set<string>();
  for (const id of removed) {
    const node = graph.nodesById.get(id);
    if (node === undefined) continue;
    const contentKey = contentKeyOf(registry, node);
    if (contentKey !== null) touchedContentKeys.add(contentKey);
    const sourceKey = sourceKeyOf(registry, node);
    // Only the node that actually HOLDS the key vacates it. A `reference`
    // placement of the same key never owned it and its removal changes nothing.
    if (sourceKey !== null && graph.ownerBySourceKey.get(sourceKey) === id) {
      orphanedSourceKeys.add(sourceKey);
    }
  }
  if (touchedContentKeys.size === 0 && orphanedSourceKeys.size === 0) {
    return previous;
  }

  let placementsByContentKey = graph.placementsByContentKey;
  if (touchedContentKeys.size > 0) {
    const next = new Map(graph.placementsByContentKey);
    for (const contentKey of touchedContentKeys) {
      const bucket = next.get(contentKey);
      if (bucket === undefined) continue;
      const kept = bucket.filter((id) => !removed.has(id));
      if (kept.length === bucket.length) continue;
      // An emptied bucket must be DELETED, not left as `[]` — check 9 compares
      // key COUNTS against a fresh rebuild, and a rebuild never mints an empty
      // one.
      if (kept.length === 0) next.delete(contentKey);
      else next.set(contentKey, kept);
    }
    placementsByContentKey = next;
  }

  let ownerBySourceKey = graph.ownerBySourceKey;
  if (orphanedSourceKeys.size > 0) {
    const next = new Map(graph.ownerBySourceKey);
    for (const sourceKey of orphanedSourceKeys) next.delete(sourceKey);
    ownerBySourceKey = next;
  }

  return { placementsByContentKey, ownerBySourceKey };
}

/**
 * True when inserting exactly these nodes cannot move EITHER derived index.
 *
 * An insert never reorders anything that was already there — splicing an id into
 * a children array shifts later siblings within the document order but preserves
 * the relative order of every pre-existing node — so the only entries a new node
 * can disturb are the ones it would contribute itself. A batch that contributes
 * no key at all (a new folder, in a registry where only clips carry keys) leaves
 * both maps exactly as they were, and both can be handed on by reference.
 */
export function insertLeavesDerivedIndexesIntact<Ts extends readonly unknown[], S>(
  registry: NodeTypeRegistry,
  nodes: readonly AnyNode<Ts, S>[],
): boolean {
  for (const node of nodes) {
    if (contentKeyOf(registry, node) !== null) return false;
    if (sourceKeyOf(registry, node) !== null) return false;
  }
  return true;
}

/**
 * True when one node's data change cannot move EITHER derived index.
 *
 * Asks the codec rather than the registry shape, because the high-value case is
 * a kind that DOES define `contentKey` and whose key does not depend on the
 * field being edited — retitling a clip whose `contentKey` is its asset id. The
 * cheap structural case (a kind defining neither function) falls out of the same
 * two calls, both of which return `null` for it.
 *
 * `data-changed` cannot move a node, so document order is untouched and equal
 * keys really do mean an untouched index.
 */
export function dataChangeLeavesDerivedIndexesIntact(
  registry: NodeTypeRegistry,
  kind: string,
  before: unknown,
  after: unknown,
): boolean {
  const type = registry.get(kind);
  if (type === undefined) return true;
  if (type.contentKey !== undefined && type.contentKey(before) !== type.contentKey(after)) {
    return false;
  }
  if (type.sourceKey !== undefined && type.sourceKey(before) !== type.sourceKey(after)) {
    return false;
  }
  return true;
}

/**
 * IO landing for "storage says this subtree is gone".
 *
 * TOTAL and NO-OP SAFE, because it races real structure changes: the fetch that
 * 404'd was issued a while ago, and the node may have moved, been removed or
 * been loaded since. Returning `graph` unchanged is always a correct response
 * to a stale answer.
 *
 * The no-op cases, each for its own reason:
 *   - unknown id              — the node is already gone.
 *   - leaf / quarantined leaf — no subtree to be missing.
 *   - `reference`             — this placement never owned the subtree; the
 *                               owner is the one entitled to hear a 404 about
 *                               it.
 *   - `loaded`                — LOADING IS MONOTONE IN V1. Demoting a loaded
 *                               collection to `missing` is an unload: it would
 *                               discard resident nodes with no patch, and break
 *                               the property `verifyPatchApplies` rests on —
 *                               that a surviving node is the node the dormant
 *                               patch was recorded against.
 *   - `missing`, same reason  — already said.
 *
 * Produces NO patch, NO history entry and NO change-feed event; the consumer
 * performed the IO and already knows. It DOES bump `subtreeRev` along the
 * chain, because every ancestor's rollup just changed meaning.
 */
export function markMissing<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
  reason: string,
): Graph<Ts, S> {
  const node = graph.nodesById.get(id);
  if (node === undefined) return graph;

  const state = childrenStateOf(graph, id);
  if (state === null) return graph;
  if (state.status === "reference" || state.status === "loaded") return graph;
  if (state.status === "missing" && state.reason === reason) return graph;

  const children: ChildrenState = { status: "missing", reason };
  // A spread, not one of the boundary constructors: nothing here came out of
  // the erased registry, so no cast is warranted, and a spread cannot silently
  // drop a field the node type grows later.
  const next: AnyNode<Ts, S> = node.quarantined
    ? { ...node, children }
    : { ...node, children };

  const nodesById = new Map(graph.nodesById);
  nodesById.set(id, next);

  return {
    ...graph,
    nodesById,
    // The node keeps its `ChildrenState` slot and keeps owning its subtree
    // (`unloaded` and `missing` both own), and its `data` is untouched — so
    // neither derived index can have changed, and neither is rebuilt.
    subtreeRevById: bumpSubtreeRevs(graph.subtreeRevById, graph, [id]),
  };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * The first structural violation, or `null`.
 *
 * ORDER MATTERS, cheapest-and-most-fundamental first: every later check assumes
 * the earlier ones passed, which is what lets the reachability walk be a plain
 * stack with no defensive re-resolution. The audit is:
 *
 *   1. `nodesById` keys agree with the nodes they hold, and are non-empty.
 *   2. every `childrenById` entry belongs to a `loaded` collection, every child
 *      id resolves, and no id appears twice as a child — across arrays or
 *      within one.
 *   3. every `loaded` collection HAS an entry — the other direction of (2), so
 *      `ChildrenState` and `childrenById` cannot drift apart.
 *   4. roots resolve, are containers, are listed once, and are nobody's child.
 *   5. `parentById` is total and agrees with `childrenById`.
 *   6. `subtreeRevById` is total.
 *   7. every node is reachable from a root.
 *   8. at most one non-`reference` placement per `sourceKey`.
 *   9. both derived indexes match a fresh rebuild.
 *
 * ACYCLICITY IS NOT A SEPARATE WALK. The graph is a flat node list, and "each
 * id appears at most once as a child, and a root appears as none" IS the forest
 * condition — checks 2, 4 and 7 together make a cycle unrepresentable, because
 * any cycle either duplicates a child (2), makes a root a child (4), or
 * detaches its members from every root (7). The `"cycle"` code is emitted only
 * by the reachability walk's re-visit guard, which in a graph that passed 2 and
 * 4 is unreachable, and which exists to TERMINATE rather than to detect.
 */
export function findInvariantViolation<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): Violation | null {
  const { nodesById, childrenById, parentById, rootIds, subtreeRevById } = graph;

  // --- 1. ids -------------------------------------------------------------
  for (const [key, node] of nodesById) {
    if (key.trim() === "") {
      return { code: "empty-node-id", message: "nodesById holds an empty id" };
    }
    if (node.id !== key) {
      // Not merely untidy: the key and the node's own id are both used as "the"
      // id by different modules, so a disagreement means one node reachable
      // under two identities — the duplicate-id failure wearing a disguise.
      return {
        code: "duplicate-node-id",
        message:
          `nodesById key ${JSON.stringify(key)} holds a node whose own id is ` +
          `${JSON.stringify(node.id)}`,
        nodeId: node.id,
        otherNodeId: key,
      };
    }
  }

  // --- 2. children arrays -------------------------------------------------
  // `parentOfChild` is built here and reused by checks 4 and 5, so "who is this
  // node's parent" has exactly one answer for the whole audit.
  const parentOfChild = new Map<NodeId, NodeId>();
  for (const [parentId, childIds] of childrenById) {
    if (!nodesById.has(parentId)) {
      // There is no `unknown-parent` violation code; `dangling-child` is the
      // code for "an id reference that resolves to nothing", and the message
      // names which side dangled.
      return {
        code: "dangling-child",
        message: "childrenById holds an entry keyed by an id that is not a node",
        parentId,
      };
    }
    const state = childrenStateOf(graph, parentId);
    if (state === null) {
      return {
        code: "leaf-with-children",
        message: "a node with no ChildrenState has a childrenById entry",
        nodeId: parentId,
      };
    }
    if (state.status !== "loaded") {
      return {
        code: "unloaded-collection-with-children",
        message:
          `a collection in state ${JSON.stringify(state.status)} has a ` +
          `childrenById entry; only "loaded" may have one`,
        nodeId: parentId,
      };
    }
    for (const childId of childIds) {
      if (!nodesById.has(childId)) {
        return {
          code: "dangling-child",
          message: "a children array names an id that is not a node",
          nodeId: childId,
          parentId,
        };
      }
      const priorParentId = parentOfChild.get(childId);
      if (priorParentId !== undefined) {
        return {
          code: "multi-parent",
          message: "an id appears as a child in two places",
          nodeId: childId,
          parentId,
          otherNodeId: priorParentId,
        };
      }
      parentOfChild.set(childId, parentId);
    }
  }

  // --- 3. loaded => has an entry (the other direction of 2) ---------------
  for (const id of nodesById.keys()) {
    const state = childrenStateOf(graph, id);
    if (state === null) continue;
    if (state.status === "loaded" && !childrenById.has(id)) {
      return {
        code: "loaded-collection-missing-children-entry",
        message: 'a collection in state "loaded" has no childrenById entry',
        nodeId: id,
      };
    }
  }

  // --- 4. roots -----------------------------------------------------------
  const seenRootIds = new Set<NodeId>();
  for (const rootId of rootIds) {
    const node = nodesById.get(rootId);
    if (node === undefined) {
      return {
        code: "dangling-child",
        message: "rootIds names an id that is not a node",
        nodeId: rootId,
      };
    }
    if (seenRootIds.has(rootId)) {
      return {
        code: "duplicate-node-id",
        message: "rootIds lists the same id twice",
        nodeId: rootId,
      };
    }
    seenRootIds.add(rootId);
    // Read straight off the node, not through `isCollection`: a quarantined
    // root is judged by the `container` flag its document declared, which is
    // the only evidence there is when no codec would parse it.
    if (!node.container) {
      return {
        code: "root-not-container",
        message: "a root is not a container",
        nodeId: rootId,
      };
    }
    const claimedBy = parentOfChild.get(rootId);
    if (claimedBy !== undefined) {
      return {
        code: "root-is-child",
        message: "a root also appears in a children array",
        nodeId: rootId,
        parentId: claimedBy,
      };
    }
  }

  // --- 5. parentById ------------------------------------------------------
  for (const id of nodesById.keys()) {
    // `has`, not `get`: a root's entry is an explicit `null`, so an absent key
    // and a root are indistinguishable through `get` alone.
    if (!parentById.has(id)) {
      return {
        code: "missing-parent-entry",
        message: "parentById has no entry for a node",
        nodeId: id,
      };
    }
    const recorded = parentById.get(id) ?? null;
    const actual = parentOfChild.get(id) ?? null;
    if (recorded !== actual) {
      const violation: Violation = {
        code: "parent-index-disagrees",
        message:
          `parentById records ${JSON.stringify(recorded)} but childrenById ` +
          `says ${JSON.stringify(actual)}`,
        nodeId: id,
      };
      return actual === null ? violation : { ...violation, parentId: actual };
    }
  }

  // --- 6. subtreeRevById --------------------------------------------------
  for (const id of nodesById.keys()) {
    if (!subtreeRevById.has(id)) {
      return {
        code: "missing-subtree-rev",
        message: "subtreeRevById has no entry for a node",
        nodeId: id,
      };
    }
  }

  // --- 7. reachability, with an EXPLICIT STACK ----------------------------
  const reached = new Set<NodeId>();
  const stack: NodeId[] = [...rootIds];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (reached.has(current)) {
      // Unreachable given checks 2 and 4 — a re-visit means an id was reached
      // by two paths, which is a duplicated child or a re-listed root, both
      // already refused. Kept because it is the only thing standing between a
      // corrupt graph and an infinite loop, and because reordering the checks
      // above must not silently reintroduce that hang.
      return {
        code: "cycle",
        message: "the children graph reaches one node twice",
        nodeId: current,
      };
    }
    reached.add(current);
    const childIds = childrenById.get(current);
    if (childIds === undefined) continue;
    for (const childId of childIds) stack.push(childId);
  }
  if (reached.size !== nodesById.size) {
    for (const id of nodesById.keys()) {
      if (!reached.has(id)) {
        return {
          code: "unreachable-node",
          message: "a node is not reachable from any root",
          nodeId: id,
        };
      }
    }
  }

  // --- 8. single owner per sourceKey --------------------------------------
  const owners = new Map<string, NodeId>();
  for (const id of documentOrder(graph)) {
    const node = nodesById.get(id);
    if (node === undefined) continue;
    const sourceKey = sourceKeyOf(registry, node);
    if (sourceKey === null) continue;
    if (!ownsItsSubtree(node)) continue;
    const ownerId = owners.get(sourceKey);
    if (ownerId !== undefined) {
      return {
        code: "duplicate-owner",
        message:
          "two non-reference placements claim one sourceKey; the second must " +
          "be a reference",
        nodeId: id,
        otherNodeId: ownerId,
        sourceKey,
      };
    }
    owners.set(sourceKey, id);
  }

  // --- 9. derived indexes are not stale -----------------------------------
  return findStaleDerivedIndex(graph, rebuildDerivedIndexes(graph, registry));
}

/** Split out only so `findInvariantViolation` stays readable; it is check 9. */
function findStaleDerivedIndex<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  fresh: Pick<Graph<Ts, S>, "placementsByContentKey" | "ownerBySourceKey">,
): Violation | null {
  const placements = graph.placementsByContentKey;
  if (placements.size !== fresh.placementsByContentKey.size) {
    return {
      code: "derived-index-stale",
      message: "placementsByContentKey has the wrong number of keys",
    };
  }
  for (const [contentKey, freshIds] of fresh.placementsByContentKey) {
    const storedIds = placements.get(contentKey);
    if (storedIds === undefined || storedIds.length !== freshIds.length) {
      return {
        code: "derived-index-stale",
        message: `placementsByContentKey disagrees for ${JSON.stringify(contentKey)}`,
      };
    }
    for (let i = 0; i < freshIds.length; i += 1) {
      // ORDER is part of the index's contract — placements are in document
      // order, and a consumer rendering "3 of 7" reads position from here.
      if (storedIds[i] !== freshIds[i]) {
        return {
          code: "derived-index-stale",
          message: `placementsByContentKey is out of order for ${JSON.stringify(contentKey)}`,
        };
      }
    }
  }

  const owners = graph.ownerBySourceKey;
  if (owners.size !== fresh.ownerBySourceKey.size) {
    return {
      code: "derived-index-stale",
      message: "ownerBySourceKey has the wrong number of keys",
    };
  }
  for (const [sourceKey, freshOwnerId] of fresh.ownerBySourceKey) {
    if (owners.get(sourceKey) !== freshOwnerId) {
      return {
        code: "derived-index-stale",
        message: `ownerBySourceKey disagrees for ${JSON.stringify(sourceKey)}`,
        nodeId: freshOwnerId,
        sourceKey,
      };
    }
  }

  return null;
}
