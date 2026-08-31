// Graph — the `insert-nodes` arm, and seed expansion.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  type GraphNode,
  type EngineContext,
  type Graph,
  type NodeId,
  type Patch,
  type Placement,
  type Rejection,
  type Result,
  type Seed,
  makeCollectionNode,
  makeLeafNode,
  tryParseNodeId,
  type WidenedNodeType,
} from "../types";
import {
  getChildren,
  getNode,
} from "../graph";
import { applyPatch } from "../patches";
import { parseNodeData } from "../serialize";

import { depthOf, isValidIndex, owningSourceKey } from "./queries";
import { fail, ok } from "./results";

// insert-nodes
// ---------------------------------------------------------------------------

/**
 * Mint an id nothing has claimed.
 *
 * `taken` carries the ids minted EARLIER IN THIS COMMAND as well as the graph's,
 * because a weak `mintId` (a short random suffix, a test stub) collides with its
 * own siblings long before it collides with the document.
 *
 * The bounded retry followed by a deterministic fallback is deliberate. A
 * `mintId` that always returns the same string, or returns whitespace, is a
 * programmer error — but nothing in this module may throw, and an unbounded
 * retry loop is a hang, which is strictly worse than an ugly id.
 */
function mintFreshId<S>(
  taken: ReadonlySet<string>,
  ctx: EngineContext<S>,
): NodeId {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const minted = tryParseNodeId(ctx.mintId());
    if (minted.ok && !taken.has(minted.value)) return minted.value;
  }
  for (let counter = 0; ; counter += 1) {
    const candidate = `graph-node-${counter}`;
    if (!taken.has(candidate)) {
      // Always ok — the literal is non-empty — but branded through the door
      // rather than cast, so this file contains no cast at all.
      const parsed = tryParseNodeId(candidate);
      if (parsed.ok) return parsed.value;
    }
  }
}

/** One frame of the seed walk, plus the ancestor link that turns a cyclic seed
 *  into a rejection rather than a hang. */
type SeedFrame<Ts extends readonly WidenedNodeType[], S> = Readonly<{
  seed: Seed<Ts, S>;
  parentId: NodeId;
  index: number;
  ancestors: SeedPath<Ts, S> | null;
}>;

/**
 * The ancestor path as a linked list, not a Set: O(1) to extend, and depth is
 * small in practice. It has to be the PATH and not a global visited set —
 * inserting the same seed VALUE twice as two siblings is legitimate (two copies
 * of one thing), while a seed that appears inside itself is a cycle.
 */
type SeedPath<Ts extends readonly WidenedNodeType[], S> = Readonly<{
  seed: Seed<Ts, S>;
  parent: SeedPath<Ts, S> | null;
}>;

function seedPathContains<Ts extends readonly WidenedNodeType[], S>(
  path: SeedPath<Ts, S> | null,
  seed: Seed<Ts, S>,
): boolean {
  for (let link = path; link !== null; link = link.parent) {
    if (link.seed === seed) return true;
  }
  return false;
}

