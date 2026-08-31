// Graph — serializeGraph — the way out.
//
// Split out of the former single-file `serialize.ts`; see ./index.ts.

import {
  type ChildrenState,
  type EngineContext,
  type Graph,
  quoteFromWire,
  type NodeId,
  type SerializedDocument,
  type SerializedNode,
  type WidenedNodeType,
} from "../types";

import {
  documentOrder,
  getChildren,
} from "../graph";

import { type NodeDraft } from "./shape";


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
export function serializeGraph<Ts extends readonly WidenedNodeType[], S>(
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
    // sealed unloaded container reloads as a sealed leaf and its
    // subtree becomes unreachable forever.
    draft.childrenState = state.status;
    if (state.status === "missing") draft.missingReason = state.reason;
  };

  const serializeData = (kind: string, data: unknown): unknown => {
    const nodeType = ctx.registry.get(kind);
    // Unreachable: a non-sealed node was built by a node type found in this
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
    // on reload it either parses or seals loudly. Both outcomes beat
    // losing the whole save.
    try {
      return nodeType.serialize(data);
    } catch (thrown) {
      console.error(
        `graph-core: ${quoteFromWire(kind)}.serialize threw while writing a node for save. ` +
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

    if (node.sealed) {
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
      // examined, and it wins. That is precisely the case that made sealing
      // a one-way door: a node sealed at v1 because the v2 migration threw
      // was re-emitted labelled v2, so the fixed build's `runMigrations` saw
      // `from >= to`, ran nothing, and handed v1 bytes to a v2 `parse`. The
      // node sealed again, forever, and the mechanism that existed to
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
            `graph-core: the summary type's serialize threw while writing node ${quoteFromWire(id)} for save. ` +
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
