// COMPILE-ONLY FIXTURE. No runtime role, not exported from the package barrel,
// not imported by anything. `npx tsc --noEmit -p tsconfig.json` IS its assertion
// — every annotated `const` below fails to compile if the property it names
// stops holding.
//
// WHY IT EXISTS, and why deleting it costs something real.
//
// The entire point of splitting keel into two packages is that
// `createReactBindings(engine)` infers its parameters from `typeof engine`, so
// the registry tuple survives to the call site instead of dying at a
// module-scope `createContext`. That property has NO error at the definition
// site when it breaks. It breaks silently, in the CONSUMER, as a `data` that is
// `unknown` inside a per-kind view or a `useFold` that returns `Folded<unknown>`
// — and by then the consumer reads it as their own mistake.
//
// It has already broken once, during this package's own bring-up. `Engine` is a
// type ALIAS, so TypeScript expands it structurally when inferring; `F` occurred
// only as `keyof F` and `F[K]` in every member, which are non-inferrable
// positions, so `F` had no inference candidate and quietly fell back to its
// constraint. `keyof F` became `string`, `FoldValue<F[K]>` became `unknown`, and
// `ui.useFold("seconds", id)` returned `Folded<unknown>` with keel-core and
// keel-react both compiling perfectly clean. The fix was a direct `Folds: F`
// occurrence on keel-core's `PhantomTypes`. This file is what would have caught
// it, and what will catch the next equivalent.
//
// The consumer here is deliberately realistic — two kinds with different `Data`
// and different `Edit`, a container kind, a summary type, and a registered fold
// — because a single-kind fixture cannot tell a real discriminated union apart
// from a widened one.

import { useState, type ReactNode } from "react";
import {
  createEngine,
  defineNodeType,
  emptyGraph,
  foldMonoid,
  type NodeId,
} from "@storyboard/keel-core";
import { createReactBindings } from "./bindings";

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ type: "rename"; title: string }>;
type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ type: "rename"; name: string }>;
type Summary = Readonly<{ seconds: number }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const seconds = record["seconds"];
    if (typeof title !== "string" || typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$", message: "bad clip" }] };
    }
    return { ok: true, value: { title, seconds } };
  },
  serialize: (data) => ({ ...data }),
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title } };
  },
});

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$", message: "bad folder" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize: (data) => ({ ...data }),
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, name: edit.name } };
  },
});

type Types = readonly [typeof clipType, typeof folderType];

/**
 * HOISTED to its own `const`, not written inline in the `createEngine` call, and
 * this matters. Inline, the object literal is contextually typed by the `F
 * extends FoldRegistry<Ts, S>` constraint, so each fold's `A` widens to
 * `unknown` before inference ever sees it. keel-core's own engine test hoists it
 * the same way.
 */
const secondsFold = foldMonoid<Types, Summary, number>({
  key: "seconds",
  empty: 0,
  leaf: (node) => (node.kind === "clip" ? node.data.seconds : 0),
  concat: (a, b) => a + b,
});

const folds = { seconds: secondsFold };

const engine = createEngine({
  types: [clipType, folderType] as const,
  summary: {
    parse(raw) {
      if (typeof raw !== "object" || raw === null) {
        return { ok: false, error: [{ path: "$", message: "bad summary" }] };
      }
      const seconds = ({ ...raw } as Record<string, unknown>)["seconds"];
      if (typeof seconds !== "number") {
        return { ok: false, error: [{ path: "$", message: "bad summary" }] };
      }
      return { ok: true, value: { seconds } };
    },
    serialize: (summary) => ({ ...summary }),
  },
  folds,
});

const ui = createReactBindings(engine);

// --- assertion 1: a per-kind view's `data` narrows to THAT kind's Data --------

ui.defineNodeView("clip", ({ id, data }) => {
  const dispatch = ui.useDispatch();
  // `data.title` / `data.seconds` do not exist on `unknown`, and the edit's
  // payload is checked against `ClipEdit` rather than against `FolderEdit`.
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({
          type: "edit-nodes",
          edits: [
            { nodeId: id, kind: "clip", edit: { type: "rename", title: "x" } },
          ],
        })
      }
    >
      {data.title} — {data.seconds.toFixed(1)}
    </button>
  );
});

// --- assertion 2: `useFold` keeps the fold's own `A` -------------------------

ui.defineNodeView("folder", ({ id, data }) => {
  const children = ui.useChildren(id);
  const total = ui.useFold("seconds", id);
  const selected = ui.useIsSelected(id);
  // `number`, not `unknown`. This is the line the silent widening broke.
  const seconds: number | undefined = total?.value;
  return (
    <section data-selected={selected}>
      <h2>
        {data.name} ({seconds ?? "?"}s, {total?.certainty})
      </h2>
      {children.map((childId) => (
        <ui.NodeSlot key={childId} id={childId} />
      ))}
    </section>
  );
});

ui.defineQuarantinedView(({ node }) => <pre>{node.reason}</pre>);

// --- assertion 3: `useAggregate` is the same function under the spec's name --

declare const someId: NodeId;

export function FoldAliasProbe(): ReactNode {
  const viaAlias: number | undefined = ui.useAggregate("seconds", someId)?.value;
  return <span>{viaAlias}</span>;
}

// --- assertion 4: `AnyNode` still discriminates ------------------------------
//
// Three arms, `quarantined` first. If `Ts` had widened, `node.kind` on the last
// arm would be `string` rather than `"clip" | "folder"` and `node.children`
// would not carry the four-state discriminant.

export function Roots(): ReactNode {
  const roots = ui.useRoots();
  const node = ui.useNode(roots[0] ?? someId);
  const label: string =
    node === undefined
      ? "gone"
      : node.quarantined
        ? node.reason
        : node.container
          ? node.children.status
          : node.kind;
  return (
    <>
      <span>{label}</span>
      {roots.map((id) => (
        <ui.NodeSlot key={id} id={id} />
      ))}
    </>
  );
}

// --- assertion 5: history and the Provider wire up --------------------------

function Toolbar(): ReactNode {
  const { canUndo, canRedo, undo, redo } = ui.useHistory();
  return (
    <div>
      <button type="button" disabled={!canUndo} onClick={() => undo()}>
        undo
      </button>
      <button type="button" disabled={!canRedo} onClick={() => redo()}>
        redo
      </button>
    </div>
  );
}

export function App(): ReactNode {
  // The store is created ONCE, in lazy initial state — a store rebuilt on every
  // render would drop every subscription and every fold cache entry each time.
  const [store] = useState(() =>
    engine.createStore(emptyGraph(engine.engineId)),
  );
  return (
    <ui.Provider store={store}>
      <Toolbar />
      <Roots />
    </ui.Provider>
  );
}
