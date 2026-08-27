"use client";

// KEEL React — the public surface.
//
// CURATED, not `export *`, for the same reason keel-core's barrel is: an
// `export *` makes every internal helper part of the contract the moment someone
// imports it, and this repo has already paid for that once — a barrel's
// re-exports made four dead modules look reachable, and grep cannot tell a
// barrel from a consumer.
//
// The surface is deliberately ONE FUNCTION plus the types needed to annotate
// what it returns. There are no pre-made components and no standalone hooks
// here, and that is a consequence rather than an omission: `createContext`
// cannot be generic, so every hook has to be created inside a call where the
// engine's type parameters are bound. See ./src/bindings.tsx.
//
// `"use client"` sits on this module and on ./src/bindings.tsx. keel-core
// carries it NOWHERE — a route handler must be able to call
// `engine.deserialize` without dragging a client module into a server bundle,
// which typechecks clean and 500s at request time.

export { createReactBindings } from "./src/bindings";

export type {
  DispatchFn,
  HistoryControls,
  NodeView,
  NodeViewProps,
  ProviderProps,
  QuarantinedView,
  QuarantinedViewProps,
  ReactBindings,
} from "./src/types";
