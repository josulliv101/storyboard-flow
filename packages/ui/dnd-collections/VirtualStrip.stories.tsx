import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  buildGraph,
  mediaDurationSeconds,
  parseNodeId,
  type GraphNodeSpec,
} from "./core/graph";
import { useCollectionsStore } from "./react/collections-store";
import { DndCollections } from "./react/DndCollections";
import { UndoRedoControls } from "./react/history-views";
import { VirtualStrip, type VirtualStripHandle } from "./virtual/VirtualStrip";
import { durationToWidth } from "./virtual/virtual-strip-geometry";
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

function LatestFocusRequestHarness() {
  const handle = useRef<VirtualStripHandle>(null);
  return (
    <DndCollections initialGraph={bigGraph()}>
      <div className="flex w-[640px] flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            handle.current?.focusNode(parseNodeId("m900"));
            handle.current?.focusNode(parseNodeId("m100"));
          }}
        >
          focus latest target
        </button>
        <VirtualStrip ref={handle} collectionId={parseNodeId("strip")} />
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

export const InvalidNumericOptionsUseSafeDefaults: Story = {
  render: () => (
    <DndCollections initialGraph={bigGraph()}>
      <div className="w-[640px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemWidth={Number.NaN}
          itemWidthFor={() => Number.POSITIVE_INFINITY}
          itemHeight={-1}
          gap={Number.NaN}
          overscan={-1}
          trimPixelsPerSecond={Number.NaN}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "m0"));
    const slot = canvasElement.querySelector<HTMLElement>('[data-virtual-index="0"]')!;
    expect(parseFloat(slot.style.width)).toBe(128);
    expect(parseFloat(slot.style.height)).toBe(96);
    expect(slot.querySelector("[data-trim-handle]")).toBeNull();
  },
};

function zeroWidthGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        { kind: "media", id: "wide", name: "Wide", durationSeconds: 5 },
        { kind: "media", id: "zero", name: "Zero", durationSeconds: 5 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const FullyTrimmedClipKeepsMinimumWidth: Story = {
  // A clip whose itemWidthFor yields 0 (fully trimmed) must not collapse to a
  // 0px, invisible, unselectable slot — the slot is floored to a clickable
  // minimum while the node's semantic duration stays whatever it is.
  render: () => (
    <DndCollections initialGraph={zeroWidthGraph()}>
      <div className="w-[640px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemWidthFor={(node) => (node.kind === "media" && node.name === "Zero" ? 0 : 96)}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "wide"));
    const zero = nodeCard(canvasElement, "zero");
    const zeroSlot = zero.closest<HTMLElement>("[data-virtual-index]")!;

    // The 0-width clip did not vanish: its slot holds the interactive minimum.
    expect(parseFloat(zeroSlot.style.width)).toBe(12);
    expect(zero.getBoundingClientRect().width).toBeGreaterThanOrEqual(12);

    // And it is still selectable by pointer.
    const user = userEvent.setup();
    await user.click(zero);
    await waitFor(() =>
      expect(nodeCard(canvasElement, "zero")).toHaveAttribute("data-selected", "true")
    );
  },
};

export const MissingCollectionUsesNativeScrollFallback: Story = {
  render: () => (
    <DndCollections initialGraph={bigGraph()}>
      <div className="w-[640px]">
        <VirtualStrip
          collectionId={parseNodeId("missing-strip")}
          panToScroll={false}
          className="native-scroll-coverage"
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>(
      '[data-virtual-strip="missing-strip"]'
    )!;
    expect(strip).toHaveAttribute("aria-label", "missing-strip, 0 items");
    expect(strip).toHaveAttribute("aria-rowcount", "0");
    expect(strip).toHaveClass("native-scroll-coverage");
    expect(strip.style.touchAction).toBe("auto");
    expect(strip.querySelector("[data-drag-handle]")).toBeNull();

    const keydown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    strip.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false);
  },
};

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
            node.kind === "media" ? mediaDurationSeconds(node) * WIDTH_PER_SECOND : undefined
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

export const WidthCallbackStableDuringDrag: Story = {
  // Regression guard for TanStack measurement thrash: the virtualizer
  // memoizes its measurements on getItemKey's IDENTITY. An inline getItemKey
  // closure rebuilt all measurements — re-running itemWidthFor for every
  // item — on every render, including once per indicator move during a drag.
  // With a stable getItemKey, a drag that only changes the drop boundary
  // must not re-invoke itemWidthFor at all.
  render: () => {
    const calls = { n: 0 };
    return (
      <DndCollections initialGraph={variableGraph()}>
        <div className="w-[640px]">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) => {
              calls.n += 1;
              // Stash the live count where the play function can read it.
              (window as unknown as { __widthCalls: number }).__widthCalls = calls.n;
              return node.kind === "media" ? mediaDurationSeconds(node) * WIDTH_PER_SECOND : undefined;
            }}
          />
        </div>
      </DndCollections>
    );
  },
  play: async ({ canvasElement }) => {
    const m0 = nodeHandle(canvasElement, "m0");
    const m1 = nodeCard(canvasElement, "m1");
    const m2 = nodeCard(canvasElement, "m2");
    const m3 = nodeCard(canvasElement, "m3");
    await waitForLayout(m3);

    // Establish the drag and settle on a boundary.
    await dragHoldAt(m0, gapBetween(m1, m2));
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-drop-indicator="virtual"]')).not.toBeNull();
    });

    const win = window as unknown as { __widthCalls: number };
    const before = win.__widthCalls;
    // Bounce the pointer across boundaries: each move is an intent change
    // that re-renders the strip for its indicator.
    await moveHeldPointer(gapBetween(m2, m3));
    await moveHeldPointer(gapBetween(m1, m2));
    await moveHeldPointer(gapBetween(m2, m3));

    // Zero extra width evaluations across those re-renders.
    expect(win.__widthCalls).toBe(before);

    await releaseAt(gapBetween(m2, m3));
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
              ? mediaDurationSeconds(node) * WIDTH_PER_SECOND
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
    const grip = m3
      .closest("[data-node-wrapper]")!
      .querySelector<HTMLElement>('[data-drag-handle="m3"]')!;
    expect(grip.tagName).toBe("BUTTON");
    expect(grip.getAttribute("aria-describedby")).not.toMatch(/undefined|null/);
    expect(m3.getAttribute("aria-describedby")).not.toMatch(/undefined|null/);
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

