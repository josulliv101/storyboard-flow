import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId, type CollectionsGraph } from "@storyboard/ui/dnd-collections";

import { buildTimelineTree } from "./timeline-tree";

/** project ─ img1 (image 3s), vid1 (video full 10, trim 1/2 → 7s), scene-a[ c1, c2 ] */
function fixture(): CollectionsGraph {
  const built = buildGraph([
    {
      kind: "collection",
      id: "project",
      name: "Project",
      children: [
        { kind: "media", id: "img1", name: "img1", durationSeconds: 3 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid1",
          name: "vid1",
          fullDurationSeconds: 10,
          trimInSeconds: 1,
          trimOutSeconds: 2,
        },
        {
          kind: "collection",
          id: "scene-a",
          name: "Scene A",
          children: [
            { kind: "media", id: "c1", name: "c1" },
            { kind: "media", id: "c2", name: "c2" },
          ],
        },
      ],
    },
  ]);
  if (!built.ok) throw new Error(`fixture invalid: ${JSON.stringify(built.error)}`);
  return built.value;
}

const project = parseNodeId("project");
const allHydrated = () => true;

describe("buildTimelineTree", () => {
  const graph = fixture();

  it("projects media fields and reports focus", () => {
    const tree = buildTimelineTree(graph, project, "project", 1, allHydrated);
    expect(tree.timeline).toEqual({ id: "project", title: "Project", focused: true });
    expect(tree.nodes[0]).toMatchObject({ id: "img1", kind: "media", mediaKind: "image", durationSeconds: 3 });
    expect(tree.nodes[1]).toMatchObject({
      id: "vid1",
      kind: "media",
      mediaKind: "video",
      durationSeconds: 7,
      trimInSeconds: 1,
      trimOutSeconds: 2,
      fullDurationSeconds: 10,
    });
  });

  it("summarizes a nested collection at depth 1 (no children)", () => {
    const tree = buildTimelineTree(graph, project, "project", 1, allHydrated);
    const collection = tree.nodes[2];
    expect(collection).toMatchObject({ id: "scene-a", kind: "collection", hydrated: true, childCount: 2 });
    expect(collection.children).toBeUndefined();
  });

  it("expands a hydrated collection at depth 2", () => {
    const tree = buildTimelineTree(graph, project, "project", 2, allHydrated);
    expect(tree.nodes[2].children?.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("never expands an un-hydrated placeholder, even within depth", () => {
    const isHydrated = (id: string) => id !== "scene-a";
    const tree = buildTimelineTree(graph, project, "project", 2, isHydrated);
    expect(tree.nodes[2]).toMatchObject({ id: "scene-a", hydrated: false });
    expect(tree.nodes[2].children).toBeUndefined();
  });

  it("reports focused:false when reading a non-focused collection", () => {
    const tree = buildTimelineTree(graph, parseNodeId("scene-a"), "project", 1, allHydrated);
    expect(tree.timeline).toEqual({ id: "scene-a", title: "Scene A", focused: false });
  });
});
