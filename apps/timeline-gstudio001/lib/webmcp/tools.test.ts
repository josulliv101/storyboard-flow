import { describe, expect, it } from "vitest";

import {
  buildGraph,
  createCollectionsStore,
  getChildren,
  parseNodeId,
  type CollectionsGraph,
} from "@storyboard/ui/dnd-collections";

import type { GraphDetailsStore } from "@/lib/graph-details-store";

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

function harness(focusedId = "project") {
  const store = createCollectionsStore(graph());
  const defs = createGraphTools({ store, details: fakeDetails, focusedId });
  const tool = (name: string) => {
    const found = defs.find((d) => d.name === name);
    if (!found) throw new Error(`missing tool ${name}`);
    return found;
  };
  const order = (parent: string) =>
    getChildren(store.getSnapshot().graph, parseNodeId(parent)).map(String);
  return { store, read: tool("read_timeline"), move: tool("move_clip"), order };
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
