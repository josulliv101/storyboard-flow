// Graph — Document building — the pass both ingress doors share.
//
// Split out of the former single-file `serialize.ts`; see ./index.ts.

import {
  describeThrown,
  makeCollectionNode,
  makeLeafNode,
  makeSealedNode,
  tryParseNodeId,
  type GraphNode,
  type ChildrenState,
  type EngineContext,
  type Graph,
  type IngressError,
  type Issue,
  type LoadReport,
  quoteFromWire,
  type NodeId,
  type NodeTypeRegistry,
  type Result,
  type SerializedNode,
  type StructuralError,
  type WidenedNodeType,
} from "../types";

import {
  ownsItsSubtree,
  sourceKeyOf,
} from "../graph";

import { fail, malformed, parseSerializedDocument } from "./shape";
import { parseNodeData, runContentDevChecks } from "./content";


// 3. Document building — the pass both ingress doors share
// ---------------------------------------------------------------------------

/**
 * A validated, content-parsed document, not yet a `Graph`. `parentById` maps
 * this document's own roots to `null`; `loadChildrenInto` re-points them at
 * the target it is filling.
 */
type BuiltDocument<Ts extends readonly WidenedNodeType[], S> = Readonly<{
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
/**
 * THE ID-LENGTH CEILING, applied wherever this document's ids are adopted.
 *
 * One helper for all three sites — `nodes[].id`, `rootIds[]` and
 * `children[]` — because a ceiling enforced at two of the three is a ceiling
 * with a door left open, and each of those three is somewhere a sender chooses
 * a string. See `EngineConfig.maxNodeIdLength` for what it protects, which is
 * the memo table rather than the graph.
 *
 * BEFORE `tryParseNodeId`, not after, and for `quoteFromWire`'s reason: the
 * only thing done with an over-long id should be measuring it. Parsing it first
 * would brand a megabyte on the way to refusing it.
 *
 * `null` when the id fits, so the caller reads it as "no complaint".
 */
function idTooLong<S>(
  raw: string,
  ctx: EngineContext<S>,
  where: string,
): StructuralError | null {
  if (ctx.maxNodeIdLength === null) return null;
  if (raw.length <= ctx.maxNodeIdLength) return null;
  return {
    code: "node-id-too-long",
    message:
      `${where} presents a node id of ${raw.length} characters, above the ` +
      `${ctx.maxNodeIdLength} ceiling. Raise or clear EngineConfig.maxNodeIdLength ` +
      `if this id is legitimate.`,
    limit: ctx.maxNodeIdLength,
    actual: raw.length,
  };
}

export function buildDocument<Ts extends readonly WidenedNodeType[], S>(
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
    const tooLong = idTooLong(node.id, ctx, "nodes");
    if (tooLong !== null) return fail(tooLong);
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
        message: `Node id ${quoteFromWire(node.id)} appears more than once in nodes`,
        nodeId: id.value,
      });
    }
    wireById.set(id.value, node);
  }

  // --- Pass B: roots --------------------------------------------------------
  const rootIds: NodeId[] = [];
  const rootSet = new Set<NodeId>();
  for (const rawRootId of doc.rootIds) {
    const tooLong = idTooLong(rawRootId, ctx, "rootIds");
    if (tooLong !== null) return fail(tooLong);
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
        message: `rootIds names ${quoteFromWire(rawRootId)}, which is not in nodes`,
        nodeId: id.value,
      });
    }
    if (rootSet.has(id.value)) {
      return fail({
        code: "duplicate-node-id",
        message: `rootIds names ${quoteFromWire(rawRootId)} more than once`,
        nodeId: id.value,
      });
    }
    rootSet.add(id.value);
    rootIds.push(id.value);
  }

  // --- Pass C: container-ness and children state ----------------------------
  const containerById = new Map<NodeId, boolean>();
  const stateById = new Map<NodeId, ChildrenState>();
  /** Leaf kinds that arrived carrying children. Sealed in Pass F. */
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
    // is what keeps seal round-tripping: `serializeGraph` writes an
    // explicit `childrenState: "unloaded"` for every non-loaded container, so
    // a sealed node arriving with neither signal really was a leaf, and
    // guessing "unloaded container" would silently grow it a subtree it never
    // had.
    const container =
      nodeType !== undefined
        ? nodeType.container
        : hasChildren || node.childrenState !== undefined;

    if (!container) {
      // A LEAF KIND ARRIVING WITH CHILDREN IS SEALD, NOT REJECTED.
      //
      // This was the last shape failure that took the whole document down,
      // while a node whose DATA failed to parse sealed and everything
      // around it loaded. Nothing justified the asymmetry: both are one node's
      // wire form disagreeing with this build, and `SealReason`'s own
      // doc already carried the argument — "one refused stored clip made a
      // whole document unwritable forever."
      //
      // HELD AS A CONTAINER, deliberately, and this is the part that matters.
      // The node declared children; they exist in the flat tree and something
      // must own them. Recording it as a leaf here would leave every one of
      // them parentless, which is the single thing this engine refuses to
      // produce. `SealedNode` carries both `container` and a
      // `ChildrenState` precisely so this case has somewhere to land.
      const mismatch = hasChildren
        ? `carries a children array while kind ${quoteFromWire(node.kind)} is registered as a leaf`
        : node.childrenState !== undefined
          ? `carries childrenState ${quoteFromWire(node.childrenState)} while kind ${quoteFromWire(node.kind)} is registered as a leaf`
          : null;
      if (mismatch === null) {
        containerById.set(id, false);
        continue;
      }
      shapeMismatchById.set(id, {
        path: "$",
        message: `Node ${quoteFromWire(node.id)} ${mismatch}`,
      });
      // Fall through to the container arm below, so the declared children are
      // walked, counted and attached exactly as a real container's would be.
      // Pass F reads `containerById` and `stateById`, so the sealed node
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
      const tooLongChild = idTooLong(rawChildId, ctx, "children");
      if (tooLongChild !== null) return fail(tooLongChild);
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
          message: `Node ${quoteFromWire(node.id)} names child ${quoteFromWire(rawChildId)}, which is not in nodes`,
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
          message: `Node ${quoteFromWire(rawChildId)} appears as a child more than once`,
          nodeId: child.value,
        });
      }
      if (rootSet.has(child.value)) {
        return fail({
          code: "multi-parent",
          message: `Node ${quoteFromWire(rawChildId)} is a root and also a child of ${quoteFromWire(node.id)}`,
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
          message: `Root ${quoteFromWire(id)} is not a container`,
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
          message: `Node ${quoteFromWire(node.id)} is not reachable from any root`,
          nodeId: id.value,
        });
      }
    }
    return malformed("Document contains nodes unreachable from any root");
  }

  // --- Pass F: content -----------------------------------------------------
  const nodesById = new Map<NodeId, GraphNode<Ts, S>>();
  const sealed: IngressError[] = [];
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
    // SEALS — loud, byte-exact, and repairable. Between a silent
    // corruption and a loud refusal, take the refusal.
    const declaredVersion =
      // THE NODE'S OWN VERSION WINS. Present only on a node re-emitted from
      // seal, where the document-level entry describes the registry
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
      // one. `raw` is carried through byte-exact, as with every seal.
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
      // to a node type that expects `S` would seal a node for the crime of
      // having no rollup yet.
      if (container && wire.summary !== undefined && wire.summary !== null) {
        // WRAPPED, exactly as `parseNodeData` wraps a node type's `parse`. The
    // summary type is consumer-supplied and runs on untrusted bytes, so a
    // throw here is the same class of event as a throw there — and it used to
    // take the whole `deserialize` down instead of sealing one node,
    // which is the failure sealing exists to prevent.
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
          // A failed summary is PER-NODE CONTENT, so it seals like any
          // other content failure rather than killing the document. The node
          // keeps its raw summary verbatim, its children stay addressable, and
          // the user can still delete or move it — which is the whole point of
          // seal.
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
            `the summary type (node ${quoteFromWire(id)})`,
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
          message: `Node ${quoteFromWire(wire.id)} (kind ${quoteFromWire(wire.kind)}) failed ingress: ${failure.reason}`,
          nodeId: id,
          issues: failure.issues,
          ingress: [failure],
        });
      }
      sealed.push(failure);
      nodesById.set(
        id,
        makeSealedNode({
          id,
          kind: wire.kind,
          container,
          // Carried from the wire so a round-trip through seal re-emits
          // the version the document actually declared, even for a kind this
          // build has never heard of.
          schemaVersion: declaredVersion,
          // `raw` is the node's DATA only, byte-exact. Its children live in
          // the flat tree, which is what keeps them addressable and movable.
          raw: wire.data,
          reason: failure.reason,
          issues: failure.issues,
          // A sealed CONTAINER still needs its load state, or a document
          // that round-trips through seal forgets that a subtree was
          // unloaded. `null` on a sealed leaf.
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
        sealed,
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
 * with no subtree cannot own one. Sealed nodes are exempt too —
 * `sourceKeyOf` returns `null` for them, since the key comes from a node type that
 * by definition did not run.
 */
export function findDuplicateOwner<Ts extends readonly WidenedNodeType[], S>(
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
        message: `sourceKey ${quoteFromWire(key)} is owned by both ${quoteFromWire(existing)} and ${quoteFromWire(id)}; the second placement must be a reference`,
        nodeId: id,
      };
    }
    owners.set(key, id);
  }
  return null;
}

