// Graph — every shared type in the engine core.
//
// PURE. No React, no DOM, no "use client", no dependencies. This module is
// imported by every other module in this package AND by its `./react` entry, so
// anything that lands here ships to a Node route handler as readily as to a
// browser bundle. That split is not stylistic: a `"use client"` module whose
// exports a route handler imports typechecks clean and 500s at request time,
// which is this repo's most expensive bug class.
//
// Layout:
//   1. Primitives      — NodeId, Result, Issue
//   2. Node types      — the per-kind registry and its factory
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
// This file was 2,219 lines — the largest in the package, and the only one
// with NO imports of its own: it is the leaf everything else stands on. The
// split follows the numbered sections it already declared.
//
// THREE OF THESE ARE NOT TYPES, which is half the reason for the move:
// `constructors` (the only four places a cast is permitted), `describe` and
// `dev-checks` are runtime code that had been living in a file called
// `types.ts`.
//
// `export *`, UNLIKE every other barrel in this package. The others curate
// because they have internals worth withholding; this one has none — all 77
// exports were the point of the file, and `./index.ts` one level up is where
// the package's public surface is actually chosen. Listing 77 names here would
// add a place to forget one, not a boundary.
//
// Type-only cycles between these modules are expected and harmless — `Graph`
// and `GraphNode` reference each other, and `import type` is erased before
// anything runs. A VALUE cycle would not be; the four runtime modules are
// checked separately for that.
// ---------------------------------------------------------------------------

export * from "./primitives";
export * from "./node-types";
export * from "./graph";
export * from "./commands";
export * from "./patches";
export * from "./rejections";
export * from "./wire";
export * from "./folds";
export * from "./history";
export * from "./engine";
export * from "./constructors";
export * from "./describe";
export * from "./dev-checks";
