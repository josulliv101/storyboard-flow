import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "./core/graph";
import { useCollectionsStore } from "./react/collections-store";
import { DndCollections } from "./react/DndCollections";
import { VirtualStrip, type VirtualStripHandle } from "./virtual/VirtualStrip";
import {
  dispatchPointerSequence,
  dragHoldAt,
  dragToPoint,
  gapBetween,
  moveHeldPointer,
  nodeCard,
  nodeHandle,
  rectCenter,
  releaseAt,
  waitForLayout,
} from "./stories-helpers";

// Phase 2 coverage (VIRTUALIZATION-PLAN.md): 1,000 nodes share one graph,
// only visible + overscan cards mount, selection works on mounted cards,
// and offscreen nodes can be scrolled to and focused.

const ITEM_COUNT = 1000;

function bigGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    children.push({ kind: "media", id: `m${i}`, name: `M${i}`, durationSeconds: 4 });
  }
  const result = buildGraph([{ kind: "collection", id: "strip", name: "Strip", children }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function StripHarness({
  focusTarget,
  activation = "handle",
}: {
  focusTarget?: string;
  activation?: "handle" | "hold";
}) {
  const handle = useRef<VirtualStripHandle>(null);
  return (
    <DndCollections initialGraph={bigGraph()}>
      <div className="flex w-[640px] flex-col gap-3">
        {focusTarget && (
          <button type="button" onClick={() => handle.current?.focusNode(parseNodeId(focusTarget))}>
            focus target
          </button>
        )}
        <VirtualStrip
          ref={handle}
          collectionId={parseNodeId("strip")}
          itemDragActivation={activation}
        />
      </div>
    </DndCollections>
  );
}

const meta = {
  title: "UI/DndCollectionsVirtual",
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Play-less twin for e2e (real-mouse scroll/drag must not race a play()). */
export const VirtualPlayground: Story = {
  render: () => <StripHarness />,
};

export const ThousandItemsVirtualized: Story = {
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const first = nodeCard(canvasElement, "m0");
    await waitForLayout(first);

    // The graph holds 1,000 nodes; the DOM holds a viewport's worth.
    const mounted = canvasElement.querySelectorAll("[data-node-id]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(50);

    // The scroll range still accounts for every unmounted node.
    const spacer = canvasElement.querySelector<HTMLElement>(
      '[data-virtual-strip="strip"] > div'
    );
    expect(spacer!.style.width).toBe(`${ITEM_COUNT * (128 + 8)}px`);

    // Selection is plain NodeCard behavior, unchanged by virtualization.
    const user = userEvent.setup();
    await user.click(first);
    await waitFor(() => {
      expect(nodeCard(canvasElement, "m0")).toHaveAttribute("data-selected", "true");
    });
  },
};

export const DragIntoGapUsesVirtualBoundary: Story = {
  // Phase 3: the strip container is the droppable; pointer offset resolves
  // through the virtualizer's slot math into an insert-at-index intent —
  // no neighbor card rects involved. The indicator renders at the boundary
  // offset in content coordinates.
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const m5 = nodeHandle(canvasElement, "m5");
    const m1 = nodeCard(canvasElement, "m1");
    const m2 = nodeCard(canvasElement, "m2");
    await waitForLayout(m2);
    const gap = gapBetween(m1, m2);

    await dragHoldAt(m5, gap);
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-drop-indicator="virtual"]')).not.toBeNull();
    });
    await releaseAt(gap);

    await waitFor(() => {
      const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
      const ids = [...strip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids.slice(0, 4)).toEqual(["m0", "m1", "m5", "m2"]);
    });
  },
};

const WIDTH_PER_SECOND = 24;
const VARIABLE_COUNT = 300;

