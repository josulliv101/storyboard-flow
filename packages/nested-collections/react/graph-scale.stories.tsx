// Graph — what a 100,000-node graph costs with a REALISTIC viewport mounted.
//
// WHY THIS SHAPE. Every scaling number this package has was measured on
// the core in node, with no React and no DOM. The open question was never "can
// React render 100,000 cards" — it never will. A list windows, and `NodeSlot` is
// keyed by id precisely so the consumer decides which ids exist. The question is
// what ONE KEYSTROKE costs when the graph is enormous and the viewport is not.
//
// So: 100,000 nodes in the store, 200 NodeSlots mounted, real headless Chromium.
//
// WHAT IS O(graph) AND WHAT IS NOT, which is what this exists to separate:
//   - the commit copies whole maps          -> O(graph), independent of mounting
//   - the subscription fan-out              -> O(mounted), by design
//   - a rollup over a subtree               -> O(that subtree), not the viewport
//   - the DOM                               -> O(mounted)
// A measurement that mounts everything cannot tell those apart. This one can.
//
// MEASURED WITH flushSync, deliberately. `dispatch` alone returns before React
// has done anything, so timing it measures the reducer and calls it "a
// keystroke". Every number below spans dispatch THROUGH the committed DOM.
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import {
  createEngine,
  defineNodeType,
  foldMonoid,
  getChildren,
  nodeCount,
  parseNodeId,
  type Issue,
  type NodeId,
  type Result,
  type SerializedDocument,
  type SerializedNode,
  type ConsumerDefinedSummaryType,
} from "..";
import { createReactBindings } from "./index";

// ---------------------------------------------------------------------------
// Fixture size. 200 folders x 499 clips + 200 folders + 1 root = 100,001.
// ---------------------------------------------------------------------------

const FOLDERS = 200;
const CLIPS_PER_FOLDER = 499;
const MOUNTED = 200;
const TOTAL = 1 + FOLDERS + FOLDERS * CLIPS_PER_FOLDER;