export const StationaryHoldReleaseDoesNotFling: Story = {
  // The universal kill-momentum gesture: pan fast, stop dead, HOLD, release.
  // Samples are only pruned on movement, so the window still describes the
  // pre-hold motion at release — without the staleness check the strip would
  // fling as if flicked. (Hand jitter masks the bug in manual testing; the
  // simulated pointer here is perfectly still.)
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    const m3 = nodeCard(canvasElement, "m3");
    await waitForLayout(m3);
    const body = rectCenter(m3);

    // Fast leftward pan, then a stationary hold well past SAMPLE_WINDOW_MS
    // (120ms) before releasing.
    await dispatchPointerSequence([
      { element: m3, type: "pointerdown", clientX: body.x, clientY: body.y },
      { element: m3, type: "pointermove", clientX: body.x - 40, clientY: body.y, delayAfterMs: 16 },
      { element: m3, type: "pointermove", clientX: body.x - 80, clientY: body.y, delayAfterMs: 16 },
      { element: m3, type: "pointermove", clientX: body.x - 120, clientY: body.y, delayAfterMs: 300 },
      { element: m3, type: "pointerup", clientX: body.x - 120, clientY: body.y },
    ]);

    // No glide: the scroll position must hold steady after the release.
    const atRelease = strip.scrollLeft;
    expect(atRelease).toBeGreaterThan(100); // the pan itself did scroll
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(strip.scrollLeft).toBe(atRelease);
  },
};

export const ActivationPointerSeedsEdgeAutoScroll: Story = {
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    const handle = nodeHandle(canvasElement, "m3");
    await waitForLayout(handle);
    const start = rectCenter(handle);
    const stripRect = strip.getBoundingClientRect();

    // The one move both activates dnd-kit and parks the pointer in the edge
    // band. No further pointermove is sent: auto-scroll must use the position
    // observed before the store published `isDragging`.
    await dispatchPointerSequence([
      { element: handle, type: "pointerdown", clientX: start.x, clientY: start.y },
      {
        element: document,
        type: "pointermove",
        clientX: stripRect.right - 2,
        clientY: start.y,
        delayAfterMs: 30,
      },
    ]);
    await waitFor(() => {
      expect(canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')).not.toBeNull();
      expect(strip.scrollLeft).toBeGreaterThan(5);
    });
    await dispatchPointerSequence([
      {
        element: document,
        type: "pointercancel",
        clientX: stripRect.right - 2,
        clientY: start.y,
      },
    ]);
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

export const LatestOffscreenFocusRequestWins: Story = {
  render: () => <LatestFocusRequestHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitForLayout(nodeCard(canvasElement, "m0"));

    const user = userEvent.setup();
    await user.click(canvas.getByRole("button", { name: /focus latest target/i }));
    await waitFor(() => {
      const card = canvasElement.querySelector<HTMLElement>('[data-node-id="m100"]');
      expect(card).not.toBeNull();
      expect(card!.ownerDocument.activeElement).toBe(card);
    });
    expect(canvasElement.querySelector('[data-node-id="m900"]')).toBeNull();
  },
};

export const KeyboardRovingNavigation: Story = {
  // §17/§20: a keyboard user traverses the WHOLE 1,000-item collection with
  // arrows — the strip is one roving tab stop, and navigation pulls offscreen
  // items into view. Grid semantics (role + aria-colcount/colindex) expose the
  // true position under virtualization.
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const m0 = nodeCard(canvasElement, "m0");
    await waitForLayout(m0);

    // Roving tabindex: the first card is the single tab stop; neighbors are -1.
    expect(m0.tabIndex).toBe(0);
    expect(nodeCard(canvasElement, "m1").tabIndex).toBe(-1);
    const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
    expect(strip.getAttribute("role")).toBe("grid");
    expect(strip.getAttribute("aria-colcount")).toBe("1000");

    // ArrowRight roves one item and follows focus; the roving stop moves with it.
    m0.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      const m1 = nodeCard(canvasElement, "m1");
      expect(m1.ownerDocument.activeElement).toBe(m1);
      expect(m1.tabIndex).toBe(0);
      expect(nodeCard(canvasElement, "m0").tabIndex).toBe(-1);
    });

    // Reverse navigation and unrelated keys keep the roving stop predictable.
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => {
      const first = nodeCard(canvasElement, "m0");
      expect(first.ownerDocument.activeElement).toBe(first);
      expect(first.tabIndex).toBe(0);
    });
    await user.keyboard("{PageDown}");
    expect(document.activeElement).toBe(nodeCard(canvasElement, "m0"));

    // End jumps to the last item — unmounted and far offscreen — scrolling it
    // into view and focusing it. This is the whole point: no Tab could reach it.
    expect(canvasElement.querySelector('[data-node-id="m999"]')).toBeNull();
    await user.keyboard("{End}");
    await waitFor(() => {
      const last = canvasElement.querySelector<HTMLElement>('[data-node-id="m999"]');
      expect(last).not.toBeNull();
      expect(last!.ownerDocument.activeElement).toBe(last);
      expect(last!.tabIndex).toBe(0);
    });

    // Home returns from the virtualized tail to the first logical item.
    await user.keyboard("{Home}");
    await waitFor(() => {
      const first = canvasElement.querySelector<HTMLElement>('[data-node-id="m0"]');
      expect(first).not.toBeNull();
      expect(first!.ownerDocument.activeElement).toBe(first);
      expect(first!.tabIndex).toBe(0);
    });
  },
};

