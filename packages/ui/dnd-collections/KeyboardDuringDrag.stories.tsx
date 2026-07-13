import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { buildGraph, parseNodeId } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { CollectionPanels } from "./react/node-views";
import { nodeCard, panelOrder, waitForLayout } from "./stories-helpers";

function graph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "panel",
      name: "Panel",
      children: [
        {
          kind: "media",
          id: "alpha",
          name: "Alpha",
          durationSeconds: 4,
        },
        {
          kind: "media",
          id: "bravo",
          name: "Bravo",
          durationSeconds: 4,
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const meta = {
  title: "UI/DndCollectionsKeyboardDuringDrag",
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

export const AltCommandsDoNotMutateDuringDrag: Story = {
  render: () => (
    <DndCollections initialGraph={graph()} animateMoves={false}>
      <CollectionPanels collectionIds={[parseNodeId("panel")]} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(alpha);
    alpha.focus();

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
      ).not.toBeNull();
    });

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(panelOrder(canvasElement, "panel")).toEqual(["alpha", "bravo"]);

    await user.keyboard("{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}");
    expect(nodeCard(canvasElement, "alpha")).toHaveTextContent("4s");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector('[data-testid="drag-ghost"]')
      ).toBeNull();
    });
  },
};
