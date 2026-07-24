import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId, type CollectionsGraph } from "@storyboard/ui/dnd-collections";

import { resolveMovePlacement } from "./placement";

/** project ─ a, b, scene-a[ c1, c2 ] */
function fixture(): CollectionsGraph {
  const built = buildGraph([
    {
      kind: "collection",
      id: "project",
      name: "Project",
      children: [
        { kind: "media", id: "a", name: "a" },
        { kind: "media", id: "b", name: "b" },
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

const id = parseNodeId;

describe("resolveMovePlacement", () => {
  const graph = fixture();

  it("reorders within the same parent, adjusting for the post-removal shift", () => {
    // Move `a` after `b`: pre-removal insert index is 2, but removing `a`
    // (index 0, before the target) shifts it down to 1.
    expect(resolveMovePlacement(graph, { nodeId: id("a"), targetId: id("project"), after: id("b") })).toEqual(
      { ok: true, toParentId: id("project"), toIndex: 1 },
    );
  });

  it("does not adjust when the node sits after the insertion point", () => {
    // Move `scene-a` (index 2) to the start: nothing before it is removed.
    expect(
      resolveMovePlacement(graph, { nodeId: id("scene-a"), targetId: id("project"), position: "start" }),
    ).toEqual({ ok: true, toParentId: id("project"), toIndex: 0 });
  });

  it("places at the end of the same parent (post-removal length)", () => {
    expect(resolveMovePlacement(graph, { nodeId: id("a"), targetId: id("project"), position: "end" })).toEqual(
      { ok: true, toParentId: id("project"), toIndex: 2 },
    );
  });

  it("moves into another collection without a post-removal adjustment", () => {
    expect(resolveMovePlacement(graph, { nodeId: id("a"), targetId: id("scene-a"), before: id("c1") })).toEqual(
      { ok: true, toParentId: id("scene-a"), toIndex: 0 },
    );
    expect(resolveMovePlacement(graph, { nodeId: id("a"), targetId: id("scene-a"), position: "end" })).toEqual(
      { ok: true, toParentId: id("scene-a"), toIndex: 2 },
    );
  });

  it("defaults to end when no anchor is given", () => {
    expect(resolveMovePlacement(graph, { nodeId: id("c1"), targetId: id("scene-a") })).toEqual({
      ok: true,
      toParentId: id("scene-a"),
      toIndex: 1, // [c1, c2] → removing c1 → end is index 1
    });
  });

  it("rejects an unknown anchor", () => {
    expect(resolveMovePlacement(graph, { nodeId: id("a"), targetId: id("project"), after: id("nope") })).toEqual(
      { ok: false, error: { reason: "unknown-anchor", anchor: id("nope") } },
    );
  });

  it("rejects conflicting anchors", () => {
    expect(
      resolveMovePlacement(graph, {
        nodeId: id("a"),
        targetId: id("project"),
        before: id("b"),
        position: "end",
      }),
    ).toEqual({ ok: false, error: { reason: "conflicting-anchors" } });
  });
});