/** Durations cycle 2..6s -> widths cycle 48..144px. */
function variableGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < VARIABLE_COUNT; i++) {
    children.push({ kind: "media", id: `m${i}`, name: `M${i}`, durationSeconds: (i % 5) + 2 });
  }
  const result = buildGraph([{ kind: "collection", id: "strip", name: "Strip", children }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const VariableWidthItems: Story = {
  // Phase 4: widths come from node metadata via itemWidthFor — evaluated
  // lazily, cached by node id in the virtualizer, never by rendering the
  // node. Boundary resolution and the indicator use measured offsets, so
  // gap drops stay aligned between unequal cards.
  render: () => (
    <DndCollections initialGraph={variableGraph()}>
      <div className="w-[640px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemWidthFor={(node) =>
            node.kind === "media" ? node.durationSeconds * WIDTH_PER_SECOND : undefined
          }
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const m0 = nodeCard(canvasElement, "m0"); // 2s -> 48px
    const m4 = nodeCard(canvasElement, "m4"); // 6s -> 144px
    await waitForLayout(m4);
    expect(Math.round(m0.getBoundingClientRect().width)).toBe(48);
    expect(Math.round(m4.getBoundingClientRect().width)).toBe(144);

    // The scroll range is the metadata-derived sum — no DOM render needed:
    // widths per 5-cycle sum to 480px + 5 gaps of 8px = 520px.
    const spacer = canvasElement.querySelector<HTMLElement>(
      '[data-virtual-strip="strip"] > div'
    );
    expect(spacer!.style.width).toBe(`${(VARIABLE_COUNT / 5) * 520}px`);

    // Gap drop between two UNEQUAL cards resolves the measured boundary:
    // m0 into the m2/m3 gap -> visible boundary 3 -> lands after m2.
    const gap = gapBetween(nodeCard(canvasElement, "m2"), nodeCard(canvasElement, "m3"));
    await dragHoldAt(nodeHandle(canvasElement, "m0"), gap);

    // The drag ghost matches the dragged card's DISPLAY width (48px for a
    // 2s item), not a fixed card size — dnd-kit sizes the overlay to the
    // dragged element's measured rect and the ghost fills it.
    await waitFor(() => {
      const ghost = document.querySelector<HTMLElement>('[data-testid="drag-ghost"]');
      expect(ghost).not.toBeNull();
      expect(Math.round(ghost!.getBoundingClientRect().width)).toBe(48);
    });
    await releaseAt(gap);
    await waitFor(() => {
      const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
      const ids = [...strip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids.slice(0, 4)).toEqual(["m1", "m2", "m0", "m3"]);
    });
  },
};

/** Media strip with a collection card ("folder", 1 child) at index 5. */
function mixedGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < 12; i++) {
    children.push({ kind: "media", id: `m${i}`, name: `M${i}`, durationSeconds: 4 });
  }
  children.splice(5, 0, {
    kind: "collection",
    id: "folder",
    name: "Folder",
    children: [{ kind: "media", id: "f1", name: "F1", durationSeconds: 4 }],
  });
  const result = buildGraph([{ kind: "collection", id: "strip", name: "Strip", children }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const NestIntoCollectionOnStrip: Story = {
  // A collection card mounted INSIDE a virtual strip must win the pointer
  // over the strip container itself (pointerWithin has no z-order — the
  // wide container's center can be nearer than the card's). Dropping on
  // the card's center nests; the strip's insert-at-index applies only in
  // gaps.
  render: () => (
    <DndCollections initialGraph={mixedGraph()}>
      <div className="w-[640px]">
        <VirtualStrip collectionId={parseNodeId("strip")} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const m0 = nodeHandle(canvasElement, "m0");
    const folder = nodeCard(canvasElement, "folder");
    await waitForLayout(folder);

    // Hold over the folder's center: the nest highlight must show (card
    // won the collision), not the strip's insertion indicator.
    const center = rectCenter(folder);
    await dragHoldAt(m0, center);
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-nest-state="valid"]')).not.toBeNull();
      expect(canvasElement.querySelector('[data-drop-indicator="virtual"]')).toBeNull();
    });
    await releaseAt(center);

    await waitFor(() => {
      // m0 nested: gone from the strip, folder count bumped.
      const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
      const ids = [...strip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids).not.toContain("m0");
      expect(ids[0]).toBe("m1");
      expect(nodeCard(canvasElement, "folder").getAttribute("aria-label")).toMatch(
        /collection, 2 items/i
      );
    });
  },
};

