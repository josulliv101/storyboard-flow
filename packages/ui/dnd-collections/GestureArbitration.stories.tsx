import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import {
  buildGraph,
  mediaDurationSeconds,
  parseNodeId,
  type GraphNodeSpec,
} from "@storyboard/collections-core/graph";
import { DndCollections } from "./react/DndCollections";
import { VirtualStrip } from "./virtual/VirtualStrip";
import {
  dispatchPointerSequence,
  nodeCard,
  rectCenter,
  TRIM_ARM_SETTLE_MS,
  waitForLayout,
} from "./stories-helpers";

function graph() {
  const children: GraphNodeSpec[] = Array.from({ length: 12 }, (_, index) => ({
    kind: "media",
    id: `m${index}`,
    name: `Media ${index}`,
    durationSeconds: 4,
  }));
  const result = buildGraph([
    { kind: "collection", id: "strip", name: "Strip", children },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const meta = {
  title: "UI/DndCollectionsGestureArbitration",
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

export const PanMovementCancelsPendingHoldDrag: Story = {
  render: () => (
    <DndCollections initialGraph={graph()} animateMoves={false}>
      <div className="w-[480px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemDragActivation="hold"
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>(
      '[data-virtual-strip="strip"]'
    )!;
    const card = nodeCard(canvasElement, "m1");
    await waitForLayout(card);
    const start = rectCenter(card);

    // Six pixels crosses the pan's five-pixel slop. It must also cancel the
    // pending hold activation, even if the pointer then stays still beyond
    // the hold delay.
    await dispatchPointerSequence([
      {
        element: card,
        type: "pointerdown",
        clientX: start.x,
        clientY: start.y,
      },
      {
        element: card,
        type: "pointermove",
        clientX: start.x - 6,
        clientY: start.y,
        delayAfterMs: 320,
      },
    ]);

    expect(strip.scrollLeft).toBeGreaterThan(0);
    expect(
      canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
    ).toBeNull();

    await dispatchPointerSequence([
      {
        element: card,
        type: "pointerup",
        clientX: start.x - 6,
        clientY: start.y,
      },
    ]);
  },
};

/** The right handle of `m1`, which in this strip is a plain image clip. */
function trimHandle(canvasElement: HTMLElement): HTMLElement {
  return nodeCard(canvasElement, "m1")
    .closest("[data-node-wrapper]")!
    .querySelector<HTMLElement>('[data-trim-handle="right"]')!;
}

/** Card width IS duration at this scale, so a trim shows up as a width. */
const TRIM_PPS = 24;

/**
 * Trim handles need a TIME SCALE to exist — `trimPixelsPerSecond` is what
 * turns pointer pixels into seconds — and `itemWidthFor` is what makes the
 * strip draw clips at that scale instead of a fixed size. Twelve 4s clips at
 * 24px/s is 1152px inside a 480px viewport, so there is room to pan and the
 * scroll position means something.
 */
function TrimArbitrationStrip() {
  return (
    <DndCollections initialGraph={graph()} animateMoves={false}>
      <div className="w-[480px]">
        <VirtualStrip
          collectionId={parseNodeId("strip")}
          itemDragActivation="hold"
          itemWidthFor={(node) =>
            node.kind === "media" ? mediaDurationSeconds(node) * TRIM_PPS : undefined
          }
          trimPixelsPerSecond={TRIM_PPS}
        />
      </div>
    </DndCollections>
  );
}

/**
 * THE BUG THIS PAIR EXISTS FOR: panning the strip changed a clip's duration.
 *
 * Trim handles are 8px at each clip edge and always on with a mouse, so in a
 * flush strip every cut carries 16px where a press meant for the pan landed on
 * an edit instead. The cursor was the only warning, and touch has none.
 *
 * Here the press starts ON the handle and moves straight away — the shape of a
 * pan, not of an aim. The strip must scroll and the clip must come out exactly
 * as wide as it went in.
 */
export const MovingOffATrimHandlePansInstead: Story = {
  render: () => <TrimArbitrationStrip />,
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    const card = nodeCard(canvasElement, "m1");
    await waitForLayout(card);
    const handle = trimHandle(canvasElement);
    const start = rectCenter(handle);
    const widthBefore = Math.round(card.getBoundingClientRect().width);

    // Ten pixels, immediately: past the trim's 4px tolerance and past the
    // pan's 5px slop, with no dwell in between for the handle to arm in.
    await dispatchPointerSequence([
      { element: handle, type: "pointerdown", clientX: start.x, clientY: start.y },
      {
        element: document,
        type: "pointermove",
        clientX: start.x - 10,
        clientY: start.y,
        delayAfterMs: 320,
      },
      {
        element: document,
        type: "pointerup",
        clientX: start.x - 10,
        clientY: start.y,
        delayAfterMs: 40,
      },
    ]);

    expect(strip.scrollLeft).toBeGreaterThan(0);
    expect(handle.dataset.trimArmed).toBeUndefined();
    // The card moved with the scroll, so measure the WIDTH, which a trim
    // would have changed and a pan cannot.
    expect(Math.round(nodeCard(canvasElement, "m1").getBoundingClientRect().width)).toBe(
      widthBefore
    );
  },
};

/**
 * The other half: a press that SETTLES on the handle still trims, and once it
 * has, the pan stands down rather than scrolling underneath the edit.
 */
export const SettledTrimHandlePressStillTrims: Story = {
  render: () => <TrimArbitrationStrip />,
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>('[data-virtual-strip="strip"]')!;
    const card = nodeCard(canvasElement, "m1");
    await waitForLayout(card);
    const handle = trimHandle(canvasElement);
    const start = rectCenter(handle);
    const widthBefore = Math.round(card.getBoundingClientRect().width);

    await dispatchPointerSequence([
      // Hold still past the arm delay. The dwell is the whole gesture — take
      // it out and this story becomes the one above.
      {
        element: handle,
        type: "pointerdown",
        clientX: start.x,
        clientY: start.y,
        delayAfterMs: TRIM_ARM_SETTLE_MS,
      },
      {
        element: document,
        type: "pointermove",
        clientX: start.x - 40,
        clientY: start.y,
        delayAfterMs: 60,
      },
    ]);

    expect(handle.dataset.trimArmed).toBe("true");

    await dispatchPointerSequence([
      {
        element: document,
        type: "pointerup",
        clientX: start.x - 40,
        clientY: start.y,
        delayAfterMs: 60,
      },
    ]);

    expect(Math.round(nodeCard(canvasElement, "m1").getBoundingClientRect().width)).toBeLessThan(
      widthBefore
    );
    // The armed trim claimed the pointer, so the 40px never reached the pan.
    expect(strip.scrollLeft).toBe(0);
    expect(handle.dataset.trimArmed).toBeUndefined();
  },
};