export function applyInsertNodes<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  seeds: readonly Seed<Ts, S>[],
  toParentId: NodeId,
  toIndex: number,
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  if (seeds.length === 0) {
    return fail("empty-command", "insert-nodes was given no seeds.");
  }

  const targetCheck = checkInsertTarget(graph, toParentId);
  if (!targetCheck.ok) return targetCheck;

  const currentChildren = getChildren(graph, toParentId);
  // Nothing is removed first, so this index lives in the target's CURRENT
  // coordinates — the one place insert and move genuinely differ.
  if (!isValidIndex(toIndex, currentChildren.length)) {
    return fail(
      "index-out-of-range",
      `toIndex ${toIndex} is outside [0, ${currentChildren.length}] for ${JSON.stringify(toParentId)}.`,
      { parentId: toParentId, index: toIndex },
    );
  }

  // DEPTH first, because it can be answered from the seeds alone and refusing
  // before `buildSeedPlacements` mints ids keeps a refused command from having
  // consumed any of the id space.
  if (ctx.maxDepth !== null) {
    const deepest = depthOf(graph, toParentId) + tallestSeed<Ts, S>(seeds);
    if (deepest > ctx.maxDepth) {
      return fail(
        "would-exceed-max-depth",
        `Inserting here would nest ${deepest} levels, above the ${ctx.maxDepth} ceiling. ` +
          `Raise or clear EngineConfig.maxDepth if this is legitimate.`,
        { parentId: toParentId, limit: ctx.maxDepth, actual: deepest },
      );
    }
  }

  const built = buildSeedPlacements(graph, seeds, toParentId, toIndex, ctx);
  if (!built.ok) return built;

  // COUNTED FROM THE PLACEMENTS, not from `seeds.length`: one seed may carry a
  // whole subtree, and a per-command check would let three nodes in under a
  // ceiling with room for one.
  const total = graph.nodesById.size + built.value.length;
  if (total > ctx.maxNodes) {
    return fail(
      "would-exceed-max-nodes",
      `Inserting ${built.value.length} node(s) into a graph of ${graph.nodesById.size} would reach ` +
        `${total}, above the ${ctx.maxNodes} ceiling. Raise EngineConfig.maxNodes if this is legitimate.`,
      { parentId: toParentId, limit: ctx.maxNodes, actual: total },
    );
  }

  const patch: Patch<Ts, S> = { type: "inserted", placements: built.value };
  return ok({ graph: applyPatch(graph, patch, ctx), patch });
}

export function checkInsertTarget<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  toParentId: NodeId,
): Result<void, Rejection> {
  const target = getNode(graph, toParentId);
  if (target === undefined) {
    return fail(
      "unknown-parent",
      `No node ${JSON.stringify(toParentId)} to insert into.`,
      { parentId: toParentId },
    );
  }
  if (!target.container) {
    return fail(
      "not-a-container",
      `Node ${JSON.stringify(toParentId)} is a leaf and cannot hold children.`,
      { parentId: toParentId, kind: target.kind },
    );
  }
  if (target.children === null || target.children.status !== "loaded") {
    return fail(
      "target-not-loaded",
      `Node ${JSON.stringify(toParentId)} is a container whose children are not loaded.`,
      { parentId: toParentId },
    );
  }
  return ok(undefined);
}

/**
 * Expand a seed forest into `inserted` placements: DOCUMENT ORDER, parents
 * first, which is the order `applyPatch` walks forward and `invertPatch`
 * preserves.
 *
 * EXPLICIT STACK, never recursion — seed depth is consumer input.
 */

/**
 * The tallest subtree in a seed batch, counting the seed itself as 1.
 *
 * Walked with an explicit stack for the same reason every other walk in this
 * package is: a seed's children are consumer-supplied and their nesting is not
 * this module's to trust.
 */
