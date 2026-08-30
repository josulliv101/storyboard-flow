// KEEL graph — the kind -> node type map.
//
// One function, and it is the only one in keel-core that throws. That is why it
// is on its own: everything else in this folder is total, and burying the single
// exception among them is how a reader comes to believe the rule has holes.

import type { ErasedNodeType, NodeTypeRegistry } from "../types";


/**
 * Build the kind -> node type map.
 *
 * THROWS on a duplicate kind, and this is the only function in keel-core that
 * throws. It is a module-init programmer error, not a recoverable condition:
 * two node types claiming one kind means one of them silently wins at the trust
 * boundary, so `switch (node.kind)` narrows `data` to a type the node does not
 * hold and the whole discriminated union is quietly a lie. There is no
 * partial-success answer worth returning — the consumer's module graph is
 * wrong, and it is wrong before any data has been read.
 */
export function buildRegistry(types: readonly ErasedNodeType[]): NodeTypeRegistry {
  const registry = new Map<string, ErasedNodeType>();
  for (const nodeType of types) {
    if (registry.has(nodeType.kind)) {
      throw new Error(
        `keel: duplicate node kind ${JSON.stringify(nodeType.kind)} in ` +
          `createEngine({ types }). Each kind may be claimed by exactly one node type.`,
      );
    }
    registry.set(nodeType.kind, nodeType);
  }
  return registry;
}

// ---------------------------------------------------------------------------
