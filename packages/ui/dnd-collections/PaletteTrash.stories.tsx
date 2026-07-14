import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { buildGraph, parseNodeId, type CollectionItemNode, type GraphNodeSpec } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { CollectionPanels } from "./react/node-views";
import { UndoRedoControls } from "./react/history-views";
import { PaletteItem } from "./react/palette";
import { TrashTarget } from "./react/trash-target";
import {
  dragHoldAt,
  dragToPoint,
  nodeCard,
  panelOrder,
  rectCenter,
  rectPoint,
  releaseAt,
  waitForLayout,
} from "./stories-helpers";

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
let nextCollectionId = 0;

function PaletteBoard() {
  return (
    // animateMoves off: these stories fire back-to-back drops, and a card
    // still mid-FLIP would report an animated rect that disagrees with its
    // droppable rect, landing a follow-up drop on the wrong side.
    <DndCollections initialGraph={paletteGraph()} animateMoves={false}>
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
          <PaletteItem
            paletteId="new-collection"
            createNode={() => {
              nextCollectionId += 1;
              return {
                id: parseNodeId(`col-${nextCollectionId}`),
                kind: "collection",
                name: `Collection ${nextCollectionId}`,
              };
            }}
          >
            + New collection
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

export const InvalidTrashIdIsDisabled: Story = {
  render: () => (
    <DndCollections initialGraph={paletteGraph()} animateMoves={false}>
      <TrashTarget trashId={parseNodeId("alpha")} />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const target = canvasElement.querySelector<HTMLElement>('[data-trash-target="alpha"]')!;
    expect(target.dataset.trashValid).toBe("false");
    expect(target.getAttribute("aria-disabled")).toBe("true");
  },
};

/** Play-less twin for e2e (real mouse must not race an auto-running play). */
export const PalettePlayground: Story = {
  render: () => <PaletteBoard />,
};

export const PaletteDropAddsNewNode: Story = {
  render: () => <PaletteBoard />,
  play: async ({ canvasElement }) => {
    const palette = canvasElement.querySelector<HTMLElement>('[data-palette-item="new-image"]')!;
    const bravo = nodeCard(canvasElement, "bravo");
    await waitForLayout(bravo);

    // Drop on bravo's left half: the new node inserts BEFORE bravo — the
    // full intent pipeline applies to palette drags, not just append. Read
    // the minted id from the DOM rather than predicting the factory counter
    // (which drifts across retries/prior stories).
    await dragToPoint(palette, rectPoint(bravo, 0.15));
    await waitFor(() => {
      const order = panelOrder(canvasElement, "panel-a");
      expect(order).toHaveLength(4);
      expect(order[0]).toBe("alpha");
      expect(order[1]).toMatch(/^img-/);
      expect(order.slice(2)).toEqual(["bravo", "charlie"]);
    });
    const firstId = panelOrder(canvasElement, "panel-a")[1];
    // Drop cleanup: the palette path ends the drag in the store, so no
    // indicator/highlight lingers and drag-gated behaviors are disarmed.
    expect(
      canvasElement.querySelectorAll("[data-drop-indicator],[data-nest-state]").length
    ).toBe(0);

    // A second drag mints a FRESH id (factory runs per pick-up).
    await dragToPoint(palette, rectPoint(nodeCard(canvasElement, "charlie"), 0.85));
    await waitFor(() => {
      const order = panelOrder(canvasElement, "panel-a");
      expect(order).toHaveLength(5);
      expect(order.slice(0, 4)).toEqual(["alpha", firstId, "bravo", "charlie"]);
      expect(order[4]).toMatch(/^img-/);
    });
    const secondId = panelOrder(canvasElement, "panel-a")[4];
    expect(secondId).not.toBe(firstId);

    // Adds are first-class history: undo removes the newest node.
    const user = userEvent.setup();
    await user.click(within(canvasElement).getByRole("button", { name: /undo/i }));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", firstId, "bravo", "charlie"]);
    });
  },
};

export const PaletteDropAddsNewCollection: Story = {
  // §11: a brand-new COLLECTION dragged in from the palette becomes a
  // sibling card — empty, and immediately a functional drop target (the
  // add-nodes patch gives it a children entry from birth).
  render: () => <PaletteBoard />,
  play: async ({ canvasElement }) => {
    const palette = canvasElement.querySelector<HTMLElement>(
      '[data-palette-item="new-collection"]'
    )!;
    const charlie = nodeCard(canvasElement, "charlie");
    await waitForLayout(charlie);

    // Drop on charlie's right half: the new collection inserts after it.
    // Read the minted id from the DOM (not the factory counter).
    await dragToPoint(palette, rectPoint(charlie, 0.85));
    await waitFor(() => {
      const order = panelOrder(canvasElement, "panel-a");
      expect(order.slice(0, 3)).toEqual(["alpha", "bravo", "charlie"]);
      expect(order[3]).toMatch(/^col-/);
    });
    const newId = panelOrder(canvasElement, "panel-a")[3];
    expect(nodeCard(canvasElement, newId).getAttribute("aria-label")).toMatch(
      /collection, 0 items/i
    );

    // The just-added collection accepts drops right away: nest alpha into it.
    await dragToPoint(nodeCard(canvasElement, "alpha"), rectCenter(nodeCard(canvasElement, newId)));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["bravo", "charlie", newId]);
      expect(nodeCard(canvasElement, newId).getAttribute("aria-label")).toMatch(
        /collection, 1 items/i
      );
    });
  },
};

