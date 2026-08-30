// Graph — identity keys, and the one ownership predicate.
//
// `contentKey` ("same asset") and `sourceKey` ("same stored subtree") are the
// two consumer hooks the derived indexes are built from, and `ownsItsSubtree` is
// THE SINGLE ANSWER to "does this placement own its subtree" — four call sites
// used to decide that independently and disagreed about leaves.
//
// Kept together because they are one decision: what a node's identity is, and
// who is entitled to claim it.

import type {
  WidenedNodeType,
  GraphNode,
  NodeId,
  NodeTypeRegistry,
} from "../types";
import { describeThrown } from "../types";
import { stateOwnsSubtree } from "./queries";

// Both return `null` for a quarantined node, and that is not a shortcut. A
// quarantined node holds `raw`, not parsed `Data`; no node type is willing to vouch
// for it, so handing `raw` to `contentKey` would ask a function typed against
// `Data` to read something that failed to become `Data`. A node whose content
// could not be understood has no content identity.
//
// Neither swallows the call into `null`, and that part of the original
// decision stands: swallowing would silently disable the single-owner rule —
// the invariant that stops two placements from both claiming one stored
// subtree, which is the condition the predecessor's server had to answer with
// a 409 because nothing upstream enforced it. `null` means "this node has no
// key", and a node type that threw has not said that.
//
// But letting the throw travel RAW was the other half of a choice with only
// two options in it, and it is the half review3 already ruled out for every
// other consumer hook: "dispatch promises a `Result`. A node type that throws
// ... turned that into an unhandled exception out of a React event handler, at
// every call site that correctly wrote `if (!result.ok)`." Measured before this
// change, one throwing `contentKey`:
//
//   deserialize                     THREW
//   dispatch (edit / insert / remove)  THREW
//   undo, through verifyPatchApplies   THREW
//   store.load                      THREW
//   findInvariantViolation          THREW
//   serializeGraph                  survived (it does not read these keys)
//
// Seven of eight doors, five of them promising a `Result` and one promising to
// be total.
//
// THE THIRD OPTION: refuse. The consumer's throw is caught here and re-thrown
// as `KeyHookFailure`, a private tag no consumer can construct, and each
// Result-typed door catches THAT TAG ONLY and turns it into a rejection naming
// the node and the hook. Nothing is swallowed, nothing silently loses a key,
// and — because the catch is `instanceof` a private class rather than a bare
// `catch` around a door — a genuine bug inside this engine still crashes
// loudly instead of being reported as a consumer's fault.

/**
 * A consumer `contentKey`/`sourceKey` threw.
 *
 * PRIVATE BY CONSTRUCTION: not exported from ./index, so a consumer cannot
 * construct one and a door catching it cannot be spoofed into reporting an
 * engine bug as a node-type failure.
 */
export class KeyHookFailure extends Error {
  readonly kind: string;
  readonly hook: "contentKey" | "sourceKey";
  readonly nodeId: NodeId | null;
  readonly cause: unknown;

  constructor(
    kind: string,
    hook: "contentKey" | "sourceKey",
    nodeId: NodeId | null,
    cause: unknown,
  ) {
    super(
      `graph-core: ${JSON.stringify(kind)}.${hook} threw` +
        (nodeId === null ? "" : ` for node ${JSON.stringify(nodeId)}`) +
        `. ${describeThrown(cause)}`,
    );
    this.name = "KeyHookFailure";
    this.kind = kind;
    this.hook = hook;
    this.nodeId = nodeId;
    this.cause = cause;
  }
}

/** The rejection message every door reports this failure with, so the consumer
 *  reads the same sentence whichever door refused. */
export function keyHookMessage(failure: KeyHookFailure): string {
  return failure.message;
}

export function contentKeyOf<Ts extends readonly WidenedNodeType[], S>(
  registry: NodeTypeRegistry,
  node: GraphNode<Ts, S>,
): string | null {
  if (node.quarantined) return null;
  const nodeType = registry.get(node.kind);
  if (nodeType === undefined || nodeType.contentKey === undefined) return null;
  try {
    return nodeType.contentKey(node.data);
  } catch (thrown) {
    throw new KeyHookFailure(node.kind, "contentKey", node.id, thrown);
  }
}

export function sourceKeyOf<Ts extends readonly WidenedNodeType[], S>(
  registry: NodeTypeRegistry,
  node: GraphNode<Ts, S>,
): string | null {
  if (node.quarantined) return null;
  return sourceKeyForData(registry, node.kind, node.data, node.id);
}

/**
 * The key a piece of DATA would claim — for a caller holding a value no node
 * holds yet.
 *
 * `verifyDataChanged` needs exactly this: it must know what key a patch's
 * `after` would claim before deciding whether replaying it is safe, and the
 * node in the graph still carries the old value.
 *
 * `Of` a node, `For` raw data — that is the whole distinction between this and
 * `sourceKeyOf` above. It was `sourceKeyOfKindData`, which listed its
 * parameters instead of saying what it answers.
 *
 * Split out rather than duplicated so the two cannot disagree about which
 * node-type hook answers, and so the `KeyHookFailure` wrapping stays in ONE
 * place — see the block comment at the top of this file for why a throwing key
 * function is neither swallowed into `null` nor allowed to travel raw.
 */
export function sourceKeyForData(
  registry: NodeTypeRegistry,
  kind: string,
  data: unknown,
  /** Only for the failure message — this overload exists precisely for a caller
   *  holding a value no node holds yet, so there may be no id to name. */
  nodeId: NodeId | null = null,
): string | null {
  const nodeType = registry.get(kind);
  if (nodeType === undefined || nodeType.sourceKey === undefined) return null;
  try {
    return nodeType.sourceKey(data);
  } catch (thrown) {
    throw new KeyHookFailure(kind, "sourceKey", nodeId, thrown);
  }
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
 * Reads a bare `ChildrenState` through `stateOwnsSubtree` in ./queries, which is
 * the same question one layer down. Prefer THIS one at every call site that has
 * a node: it rules out the two cases that have no state to ask about before
 * delegating, and keeping the pair distinguishable is why that one is named for
 * its argument.
 *
 * A quarantined node owns nothing either: its key would have to come from a
 * node type that by definition did not run, so `sourceKeyOf` already answers `null`
 * for it. Stated here as well so the predicate is total on its own terms rather
 * than relying on a caller having checked first.
 */
export function ownsItsSubtree<Ts extends readonly WidenedNodeType[], S>(
  node: GraphNode<Ts, S>,
): boolean {
  if (node.quarantined) return false;
  if (!node.container) return false;
  return stateOwnsSubtree(node.children);
}

// ---------------------------------------------------------------------------
