import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId, type CollectionsGraph, type NodeId } from "@storyboard/ui/dnd-collections";

import { resolveInsertPlacement, toPostRemovalIndex } from "./graph-insert-placement";

/**
 * project ─ alpha, bravo, scene-a[ c1, c2, scene-b[ d1 ] ], charlie
 * trash   ─ t1
 *
 * `trash` is a SEPARATE root, exactly as the app builds it — a selected card
 * there must never pull an insert out of the focused project.
 */
function fixture(): CollectionsGraph {
  const built = buildGraph([
    {
      kind: "collection",
      id: "project",
      name: "Project",
      children: [
        { kind: "media", id: "alpha", name: "alpha" },
        { kind: "media", id: "bravo", name: "bravo" },
        {
          kind: "collection",
          id: "scene-a",
          name: "Scene A",
          children: [
            { kind: "media", id: "c1", name: "c1" },
            { kind: "media", id: "c2", name: "c2" },
            {
              kind: "collection",
              id: "scene-b",
              name: "Scene B",
              children: [{ kind: "media", id: "d1", name: "d1" }],
            },
          ],
        },
        { kind: "media", id: "charlie", name: "charlie" },
      ],
    },
    {
      kind: "collection",
      id: "trash",
      name: "Trash",
      children: [{ kind: "media", id: "t1", name: "t1" }],
    },
  ]);
  if (!built.ok) throw new Error(`fixture graph invalid: ${JSON.stringify(built.error)}`);
  return built.value;
}

const ids = (...values: string[]): NodeId[] => values.map(parseNodeId);

describe("resolveInsertPlacement", () => {
  const graph = fixture();

  it("appends to the focused collection when nothing is selected", () => {
    expect(resolveInsertPlacement(graph, [], "project")).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 4,
      afterId: null,
    });
  });

  it("lands right after a card selected in the focused collection", () => {
    expect(resolveInsertPlacement(graph, ids("bravo"), "project")).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 2,
      afterId: parseNodeId("bravo"),
    });
  });

  it("follows the selection into a DESCENDANT strip the board is showing", () => {
    // Sub-timeline rows are on screen under the focused one, so a card
    // selected there is a legitimate anchor — the insert goes to ITS strip.
    expect(resolveInsertPlacement(graph, ids("c1"), "project")).toEqual({
      parentId: parseNodeId("scene-a"),
      toIndex: 1,
      afterId: parseNodeId("c1"),
    });
    // Any depth, not just one level down.
    expect(resolveInsertPlacement(graph, ids("d1"), "project")).toEqual({
      parentId: parseNodeId("scene-b"),
      toIndex: 1,
      afterId: parseNodeId("d1"),
    });
  });

  it("uses the LAST selected card of a multi-selection", () => {
    expect(resolveInsertPlacement(graph, ids("charlie", "alpha"), "project")).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 1,
      afterId: parseNodeId("alpha"),
    });
  });

  it("ignores a selection ABOVE the focused collection (the drill-in wrinkle)", () => {
    // Copy alpha in the project, drill into Scene A, Paste: the selection
    // survived the navigation but its strip is gone. Appending into the
    // focused collection is the only placement the user can see happen.
    expect(resolveInsertPlacement(graph, ids("alpha"), "scene-a")).toEqual({
      parentId: parseNodeId("scene-a"),
      toIndex: 3,
      afterId: null,
    });
    // The focused collection's OWN card is a selection above it too.
    expect(resolveInsertPlacement(graph, ids("scene-a"), "scene-a")).toEqual({
      parentId: parseNodeId("scene-a"),
      toIndex: 3,
      afterId: null,
    });
  });

  it("ignores a selection in a sibling branch of the focused collection", () => {
    // Focused on Scene B; c1 lives in Scene A's strip, which is neither the
    // focused collection nor inside it.
    expect(resolveInsertPlacement(graph, ids("c1"), "scene-b")).toEqual({
      parentId: parseNodeId("scene-b"),
      toIndex: 1,
      afterId: null,
    });
  });

  it("ignores a selection under a different root (the trash)", () => {
    expect(resolveInsertPlacement(graph, ids("t1"), "project")).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 4,
      afterId: null,
    });
  });

  it("ignores a root selection (a root has no parent to take a sibling)", () => {
    expect(resolveInsertPlacement(graph, ids("project"), "project")).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 4,
      afterId: null,
    });
  });

  it("ignores a selected id that is no longer in the graph", () => {
    expect(resolveInsertPlacement(graph, ids("deleted"), "project")).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 4,
      afterId: null,
    });
  });

  it("appends at 0 when the focused collection is not in the graph yet", () => {
    // Un-hydrated focus: the dispatch itself will refuse, but the placement
    // must stay defined rather than throw on a missing children list.
    expect(resolveInsertPlacement(graph, ids("alpha"), "not-loaded")).toEqual({
      parentId: parseNodeId("not-loaded"),
      toIndex: 0,
      afterId: null,
    });
  });

  // R9.2 — the ANCHOR decides where a paste lands, not selection order.
  //
  // These pin the gap v3 exposed: right-clicking an already-selected card
  // re-anchors WITHOUT changing the selection, so `selectedIds` cannot answer
  // where the paste goes. Before the anchor argument existed, "aim at that one"
  // moved the visible `⋮` and left the paste following whatever was clicked
  // last, which is the one thing the badge promises it will not do.
  it("lands after the ANCHOR, not the last-selected card", () => {
    expect(
      resolveInsertPlacement(graph, ids("alpha", "charlie"), "project", parseNodeId("alpha")),
    ).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 1,
      afterId: parseNodeId("alpha"),
    });
  });

  it("falls back to the last-selected card when there is no anchor", () => {
    // Every non-paste caller (the Collection tool, native drops) still passes
    // nothing here, so the old rule has to survive its absence.
    expect(resolveInsertPlacement(graph, ids("alpha", "charlie"), "project", null)).toEqual(
      resolveInsertPlacement(graph, ids("alpha", "charlie"), "project"),
    );
  });

  it("ignores an anchor that has left the graph", () => {
    // E4/E1: the anchor can be deleted between the click and the paste. A
    // stale id must degrade to the selection rather than resolve to nothing
    // and silently append.
    expect(
      resolveInsertPlacement(graph, ids("alpha"), "project", parseNodeId("deleted-since")),
    ).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 1,
      afterId: parseNodeId("alpha"),
    });
  });

  it("respects an anchor that is not in the selection at all", () => {
    // Not a state the UI produces (the anchor is by definition selected), but
    // the function must not depend on that invariant holding.
    expect(resolveInsertPlacement(graph, [], "project", parseNodeId("bravo"))).toEqual({
      parentId: parseNodeId("project"),
      toIndex: 2,
      afterId: parseNodeId("bravo"),
    });
  });
});

