import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { VirtualStrip } from "./virtual/VirtualStrip";
import {
  dispatchPointerSequence,
  nodeCard,
  rectCenter,
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