function tallestSeed<Ts extends readonly WidenedNodeType[], S>(
  seeds: readonly Seed<Ts, S>[],
): number {
  // MEMOISED BY OBJECT IDENTITY, because a seed forest is a plain object tree
  // and nothing stops two branches pointing at the SAME child. That is a DAG,
  // not a cycle, so the cyclic-seed guard in `buildSeedPlacements` never fires
  // for it — and a plain walk would visit the shared subtree once per path,
  // which is 2^depth for one child reused at every level.
  //
  // Heights are what memoise cleanly here: a seed's height depends only on the
  // seed, so the same object always has the same answer and computing it once
  // makes the walk O(distinct seeds) instead of O(paths).
  //
  // The map is scoped to the call and keyed by reference, so it holds the
  // consumer's objects only for as long as the check runs.
  const heightOf = new Map<Seed<Ts, S>, number>();

  // ITERATIVE, with an explicit stack, for the reason every walk in this
  // package is: nesting is consumer-supplied and not this module's to trust.
  // Two passes over each frame — the first schedules children, the second folds
  // their finished heights — which is how a post-order fold is written without
  // recursion.
  let tallest = 0;
  for (const root of seeds) {
    const stack: Readonly<{ seed: Seed<Ts, S>; expanded: boolean }>[] = [
      { seed: root, expanded: false },
    ];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) break;
      const { seed, expanded } = frame;
      if (heightOf.has(seed)) continue;

      const kids = seed.children;
      if (kids === undefined || kids.length === 0) {
        heightOf.set(seed, 1);
        continue;
      }

      if (!expanded) {
        stack.push({ seed, expanded: true });
        for (const kid of kids) {
          if (!heightOf.has(kid)) stack.push({ seed: kid, expanded: false });
        }
        continue;
      }

      let tallestChild = 0;
      for (const kid of kids) {
        // Present for every child by now: this frame was re-pushed beneath all
        // of them. A cyclic seed is the one shape that could leave one missing,
        // and `buildSeedPlacements` refuses that with `parse-failed` — so the
        // `?? 0` is a total-function guard, not a silent floor anything relies
        // on.
        const kidHeight = heightOf.get(kid) ?? 0;
        if (kidHeight > tallestChild) tallestChild = kidHeight;
      }
      heightOf.set(seed, tallestChild + 1);
    }
    const rootHeight = heightOf.get(root) ?? 1;
    if (rootHeight > tallest) tallest = rootHeight;
  }
  return tallest;
}