describe("toPostRemovalIndex", () => {
  const graph = fixture();
  const project = parseNodeId("project");
  // project children: alpha, bravo, scene-a, charlie

  it("shifts left by the moved siblings that sat before the destination", () => {
    // THE REPORTED BUG. Cut the first two cards, then aim at the second-to-last
    // one: the visible index is 3 (after scene-a), but removing alpha and bravo
    // first leaves [scene-a, charlie], where 3 is past the end and clamps — so
    // the items appended instead of landing where the user aimed.
    expect(toPostRemovalIndex(graph, project, ids("alpha", "bravo"), 3)).toBe(1);
  });

  it("leaves the index alone when the moved nodes sit after it", () => {
    // Nothing before the destination was removed, so the visible index is
    // already the post-removal one.
    expect(toPostRemovalIndex(graph, project, ids("charlie"), 1)).toBe(1);
  });

  it("ignores nodes moving in from another collection", () => {
    // They were never in this list, so they cannot have shifted it. `c1` lives
    // in scene-a; counting it here would pull the insert one slot left.
    expect(toPostRemovalIndex(graph, project, ids("c1"), 3)).toBe(3);
  });

  it("counts only the moved siblings, not every moved node", () => {
    // Mixed: alpha is a sibling before the destination, c1 is not a sibling at
    // all. Exactly one shift.
    expect(toPostRemovalIndex(graph, project, ids("alpha", "c1"), 3)).toBe(2);
  });

  it("never returns a negative index", () => {
    // Pasting after a card you just cut asks for a position inside the moved
    // run itself, which does not exist once the run is gone.
    expect(toPostRemovalIndex(graph, project, ids("alpha", "bravo"), 0)).toBe(0);
  });

  it("appends unchanged when nothing is moving", () => {
    expect(toPostRemovalIndex(graph, project, [], 4)).toBe(4);
  });
});