type Clip = Readonly<{ title: string; seconds: number }>;
const clipType = defineNodeType<Clip, Readonly<{ title?: string }>>()({
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
const folderType = defineNodeType<Folder, Readonly<{ name?: string }>>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ seconds: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const seconds = record["seconds"];
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { seconds } };
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

const folds = {
  seconds: foldMonoid<Types, Summary, number>({
    key: "seconds",
    empty: 0,
    leaf: (node) => (node.kind === "clip" ? node.data.seconds : 0),
    concat: (a, b) => a + b,
  }),
};

// `maxNodes` raised on purpose: the DEFAULT is 100,000 and this fixture is one
// node over it, which is itself worth knowing — the ceiling is reachable by a
// document a consumer might really build, not a theoretical one.
const engine = createEngine<Types, Summary, typeof folds>({
  types,
  summary,
  folds,
  maxNodes: 250_000,
  // The default table holds 8 x 16,384 = 131,072 entries. With ONE fold that
  // covers 100,000 nodes, so nothing here measures a thrashing cache — that
  // failure has its own coverage in the core. Stated so the numbers are not
  // read as "a big graph is fine" when a realistic 8-fold registry would not
  // fit at this size.
});

function buildDocument(): SerializedDocument {
  const nodes: SerializedNode[] = [];
  const folderIds: string[] = [];
  for (let f = 0; f < FOLDERS; f += 1) folderIds.push(`f${f}`);
  nodes.push({
    id: "root",
    kind: "folder",
    data: { name: "root" },
    children: folderIds,
  });
  for (let f = 0; f < FOLDERS; f += 1) {
    const clipIds: string[] = [];
    for (let c = 0; c < CLIPS_PER_FOLDER; c += 1) clipIds.push(`c${f}-${c}`);
    nodes.push({
      id: `f${f}`,
      kind: "folder",
      data: { name: `folder ${f}` },
      children: clipIds,
    });
    for (let c = 0; c < CLIPS_PER_FOLDER; c += 1) {
      nodes.push({
        id: `c${f}-${c}`,
        kind: "clip",
        data: { title: `clip ${f}-${c}`, seconds: 4 },
      });
    }
  }
  return {
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes,
  };
}

// Built once at module load. A temporal-dead-zone trap lives here if the timer
// is written before the binding it assigns — declare first, then measure.
let buildMs = 0;
const loadedDoc: SerializedDocument = (() => {
  const t0 = performance.now();
  const doc = buildDocument();
  buildMs = performance.now() - t0;
  return doc;
})();

const ui = createReactBindings(engine);

// ---------------------------------------------------------------------------
// Render counting — the thing #573 asks for, and the reason this file mounts
// real components rather than timing the store alone.
// ---------------------------------------------------------------------------

const renders = new Map<NodeId, number>();
function countRender(id: NodeId): void {
  renders.set(id, (renders.get(id) ?? 0) + 1);
}
function rendersOver(ids: readonly NodeId[]): number {
  let total = 0;
  for (const id of ids) total += renders.get(id) ?? 0;
  return total;
}

ui.defineNodeView("clip", function ClipView({ id, data }) {
  countRender(id);
  return (
    <div data-testid={`node-${id}`}>
      <span data-testid={`title-${id}`}>{data.title}</span>
      <span> · {data.seconds}s</span>
    </div>
  );
});

ui.defineNodeView("folder", function FolderView({ id, data }) {
  countRender(id);
  return <div data-testid={`node-${id}`}>{data.name}</div>;
});

export default {
  title: "Graph/Scale",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

type Story = StoryObj;

function Harness() {
  const store = ui.useStore();
  const dispatch = ui.useDispatch();
  const [windowStart, setWindowStart] = useState(0);
  const [lines, setLines] = useState<readonly string[]>([]);
  const doneRef = useRef(false);

  const mounted: NodeId[] = [];
  for (let i = 0; i < MOUNTED; i += 1) {
    mounted.push(parseNodeId(`c0-${windowStart + i}`));
  }

  const run = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const out: string[] = [];

    // BEST-OF-N, NOT ONE SAMPLE. The first pass of this harness reported the
    // mounted edit as CHEAPER than the offscreen one, which is backwards — the
    // mounted edit does strictly more work. That was JIT warmup on the first
    // measurement, read as signal. Every number below is the best of N, with
    // the median beside it so a single lucky run cannot be mistaken for a
    // steady state.
    const REPS = 10;
    const stat = (label: string, samples: number[], extra = "") => {
      const sorted = [...samples].sort((a, b) => a - b);
      const best = sorted[0] ?? 0;
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      out.push(`${label}=${best.toFixed(1)}/${median.toFixed(1)}ms${extra}`);
    };

    const windowIds: NodeId[] = [];
    for (let i = 0; i < MOUNTED; i += 1) windowIds.push(parseNodeId(`c0-${i}`));

    const editOnce = (target: string, title: string): number => {
      const t0 = performance.now();
      flushSync(() => {
        dispatch({
          type: "edit-nodes",
          edits: [
            { nodeId: parseNodeId(target), kind: "clip", edit: { title } },
          ],
        });
      });
      return performance.now() - t0;
    };

    // THE GENUINELY COLD ROLLUP, measured FIRST and exactly once, because it is
    // only cold once per store. Everything after this has a populated table.
    {
      const t0 = performance.now();
      const folded = store.aggregate("seconds", parseNodeId("root"));
      out.push(
        `rollupFirstEver=${(performance.now() - t0).toFixed(1)}ms value=${String(folded?.value)}`,
      );
    }

    // WARM-UP, discarded. Two of each, so the measured passes are all steady.
    editOnce("c0-0", "warm-a");
    editOnce("c199-400", "warm-b");

    // 1. ONE KEYSTROKE ON A MOUNTED NODE — dispatch through committed DOM.
    let before = rendersOver(windowIds);
    const mountedEdits: number[] = [];
    for (let i = 0; i < REPS; i += 1) mountedEdits.push(editOnce("c0-0", `m${i}`));
    stat("editMounted", mountedEdits, ` renders=${rendersOver(windowIds) - before}/${REPS}`);

    // 2. ONE KEYSTROKE ON AN UNMOUNTED NODE, 99,000 nodes away. Same commit
    //    size; the render work should be ZERO.
    before = rendersOver(windowIds);
    const offEdits: number[] = [];
    for (let i = 0; i < REPS; i += 1) offEdits.push(editOnce("c199-400", `o${i}`));
    stat("editOffscreen", offEdits, ` renders=${rendersOver(windowIds) - before}/${REPS}`);

    // 3. INSERT then DELETE, paired so the graph size returns to where it was
    //    and the two are measured against the same document.
    const inserts: number[] = [];
    const deletes: number[] = [];
    for (let i = 0; i < REPS; i += 1) {
      let t0 = performance.now();
      flushSync(() => {
        dispatch({
          type: "insert-nodes",
          toParentId: parseNodeId("f0"),
          toIndex: 0,
          seeds: [{ kind: "clip", data: { title: `ins${i}`, seconds: 4 } }],
        });
      });
      inserts.push(performance.now() - t0);
      const first = getChildren(store.getGraph(), parseNodeId("f0"))[0];
      if (first === undefined) continue;
      t0 = performance.now();
      flushSync(() => {
        dispatch({ type: "remove-nodes", nodeIds: [first] });
      });
      deletes.push(performance.now() - t0);
    }
    stat("insert", inserts);
    stat("delete", deletes);

    // 4. ROOT ROLLUP AFTER ONE EDIT — the realistic steady-state case, and NOT
    //    a cold fold however it looked at first. Editing one clip bumps only
    //    its own ancestor chain, so 199 of the 200 folder entries stay valid
    //    and the root re-fold walks one folder plus 200 cached children. The
    //    first draft of this harness called that "rollupCold" and reported
    //    0.5ms as the cost of folding 100,000 nodes. It is the cost of the memo
    //    table WORKING; the real cold number is `rollupFirstEver` above.
    const colds: number[] = [];
    let value: unknown = null;
    for (let i = 0; i < 5; i += 1) {
      editOnce("c199-400", `r${i}`);
      const t0 = performance.now();
      const folded = store.aggregate("seconds", parseNodeId("root"));
      colds.push(performance.now() - t0);
      value = folded?.value;
    }
    stat("rollupAfterEdit", colds, ` value=${String(value)}`);
    const warms: number[] = [];
    for (let i = 0; i < REPS; i += 1) {
      const t0 = performance.now();
      store.aggregate("seconds", parseNodeId("root"));
      warms.push(performance.now() - t0);
    }
    stat("rollupWarm", warms);

    // 5. SCROLL — swap the mounted window to 200 different ids, repeatedly.
    const scrolls: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const t0 = performance.now();
      // EVERY iteration must actually move the window. The first draft
      // alternated between two values, so half the passes set the state to what
      // it already held, React bailed out, and best-of-N faithfully reported
      // the cost of doing nothing.
      flushSync(() => {
        setWindowStart(200 + i * 200);
      });
      scrolls.push(performance.now() - t0);
    }
    stat("scroll", scrolls);

    out.push(`nodes=${nodeCount(store.getGraph())}`);
    out.push(`mounted=${MOUNTED}`);
    out.push(`buildMs=${buildMs.toFixed(0)}`);
    setLines(out);
  }, [dispatch, store]);

  return (
    <div>
      <button data-testid="run" onClick={run}>
        run
      </button>
      <pre data-testid="results">{lines.join("\n")}</pre>
      <div>
        {mounted.map((id) => (
          <ui.NodeSlot key={id} id={id} />
        ))}
      </div>
    </div>
  );
}