export const RovingFocusFollowsClick: Story = {
  // Regression: the roving index must track the card that ACTUALLY has focus,
  // not just the hook's own key handler. Clicking a mid-list card then pressing
  // an arrow must move relative to THAT card — earlier the internal index
  // stayed at 0, so ArrowRight after clicking m5 wrongly went to m1.
  render: () => <StripHarness />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const m5 = nodeCard(canvasElement, "m5");
    await waitForLayout(m5);

    // Click m5 (which focuses it), then ArrowRight -> m6, NOT m1.
    await user.click(m5);
    await waitFor(() => {
      const c = nodeCard(canvasElement, "m5");
      expect(c.ownerDocument.activeElement).toBe(c);
    });
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      const m6 = nodeCard(canvasElement, "m6");
      expect(m6.ownerDocument.activeElement).toBe(m6);
      expect(m6.tabIndex).toBe(0);
    });
    // The stale-index bug would have landed on m1.
    expect(nodeCard(canvasElement, "m1").tabIndex).toBe(-1);
  },
};

export const FlipAnimatesStripReorder: Story = {
  // Provider-level FLIP reaches virtualized views: a reorder inside the strip
  // animates the moved card. Before ownership moved to the provider, FLIP was
  // mounted only in CollectionPanels, so virtual views never animated.
  render: () => <StripHarness />, // animateMoves defaults on at the provider
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const m0 = nodeCard(canvasElement, "m0");
    await waitForLayout(m0);

    // Alt+ArrowRight = move-next: m0 swaps with m1. The commit triggers a FLIP
    // sweep, which plays synchronously in the layout effect.
    m0.focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    const flip = m0.getAnimations().flatMap((a) => {
      if (!(a.effect instanceof KeyframeEffect)) return [];
      const t = a.effect.getKeyframes()[0]?.transform;
      return typeof t === "string" && t.startsWith("translate") ? [t] : [];
    });
    expect(flip.length).toBeGreaterThan(0);

    await waitFor(() => {
      const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
      const ids = [...strip.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids.slice(0, 2)).toEqual(["m1", "m0"]);
    });
  },
};

const TRIM_PPS = 24;
// The overview MUST use the strip's pixels-per-second so the amber "showing"
// window is the exact same pixel width as the clip below it (always in sync).

/** Pre-select a node so selection-driven UI (the overview strip) shows. */
function SelectOnMount({ id }: { id: string }) {
  const store = useCollectionsStore();
  useEffect(() => {
    store.setSelection([parseNodeId(id)]);
  }, [store, id]);
  return null;
}

// Real local dog frames (deterministic, offline) so trimming shows actual
// media resize: the image its poster, the video a frame sequence.
const trimDogFrames = [
  new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href,
  new URL("./fixtures/dog-exit-4s.png", import.meta.url).href,
] as const;

function trimGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        { kind: "media", id: "img", name: "Img", src: trimDogFrames[0], durationSeconds: 4 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          posterSrcs: trimDogFrames,
          fullDurationSeconds: 10,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const TrimMediaWithHandles: Story = {
  // Edge trim handles dispatch update-media: image right = duration, video
  // right = trim-out, video left = trim-in. At TRIM_PPS the card width IS the
  // duration. The card resizes LIVE as the handle drags (targeted resizeItem,
  // no commit), and the graph commits once on release.
  render: () => (
    <DndCollections initialGraph={trimGraph()} animateMoves={false}>
      <div className="flex w-[640px] flex-col gap-2">
        <UndoRedoControls />
        {/* Headroom for the floating overview tooltip (shown once vid is selected). */}
        <div className="pt-16">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) =>
              node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
            }
            trimPixelsPerSecond={TRIM_PPS}
          />
        </div>
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const width = (id: string) =>
      Math.round(nodeCard(canvasElement, id).getBoundingClientRect().width);
    const handle = (id: string, side: "left" | "right") =>
      nodeCard(canvasElement, id)
        .closest("[data-node-wrapper]")!
        .querySelector<HTMLElement>(`[data-trim-handle="${side}"]`);
    const left = (id: string) =>
      Math.round(nodeCard(canvasElement, id).getBoundingClientRect().left);
    const overviewWindow = () =>
      canvasElement.querySelector<HTMLElement>("[data-trim-overview-window]");
    const expectOverviewAlignedTo = (id: string) => {
      const w = overviewWindow()!.getBoundingClientRect();
      const v = nodeCard(canvasElement, id).getBoundingClientRect();
      expect(Math.round(w.left)).toBe(Math.round(v.left));
      expect(Math.round(w.right)).toBe(Math.round(v.right));
    };
    // Hold a handle down and move it, WITHOUT releasing — leaves the live
    // trim in flight so the card size can be inspected pre-commit.
    const holdHandleBy = async (el: HTMLElement, dx: number) => {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const x = r.left + r.width / 2;
      await dispatchPointerSequence([
        { element: el, type: "pointerdown", clientX: x, clientY: y },
        { element: document, type: "pointermove", clientX: x + dx, clientY: y, delayAfterMs: 30 },
      ]);
    };
    const release = async () => {
      await dispatchPointerSequence([
        { element: document, type: "pointerup", clientX: 0, clientY: 0, delayAfterMs: 30 },
      ]);
    };
    const dragHandleBy = async (el: HTMLElement, dx: number) => {
      await holdHandleBy(el, dx);
      await release();
    };
    const undoButton = () => within(canvasElement).getByRole("button", { name: /undo/i });

    await waitFor(() => nodeCard(canvasElement, "vid"));
    // Widths ARE the durations: img 4s -> 96px, vid 10s -> 240px.
    expect(width("img")).toBe(96);
    expect(width("vid")).toBe(240);

    // Image: right handle only. Video: both.
    expect(handle("img", "right")).not.toBeNull();
    expect(handle("img", "left")).toBeNull();
    expect(handle("vid", "left")).not.toBeNull();
    expect(handle("vid", "right")).not.toBeNull();

    // Alignment: selecting the video shows the overview DIRECTLY above it
    // (VirtualStrip renders it automatically — no separate component to
    // mount), with the amber window's edges pixel-matched to the clip's own
    // rendered edges.
    await user.click(nodeCard(canvasElement, "vid"));
    await waitFor(() => {
      expect(overviewWindow()).not.toBeNull();
      expectOverviewAlignedTo("vid");
    });

    // Mid-drag: hold the left handle in (trimIn +1s) and confirm alignment
    // holds LIVE (not just after commit) — the overview reads the drag's
    // live trim split, not the stale committed value. Abort (pointercancel,
    // not release) so this probe leaves vid's trim at 0/0 for the rest of
    // the test.
    await holdHandleBy(handle("vid", "left")!, 24);
    await waitFor(() => expectOverviewAlignedTo("vid"));
    await dispatchPointerSequence([
      { element: document, type: "pointercancel", clientX: 0, clientY: 0, delayAfterMs: 30 },
    ]);
    await waitFor(() => expectOverviewAlignedTo("vid"));

    // LIVE preview: hold the image's right edge OUT +48px and assert the card
    // ALREADY reads 6s -> 144px BEFORE release. The video after it shifts
    // right by the same +48px, and nothing is committed yet (undo disabled).
    const vidLeft0 = left("vid");
    await holdHandleBy(handle("img", "right")!, 48);
    await waitFor(() => expect(width("img")).toBe(144));
    expect(left("vid") - vidLeft0).toBe(48);
    expect(undoButton()).toBeDisabled();
    // Release commits it; the card stays put (no resize flash on commit).
    await release();
    await waitFor(() => expect(undoButton()).toBeEnabled());
    expect(width("img")).toBe(144);

    // Undo restores it (trims are ordinary undoable commands).
    await user.click(undoButton());
    await waitFor(() => expect(width("img")).toBe(96));

    // Trim the video's END: drag its right edge IN (left) 72px -> trimOut +3s
    // -> effective 7s -> 168px.
    await dragHandleBy(handle("vid", "right")!, -72);
    await waitFor(() => expect(width("vid")).toBe(168));

    // Trim the video's START: left edge in (right) 48px -> trimIn +2s ->
    // effective 5s -> 120px.
    await dragHandleBy(handle("vid", "left")!, 48);
    await waitFor(() => expect(width("vid")).toBe(120));

    // Over-drag the end: effective duration clamps at 0 (slot width 0, so the
    // card bottoms out at its ~18px chrome — never negative, never huge).
    // The pill (now DefaultItemContent's readout) reports 0 showing of the
    // full 10s source.
    await dragHandleBy(handle("vid", "right")!, -600);
    await waitFor(() => expect(width("vid")).toBeLessThanOrEqual(20));
    expect(
      nodeCard(canvasElement, "vid").querySelector("[data-trim-pill]")!.textContent
    ).toBe("0.00s / 10.00s");
  },
};

