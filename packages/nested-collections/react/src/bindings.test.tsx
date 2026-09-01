// Runtime proof for the React bindings — the half tsc cannot check.
//
// It renders a REAL engine, a REAL store and a REAL graph through the Provider
// with react-dom/server, because every interesting failure in this package is a
// runtime one that typechecks perfectly: a getSnapshot that returns a fresh
// object every call (an infinite render loop), a NodeSlot that dispatches to the
// wrong per-kind view, a fold read off the uncached engine instead of the cached
// store, an ancestor that is never woken by a descendant edit.
//
// PICKED UP BY THE SHARED `unit` PROJECT in apps/storybook/vitest.config.ts,
// whose include list reaches `../../packages/nested-collections/**/*.test.ts`
// AND `**/*.test.tsx`. The .tsx glob is not decoration: this file lives under
// `react/` and would otherwise be collected by neither, which is how it sat
// unrun for a while. The project is node-env and already runs .tsx tests from
// packages/ui.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createEngine,
  defineNodeType,
  foldMonoid,
  parseNodeId,
  type NodeId,
} from "../..";
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
    const r = raw as Record<string, unknown>;
    const title = r["title"];
    const seconds = r["seconds"];
    if (typeof title !== "string" || typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$", message: "bad clip" }] };
    }
    return { ok: true, value: { title, seconds } };
  },
  serialize: (d) => ({ ...d }),
  applyEdit: (d, e) => ({ ok: true, value: { ...d, title: e.title } }),
});

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw) {
    const name = (raw as Record<string, unknown>)["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$", message: "bad folder" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize: (d) => ({ ...d }),
  applyEdit: (d, e) => ({ ok: true, value: { ...d, name: e.name } }),
});

type Types = readonly [typeof clipType, typeof folderType];

const secondsFold = foldMonoid<Types, Summary, number>({
  key: "seconds",
  empty: 0,
  leaf: (n) => (n.kind === "clip" ? n.data.seconds : 0),
  concat: (a, b) => a + b,
});

const folds = { seconds: secondsFold };

const engine = createEngine({
  types: [clipType, folderType] as const,
  summary: {
    parse: (raw) => ({
      ok: true,
      value: {
        seconds: Number((raw as Record<string, unknown>)["seconds"] ?? 0),
      },
    }),
    serialize: (s) => ({ ...s }),
  },
  folds,
});

const rootId = parseNodeId("root");
const clipId = parseNodeId("clip-a");

const doc = {
  formatVersion: 1 as const,
  schemaVersions: { clip: 1, folder: 1 },
  rootIds: ["root"],
  nodes: [
    { id: "root", kind: "folder", children: ["clip-a"], data: { name: "R" } },
    { id: "clip-a", kind: "clip", data: { title: "A", seconds: 4 } },
  ],
};

const ui = createReactBindings(engine);

ui.defineNodeView("clip", ({ data }) => <i>{data.title}</i>);
ui.defineNodeView("folder", ({ id, data }) => {
  const kids = ui.useChildren(id);
  const total = ui.useFold("seconds", id);
  const selected = ui.useIsSelected(id);
  return (
    <b>
      {data.name}:{total?.value}:{total?.certainty}:{String(selected)}:
      {kids.map((k) => (
        <ui.NodeSlot key={k} id={k} />
      ))}
    </b>
  );
});

function Tree({ id }: Readonly<{ id: NodeId }>) {
  const { canUndo, canRedo } = ui.useHistory();
  const rev = ui.useSubtreeRev(id);
  const roots = ui.useRoots();
  return (
    <div>
      <span>
        rev={rev} roots={roots.length} undo={String(canUndo)} redo=
        {String(canRedo)}
      </span>
      <ui.NodeSlot id={id} />
    </div>
  );
}

describe("react bindings", () => {
  it("renders a real graph through the Provider, hooks and NodeSlot", () => {
    const loaded = engine.deserialize(doc);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const first = renderToStaticMarkup(
      <ui.Provider store={store}>
        <Tree id={rootId} />
      </ui.Provider>,
    );
    expect(first).toContain("R:4:exact:false:");
    expect(first).toContain("<i>A</i>");
    expect(first).toContain("undo=false");

    // Mutate, then re-render: the fold, the history flags and the node data all
    // have to move.
    const edited = store.dispatch({
      type: "edit-nodes",
      edits: [
        {
          nodeId: clipId,
          kind: "clip",
          edit: { type: "rename", title: "RENAMED" },
        },
      ],
    });
    expect(edited.ok).toBe(true);
    store.selection.set([rootId]);

    const second = renderToStaticMarkup(
      <ui.Provider store={store}>
        <Tree id={rootId} />
      </ui.Provider>,
    );
    expect(second).toContain("<i>RENAMED</i>");
    expect(second).toContain("undo=true");
    expect(second).toContain("R:4:exact:true:");

    store.undo();
    const third = renderToStaticMarkup(
      <ui.Provider store={store}>
        <Tree id={rootId} />
      </ui.Provider>,
    );
    expect(third).toContain("<i>A</i>");
    expect(third).toContain("redo=true");
  });

  it("throws a named error outside the Provider", () => {
    expect(() => renderToStaticMarkup(<Tree id={rootId} />)).toThrow(
      /must be used inside the Provider/,
    );
  });

  it("subscribes per node and notifies on a deep change", () => {
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture");
    const store = engine.createStore(loaded.value.graph);

    let rootNotifications = 0;
    store.subscribeToNode(rootId, () => {
      rootNotifications += 1;
    });
    store.dispatch({
      type: "edit-nodes",
      edits: [
        { nodeId: clipId, kind: "clip", edit: { type: "rename", title: "Z" } },
      ],
    });
    // The ancestor is woken by a child's content change — the hole the
    // predecessor's per-parent data version left open.
    expect(rootNotifications).toBe(1);
  });
});
