// Graph — part of the former single-file `types.ts`; see ./index.ts.

import { quoteFromWire } from "./describe";

// ---------------------------------------------------------------------------
// 1. Primitives
// ---------------------------------------------------------------------------

declare const nodeIdBrand: unique symbol;

/**
 * Branded node id — a plain string at runtime, nominal at compile time.
 *
 * Engine-minted ONLY on the mutation paths: `insert-nodes` seeds carry values,
 * never ids, so a consumer cannot collide with a node it never saw. Ingress
 * paths (`deserialize`, `loadChildren`) adopt the ids on the wire.
 *
 * The brand is GLOBAL, not per-engine, so an id minted by engine A typechecks
 * against engine B. That residual hazard is covered at runtime by the
 * `engineId` check on every mutating call — reads stay unchecked because they
 * are the hot path. Documented, not fixed.
 */
export type NodeId = string & { readonly [nodeIdBrand]: true };

export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

/** One validation complaint. `path` is JSON-pointer-ish (`"$.durationSeconds"`). */
export type Issue = Readonly<{ path: string; message: string }>;

/**
 * Parse-or-throw for authoring-time-trusted ids — story fixtures, unit tests,
 * literals in consumer code that already holds the node. NEVER call this on
 * wire data; `tryParseNodeId` is the ingress door and it does not throw.
 *
 * The only rule is non-empty/non-whitespace: an id may contain ANY other
 * character. The predecessor engine string-sniffed a `"dup:"` prefix off ids
 * documented to permit anything, and shipped a bug where `scene/a` and
 * `timeline-e2e,comma` were misclassified and silently never loaded. Keel
 * carries no meaning in the id text at all — ownership is a node state
 * (`ChildrenState`), not a substring.
 */
export function parseNodeId(id: string): NodeId {
  const parsed = tryParseNodeId(id);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

/**
 * The non-throwing form. Every ingress path uses this one.
 *
 * QUOTED THROUGH `quoteFromWire`, which clamps before it quotes. This message is
 * not built at a refusal site — it is RELAYED verbatim by three of them in
 * ./serialize — so those three inherited an unbounded quote however carefully
 * they were written, and the fourth round's sweep could not see it, because
 * there is no `JSON.stringify` at the sites it audited.
 *
 * The string that reaches here both refused AND enormous is whitespace: a
 * 1,000,000-space id is legal JSON, fails the `trim()` test, and produced a
 * 1,000,063-character `error.message`. MEASURED, and reachable at any
 * `maxNodeIdLength` — the ceiling refuses over-long ids first where it is set,
 * but `null` is supported, and this door is also `parseNodeId`'s, whose THROW
 * carried the same string.
 */
export function tryParseNodeId(id: string): Result<NodeId, Issue> {
  if (typeof id !== "string" || id.trim() === "") {
    return {
      ok: false,
      error: {
        path: "$.id",
        message:
          `Invalid NodeId: ${quoteFromWire(String(id))} ` +
          `(must be a non-empty, non-whitespace string)`,
      },
    };
  }
  return { ok: true, value: id as NodeId };
}