/** Play-less twin of TrimMediaWithHandles for e2e (real-mouse drag must not
 * race a play()). Same graph/scale so pixel-for-pixel assertions carry over. */
export const TrimPlayground: Story = {
  render: () => (
    <DndCollections initialGraph={trimGraph()} animateMoves={false}>
      <SelectOnMount id="vid" />
      <div className="flex w-[640px] flex-col gap-3">
        <UndoRedoControls />
        {/* Headroom for the floating overview tooltip. */}
        <div className="pt-16">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) =>
              node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
            }
            trimPixelsPerSecond={TRIM_PPS}
          />
        </div>
      </div>
    </DndCollections>
  ),
};

function trimmedGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        { kind: "media", id: "img", name: "Img", src: trimDogFrames[0], durationSeconds: 4 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          posterSrcs: trimDogFrames,
          fullDurationSeconds: 10,
          trimInSeconds: 2,
          trimOutSeconds: 1.5,
        },
        { kind: "media", id: "img2", name: "Img2", src: trimDogFrames[1], durationSeconds: 3 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Shows the amber source-window offset by an existing trim (2s in / 1.5s out),
 *  with the trimmed room dimmed on each side. Play-less. */
export const TrimOverviewShowcase: Story = {
  render: () => (
    <DndCollections initialGraph={trimmedGraph()} animateMoves={false}>
      <SelectOnMount id="vid" />
      <div className="flex w-[640px] flex-col gap-3">
        <UndoRedoControls />
        {/* Headroom for the floating overview tooltip. */}
        <div className="pt-16">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) =>
              node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
            }
            trimPixelsPerSecond={TRIM_PPS}
          />
        </div>
      </div>
    </DndCollections>
  ),
};

export const KeyboardTrim: Story = {
  // Alt+Shift+Arrows trim the focused media card without a drag, resolving to
  // the SAME update-media command the pointer handles dispatch. At TRIM_PPS
  // the card width IS the effective duration, so a resize proves the commit.
  // Horizontal = the end edge (all media); vertical = the video start edge.
  render: () => (
    <DndCollections initialGraph={trimGraph()} animateMoves={false}>
      <div className="flex w-[640px] flex-col gap-2">
        <UndoRedoControls />
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemWidthFor={(node) =>
            node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
          }
          trimPixelsPerSecond={TRIM_PPS}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const width = (id: string) =>
      Math.round(nodeCard(canvasElement, id).getBoundingClientRect().width);
    const undoButton = () => canvas.getByRole("button", { name: /undo/i });

    const img = nodeCard(canvasElement, "img");
    await waitForLayout(img);
    // img 4s -> 96px, vid 10s -> 240px.
    expect(width("img")).toBe(96);
    expect(width("vid")).toBe(240);

    // END edge on the image: right lengthens (+1s -> 120px), left shortens.
    await user.click(img);
    await user.keyboard("{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}");
    await waitFor(() => expect(width("img")).toBe(120));
    await user.keyboard("{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}");
    await waitFor(() => expect(width("img")).toBe(96));

    // Trims are ordinary undoable commands.
    await user.click(undoButton());
    await waitFor(() => expect(width("img")).toBe(120));

    // Images have no START edge — Alt+Shift+ArrowUp announces, doesn't resize.
    await user.click(img);
    await user.keyboard("{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}");
    expect(await canvas.findByText(/images can only be trimmed at the end/i)).toBeInTheDocument();
    expect(width("img")).toBe(120);

    // END edge on the video: left shortens (trim-out +1s -> 9s -> 216px).
    const vid = nodeCard(canvasElement, "vid");
    await user.click(vid);
    await user.keyboard("{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}");
    await waitFor(() => expect(width("vid")).toBe(216));

    // START edge on the video: up trims the start (trim-in +1s -> 8s -> 192px);
    // down gives it back (-> 9s -> 216px).
    await user.keyboard("{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}");
    await waitFor(() => expect(width("vid")).toBe(192));
    await user.keyboard("{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}");
    await waitFor(() => expect(width("vid")).toBe(216));
  },
};

