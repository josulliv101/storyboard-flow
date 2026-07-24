import { describe, expect, it } from "vitest";

import {
  buildGraph,
  createCollectionsStore,
  getChildren,
  parseNodeId,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import type { GraphDetailsStore } from "@/lib/graph-details-store";
import type { GraphViewStateDetail } from "@/lib/graph-view-events";

import { createGraphTools } from "./tools";

/** project ─ a, b, scene-a[ c1 ] */
function graph(): CollectionsGraph {
  const built = buildGraph([
    {
      kind: "collection",
      id: "project",
      name: "Project",
      children: [
        { kind: "media", id: "a", name: "a" },
        { kind: "media", id: "b", name: "b" },
        { kind: "collection", id: "scene-a", name: "Scene A", children: [{ kind: "media", id: "c1", name: "c1" }] },
      ],
    },
  ]);
  if (!built.ok) throw new Error(`fixture invalid: ${JSON.stringify(built.error)}`);
  return built.value;
}

// The tools only read `details.get`; a no-op store is enough for these paths.
const fakeDetails = {
  read: () => ({}),
  get: () => undefined,
  merge: () => {},
  prune: () => {},
  subscribe: () => () => {},
} as unknown as GraphDetailsStore;

/** Records navigation/preview/playback calls the view tools make, and
 *  simulates preview + playback so the tools' deterministic logic is testable. */
function viewSpies() {
  const opened: string[] = [];
  const toggles: string[] = [];
  let view: GraphViewStateDetail = {
    surface: "grid",
    rulerOn: false,
    childrenShown: false,
    previewOn: false,
  };
  let playback = { time: 0, isPlaying: false };
  return {
    opened,
    toggles,
    getPreview: () => view.previewOn,
    getPlayback: () => playback,
    hooks: {
      openTimeline: (id: NodeId) => {
        opened.push(String(id));
      },
      getViewState: () => view,
      togglePreview: () => {
        toggles.push("toggle");
        view = { ...view, previewOn: !view.previewOn };
      },
      seek: (seconds: number) => {
        playback = { ...playback, time: Math.max(0, seconds) };
      },
      setPlaying: (playing: boolean) => {
        playback = { ...playback, isPlaying: playing };
      },
      getPlayback: () => playback,
    },
  };
}

function harness(focusedId = "project") {
  const store = createCollectionsStore(graph());
  const spies = viewSpies();
  const defs = createGraphTools({
    store,
    details: fakeDetails,
    projectId: "project",
    focusedId,
    trashId: null,
    ...spies.hooks,
  });
  const tool = (name: string) => {
    const found = defs.find((d) => d.name === name);
    if (!found) throw new Error(`missing tool ${name}`);
    return found;
  };
  const order = (parent: string) =>
    getChildren(store.getSnapshot().graph, parseNodeId(parent)).map(String);
  const selected = () => [...store.getSnapshot().interaction.selectedIds].map(String);
  return {
    store,
    order,
    selected,
    opened: spies.opened,
    toggles: spies.toggles,
    getPreview: spies.getPreview,
    getPlayback: spies.getPlayback,
    read: tool("read_timeline"),
    move: tool("move_clip"),
    getViewStateTool: tool("get_view_state"),
    select: tool("select_items"),
    clearSelection: tool("clear_selection"),
    focus: tool("focus"),
    goUp: tool("go_up"),
    setPreview: tool("set_preview"),
    play: tool("play"),
    pause: tool("pause"),
    seek: tool("seek"),
  };
}

describe("read_timeline tool", () => {
  it("returns the focused timeline as a structured tree", async () => {
    const { read } = harness();
    const res = await read.execute({});
    expect(res.isError).toBeFalsy();
    const tree = res.structuredContent as { timeline: { id: string }; nodes: { id: string }[] };
    expect(tree.timeline.id).toBe("project");
    expect(tree.nodes.map((n) => n.id)).toEqual(["a", "b", "scene-a"]);
  });

  it("errors on an unknown id", async () => {
    const { read } = harness();
    expect((await read.execute({ collectionId: "nope" })).isError).toBe(true);
  });
});

describe("move_clip tool", () => {
  it("reorders within the parent and actually mutates the store", async () => {
    const { move, order } = harness();
    const res = await move.execute({ nodeId: "a", after: "b" });
    expect(res.isError).toBeFalsy();
    expect(order("project")).toEqual(["b", "a", "scene-a"]);
  });

  it("moves into another collection, updating both parents", async () => {
    const { move, order } = harness();
    const res = await move.execute({ nodeId: "a", into: "scene-a", position: "end" });
    expect(res.isError).toBeFalsy();
    expect(order("scene-a")).toEqual(["c1", "a"]);
    expect(order("project")).toEqual(["b", "scene-a"]);
  });

  it("surfaces the reducer rejection when the target is a clip", async () => {
    const { move } = harness();
    expect((await move.execute({ nodeId: "a", into: "b" })).isError).toBe(true);
  });
});

/** project ─ img (image 4s), vid (video full 10, trim 1/1) ; trash (empty root) */
function mediaGraph(): CollectionsGraph {
  const built = buildGraph([
    {
      kind: "collection",
      id: "project",
      name: "Project",
      children: [
        { kind: "media", id: "img", name: "img", durationSeconds: 4 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "vid",
          fullDurationSeconds: 10,
          trimInSeconds: 1,
          trimOutSeconds: 1,
        },
      ],
    },
    { kind: "collection", id: "trash", name: "Trash", children: [] },
  ]);
  if (!built.ok) throw new Error(`fixture invalid: ${JSON.stringify(built.error)}`);
  return built.value;
}

function mediaHarness(trashId: string | null = "trash") {
  const store = createCollectionsStore(mediaGraph());
  const defs = createGraphTools({
    store,
    details: fakeDetails,
    projectId: "project",
    focusedId: "project",
    trashId,
    ...viewSpies().hooks,
  });
  const tool = (name: string) => {
    const found = defs.find((d) => d.name === name);
    if (!found) throw new Error(`missing tool ${name}`);
    return found;
  };
  const node = (id: string) => store.getSnapshot().graph.nodesById.get(parseNodeId(id));
  const order = (parent: string) =>
    getChildren(store.getSnapshot().graph, parseNodeId(parent)).map(String);
  return {
    store,
    node,
    order,
    trim: tool("trim_clip"),
    rename: tool("rename_item"),
    remove: tool("remove_clip"),
  };
}

describe("trim_clip tool", () => {
  it("re-trims a video and mutates the node", async () => {
    const { trim, node } = mediaHarness();
    const res = await trim.execute({ nodeId: "vid", trimInSeconds: 2, trimOutSeconds: 3 });
    expect(res.isError).toBeFalsy();
    expect(node("vid")).toMatchObject({ trimInSeconds: 2, trimOutSeconds: 3 });
    expect(res.structuredContent).toMatchObject({ effectiveDurationSeconds: 5 });
  });

  it("sets an image duration", async () => {
    const { trim, node } = mediaHarness();
    const res = await trim.execute({ nodeId: "img", durationSeconds: 8 });
    expect(res.isError).toBeFalsy();
    expect(node("img")).toMatchObject({ durationSeconds: 8 });
  });

  it("rejects a trim that exceeds the source length", async () => {
    const { trim } = mediaHarness();
    expect((await trim.execute({ nodeId: "vid", trimInSeconds: 6, trimOutSeconds: 6 })).isError).toBe(true);
  });

  it("rejects the wrong field for the media kind", async () => {
    const { trim } = mediaHarness();
    expect((await trim.execute({ nodeId: "vid", durationSeconds: 3 })).isError).toBe(true);
    expect((await trim.execute({ nodeId: "img", trimInSeconds: 1 })).isError).toBe(true);
  });
});

describe("rename_item tool", () => {
  it("renames a clip and trims whitespace", async () => {
    const { rename, node } = mediaHarness();
    const res = await rename.execute({ nodeId: "img", name: "  Hero shot  " });
    expect(res.isError).toBeFalsy();
    expect(node("img")).toMatchObject({ name: "Hero shot" });
  });

  it("rejects a blank name", async () => {
    const { rename } = mediaHarness();
    expect((await rename.execute({ nodeId: "img", name: "   " })).isError).toBe(true);
  });
});

describe("remove_clip tool", () => {
  it("moves a clip into the trash root", async () => {
    const { remove, order } = mediaHarness();
    const res = await remove.execute({ nodeId: "img" });
    expect(res.isError).toBeFalsy();
    expect(order("project")).toEqual(["vid"]);
    expect(order("trash")).toEqual(["img"]);
  });

  it("errors when the trash isn't loaded", async () => {
    const { remove } = mediaHarness(null);
    expect((await remove.execute({ nodeId: "img" })).isError).toBe(true);
  });
});

describe("select_items / clear_selection tools", () => {
  it("selects known ids and skips unknown ones", async () => {
    const h = harness();
    const res = await h.select.execute({ nodeIds: ["a", "scene-a", "ghost"] });
    expect(res.isError).toBeFalsy();
    expect(h.selected().sort()).toEqual(["a", "scene-a"]);
  });

  it("errors when no id is known", async () => {
    const h = harness();
    expect((await h.select.execute({ nodeIds: ["ghost"] })).isError).toBe(true);
  });

  it("clears the selection", async () => {
    const h = harness();
    await h.select.execute({ nodeIds: ["a", "b"] });
    await h.clearSelection.execute({});
    expect(h.selected()).toEqual([]);
  });
});

describe("get_view_state tool", () => {
  it("reports focus, selection, and preview", async () => {
    const h = harness();
    await h.select.execute({ nodeIds: ["a"] });
    const res = await h.getViewStateTool.execute({});
    expect(res.structuredContent).toMatchObject({
      focusedId: "project",
      isRoot: true,
      selectedIds: ["a"],
      previewOn: false,
    });
  });
});

describe("focus / go_up tools", () => {
  it("focus opens a collection by id", async () => {
    const h = harness();
    expect((await h.focus.execute({ nodeId: "scene-a" })).isError).toBeFalsy();
    expect(h.opened).toEqual(["scene-a"]);
  });

  it("focus with no id opens the project root", async () => {
    const h = harness("scene-a");
    await h.focus.execute({});
    expect(h.opened).toEqual(["project"]);
  });

  it("focus on the already-focused node is a no-op", async () => {
    const h = harness();
    const res = await h.focus.execute({ nodeId: "project" });
    expect((res.structuredContent as { changed: boolean }).changed).toBe(false);
    expect(h.opened).toEqual([]);
  });

  it("focus rejects a clip", async () => {
    const h = harness();
    expect((await h.focus.execute({ nodeId: "a" })).isError).toBe(true);
  });

  it("go_up focuses the parent", async () => {
    const h = harness("scene-a");
    await h.goUp.execute({});
    expect(h.opened).toEqual(["project"]);
  });

  it("go_up at the root is a no-op", async () => {
    const h = harness();
    const res = await h.goUp.execute({});
    expect((res.structuredContent as { changed: boolean }).changed).toBe(false);
    expect(h.opened).toEqual([]);
  });
});

describe("set_preview tool", () => {
  it("toggles only when the requested state differs", async () => {
    const h = harness();
    const on = await h.setPreview.execute({ on: true });
    expect((on.structuredContent as { changed: boolean }).changed).toBe(true);
    expect(h.getPreview()).toBe(true);
    expect(h.toggles.length).toBe(1);

    const again = await h.setPreview.execute({ on: true });
    expect((again.structuredContent as { changed: boolean }).changed).toBe(false);
    expect(h.toggles.length).toBe(1);
  });
});

describe("play / pause / seek tools", () => {
  it("play turns preview on (when off) and starts playback", async () => {
    const h = harness();
    const res = await h.play.execute({});
    expect(res.isError).toBeFalsy();
    expect(h.getPreview()).toBe(true);
    expect(h.getPlayback().isPlaying).toBe(true);
    expect((res.structuredContent as { openedPreview: boolean }).openedPreview).toBe(true);
  });

  it("play does not re-open the preview when it's already on", async () => {
    const h = harness();
    await h.setPreview.execute({ on: true });
    const res = await h.play.execute({});
    expect((res.structuredContent as { openedPreview: boolean }).openedPreview).toBe(false);
    expect(h.getPlayback().isPlaying).toBe(true);
  });

  it("pause stops playback", async () => {
    const h = harness();
    await h.play.execute({});
    const res = await h.pause.execute({});
    expect(h.getPlayback().isPlaying).toBe(false);
    expect((res.structuredContent as { changed: boolean }).changed).toBe(true);
  });

  it("seek moves the playhead and clamps negatives to 0", async () => {
    const h = harness();
    await h.seek.execute({ seconds: 12.5 });
    expect(h.getPlayback().time).toBe(12.5);
    await h.seek.execute({ seconds: -4 });
    expect(h.getPlayback().time).toBe(0);
  });

  it("get_view_state reports playback", async () => {
    const h = harness();
    await h.seek.execute({ seconds: 3 });
    await h.play.execute({});
    const res = await h.getViewStateTool.execute({});
    expect(res.structuredContent).toMatchObject({
      isPlaying: true,
      currentTimeSeconds: 3,
      previewOn: true,
    });
  });
});