function buildSeedPlacements<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  seeds: readonly Seed<Ts, S>[],
  toParentId: NodeId,
  toIndex: number,
  ctx: EngineContext<S>,
): Result<readonly Placement<Ts, S>[], Rejection> {
  const placements: Placement<Ts, S>[] = [];
  const taken = new Set<string>(graph.nodesById.keys());
  // Owners claimed by THIS batch. The graph's own index cannot see them yet, so
  // without this two sibling seeds could both claim one stored subtree.
  const claimedSourceKeys = new Map<string, NodeId>();

  const stack: SeedFrame<Ts, S>[] = [];
  // Pushed in reverse so the stack pops them in order; a plain DFS from there
  // IS document order.
  for (let i = seeds.length - 1; i >= 0; i -= 1) {
    const seed = seeds[i];
    if (seed === undefined) continue;
    stack.push({ seed, parentId: toParentId, index: toIndex + i, ancestors: null });
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { seed, parentId, index, ancestors } = frame;

    if (seedPathContains(ancestors, seed)) {
      // A seed that contains itself would expand forever. Reported as
      // "parse-failed" — "we could not build this node" is exactly true, and it
      // is the code that carries `issues`.
      return fail("parse-failed", "A seed contains itself; the seed tree is cyclic.", {
        kind: seed.kind,
        issues: [{ path: "$.children", message: "cyclic seed" }],
      });
    }

    const nodeType = ctx.registry.get(seed.kind);
    if (nodeType === undefined) {
      // On the WIRE an unknown kind seals, because forward-incompatible
      // stored data has to stay movable and deletable. On the COMMAND path it
      // is refused: the consumer is right here holding a value it just built,
      // and sealing a brand-new insert would be nonsense.
      return fail(
        "unknown-kind",
        `No node type registered for kind ${JSON.stringify(seed.kind)}.`,
        { kind: seed.kind },
      );
    }

    const seedChildren = seed.children;
    if (!nodeType.container && seedChildren !== undefined) {
      return fail(
        "leaf-seed-with-children",
        `Kind ${JSON.stringify(seed.kind)} is a leaf and cannot be seeded with children.`,
        { kind: seed.kind },
      );
    }

    const nodeId = mintFreshId(taken, ctx);
    taken.add(nodeId);

    // The seed's `data` is already typed as the kind's `Data`, and it STILL goes
    // through the node type: a normalizing parse must normalize inserts too, and a
    // consumer handing in a value that violates its own invariants deserves to
    // be caught at the same door as wire data. `schemaVersion` is the registry's
    // own, so no migration runs on a value authored against the running code.
    const parsed = parseNodeData<S>(ctx, {
      nodeId,
      kind: seed.kind,
      container: nodeType.container,
      schemaVersion: nodeType.schemaVersion,
      raw: seed.data,
    });
    if (!parsed.ok) {
      return fail(
        parsed.error.reason === "unknown-kind" ? "unknown-kind" : "parse-failed",
        `Seed for kind ${JSON.stringify(seed.kind)} failed its own parse.`,
        { kind: seed.kind, issues: parsed.error.issues },
      );
    }

    const node: GraphNode<Ts, S> = nodeType.container
      ? makeCollectionNode<Ts, S>(
          nodeId,
          seed.kind,
          parsed.value.data,
          // A seed always produces a LOADED collection: the consumer just
          // supplied its whole content, so "we have not read this yet" is false
          // by construction. Omitted children means loaded-and-empty.
          { status: "loaded" },
          seed.summary ?? null,
        )
      : makeLeafNode<Ts>(nodeId, seed.kind, parsed.value.data);

    const sourceKey = owningSourceKey<Ts, S>(ctx, node);
    if (sourceKey !== null) {
      const existingOwner =
        graph.ownerBySourceKey.get(sourceKey) ?? claimedSourceKeys.get(sourceKey);
      if (existingOwner !== undefined) {
        // The typed answer the consumer is meant to give is a `reference`
        // placement. Two owning placements of one stored subtree is the
        // condition the production predecessor survived only by never loading
        // the second one.
        return fail(
          "duplicate-owner",
          `Source ${JSON.stringify(sourceKey)} is already owned by ${JSON.stringify(existingOwner)}.`,
          { kind: seed.kind, sourceKey, ownerId: existingOwner, nodeIds: [nodeId] },
        );
      }
      claimedSourceKeys.set(sourceKey, nodeId);
    }

    placements.push({ node, parentId, index });

    // THE CEILING, CHECKED AS WE BUILD rather than after.
    //
    // `applyInsertNodes` also checks `maxNodes` once this returns, and that
    // check is the one whose message a consumer reads — but by then the work is
    // already done, and the work is what needs bounding. A seed forest is a
    // plain object tree from the consumer, and nothing stops two branches
    // pointing at the SAME child object: that is a DAG, not a cycle, so
    // `seedPathContains` above never fires (no seed is its own ancestor) and the
    // walk expands it to 2^depth.
    //
    // MEASURED against a `maxNodes` of 50, one shared child per level:
    //
    //   depth 10  ->    2,048 placements built,     4 ms
    //   depth 12  ->    8,192                      11 ms
    //   depth 14  ->   32,768                      37 ms
    //   depth 16  ->  131,072                     144 ms
    //
    // Doubling per level, all of it to end in `would-exceed-max-nodes` for a
    // ceiling of 50. At depth 30 it is two billion nodes and the process is
    // gone before anything gets to refuse.
    //
    // Refusing HERE makes the cost O(maxNodes) instead of O(2^depth), which is
    // the same correction ./serialize made on the ingress door — it calls its
    // equivalent "the EARLIEST honest point". The rejection is shaped exactly
    // like the post-hoc one so a consumer cannot tell which arm refused; only
    // `actual` differs, and it is honestly "where we stopped counting" rather
    // than a total nobody should have computed.
    const wouldHold = graph.nodesById.size + placements.length;
    if (wouldHold > ctx.maxNodes) {
      return fail(
        "would-exceed-max-nodes",
        `Inserting these seeds into a graph of ${graph.nodesById.size} would pass ` +
          `the ${ctx.maxNodes} ceiling. Raise EngineConfig.maxNodes if this is legitimate.`,
        { parentId: toParentId, limit: ctx.maxNodes, actual: wouldHold },
      );
    }

    if (seedChildren !== undefined) {
      const path: SeedPath<Ts, S> = { seed, parent: ancestors };
      for (let i = seedChildren.length - 1; i >= 0; i -= 1) {
        const child = seedChildren[i];
        if (child === undefined) continue;
        stack.push({ seed: child, parentId: nodeId, index: i, ancestors: path });
      }
    }
  }

  return ok(placements);
}
