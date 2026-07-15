import { useDroppable } from "@dnd-kit/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec, type NodeId } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { CollectionPanels } from "./react/node-views";
import { VIRTUAL_INSERT_DATA_KEY } from "./react/virtual-droppable";
import { dragToPoint, nodeCard, panelOrder, rectCenter, waitForLayout } from "./stories-helpers";

const media = (id: string): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id.toUpperCase(),
  durationSeconds: 4,
});

function collisionGraph() {
  const result = buildGraph([
    { kind: "collection", id: "panel-a", name: "Panel A", children: [media("alpha")] },
    { kind: "collection", id: "panel-b", name: "Panel B", children: [] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function VirtualFailureTarget({
  id,
  collectionId,
  resolveBoundary,
}: {
  id: string;
  collectionId: NodeId;
  resolveBoundary: () => number;
}) {
  const { setNodeRef } = useDroppable({
    id,
    data: {
      [VIRTUAL_INSERT_DATA_KEY]: {
        collectionId,
        resolveBoundary,
      },
    },
  });

  return (
    <div
      ref={setNodeRef}
      data-virtual-failure-target={id}
      style={{ border: "1px solid currentColor", height: 80, width: 180 }}
    >
      {id}
    </div>
  );
}

function CollisionCoverageHarness() {
  return (
    <DndCollections initialGraph={collisionGraph()} animateMoves={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <CollectionPanels collectionIds={[parseNodeId("panel-a"), parseNodeId("panel-b")]} />
        <div style={{ display: "flex", gap: 16 }}>
          <VirtualFailureTarget
            id="throwing-boundary"
            collectionId={parseNodeId("panel-b")}
            resolveBoundary={() => {
              throw new Error("boundary failure");
            }}
          />
          <VirtualFailureTarget
            id="non-integer-boundary"
            collectionId={parseNodeId("panel-b")}
            resolveBoundary={() => Number.NaN}
          />
          <VirtualFailureTarget
            id="missing-collection"
            collectionId={parseNodeId("missing")}
            resolveBoundary={() => 0}
          />
        </div>
      </div>
    </DndCollections>
  );
}

const meta = {
  title: "UI/DndCollections/CollisionCoverage",
  render: () => <CollisionCoverageHarness />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const InvalidVirtualTargetsCancelSafely: Story = {
  play: async ({ canvasElement }) => {
    const targetIds = ["throwing-boundary", "non-integer-boundary", "missing-collection"];
    await waitForLayout(nodeCard(canvasElement, "alpha"));

    for (const targetId of targetIds) {
      const target = canvasElement.querySelector<HTMLElement>(
        `[data-virtual-failure-target="${targetId}"]`
      )!;
      await waitForLayout(target);
      await dragToPoint(nodeCard(canvasElement, "alpha"), rectCenter(target));
      await waitFor(() => {
        expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha"]);
        expect(panelOrder(canvasElement, "panel-b")).toEqual([]);
        expect(
          canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
        ).toBeNull();
        expect(
          canvasElement.querySelectorAll("[data-drop-indicator], [data-nest-state]")
        ).toHaveLength(0);
      });
    }
  },
};
