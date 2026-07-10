import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { CollectionPanels } from "./react/node-views";
import { UndoRedoControls } from "./react/history-views";
import { PaletteItem } from "./react/palette";
import { TrashTarget } from "./react/trash-target";
import { dragToPoint, nodeCard, panelOrder, rectCenter, rectPoint, waitForLayout } from "./stories-helpers";

// Phase 6 coverage: external palette sources (brand-new nodes committed as
// add-nodes) and trash (a hidden root collection fed by the ordinary move
// pipeline — undo restores, nothing is deleted).

const media = (id: string): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id.toUpperCase(),
  durationSeconds: 4,
});

function paletteGraph() {
  const result = buildGraph([
    { kind: "collection", id: "panel-a", name: "Panel A", children: [media("alpha"), media("bravo"), media("charlie")] },
    { kind: "collection", id: "trash", name: "Trash", children: [] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

let nextImageId = 0;

function PaletteBoard() {
  return (
    <DndCollections initialGraph={paletteGraph()}>
      <div className="flex w-[640px] flex-col gap-4">
        <UndoRedoControls />
        <div className="flex gap-2" data-testid="palette">
          <PaletteItem
            paletteId="new-image"
            createNode={() => {
              nextImageId += 1;
              return {
                id: parseNodeId(`img-${nextImageId}`),
                kind: "media",
                name: `Image ${nextImageId}`,
                durationSeconds: 4,
              };
            }}
          >
            + New image
          </PaletteItem>
        </div>
        {/* Trash is a root, but only panel-a renders as a panel — hidden collection. */}
        <CollectionPanels collectionIds={[parseNodeId("panel-a")]} />
        <TrashTarget trashId={parseNodeId("trash")} />
      </div>
    </DndCollections>
  );
}

const meta = {
  title: "UI/DndCollectionsPalette",
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

export const PaletteDropAddsNewNode: Story = {
  render: () => <PaletteBoard />,
  play: async ({ canvasElement }) => {
    const palette = canvasElement.querySelector<HTMLElement>('[data-palette-item="new-image"]')!;
    const bravo = nodeCard(canvasElement, "bravo");
    await waitForLayout(bravo);
    const startCount = nextImageId;

    // Drop on bravo's left half: the new node inserts BEFORE bravo — the
    // full intent pipeline applies to palette drags, not just append.
    await dragToPoint(palette, rectPoint(bravo, 0.15));
    const firstId = `img-${startCount + 1}`;
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", firstId, "bravo", "charlie"]);
    });

    // A second drag mints a FRESH id (factory runs per pick-up).
    await dragToPoint(palette, rectPoint(nodeCard(canvasElement, "charlie"), 0.85));
    const secondId = `img-${startCount + 2}`;
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual([
        "alpha", firstId, "bravo", "charlie", secondId,
      ]);
    });

    // Adds are first-class history: undo removes the newest node.
    const user = userEvent.setup();
    await user.click(within(canvasElement).getByRole("button", { name: /undo/i }));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", firstId, "bravo", "charlie"]);
    });
  },
};

function nestedGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "panel-a",
      name: "Panel A",
      children: [
        media("alpha"),
        {
          kind: "collection",
          id: "folder-f",
          name: "Folder F",
          children: [
            media("f1"),
            { kind: "collection", id: "sub", name: "Sub", children: [media("s1")] },
          ],
        },
      ],
    },
    { kind: "collection", id: "trash", name: "Trash", children: [] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const NestedCollectionMoveAndTrashSubtree: Story = {
  // §22: moving a NESTED collection (its subtree rides along), then
  // trashing a collection subtree — preserved in trash, undo restores.
  render: () => (
    <DndCollections initialGraph={nestedGraph()}>
      <div className="flex w-[640px] flex-col gap-4">
        <UndoRedoControls />
        <CollectionPanels collectionIds={[parseNodeId("panel-a"), parseNodeId("folder-f")]} />
        <TrashTarget trashId={parseNodeId("trash")} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const sub = nodeCard(canvasElement, "sub"); // card inside the folder-f panel
    const alpha = nodeCard(canvasElement, "alpha");
    await waitForLayout(sub);

    // Move the nested collection up a level: after alpha in panel-a.
    await dragToPoint(sub, rectPoint(alpha, 0.85));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "sub", "folder-f"]);
      expect(panelOrder(canvasElement, "folder-f")).toEqual(["f1"]);
      // Subtree preserved: sub still contains s1.
      expect(nodeCard(canvasElement, "sub").getAttribute("aria-label")).toMatch(
        /collection, 1 items/i
      );
    });

    // Trash the folder-f SUBTREE (f1 rides along; nothing is deleted).
    const trash = canvasElement.querySelector<HTMLElement>("[data-trash-target]")!;
    await dragToPoint(nodeCard(canvasElement, "folder-f"), rectCenter(trash));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "sub"]);
      expect(trash.textContent).toMatch(/trash \(1\)/i);
    });

    // Restore: the subtree comes back intact.
    const user = userEvent.setup();
    await user.click(within(canvasElement).getByRole("button", { name: /undo/i }));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "sub", "folder-f"]);
      expect(nodeCard(canvasElement, "folder-f").getAttribute("aria-label")).toMatch(
        /collection, 1 items/i
      );
    });
  },
};

export const TrashMoveAndRestore: Story = {
  render: () => <PaletteBoard />,
  play: async ({ canvasElement }) => {
    const bravo = nodeCard(canvasElement, "bravo");
    const trash = canvasElement.querySelector<HTMLElement>("[data-trash-target]")!;
    await waitForLayout(bravo);

    await dragToPoint(bravo, rectCenter(trash));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "charlie"]);
      expect(trash.textContent).toMatch(/trash \(1\)/i);
    });

    // Restore = undo; the node was moved, never deleted.
    const user = userEvent.setup();
    await user.click(within(canvasElement).getByRole("button", { name: /undo/i }));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "bravo", "charlie"]);
      expect(trash.textContent).toMatch(/^trash$/i);
    });
  },
};
