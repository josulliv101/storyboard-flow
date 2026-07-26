import { describe, expect, it } from "vitest";

import { scrollCanMoveBox, type ContainmentNode } from "./edge-autoscroll-coordinator";

// A stand-in for the containment tree, so the rule can be exercised in the
// node-env project (no DOM here). `contains` is the DOM's own semantics:
// a node contains itself and every descendant.
function node(name: string, children: FakeNode[] = []): FakeNode {
  const self: FakeNode = {
    name,
    children,
    contains: (other) =>
      other === self || children.some((child) => child.contains(other as never)),
  };
  return self;
}

type FakeNode = ContainmentNode & {
  name: string;
  children: FakeNode[];
};

describe("scrollCanMoveBox", () => {
  // Two independent scroll containers side by side — the shape the recursive
  // sub-graph tree produces, and the one that made this O(mounted views).
  const stripA = node("strip-a");
  const stripB = node("strip-b");
  const page = node("page", [stripA, stripB]);

  it("does NOT remeasure the scroller itself", () => {
    // Every frame of our own auto-scroll comes through here. Scrolling a
    // container moves its content, not its own box.
    expect(scrollCanMoveBox(stripA, stripA)).toBe(false);
  });

  it("does NOT remeasure a SIBLING view", () => {
    // The regression: scrolling one strip used to force a layout on every
    // other mounted view, every frame.
    expect(scrollCanMoveBox(stripA, stripB)).toBe(false);
  });

  it("DOES remeasure a view inside the scroller", () => {
    // A nested sub-timeline really did travel with its ancestor's scroll.
    expect(scrollCanMoveBox(page, stripA)).toBe(true);
    expect(scrollCanMoveBox(page, stripB)).toBe(true);
  });

  it("remeasures everything on a null scope (resize targets window, not a Node)", () => {
    expect(scrollCanMoveBox(null, stripA)).toBe(true);
    expect(scrollCanMoveBox(null, stripB)).toBe(true);
  });

  it("remeasures everything for a document-level scroll, with no special case", () => {
    // `document.contains(el)` is true for every mounted element, so the page
    // scrolling falls out of the same rule.
    const documentish = node("document", [page]);
    expect(scrollCanMoveBox(documentish, stripA)).toBe(true);
    expect(scrollCanMoveBox(documentish, stripB)).toBe(true);
  });

  it("does not remeasure a view in a DETACHED tree", () => {
    // Defensive: an entry whose element left the document shares no ancestor
    // with the scroller, so it is not measured either.
    expect(scrollCanMoveBox(page, node("orphan"))).toBe(false);
  });
});