// Phase B fixture: a strip WIDE enough to scroll (needed for the right-edge
// anchor — a left-handle drag grows the item and shifts scrollLeft to hold
// the right edge, which only has room on a scrollable strip), with a video at
// index 3 (trim-in 3s of a 10s source -> effective 7s -> 168px) flanked by
// image neighbors on both sides.
function phaseBGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < 3; i++) {
    children.push({ kind: "media", id: `l${i}`, name: `L${i}`, src: trimDogFrames[0], durationSeconds: 4 });
  }
  children.push({
    kind: "media",
    mediaKind: "video",
    id: "vid",
    name: "Vid",
    posterSrcs: trimDogFrames,
    fullDurationSeconds: 10,
    trimInSeconds: 3,
    trimOutSeconds: 0,
  });
  for (let i = 0; i < 10; i++) {
    children.push({ kind: "media", id: `r${i}`, name: `R${i}`, src: trimDogFrames[1], durationSeconds: 4 });
  }
  const result = buildGraph([{ kind: "collection", id: "strip", name: "Strip", children }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function PhaseBHarness() {
  return (
    <DndCollections initialGraph={phaseBGraph()} animateMoves={false}>
      <SelectOnMount id="vid" />
      <div className="flex w-[640px] flex-col gap-3">
        <UndoRedoControls />
        {/* Headroom for the floating overview tooltip. */}
        <div className="pt-16">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) =>
              node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
            }
            trimPixelsPerSecond={TRIM_PPS}
          />
        </div>
      </div>
    </DndCollections>
  );
}

export const LeftHandleGrowsLeft: Story = {
  // Phase B: dragging the video's LEFT handle leftward grows the clip toward
  // the left — its RIGHT edge stays anchored, its left edge follows the
  // cursor, and left neighbors are pushed left while right neighbors stay put.
  // The mechanic is targeted resizeItem + a scrollLeft shift (no card
  // re-renders, no mid-drag graph commit).
  render: () => <PhaseBHarness />,
  play: async ({ canvasElement }) => {
    const rect = (id: string) => nodeCard(canvasElement, id).getBoundingClientRect();
    const width = (id: string) => Math.round(rect(id).width);
    const handle = (id: string, side: "left" | "right") =>
      nodeCard(canvasElement, id)
        .closest("[data-node-wrapper]")!
        .querySelector<HTMLElement>(`[data-trim-handle="${side}"]`)!;
    const holdHandleBy = async (el: HTMLElement, dx: number) => {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const x = r.left + r.width / 2;
      await dispatchPointerSequence([
        { element: el, type: "pointerdown", clientX: x, clientY: y },
        { element: document, type: "pointermove", clientX: x + dx, clientY: y, delayAfterMs: 40 },
      ]);
    };
    const release = async () => {
      await dispatchPointerSequence([
        { element: document, type: "pointerup", clientX: 0, clientY: 0, delayAfterMs: 30 },
      ]);
    };
    const undoButton = () => within(canvasElement).getByRole("button", { name: /undo/i });

    await waitForLayout(nodeCard(canvasElement, "vid"));
    // vid effective 7s -> 168px; left neighbor L2 and right neighbor R0 mount.
    expect(width("vid")).toBe(168);

    const vidRight0 = rect("vid").right;
    const l2Right0 = rect("l2").right;
    const r0Left0 = rect("r0").left;
    // A left-side bystander (offset unchanged by resizeItem AND not moved by
    // the drag geometry beyond the shared scroll shift) — its memoized card
    // must not re-render during the gesture.
    const bystander = nodeCard(canvasElement, "l1");
    const renderCount0 = bystander.getAttribute("data-render-count");

    // Drag the LEFT handle LEFT by 48px -> trim-in 3s -> 1s -> effective 9s
    // -> 216px (grew by 48). Hold, without releasing, to inspect the live
    // anchored state.
    await holdHandleBy(handle("vid", "left"), -48);
    await waitFor(() => expect(width("vid")).toBe(216));

    // Right edge anchored (within a rounding px); left neighbor pushed left by
    // the growth; right neighbor stays put.
    expect(Math.abs(rect("vid").right - vidRight0)).toBeLessThanOrEqual(1);
    expect(Math.round(rect("l2").right)).toBe(Math.round(l2Right0 - 48));
    expect(Math.round(rect("r0").left)).toBe(Math.round(r0Left0));
    // Overview window (vid is selected) stays aligned to the clip through the
    // scroll-anchored drag.
    {
      const w = canvasElement.querySelector<HTMLElement>("[data-trim-overview-window]")!.getBoundingClientRect();
      const v = rect("vid");
      expect(Math.round(w.left)).toBe(Math.round(v.left));
      expect(Math.round(w.right)).toBe(Math.round(v.right));
    }
    // Perf guard: no bystander re-render during the live trim.
    expect(bystander.getAttribute("data-render-count")).toBe(renderCount0);

    // Nothing committed yet.
    expect(undoButton()).toBeDisabled();

    // Release commits it; the right edge stays anchored (no flash) and the
    // width holds at 216.
    await release();
    await waitFor(() => expect(undoButton()).toBeEnabled());
    expect(width("vid")).toBe(216);
    expect(Math.abs(rect("vid").right - vidRight0)).toBeLessThanOrEqual(1);

    // Ordinary undoable command.
    const user = userEvent.setup();
    await user.click(undoButton());
    await waitFor(() => expect(width("vid")).toBe(168));
  },
};