export const EmptyStripReceivesDrops: Story = {
  // An EMPTY virtual strip shows a drop affordance and accepts drops — the
  // container droppable resolves boundary 0 with no cards mounted at all.
  render: () => (
    <DndCollections
      initialGraph={(() => {
        const result = buildGraph([
          {
            kind: "collection",
            id: "strip-a",
            name: "Strip A",
            children: [
              { kind: "media", id: "a0", name: "A0", durationSeconds: 4 },
              { kind: "media", id: "a1", name: "A1", durationSeconds: 4 },
            ],
          },
          { kind: "collection", id: "strip-b", name: "Strip B", children: [] },
        ]);
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        return result.value;
      })()}
    >
      <div className="flex w-[640px] flex-col gap-6">
        <VirtualStrip collectionId={parseNodeId("strip-a")} />
        <VirtualStrip collectionId={parseNodeId("strip-b")} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const emptyStrip = canvasElement.querySelector<HTMLElement>(
      '[data-virtual-strip="strip-b"]'
    )!;
    await waitForLayout(nodeCard(canvasElement, "a0"));
    expect(emptyStrip.textContent).toMatch(/drop items here/i);

    await dragToPoint(nodeHandle(canvasElement, "a0"), rectCenter(emptyStrip));

    await waitFor(() => {
      const ids = [...emptyStrip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids).toEqual(["a0"]);
      expect(emptyStrip.textContent).not.toMatch(/drop items here/i);
    });
  },
};

function RemeasureHarness() {
  // Before "metadata" loads, every item uses the estimated fallback width;
  // loading swaps in real durations and invalidates the width cache.
  const [loaded, setLoaded] = useState(false);
  const handle = useRef<VirtualStripHandle>(null);
  useEffect(() => {
    if (loaded) handle.current?.remeasure();
  }, [loaded]);
  return (
    <DndCollections initialGraph={variableGraph()}>
      <div className="flex w-[640px] flex-col gap-3">
        <button type="button" onClick={() => setLoaded(true)}>
          load metadata
        </button>
        <VirtualStrip
          ref={handle}
          collectionId={parseNodeId("strip")}
          itemWidthFor={(node) =>
            loaded && node.kind === "media"
              ? node.durationSeconds * WIDTH_PER_SECOND
              : undefined
          }
        />
      </div>
    </DndCollections>
  );
}

export const RemeasureAfterMetadataLoad: Story = {
  // §5: estimated width before metadata, remeasure() after — the cache
  // invalidates, layout re-derives from the new widths, and the scroll
  // position does not jump.
  render: () => <RemeasureHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLayout(nodeCard(canvasElement, "m0"));
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    const spacer = strip.querySelector<HTMLElement>(":scope > div")!;

    // Pre-metadata: every item at the 128px fallback estimate.
    expect(spacer.style.width).toBe(`${VARIABLE_COUNT * (128 + 8)}px`);
    expect(Math.round(nodeCard(canvasElement, "m0").getBoundingClientRect().width)).toBe(128);

    // Scroll somewhere non-trivial, then load metadata.
    strip.scrollLeft = 500;
    const user = userEvent.setup();
    await user.click(canvas.getByRole("button", { name: /load metadata/i }));

    await waitFor(() => {
      // Layout re-derived from real durations...
      expect(spacer.style.width).toBe(`${(VARIABLE_COUNT / 5) * 520}px`);
      expect(Math.round(nodeCard(canvasElement, "m0").getBoundingClientRect().width)).toBe(48);
      // ...without the scroll position resetting.
      expect(strip.scrollLeft).toBe(500);
    });
  },
};

function twoStripGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < 200; i++) {
    children.push({ kind: "media", id: `m${i}`, name: `M${i}`, durationSeconds: 4 });
  }
  const result = buildGraph([
    { kind: "collection", id: "strip-a", name: "Strip A", children },
    {
      kind: "collection",
      id: "strip-b",
      name: "Strip B",
      children: [
        { kind: "media", id: "b0", name: "B0", durationSeconds: 4 },
        { kind: "media", id: "b1", name: "B1", durationSeconds: 4 },
        { kind: "media", id: "b2", name: "B2", durationSeconds: 4 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const CrossStripMove: Story = {
  // Two virtualized strips under ONE provider share the graph/store; a drag
  // from one container resolves an insert-at-index intent against the
  // other. Same command pipeline as every other move.
  render: () => (
    <DndCollections initialGraph={twoStripGraph()}>
      <div className="flex w-[640px] flex-col gap-6">
        <VirtualStrip collectionId={parseNodeId("strip-a")} />
        <VirtualStrip collectionId={parseNodeId("strip-b")} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const m0 = nodeHandle(canvasElement, "m0");
    const b0 = nodeCard(canvasElement, "b0");
    const b1 = nodeCard(canvasElement, "b1");
    await waitForLayout(b1);

    await dragToPoint(m0, gapBetween(b0, b1));

    await waitFor(() => {
      const stripB = canvasElement.querySelector('[data-virtual-strip="strip-b"]')!;
      const ids = [...stripB.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids).toEqual(["b0", "m0", "b1", "b2"]);
      const stripA = canvasElement.querySelector('[data-virtual-strip="strip-a"]')!;
      expect(
        stripA.querySelector<HTMLElement>("[data-node-id]")!.dataset.nodeId
      ).toBe("m1");
    });
  },
};

function SelectPairButton() {
  const store = useCollectionsStore();
  return (
    <button
      type="button"
      onClick={() => store.setSelection([parseNodeId("m1"), parseNodeId("m500")])}
    >
      select pair
    </button>
  );
}

export const MultiSelectWithOffscreenItem: Story = {
  // §17/§22: selection is graph state, not DOM state — an UNMOUNTED node
  // can be selected and dragged as part of the group. m500 never mounts
  // during any of this.
  render: () => (
    <DndCollections initialGraph={bigGraph()}>
      <div className="flex w-[640px] flex-col gap-3">
        <SelectPairButton />
        <VirtualStrip collectionId={parseNodeId("strip")} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const m1 = nodeCard(canvasElement, "m1");
    await waitForLayout(m1);

    const user = userEvent.setup();
    await user.click(canvas.getByRole("button", { name: /select pair/i }));
    await waitFor(() => {
      expect(nodeCard(canvasElement, "m1")).toHaveAttribute("data-selected", "true");
    });
    // The other selected node is offscreen — genuinely not in the DOM.
    expect(canvasElement.querySelector('[data-node-id="m500"]')).toBeNull();

    // Dragging the mounted member (via its grip) drags the whole selection.
    const m3 = nodeCard(canvasElement, "m3");
    const m4 = nodeCard(canvasElement, "m4");
    const gap = gapBetween(m3, m4);
    await dragHoldAt(nodeHandle(canvasElement, "m1"), gap);
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-testid="drag-ghost-count"]')).toHaveTextContent(
        "+1"
      );
    });
    await releaseAt(gap);

    // Both landed at the boundary in document order.
    await waitFor(() => {
      const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
      const ids = [...strip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids.slice(0, 6)).toEqual(["m0", "m2", "m3", "m1", "m500", "m4"]);
    });
  },
};

export const PanToScrollWithMomentum: Story = {
  // Phase 8: dragging the CARD BODY (item drags live on the grip bar now)
  // pans the scroll position directly — no dnd-kit drag starts — and
  // releasing with velocity keeps the strip gliding (inertia). Real-mouse
  // click suppression after a pan is covered by the e2e flick test.
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    const m3 = nodeCard(canvasElement, "m3");
    await waitForLayout(m3);
    const body = rectCenter(m3);

    // Fast leftward drag from a card BODY: 120px over ~3 frames.
    await dispatchPointerSequence([
      { element: m3, type: "pointerdown", clientX: body.x, clientY: body.y },
      { element: m3, type: "pointermove", clientX: body.x - 40, clientY: body.y, delayAfterMs: 16 },
      { element: m3, type: "pointermove", clientX: body.x - 80, clientY: body.y, delayAfterMs: 16 },
      { element: m3, type: "pointermove", clientX: body.x - 120, clientY: body.y, delayAfterMs: 16 },
    ]);

    // Panning is not a drag: no ghost, and the pan tracked the pointer.
    expect(canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')).toBeNull();
    expect(strip.scrollLeft).toBeGreaterThan(100);

    await dispatchPointerSequence([
      { element: m3, type: "pointerup", clientX: body.x - 120, clientY: body.y, delayAfterMs: 30 },
    ]);

    // Momentum: the strip keeps gliding after release.
    const atRelease = strip.scrollLeft;
    await waitFor(() => {
      expect(strip.scrollLeft).toBeGreaterThan(atRelease + 30);
    });
  },
};

/** Play-less twin (hold mode) for e2e. */
export const HoldPlayground: Story = {
  render: () => <StripHarness activation="hold" />,
};

export const HoldToDragActivation: Story = {
  // itemDragActivation="hold": the card body serves BOTH gestures. Fast
  // movement pans (the hold sensor's tolerance cancels activation); a
  // still press past the 250ms delay starts an item drag, and the pan
  // hook yields (isGestureClaimed).
  render: () => <StripHarness activation="hold" />,
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    await waitForLayout(nodeCard(canvasElement, "m0"));
    // No grip bars in hold mode.
    expect(canvasElement.querySelector("[data-drag-handle]")).toBeNull();

    // Gesture 1 — fast body drag: pans, no item drag.
    const m3 = nodeCard(canvasElement, "m3");
    const body = rectCenter(m3);
    await dispatchPointerSequence([
      { element: m3, type: "pointerdown", clientX: body.x, clientY: body.y },
      { element: m3, type: "pointermove", clientX: body.x - 60, clientY: body.y, delayAfterMs: 16 },
      { element: m3, type: "pointermove", clientX: body.x - 120, clientY: body.y, delayAfterMs: 16 },
      { element: m3, type: "pointerup", clientX: body.x - 120, clientY: body.y, delayAfterMs: 30 },
    ]);
    expect(canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')).toBeNull();
    expect(strip.scrollLeft).toBeGreaterThan(80);

    // Stop the glide (wheel cancels it) and rewind for gesture 2.
    strip.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    strip.scrollLeft = 0;
    await waitForLayout(nodeCard(canvasElement, "m0"));

    // Gesture 2 — press and HOLD (past 250ms), then move: item drag, no pan.
    const m0 = nodeCard(canvasElement, "m0");
    const start = rectCenter(m0);
    const target = gapBetween(nodeCard(canvasElement, "m1"), nodeCard(canvasElement, "m2"));
    await dispatchPointerSequence([
      { element: m0, type: "pointerdown", clientX: start.x, clientY: start.y, delayAfterMs: 320 },
      { element: m0, type: "pointermove", clientX: target.x, clientY: target.y, delayAfterMs: 50 },
      { element: m0, type: "pointermove", clientX: target.x, clientY: target.y, delayAfterMs: 150 },
    ]);
    expect(
      canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
    ).not.toBeNull();
    expect(strip.scrollLeft).toBe(0); // the pan yielded to the drag

    await dispatchPointerSequence([
      { element: m0, type: "pointerup", clientX: target.x, clientY: target.y, delayAfterMs: 50 },
    ]);
    await waitFor(() => {
      const ids = [...strip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids.slice(0, 3)).toEqual(["m1", "m0", "m2"]);
    });
  },
};

export const RenderEfficiencyAtThousandItems: Story = {
  // §18 at scale: with 1,000 nodes in the graph, dragging across DIFFERENT
  // insertion boundaries (each one a store intent change re-rendering the
  // strip for its indicator) must not re-render a mounted bystander card —
  // memo + id-only props + selector bail hold under virtualization.
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const m1 = nodeCard(canvasElement, "m1");
    const m2 = nodeCard(canvasElement, "m2");
    const m3 = nodeCard(canvasElement, "m3");
    const m5 = nodeHandle(canvasElement, "m5");
    await waitForLayout(m3);

    await dragHoldAt(m5, gapBetween(m1, m2));
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-drop-indicator="virtual"]')).not.toBeNull();
    });

    const before = m3.getAttribute("data-render-count");
    // Bounce between two boundaries: intent (and indicator) changes each move.
    await moveHeldPointer(gapBetween(m2, m3));
    await moveHeldPointer(gapBetween(m1, m2));
    await moveHeldPointer(gapBetween(m2, m3));
    expect(m3.getAttribute("data-render-count")).toBe(before);

    // Settle on the final boundary — dnd-kit commits at the last MOVE.
    await moveHeldPointer(gapBetween(m1, m2), 150);
    await releaseAt(gapBetween(m1, m2));
    await waitFor(() => {
      const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
      const ids = [...strip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids.slice(0, 4)).toEqual(["m0", "m1", "m5", "m2"]);
    });
  },
};

export const OffscreenFocusScrollsIntoView: Story = {
  render: () => <StripHarness focusTarget="m900" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLayout(nodeCard(canvasElement, "m0"));
    // m900 is far outside the viewport and NOT mounted.
    expect(canvasElement.querySelector('[data-node-id="m900"]')).toBeNull();

    const user = userEvent.setup();
    await user.click(canvas.getByRole("button", { name: /focus target/i }));

    // focusNode scrolls, waits for the mount, then focuses the card.
    await waitFor(() => {
      const card = canvasElement.querySelector<HTMLElement>('[data-node-id="m900"]');
      expect(card).not.toBeNull();
      expect(card!.ownerDocument.activeElement).toBe(card);
    });
  },
};
