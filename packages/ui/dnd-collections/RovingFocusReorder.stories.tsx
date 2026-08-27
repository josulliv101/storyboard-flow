import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "@storyboard/collections-core/graph";
import { DndCollections } from "./react/DndCollections";
import { useCollectionsStore } from "./react/collections-store";
import { VirtualStrip } from "./virtual/VirtualStrip";
import { nodeCard, waitForLayout } from "./stories-helpers";

function graph() {
  const children: GraphNodeSpec[] = Array.from({ length: 8 }, (_, index) => ({
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

function ReorderFocusedItemButton() {
  const store = useCollectionsStore();
  return (
    <button
      type="button"
      onClick={() => {
        store.dispatch({
          type: "move-nodes",
          nodeIds: [parseNodeId("m1")],
          toParentId: parseNodeId("strip"),
          toIndex: 2,
        });
      }}
    >
      Reorder focused item
    </button>
  );
}

const meta = {
  title: "UI/DndCollectionsRovingFocusReorder",
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

export const RovingStopFollowsNodeAcrossReorder: Story = {
  render: () => (
    <DndCollections initialGraph={graph()} animateMoves={false}>
      <div className="flex w-[640px] flex-col gap-3">
        <ReorderFocusedItemButton />
        <VirtualStrip collectionId={parseNodeId("strip")} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const m1 = nodeCard(canvasElement, "m1");
    await waitForLayout(m1);
    m1.focus();
    await waitFor(() => expect(nodeCard(canvasElement, "m1").tabIndex).toBe(0));

    // HTMLElement.click() triggers the command without moving DOM focus away
    // from m1, reproducing a reorder initiated outside the roving key handler.
    canvasElement.querySelector<HTMLButtonElement>("button")!.click();
    await waitFor(() => {
      expect(
        nodeCard(canvasElement, "m1").closest("[data-virtual-index]")
      ).toHaveAttribute("data-virtual-index", "2");
      expect(nodeCard(canvasElement, "m1").tabIndex).toBe(0);
      expect(nodeCard(canvasElement, "m2").tabIndex).toBe(-1);
      expect(nodeCard(canvasElement, "m1").ownerDocument.activeElement).toBe(
        nodeCard(canvasElement, "m1")
      );
    });

    // m1 moved from index 1 to index 2, so Right must continue from its new
    // position and focus m3. An index-owned roving state lands back on m1.
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(nodeCard(canvasElement, "m3").ownerDocument.activeElement).toBe(
        nodeCard(canvasElement, "m3")
      );
    });
  },
};