export const LeftHandleShrinkStaysAnchored: Story = {
  // Regression: dragging the left handle to the RIGHT (trimming in / shrinking)
  // keeps the clip's RIGHT edge anchored and moves its LEFT edge right —
  // CONSISTENTLY, even at the strip start where scrollLeft can't go negative.
  // The previous imperative-scroll anchor clamped at 0 there and the right
  // edge shrank inward instead (inconsistent). The anchor is now a composited
  // transform (unclamped) applied atomically with the resize (no per-frame
  // scroll write — smooth). Proven here by scrollLeft staying 0 throughout.
  render: () => <PhaseBHarness />,
  play: async ({ canvasElement }) => {
    const rect = (id: string) => nodeCard(canvasElement, id).getBoundingClientRect();
    const width = (id: string) => Math.round(rect(id).width);
    const handle = (id: string, side: "left" | "right") =>
      nodeCard(canvasElement, id)
        .closest("[data-node-wrapper]")!
        .querySelector<HTMLElement>(`[data-trim-handle="${side}"]`)!;
    const holdHandleBy = async (el: HTMLElement, dx: number) => {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const x = r.left + r.width / 2;
      await dispatchPointerSequence([
        { element: el, type: "pointerdown", clientX: x, clientY: y },
        { element: document, type: "pointermove", clientX: x + dx, clientY: y, delayAfterMs: 40 },
      ]);
    };
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;

    await waitForLayout(nodeCard(canvasElement, "vid"));
    expect(width("vid")).toBe(168);
    expect(strip.scrollLeft).toBe(0); // at the start — the old clamp case
    const vidRight0 = rect("vid").right;
    const vidLeft0 = rect("vid").left;

    // Drag the LEFT handle RIGHT +48 -> trim-in 3s -> 5s -> effective 5s -> 120px.
    await holdHandleBy(handle("vid", "left"), 48);
    await waitFor(() => expect(width("vid")).toBe(120));

    // Right edge stays anchored; the LEFT edge moves right by the shrink — NOT
    // the right edge shrinking inward. And no scroll was written (smooth).
    expect(Math.abs(rect("vid").right - vidRight0)).toBeLessThanOrEqual(1);
    expect(Math.round(rect("vid").left)).toBe(Math.round(vidLeft0 + 48));
    expect(strip.scrollLeft).toBe(0);

    // Abort leaves the graph untouched and reverts the view.
    await dispatchPointerSequence([
      { element: document, type: "pointercancel", clientX: 0, clientY: 0, delayAfterMs: 30 },
    ]);
    await waitFor(() => expect(width("vid")).toBe(168));
    expect(Math.round(rect("vid").right)).toBe(Math.round(vidRight0));
  },
};

/** Play-less twin of LeftHandleGrowsLeft for the real-mouse e2e. */
export const PhaseBPlayground: Story = {
  render: () => <PhaseBHarness />,
};

function OverviewHarness() {
  return (
    <DndCollections initialGraph={trimmedGraph()} animateMoves={false}>
      <SelectOnMount id="vid" />
      <div className="flex w-[640px] flex-col gap-3">
        <UndoRedoControls />
        {/* Headroom for the floating overview tooltip. */}
        <div className="pt-16">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) =>
              node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
            }
            trimPixelsPerSecond={TRIM_PPS}
          />
        </div>
      </div>
    </DndCollections>
  );
}

export const OverviewHandlesAndMove: Story = {
  // Phase B.2: the overview is interactive. Its amber grips TRIM the clip
  // (right grip = trim-out here) — the SAME update-media the card handles
  // dispatch — and dragging the filmstrip body MOVES the source window
  // (trim-in/out shift together, showing constant) so the clip width doesn't
  // change but a different part of the source lands in the window. The window
  // stays locked on the clip throughout; on a move the source slides under it.
  render: () => <OverviewHarness />,
  play: async ({ canvasElement }) => {
    const rect = (id: string) => nodeCard(canvasElement, id).getBoundingClientRect();
    const width = (id: string) => Math.round(rect(id).width);
    const overview = () => canvasElement.querySelector<HTMLElement>("[data-trim-overview]")!;
    const windowRect = () =>
      canvasElement.querySelector<HTMLElement>("[data-trim-overview-window]")!.getBoundingClientRect();
    const grip = (side: "left" | "right") =>
      canvasElement.querySelector<HTMLElement>(`[data-trim-overview-handle="${side}"]`)!;
    const holdElBy = async (el: HTMLElement, dx: number) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      await dispatchPointerSequence([
        { element: el, type: "pointerdown", clientX: x, clientY: y },
        { element: document, type: "pointermove", clientX: x + dx, clientY: y, delayAfterMs: 40 },
      ]);
    };
    const release = async () => {
      await dispatchPointerSequence([
        { element: document, type: "pointerup", clientX: 0, clientY: 0, delayAfterMs: 30 },
      ]);
    };
    const undoButton = () => within(canvasElement).getByRole("button", { name: /undo/i });
    const user = userEvent.setup();

    await waitForLayout(nodeCard(canvasElement, "vid"));
    // vid: full 10s, trim-in 2s, trim-out 1.5s -> showing 6.5s -> 156px.
    expect(width("vid")).toBe(156);
    // Overview window sits on the clip.
    expect(Math.round(windowRect().left)).toBe(Math.round(rect("vid").left));
    expect(Math.round(windowRect().right)).toBe(Math.round(rect("vid").right));

    // 1) RIGHT grip trims trim-out: drag it in (left) 48px -> trim-out +2s ->
    //    showing 4.5s -> 108px. The clip's LEFT edge is anchored (right-side
    //    trim), and the window shrinks with the clip.
    await holdElBy(grip("right"), -48);
    await waitFor(() => expect(width("vid")).toBe(108));
    expect(Math.round(windowRect().right)).toBe(Math.round(rect("vid").right));
    await release();
    await waitFor(() => expect(undoButton()).toBeEnabled());
    expect(width("vid")).toBe(108);
    await user.click(undoButton());
    await waitFor(() => expect(width("vid")).toBe(156));

    // 2) MOVE: drag the filmstrip body right 48px (+2s) -> trim-in 2s -> 0s,
    //    trim-out 1.5s -> 3.5s. Showing (and the clip width) is UNCHANGED; the
    //    clip doesn't move; the window stays on it; the source filmstrip slides
    //    right (its content-space left grows as trim-in shrinks).
    const vidLeft0 = rect("vid").left;
    const overviewLeft0 = overview().getBoundingClientRect().left;
    await holdElBy(overview(), 48); // grabs the filmstrip body, not a grip
    await waitFor(() => {
      expect(overview().getBoundingClientRect().left).toBeGreaterThan(overviewLeft0 + 40);
    });
    expect(width("vid")).toBe(156); // duration unchanged
    expect(Math.round(rect("vid").left)).toBe(Math.round(vidLeft0)); // clip didn't move
    expect(Math.round(windowRect().left)).toBe(Math.round(rect("vid").left)); // window on clip
    await release();
    await waitFor(() => expect(undoButton()).toBeEnabled());
    expect(width("vid")).toBe(156);
  },
};