export const PaletteFactoryErrorIsContained: Story = {
  // A palette factory is consumer code run inside dnd-kit's drag start. A
  // throwing OR malformed-returning factory must be contained, announced ONCE
  // (not followed by a contradictory "cancelled drag"), and leave the board
  // working.
  render: () => (
    <DndCollections initialGraph={paletteGraph()} animateMoves={false}>
      <div className="flex w-[640px] flex-col gap-4">
        <PaletteItem
          paletteId="invalid-duration"
          createNode={() => ({
            id: parseNodeId("invalid-duration"),
            kind: "media",
            name: "Invalid duration",
            durationSeconds: Number.NaN,
          })}
        >
          + Invalid duration
        </PaletteItem>
        <PaletteItem
          paletteId="boom"
          createNode={() => {
            throw new Error("factory boom");
          }}
        >
          + Throws
        </PaletteItem>
        <PaletteItem
          paletteId="nullish"
          createNode={(() => null) as unknown as () => CollectionItemNode}
        >
          + Returns null
        </PaletteItem>
        <CollectionPanels collectionIds={[parseNodeId("panel-a")]} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bravo = nodeCard(canvasElement, "bravo");
    await waitForLayout(bravo);

    // 1. Structurally plausible but invalid node data is rejected at pick-up,
    //    before drag state or an overlay can be published.
    const invalidDuration = canvasElement.querySelector<HTMLElement>(
      '[data-palette-item="invalid-duration"]'
    )!;
    await dragHoldAt(invalidDuration, rectPoint(bravo, 0.15));
    await expect(await canvas.findByText(/could not create item/i)).toBeInTheDocument();
    expect(canvas.queryByText(/picked up new/i)).toBeNull();
    await releaseAt(rectPoint(bravo, 0.15));
    expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "bravo", "charlie"]);

    // 2. Throwing factory: contained + announced while held...
    const boom = canvasElement.querySelector<HTMLElement>('[data-palette-item="boom"]')!;
    await dragHoldAt(boom, rectPoint(bravo, 0.15));
    await expect(await canvas.findByText(/could not create item/i)).toBeInTheDocument();
    await releaseAt(rectPoint(bravo, 0.15));
    // ...and releasing does NOT emit a second, contradictory cancel.
    expect(canvas.queryByText(/cancelled drag/i)).toBeNull();
    expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "bravo", "charlie"]);

    // 3. Factory returning a malformed value (null) is contained the same way
    //    — no crash reading node.name.
    const nullish = canvasElement.querySelector<HTMLElement>('[data-palette-item="nullish"]')!;
    await dragHoldAt(nullish, rectPoint(nodeCard(canvasElement, "charlie"), 0.85));
    await expect(await canvas.findByText(/could not create item/i)).toBeInTheDocument();
    await releaseAt(rectPoint(nodeCard(canvasElement, "charlie"), 0.85));
    expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "bravo", "charlie"]);

    // 4. The board still works: a normal reorder commits.
    await dragToPoint(
      nodeCard(canvasElement, "alpha"),
      rectPoint(nodeCard(canvasElement, "charlie"), 0.85)
    );
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["bravo", "charlie", "alpha"]);
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
    <DndCollections initialGraph={nestedGraph()} animateMoves={false}>
      <div className="flex w-[640px] flex-col gap-4">
        <UndoRedoControls />
        <CollectionPanels
          collectionIds={[parseNodeId("panel-a"), parseNodeId("folder-f")]}
        />
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

export const TrashViaKeyboard: Story = {
  // Keyboard equivalent of TrashMoveAndRestore: Alt+Delete on the focused card
  // moves it to trash with no pointer — announces, lands focus on the neighbor
  // that took its slot, and undo restores it.
  render: () => <PaletteBoard />,
  play: async ({ canvasElement }) => {
    const trash = canvasElement.querySelector<HTMLElement>("[data-trash-target]")!;
    await waitForLayout(nodeCard(canvasElement, "bravo"));

    const user = userEvent.setup();
    nodeCard(canvasElement, "bravo").focus();

    // The chord is EXACTLY Alt+Delete — a held Shift is left for the app/
    // browser and must not trash. (If it did, the assertions below would see
    // two items in trash and the wrong panel order.)
    await user.keyboard("{Alt>}{Shift>}{Delete}{/Shift}{/Alt}");
    expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "bravo", "charlie"]);

    await user.keyboard("{Alt>}{Delete}{/Alt}");

    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "charlie"]);
      expect(trash.textContent).toMatch(/trash \(1\)/i);
    });
    // Announced to the polite live region.
    await expect(
      await within(canvasElement).findByText(/moved "bravo" to trash/i)
    ).toBeInTheDocument();
    // Focus followed to the sibling that took the vacated slot (charlie).
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-node-id")).toBe("charlie");
    });

    // Undo restores it — nothing was deleted.
    await user.click(within(canvasElement).getByRole("button", { name: /undo/i }));
    await waitFor(() => {
      expect(panelOrder(canvasElement, "panel-a")).toEqual(["alpha", "bravo", "charlie"]);
      expect(trash.textContent).toMatch(/^trash$/i);
    });
  },
};
