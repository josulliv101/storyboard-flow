// Graph — The key-hook guard, and the two public ingress doors.
//
// Split out of the former single-file `serialize.ts`; see ./index.ts.

import {
  type EngineContext,
  type Graph,
  type LoadRejection,
  type LoadReport,
  type NodeId,
  type Result,
  type StructuralError,
  type WidenedNodeType,
} from "../types";

import {
  KeyHookFailure,
  keyHookMessage,
} from "../graph";

import { deserializeDocumentUnguarded } from "./deserialize";
import { loadChildrenIntoUnguarded, loadRejection } from "./load-children";


// The key-hook guard
// ---------------------------------------------------------------------------
//
// The two ingress doors, guarded for the reason ./commands and ./patches are —
// see `guardKeyHooks` there. These two are the ones a HOSTILE payload reaches:
// both run the consumer's key hooks over the merged graph to find a duplicate
// owner, so a node type that throws on some shape of data turned a refusable
// document into a thrown load. Measured before the guard, a throwing
// `contentKey` OR `sourceKey` escaped both.
//
// `instanceof` the private tag, never a bare `catch`: a bare catch here would
// turn every genuine bug in this module into "malformed-document" and blame the
// payload for the engine's mistake, on the one door whose whole job is telling
// those two apart.

export function deserializeDocument<Ts extends readonly WidenedNodeType[], S>(
  raw: unknown,
  ctx: EngineContext<S>,
): Result<
  Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
  StructuralError
> {
  try {
    return deserializeDocumentUnguarded<Ts, S>(raw, ctx);
  } catch (thrown) {
    if (thrown instanceof KeyHookFailure) {
      return {
        ok: false,
        error: {
          code: "node-type-threw",
          message: keyHookMessage(thrown),
          ...(thrown.nodeId === null ? {} : { nodeId: thrown.nodeId }),
        },
      };
    }
    throw thrown;
  }
}

export function loadChildrenInto<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
  doc: unknown,
  ctx: EngineContext<S>,
): Result<
  Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
  LoadRejection
> {
  try {
    return loadChildrenIntoUnguarded<Ts, S>(graph, id, doc, ctx);
  } catch (thrown) {
    if (thrown instanceof KeyHookFailure) {
      return loadRejection({
        code: "node-type-threw",
        message: keyHookMessage(thrown),
        nodeId: thrown.nodeId ?? id,
      });
    }
    throw thrown;
  }
}