/** Play-less twin of OverviewHandlesAndMove for the real-mouse e2e. */
export const OverviewPlayground: Story = {
  render: () => <OverviewHarness />,
};

// Edge case: a video trimmed from the START is the FIRST item (index 0).
function firstItemTrimmedGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          posterSrcs: trimDogFrames,
          fullDurationSeconds: 10,
          trimInSeconds: 3,
          trimOutSeconds: 1,
        },
        { kind: "media", id: "img", name: "Img", src: trimDogFrames[0], durationSeconds: 4 },
        { kind: "media", id: "img2", name: "Img2", src: trimDogFrames[1], durationSeconds: 3 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const FirstItemTrimmedFromStart: Story = {
  // EDGE CASE (play-less, visual). A video trimmed 3s off the start (full 10s,
  // trim-in 3s, trim-out 1s -> showing 6s -> 144px) is the FIRST item, and is
  // selected — so the strip reserves a LEADING GUTTER (trim-in * pps = 72px)
  // that insets the first clip and gives the overview's trimmed-in room a place
  // to render INSIDE the scrollable area. Without the gutter the overview would
  // anchor at `item.start - trimIn*pps = -72px` and the room would be clipped
  // left of the origin. The gutter is transient — it's only present while this
  // first item is selected (see FirstItemGutterOnSelect for that behavior).
  render: () => (
    <DndCollections initialGraph={firstItemTrimmedGraph()} animateMoves={false}>
      <SelectOnMount id="vid" />
      <div className="flex w-[640px] flex-col gap-3">
        <UndoRedoControls />
        {/* Headroom for the floating overview tooltip. */}
        <div className="pt-16">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) =>
              node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
            }
            trimPixelsPerSecond={TRIM_PPS}
          />
        </div>
      </div>
    </DndCollections>
  ),
};

function FirstItemGutterControls() {
  const store = useCollectionsStore();
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => store.setSelection([parseNodeId("vid")])}>
        select
      </button>
      <button type="button" onClick={() => store.setSelection([])}>
        unselect
      </button>
    </div>
  );
}

export const FirstItemGutterOnSelect: Story = {
  // The leading gutter for a trimmed first item appears ONLY while that item is
  // selected, and vanishes when it isn't — matching the overview's own
  // selection-gating. Selecting insets the first clip by trim-in (3s*24=72px)
  // and un-clips the overview's room; unselecting restores the origin. The
  // overview is a floating tooltip, so showing it never displaces the row.
  render: () => (
    <DndCollections initialGraph={firstItemTrimmedGraph()} animateMoves={false}>
      <div className="flex w-[640px] flex-col gap-3">
        <FirstItemGutterControls />
        {/* Headroom for the floating overview tooltip. */}
        <div className="pt-16">
          <VirtualStrip
            collectionId={parseNodeId("strip")}
            itemWidthFor={(node) =>
              node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
            }
            trimPixelsPerSecond={TRIM_PPS}
          />
        </div>
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const vidLeft = () => Math.round(nodeCard(canvasElement, "vid").getBoundingClientRect().left);
    const overview = () => canvasElement.querySelector<HTMLElement>("[data-trim-overview]");
    const contentLeft = () =>
      Math.round(
        canvasElement
          .querySelector<HTMLElement>('[data-virtual-strip="strip"] [role="row"]')!
          .getBoundingClientRect().left
      );

    await waitForLayout(nodeCard(canvasElement, "vid"));
    // Deselected: no overview, no gutter — the first clip sits at the origin.
    expect(overview()).toBeNull();
    const originLeft = vidLeft();

    // Select the first item: the overview appears AND the clip insets by the
    // gutter (trim-in 3s * 24 = 72px).
    await user.click(canvas.getByRole("button", { name: /^select$/i }));
    await waitFor(() => {
      expect(overview()).not.toBeNull();
      expect(vidLeft()).toBe(originLeft + 72);
    });
    // The room is no longer clipped: the overview's left edge is at/after the
    // strip's content origin (it was 72px left of it before).
    expect(overview()!.getBoundingClientRect().left).toBeGreaterThanOrEqual(contentLeft() - 1);

    // Unselect: gutter gone, first clip back at the origin.
    await user.click(canvas.getByRole("button", { name: /^unselect$/i }));
    await waitFor(() => {
      expect(overview()).toBeNull();
      expect(vidLeft()).toBe(originLeft);
    });
  },
};

// ── pixelsPerSecond sizing + the overlay slot (Phase: sizing unification) ──

function ppsGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        { kind: "media", id: "img", name: "Img", durationSeconds: 4 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          fullDurationSeconds: 10,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
        { kind: "collection", id: "folder", name: "Folder", children: [] },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const PixelsPerSecondSizing: Story = {
  // pixelsPerSecond is THE scale: media widths derive from duration, trim
  // handles inherit the same conversion (no separate trimPixelsPerSecond,
  // no itemWidthFor), collections keep the fixed itemWidth — and a trim
  // commit/undo reconciles slot widths through the TARGETED resize path
  // (the nodes-updated patch resizes exactly the touched slot).
  render: () => (
    <DndCollections initialGraph={ppsGraph()} animateMoves={false}>
      <div className="flex w-[640px] flex-col gap-3">
        <UndoRedoControls />
        <VirtualStrip collectionId={parseNodeId("strip")} pixelsPerSecond={24} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const width = (id: string) =>
      Math.round(nodeCard(canvasElement, id).getBoundingClientRect().width);
    await waitForLayout(nodeCard(canvasElement, "vid"));

    // Media widths = duration * pps; collections keep the fixed itemWidth.
    expect(width("img")).toBe(96);
    expect(width("vid")).toBe(240);
    expect(width("folder")).toBe(128);

    // Trim handles inherited the scale: right edge in 48px -> trim-out +2s
    // -> 8s -> 192px, live before release and held after commit.
    const handleEl = nodeCard(canvasElement, "vid")
      .closest("[data-node-wrapper]")!
      .querySelector<HTMLElement>('[data-trim-handle="right"]')!;
    const start = rectCenter(handleEl);
    await dispatchPointerSequence([
      { element: handleEl, type: "pointerdown", clientX: start.x, clientY: start.y },
      { element: document, type: "pointermove", clientX: start.x - 48, clientY: start.y, delayAfterMs: 30 },
    ]);
    await waitFor(() => expect(width("vid")).toBe(192));
    await dispatchPointerSequence([
      { element: document, type: "pointerup", clientX: start.x - 48, clientY: start.y, delayAfterMs: 30 },
    ]);
    const undoButton = within(canvasElement).getByRole("button", { name: /undo/i });
    await waitFor(() => expect(undoButton).toBeEnabled());
    expect(width("vid")).toBe(192);

    // Undo arrives as a nodes-updated patch too: the targeted resize
    // restores exactly this slot to 240px.
    const user = userEvent.setup();
    await user.click(undoButton);
    await waitFor(() => expect(width("vid")).toBe(240));
  },
};

function playheadGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "strip",
      name: "Strip",
      children: [
        { kind: "media", id: "img", name: "Img", durationSeconds: 4 },
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          fullDurationSeconds: 10,
          trimInSeconds: 2,
          trimOutSeconds: 0,
        },
        { kind: "collection", id: "folder", name: "Folder", children: [] },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function PlayheadOverlayExample() {
  return (
    <DndCollections initialGraph={playheadGraph()} animateMoves={false}>
      <SelectOnMount id="vid" />
      <div className="w-[320px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          pixelsPerSecond={24}
          overlay={
            <div
              data-playhead
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: durationToWidth(5, 24),
                width: 2,
                background: "red",
              }}
            />
          }
        />
      </div>
    </DndCollections>
  );
}

export const PlayheadOverlay: Story = {
  // The overlay slot renders in CONTENT coordinates: a playhead placed with
  // the shared durationToWidth scale sits at its exact content x and rides
  // scrolling for free — its viewport position shifts by exactly the scroll
  // while its content-relative offset never changes.
  render: () => <PlayheadOverlayExample />,
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "img"));
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    const playhead = () => canvasElement.querySelector<HTMLElement>("[data-playhead]")!;
    const spacer = playhead().closest("[data-virtual-overlay]")!.parentElement as HTMLElement;
    const contentOffset = () =>
      playhead().getBoundingClientRect().left - spacer.getBoundingClientRect().left;

    expect(Math.round(contentOffset())).toBe(120); // durationToWidth(5, 24)

    // Scroll the strip: the playhead rides the content — viewport position
    // shifts by exactly the scroll, content-relative offset is unchanged.
    const viewportBefore = playhead().getBoundingClientRect().left;
    strip.scrollLeft = 60;
    await waitFor(() => {
      expect(Math.round(playhead().getBoundingClientRect().left)).toBe(
        Math.round(viewportBefore - 60)
      );
    });
    expect(Math.round(contentOffset())).toBe(120);
  },
};

/** Play-less twin for real-pointer left-trim anchoring assertions. */
export const PlayheadOverlayPlayground: Story = {
  render: () => <PlayheadOverlayExample />,
};

export const ConsumerFloorLivePreview: Story = {
  // The live trim preview routes through the SAME width resolution as the
  // committed layout: a consumer itemWidthFor with its OWN floor (60px here)
  // governs mid-drag widths too, so an over-drag can't dip to the package's
  // 12px minimum and snap back up on release — the MIN_ITEM_WIDTH bug class,
  // one level up, closed for arbitrary consumer mappings.
  render: () => (
    <DndCollections initialGraph={ppsGraph()} animateMoves={false}>
      <div className="w-[640px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemWidthFor={(node) =>
            node.kind === "media" ? Math.max(60, mediaDurationSeconds(node) * 24) : undefined
          }
          trimPixelsPerSecond={24}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const width = () =>
      Math.round(nodeCard(canvasElement, "vid").getBoundingClientRect().width);
    await waitForLayout(nodeCard(canvasElement, "vid"));
    expect(width()).toBe(240);

    const handleEl = nodeCard(canvasElement, "vid")
      .closest("[data-node-wrapper]")!
      .querySelector<HTMLElement>('[data-trim-handle="right"]')!;
    const start = rectCenter(handleEl);

    // Over-drag far past the floor and HOLD: the LIVE width clamps at the
    // consumer's 60px, not the package's 12px minimum.
    await dispatchPointerSequence([
      { element: handleEl, type: "pointerdown", clientX: start.x, clientY: start.y },
      { element: document, type: "pointermove", clientX: start.x - 600, clientY: start.y, delayAfterMs: 30 },
    ]);
    await waitFor(() => expect(width()).toBe(60));

    // Release: no snap — the committed width equals the last preview.
    await dispatchPointerSequence([
      { element: document, type: "pointerup", clientX: start.x - 600, clientY: start.y, delayAfterMs: 30 },
    ]);
    await waitFor(() => expect(width()).toBe(60));
  },
};