/**
 * The duplicate-owner check a LAZY PAGE needs, over the ARRIVALS alone.
 *
 * `findDuplicateOwner` answers the same question by walking every node in the
 * merged graph and calling `sourceKeyOf` on each — O(resident) node-type calls
 * to admit a page of 200. This is O(arrivals), and sound for the reason the
 * incremental index updaters are: a load ADDS nodes and changes no existing
 * node's `data`, so no incumbent's `sourceKey` moves, and the target's own
 * ownership is unchanged because `unloaded` and `loaded` BOTH own — only
 * `reference` disclaims (`stateOwnsSubtree`). The only conflicts a load can
 * create are therefore arrival-vs-incumbent and arrival-vs-arrival, and both
 * are visible from the arrivals plus the pre-load `ownerBySourceKey`.
 *
 * WHAT THIS DELIBERATELY STOPS DOING: re-auditing the WHOLE graph on every page
 * load. A duplicate already sitting among resident nodes is not this door's to
 * find — `ownerBySourceKey` cannot represent one, `findInvariantViolation`
 * check 8 is what names it, and `applyInserted` has always trusted that map the
 * same way.
 *
 * Message and shape are identical to `findDuplicateOwner`'s, so which door
 * refused is not something a consumer can tell from the rejection.
 */
export function findDuplicateOwnerAmongArrivals<
  Ts extends readonly WidenedNodeType[],
  S,
>(
  ownerBySourceKey: ReadonlyMap<string, NodeId>,
  registry: NodeTypeRegistry,
  arrived: readonly GraphNode<Ts, S>[],
): StructuralError | null {
  const claimed = new Map<string, NodeId>();
  for (const node of arrived) {
    if (!ownsItsSubtree<Ts, S>(node)) continue;
    const key = sourceKeyOf<Ts, S>(registry, node);
    if (key === null) continue;
    const existing = ownerBySourceKey.get(key) ?? claimed.get(key);
    if (existing !== undefined) {
      return {
        code: "duplicate-owner",
        message: `sourceKey ${quoteFromWire(key)} is owned by both ${quoteFromWire(existing)} and ${quoteFromWire(node.id)}; the second placement must be a reference`,
        nodeId: node.id,
      };
    }
    claimed.set(key, node.id);
  }
  return null;
}
