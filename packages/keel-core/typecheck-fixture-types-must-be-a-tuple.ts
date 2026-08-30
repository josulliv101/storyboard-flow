// COMPILE-ONLY FIXTURE. No runtime role, not exported from the package barrel,
// not imported by anything. `npx tsc --noEmit -p tsconfig.json` IS its
// assertion: each `@ts-expect-error` below FAILS THE BUILD if the error it
// names stops happening.
//
// WHAT IT DEFENDS, and why it cannot be a normal test.
//
// `Ts` is the compile-time half of the kind-to-`Data` correspondence. The TUPLE
// is what remembers that `"clip"` means `Data = Clip`; a plain array has no
// per-position types, so every mapped type built on `Ts` — `EditOf`,
// `DataForKind`, `KindOf`, `Seed` — collapses from a discriminated union into a
// cross-product. At that point a folder's edit under `kind: "clip"` typechecks,
// and so does every other wrong-kind payload.
//
// Nothing fails at runtime when that happens. The engine works; it has simply
// stopped checking, and the next wrong-kind edit is caught by `applyEdit`
// throwing on a field that is not there, in the consumer, months later. A
// vitest assertion cannot see any of this — the collapse is entirely in the
// types, which is why the assertion has to be the compiler.
//
// MEASURED before `RequireTupleTypes` existed, the same wrong-kind edit through
// `store.dispatch`:
//
//   types: [clipType, folderType] as const   ->  error, correctly
//   types: [clipType, folderType]            ->  COMPILED CLEAN
//
// `createEngine`'s `const Ts` already rescues an INLINE literal, so the hole was
// never the documented example — it was the named variable declared without
// `as const`, which is how anyone with more than two node types writes it.

import { createEngine } from "./engine";
import {
  defineNodeType,
  parseNodeId,
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
} from "./types";

// ---------------------------------------------------------------------------
// Two kinds with genuinely different `Data` AND `Edit`
// ---------------------------------------------------------------------------
//
// Two is the minimum that can tell a real discriminated union apart from a
// widened one: with a single kind, the cross-product and the union are the same
// type and the fixture would pass in both worlds.

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const seconds = record["seconds"];
    if (typeof title !== "string" || typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$", message: "shape" }] };
    }
    return { ok: true, value: { title, seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
});

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const name = ({ ...raw } as Record<string, unknown>)["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, name: edit.name ?? data.name } };
  },
});

type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const n = ({ ...raw } as Record<string, unknown>)["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

const nodeId = parseNodeId("x");

// ---------------------------------------------------------------------------
// 1. A TUPLE keeps every per-kind type alive
// ---------------------------------------------------------------------------

const tupleTypes = [clipType, folderType] as const;

const tupleEngine = createEngine<typeof tupleTypes, Summary, {}>({
  types: tupleTypes,
  summary,
  folds: {},
});

declare const tupleStore: ReturnType<typeof tupleEngine.createStore>;

// The RIGHT edit for the kind compiles, which is half the assertion — a fixture
// that only proved things fail would also pass against a type that rejects
// everything.
tupleStore.dispatch({
  type: "edit-nodes",
  edits: [{ nodeId, kind: "clip", edit: { title: "ok" } }],
});

tupleStore.dispatch({
  type: "edit-nodes",
  edits: [{ nodeId, kind: "folder", edit: { name: "ok" } }],
});

tupleStore.dispatch({
  type: "edit-nodes",
  edits: [
    // @ts-expect-error — `name` is the FOLDER's edit; under `kind: "clip"` it
    // must not typecheck. This is the property the whole tuple constraint
    // exists to keep, and the one that silently died on a plain array.
    { nodeId, kind: "clip", edit: { name: "wrong kind" } },
  ],
});

tupleStore.dispatch({
  type: "insert-nodes",
  toParentId: nodeId,
  toIndex: 0,
  // @ts-expect-error — a clip's `Data` under `kind: "folder"`. Seeds carry the
  // same correspondence as edits and lose it the same way.
  seeds: [{ kind: "folder", data: { title: "wrong", seconds: 1 } }],
});

// ---------------------------------------------------------------------------
// 2. A plain ARRAY is refused at the door, by name
// ---------------------------------------------------------------------------

const arrayTypes = [clipType, folderType];

createEngine<typeof arrayTypes, Summary, {}>({
  // @ts-expect-error — `RequireTupleTypes` resolves to a string whose text IS
  // the fix, so the consumer reads "must be a TUPLE, not an array — add `as
  // const`" in the error rather than getting an engine that has quietly stopped
  // checking. Before the guard, this line compiled clean.
  types: arrayTypes,
  summary,
  folds: {},
});

// ---------------------------------------------------------------------------
// 3. The inline literal was never broken, and must stay unbroken
// ---------------------------------------------------------------------------
//
// `const Ts` infers a tuple from a literal at the call site, so this form always
// worked — which is exactly why the defect survived review: the documented
// example is the one case that was fine.

const inlineEngine = createEngine({
  types: [clipType, folderType],
  summary,
  folds: {},
});

declare const inlineStore: ReturnType<typeof inlineEngine.createStore>;

inlineStore.dispatch({
  type: "edit-nodes",
  edits: [
    // @ts-expect-error — still a wrong-kind edit, still refused, with no
    // `as const` anywhere in sight.
    { nodeId, kind: "clip", edit: { name: "wrong kind" } },
  ],
});
