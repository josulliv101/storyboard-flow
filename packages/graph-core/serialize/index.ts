// Graph — the wire, migrations, and the ingress trust boundary.
//
// PURE. No React, no DOM. Imports ./types and ./graph and nothing else.
//
// This module owns the only place untrusted content becomes typed `Data`.
// Every ingress in the engine funnels through `parseNodeData`: `deserialize`,
// `loadChildren`, `insert-nodes` seeds, and `applyNonUndoableWrite`. One door means one
// place migrations run, one place a node type's refusal is interpreted, and one
// place to look when forward-incompatible data shows up in production.
//
// TWO VERSION AXES, deliberately separate:
//   - `formatVersion` — the ENGINE's structural format (currently 1). It
//     describes the shape of the envelope: flat node list, rootIds, the
//     children encoding.
//   - `schemaVersions` — the CONSUMER's per-kind content schema. One number
//     per kind, because one number cannot advance three independent schemas
//     without forcing every node type to bump when any one of them changes.
//
// QUARANTINE, NOT REJECTION, IS THE DEFAULT. An unregistered kind or a failed
// parse becomes a `QuarantinedNode` that keeps its id, its position and its
// children, stays movable/removable/undoable, is NOT editable, poisons its
// ancestors' folds to `partial`, and re-emits its raw bytes exactly. This is
// not politeness — the alternative shipped: one refused stored clip made a
// whole document unwritable forever, and because the trash bin is rewritten
// on every delete, deleting *anything at all* became impossible. A document
// that will not load is a document the user cannot repair.
//
// Layout:
//   1. Shape parsing        — parseSerializedDocument
//   2. The content boundary — parseNodeData
//   3. Document building    — the shared pass both ingress doors run
//   4. deserializeDocument
//   5. serializeGraph
//   6. loadChildrenInto

// ---------------------------------------------------------------------------
// This file was 1,789 lines. The split follows the six numbered sections it
// already declared plus the guard tail, so the seams are the ones the module
// always had — not new ones invented for the move. Listed in dependency order:
// every module imports only from those above it, which is what keeps this
// folder acyclic.
//
//   shape          the wire's SHAPE — parsed before any consumer code runs
//   content        the content trust boundary — where node types are called
//   document       document building, the pass both ingress doors share
//   deserialize    the whole-document door
//   write          serializeGraph, the way out
//   load-children  the lazy door
//   guards         the key-hook guard wrapping the two public ingress doors
//
// The CURATED surface below is exactly what the single file exported. Anything
// absent is internal on purpose — `graph/index.ts` withholds `buildGraph` for
// the same reason, and the tests that need an internal reach for its module
// directly rather than widening this list.
// ---------------------------------------------------------------------------

export { DEFAULT_MAX_NODES, parseSerializedDocument } from "./shape";
export { parseNodeData } from "./content";
export { serializeGraph } from "./write";
export { deserializeDocument, loadChildrenInto } from "./guards";