export const Scale: Story = {
  render: () => {
    const t0 = performance.now();
    const loaded = engine.deserialize(loadedDoc);
    const ms = performance.now() - t0;
    if (!loaded.ok) throw new Error(`fixture failed: ${loaded.error.message}`);
    const store = engine.createStore(loaded.value.graph);
    return (
      <div>
        <pre data-testid="load">{`deserializeMs=${ms.toFixed(0)} nodes=${nodeCount(loaded.value.graph)} expected=${TOTAL}`}</pre>
        <ui.Provider store={store}>
          <Harness />
        </ui.Provider>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("run"));
    const load = canvas.getByTestId("load").textContent ?? "";
    const results = canvas.getByTestId("results").textContent ?? "";

    // ASSERTS RENDER COUNTS, NEVER MILLISECONDS. The timings are the point of
    // the exercise and they render into the page for a human to read, but a
    // gate that fails at 12ms passes on the author's laptop, fails on a loaded
    // CI box, and earns a `.skip` inside a month. What is machine-independent
    // is HOW MANY COMPONENTS RENDERED, and that is the guarantee this package
    // exists to make.
    //
    // MEASURED here, best/median, 100,001 nodes with 200 cards mounted:
    //   deserialize 110ms  ·  first-ever root rollup 101ms
    //   edit, mounted     10.5/11.7ms      insert  19.3/21.1ms
    //   edit, offscreen    9.6/10.1ms      delete  15.3/15.6ms
    //   rollup after an edit  0.4/0.5ms    scroll (200 swapped) 5.2/6.2ms
    //
    // Nearly all of a keystroke is the commit's whole-Map copies — see #580.
    // The offscreen edit renders NOTHING and still costs 9.6ms, which is what
    // separates the engine's cost from React's: React is the other ~1ms.
    expect(load).toContain("nodes=100001");
    expect(load).toContain("expected=100001");

    // THE GUARANTEE, BOTH DIRECTIONS. Ten edits to a MOUNTED node must render
    // ten times — one apiece, not two, and not two hundred. Ten edits to a node
    // 99,000 away must render ZERO. Asserting only the second passes trivially
    // if nothing renders at all, which is why both are here.
    expect(results).toContain("editMounted");
    expect(results).toContain("renders=10/10");
    expect(results).toContain("editOffscreen");
    expect(results).toContain("renders=0/10");

    // Every clip folded: 200 x 499 x 4s = 399,200.
    expect(results).toContain("value=399200");
  },
};
