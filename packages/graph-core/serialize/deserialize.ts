// Graph — deserializeDocument — the whole-document ingress door.
//
// Split out of the former single-file `serialize.ts`; see ./index.ts.

import {
  type EngineContext,
  type Graph,
  type LoadReport,
  type NodeId,
  type Result,
  type StructuralError,
  type WidenedNodeType,
} from "../types";

import {
  INITIAL_REV,
  rebuildDerivedIndexes,
} from "../graph";

import { fail } from "./shape";
import { buildDocument, findDuplicateOwner } from "./document";


// 4. deserializeDocument
// ---------------------------------------------------------------------------

/**
 * Whole-document load. Structural failures are fatal and return a
 * `StructuralError`; per-node content failures seal by default, keeping
 * id, position, children and byte-exact `raw`.
 */
export function deserializeDocumentUnguarded<Ts extends readonly WidenedNodeType[], S>(
  raw: unknown,
  ctx: EngineContext<S>,
): Result<
  Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
  StructuralError
> {
  const built = buildDocument<Ts, S>(raw, ctx, { rootsMustBeContainers: true });
  if (!built.ok) return built;
  const doc = built.value;

  // Every node starts at `INITIAL_REV`, which is 1 and deliberately not 0 —
  // see that constant. `subtreeRevById` is TOTAL over
  // `nodesById` — a missing entry would read as 0 through `getSubtreeRev` and
  // then never appear to change, so a card bound to it would never re-render.
  const subtreeRevById = new Map<NodeId, number>();
  for (const id of doc.order) subtreeRevById.set(id, INITIAL_REV);

  const base: Graph<Ts, S> = {
    engineId: ctx.engineId,
    nodesById: doc.nodesById,
    childrenById: doc.childrenById,
    parentById: doc.parentById,
    rootIds: doc.rootIds,
    subtreeRevById,
    // A freshly deserialized document has removed nothing.
    // Nothing has been removed from a freshly parsed document, and every node
    // sits at the seed, so the floor is the seed.
    revFloor: INITIAL_REV,
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
