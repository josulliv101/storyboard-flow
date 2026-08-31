// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { Issue, NodeId, Result } from "./primitives";
import type { EditRejection } from "./rejections";

// ---------------------------------------------------------------------------
// 2. Node types — the per-kind registry
// ---------------------------------------------------------------------------
//
// THE `ConsumerDefined` PREFIX, and where it stops.
//
// Exactly three types in this package are authored by the consumer and CALLED
// by the engine: `ConsumerDefinedNodeType`, `ConsumerDefinedSummaryType` and
// `ConsumerDefinedFold`. Each one carries the prefix, because each one is a
// place a throw has to be caught and a returned value has to be distrusted —
// and because naming only one of the three would have implied the other two
// were the engine's.
//
// The names DERIVED from them deliberately drop it, and that is a convention
// rather than an oversight: `WidenedNodeType`, `NodeTypeRegistry`,
// `defineNodeType`, `WidenedFold`, `FoldRegistry`. Each is unambiguous from
// context — there is no engine-authored node type for `NodeTypeRegistry` to be
// confused with — and spelling it out yields `defineConsumerDefinedNodeType`,
// which says "define consumer-defined" and is worse than the thing it clarifies.
//
// So: the prefix marks the TRUST BOUNDARY, once, on the three types that cross
// it. Everything downstream is graph's own.

/** Handed to `parse` so a node type can warn without failing, and can see whether
 *  the engine is about to treat this node as a container. */
export type ParseCtx = Readonly<{
  nodeId: NodeId;
  container: boolean;
  schemaVersion: number;
  warn(issue: Issue): void;
}>;

/**
 * One kind's node type — everything the engine knows about that kind: how its
 * opaque `Data` is parsed, serialized, edited, and (optionally) keyed for
 * identity.
 *
 * CONSUMER-DEFINED, and that is the load-bearing fact rather than a note about
 * authorship. Every member below is code the engine calls but did not write, so
 * each one is a place a throw has to be caught and a returned value has to be
 * distrusted — which is why `parse`, `applyEdit` and `serialize` are wrapped at
 * every door, and why `contentKey` and `sourceKey` deliberately are not (see
 * ./graph). "Consumer" here means the programmer integrating graph-core; "user" in
 * this package always means the person pressing Ctrl-Z.
 *
 * ALL MEMBERS ARE METHOD SHORTHAND, NOT ARROW PROPERTIES. This is load-bearing
 * and it is verified, not assumed: under `strictFunctionTypes` an arrow
 * property is contravariant in its parameters, so `serialize: (data: Clip) =>
 * unknown` does NOT satisfy `serialize: (data: unknown) => unknown` and
 * `ConsumerDefinedNodeType<"clip", Clip, ClipEdit>` would fail the `WidenedNodeType` constraint
 * — every real node type rejected at the `createEngine` call. Method shorthand
 * stays bivariant, including through the `Readonly<>` wrapper (I compiled both
 * forms to confirm the wrapper preserves it). That bivariance is also what
 * lets the reducer call `nodeType.applyEdit(node.data, edit.edit)` off an erased
 * `WidenedNodeType` with no cast anywhere.
 *
 * The price is honest: bivariance is unsound, so a node type that lies about its
 * own Data type is not caught here. The trust boundary is enforceable; the
 * node type's interior is not.
 */
export type ConsumerDefinedNodeType<K extends string, Data, Edit> = Readonly<{
  kind: K;
  /**
   * KIND-LEVEL and immutable — never a predicate over data. A kind that is
   * sometimes a container cannot have its children invariants checked, and
   * "does this node have children" would become a question about content.
   */
  container: boolean;
  schemaVersion: number;
  /**
   * Keyed by TARGET version, run BEFORE parse, never parse-then-migrate.
   * Applied in ascending order from the wire's version up to `schemaVersion`.
   * An arrow property is fine here only because neither parameter mentions
   * `Data`.
   */
  migrations?: Readonly<Record<number, (raw: unknown) => unknown>>;
  /**
   * Must CONSTRUCT a fresh value, never cast the input. The engine stores
   * exactly what this returns — it never reconstructs a node's data field by
   * field, which is what makes `Data` a real type parameter rather than a
   * whitelist the engine has to be taught. (The predecessor's field-by-field
   * reconstructor silently dropped every field it had not been taught.)
   */
  parse(raw: unknown, ctx: ParseCtx): Result<Data, readonly Issue[]>;
  serialize(data: Data): unknown;
  applyEdit(data: Data, edit: Edit): Result<Data, EditRejection>;
  /**
   * OPT-IN compaction, OFF by default. Undo works from whole-value
   * before/after pairs, which cannot be wrong; a wrong inverse corrupts
   * silently N undos later and is undetectable in production. Turn this on
   * when a profile demands it, not before. Dev-mode verifies it by checking
   * that `applyEdit(applyEdit(d, e).value, invertEdit(e, d))` deep-equals `d`.
   */
  invertEdit?(edit: Edit, before: Data): Edit;
  /** "Same asset" — enables the derived `placementsByContentKey` index. */
  contentKey?(data: Data): string | null;
  /**
   * "Same stored subtree" — enables the single-owner invariant. Two
   * placements of one collection are incoherent under lazy loading (the
   * shipped predecessor coped only by never loading the second one), so the
   * engine refuses a second non-`reference` placement for a `sourceKey`.
   */
  sourceKey?(data: Data): string | null;
}>;

/**
 * Any node type, with `K`, `Data` and `Edit` widened to their tops.
 *
 * WIDENED, not erased, and the distinction is load-bearing rather than
 * cosmetic: a real `ConsumerDefinedNodeType<"clip", Clip, ClipEdit>` IS
 * assignable to this, with no cast anywhere. That only works because of the
 * method-shorthand rule above — method shorthand stays bivariant, where arrow
 * properties would be contravariant in their parameters and every node type
 * would be rejected at the `createEngine` call. Contrast graph-react's
 * `ErasedNodeView`, which is genuinely an erasure: `FunctionComponent`'s call
 * signature is a function type, so `FC<{data: Clip}>` is NOT assignable to
 * `FC<{data: unknown}>` and it has to cast through `unknown`. Two different
 * operations, and now two different words.
 *
 * WHY IT EXISTS. A `Map` cannot hold a tuple's worth of distinct types, so the
 * registry stores every node type at its widest and the correspondence between
 * a kind and its `Data` survives only at compile time, in `Ts`. That gap is
 * what the four boundary constructors at the bottom of this file exist to
 * cross, and it is why they are the only sanctioned casts here.
 *
 * Named for what it IS rather than how it got here because four uses in five
 * are the constraint `Ts extends readonly WidenedNodeType[]`, where the reader
 * is asking "which types go here" and not "what happened to them".
 */
export type WidenedNodeType = ConsumerDefinedNodeType<string, unknown, unknown>;

/**
 * CURRIED, and that is the whole point. `Edit` has exactly one inference site
 * (`applyEdit`'s second parameter), so an uncurried factory lets a node type whose
 * `applyEdit` ignores its edit argument silently infer `Edit = unknown` — at
 * which point every dispatched edit for that kind typechecks and the per-kind
 * edit typing is dead. Making `Data` and `Edit` explicit closes it while `K`
 * still infers as a string literal from the object.
 *
 *   const clipType = defineNodeType<Clip, ClipEdit>()({ kind: "clip", ... });
 */
export function defineNodeType<Data, Edit = never>(): <K extends string>(
  type: ConsumerDefinedNodeType<K, Data, Edit>,
) => ConsumerDefinedNodeType<K, Data, Edit> {
  return (type) => type;
}

/**
 * The runtime registry, keyed by kind. Built once by `createEngine`; duplicate
 * kinds are rejected there (see `buildRegistry` in ./graph).
 */
export type NodeTypeRegistry = ReadonlyMap<string, WidenedNodeType>;

/** `S`'s own parse/serialize pair — the summary has its own lifecycle, separate from any kind. */
export type ConsumerDefinedSummaryType<S> = Readonly<{
  parse(raw: unknown): Result<S, readonly Issue[]>;
  serialize(summary: S): unknown;
}>;

// ---------------------------------------------------------------------------
// `Ts extends readonly WidenedNodeType[]` — the constraint every generic below
// carries, and why it is spelled this way
// ---------------------------------------------------------------------------
//
// `Ts` is the consumer's TUPLE of node types, exactly as passed to
// `createEngine({ types })`. It is the compile-time half of the two-sided
// correspondence described on `WidenedNodeType`: the tuple remembers that
// `"clip"` means `Data = Clip`, while the runtime registry has erased that.
//
// THIS USED TO READ `Ts extends readonly unknown[]`, which is not a weaker
// constraint but NO constraint — everything extends `unknown`. Two costs:
//
//   1. It read as a claim about TRUST. In value positions `unknown` is this
//      package's untrusted marker (`data: unknown`, `raw: unknown`, every
//      ingress door), so `readonly unknown[]` invited the reading "a tuple of
//      untrusted things" about the single most trusted input there is.
//   2. It let nonsense through SILENTLY. `Graph<readonly [string, number], S>`
//      and `Command<readonly ["a","b"], S>` both compiled: the mapped types
//      below filter with `Ts[I] extends ConsumerDefinedNodeType<...> ? ... :
//      never`, so a garbage element collapsed to `never` and vanished instead
//      of erroring at the instantiation site.
//
// Tightening it was verified rather than assumed — 139 sites, and every failure
// was a missing import. Not one assignability error, which is the evidence that
// the loose form was never load-bearing.
//
// The tuple satisfies this constraint at all only because of the
// method-shorthand rule on `ConsumerDefinedNodeType`: bivariance is what lets a
// concrete `ConsumerDefinedNodeType<"clip", Clip, ClipEdit>` be assignable to
// the widened element type.

/** Every kind literal in the registry: `"clip" | "folder" | ...`. */
export type KindOf<Ts extends readonly WidenedNodeType[]> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer K, infer _D, infer _E> ? K : never;
}[number];

/** The `Data` belonging to one kind — used by the React per-kind views. */
export type DataForKind<Ts extends readonly WidenedNodeType[], K extends string> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer NK, infer D, infer _E>
    ? NK extends K
      ? D
      : never
    : never;
}[number];

/** The `Edit` belonging to one kind. */
export type EditForKind<Ts extends readonly WidenedNodeType[], K extends string> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer NK, infer _D, infer E>
    ? NK extends K
      ? E
      : never
    : never;
}[number];
