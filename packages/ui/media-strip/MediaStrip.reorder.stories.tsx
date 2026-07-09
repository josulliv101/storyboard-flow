import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useCallback, useMemo } from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";

import { MediaStrip, type MediaStripSelection } from "./media-strip";
import { MediaStripBoard } from "./media-strip-board";
import { dndKitMediaStripDndAdapter } from "./adapters/dnd-kit-adapter";
import { nativeHtml5MediaStripDndAdapter } from "./adapters/native-html5-adapter";
import { experimentalPragmaticMediaStripDndAdapter } from "./adapters/pragmatic-adapter";
import {
  trustedCollectionId,
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineCollectionsById,
  type TimelineItemCommand,
} from "./core/media-strip.types";
import { type MediaStripDndAdapter } from "./media-strip-dnd.types";
import { createImageTimelineItem } from "./core/media-strip.validation";
import { applyTimelineItemCommand } from "./core/media-strip.collection-ops";
import {
  unwrapResult,
  createImg,
  waitForLayout,
  simulatePointerDrag,
  simulatePointerDragToPoint,
  simulatePointerDragHoldAt,
  releasePointerDragAt,
  simulateDragOscillation,
  simulateScrollAreaDrag,
} from "./media-strip.stories-helpers";

// Cross-strip reordering, pointer/keyboard drag, and drop-into-empty-strip
// stories. Nested under "MediaStrip" alongside the other
// MediaStrip.*.stories.tsx files' groups in Storybook's sidebar (see each
// file's title).

const meta = {
  title: "UI/MediaStrip/MediaStrip/Reordering & Cross-Strip DnD",
  // Single shared decorator — story-level decorators STACK with this one, so
  // per-story copies double-wrap the canvas.
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const ReorderDemo = ({
  dndAdapter = dndKitMediaStripDndAdapter,
}: {
  dndAdapter?: MediaStripDndAdapter;
}) => {
  const [collections, setCollections] = useState<TimelineCollectionsById>(() =>
    new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-a"), {
        id: trustedCollectionId("strip-a"),
        name: "Media Strip A",
        items: [
          createImg("item-a1", "Item A1", "#f43f5e", 5),
          createImg("item-a2", "Item A2", "#ec4899", 6),
          createImg("item-a3", "Item A3", "#d946ef", 4),
        ],
      }],
      [trustedCollectionId("strip-b"), {
        id: trustedCollectionId("strip-b"),
        name: "Media Strip B",
        items: [
          createImg("item-b1", "Item B1", "#3b82f6", 5),
          createImg("item-b2", "Item B2", "#06b6d4", 7),
        ],
      }],
      [trustedCollectionId("strip-c"), {
        id: trustedCollectionId("strip-c"),
        name: "Media Strip C",
        items: [
          createImg("item-c1", "Item C1", "#10b981", 4),
          createImg("item-c2", "Item C2", "#059669", 5),
          createImg("item-c3", "Item C3", "#047857", 3),
          createImg("item-c4", "Item C4", "#14b8a6", 6),
          createImg("item-c5", "Item C5", "#0db9e8", 8),
          createImg("item-c6", "Item C6", "#f59e0b", 5),
          createImg("item-c7", "Item C7", "#d97706", 7),
          createImg("item-c8", "Item C8", "#b45309", 4),
        ],
      }],
    ])
  );

  const [selectedIds, setSelectedIds] = useState<TimelineItemId[]>([]);

  // Route every board command through the same pure reducer the package ships,
  // instead of re-implementing per-strip move logic in the demo.
  const handleMoveItem = useCallback((command: TimelineItemCommand) => {
    setCollections((prev) => {
      const result = applyTimelineItemCommand({ collectionsById: prev, command });
      return result.ok ? result.collectionsById : prev;
    });
  }, []);

  // selectedIds is shared across all three strips below. A naive
  // `onSelectionChange={(s) => setSelectedIds(s.selectedIds)}` would replace
  // the whole shared array with just this strip's selection, silently
  // clobbering whatever was selected in the other strips. MediaStripSelection
  // now carries `collectionId`, so this merges instead: drop only the ids
  // that belonged to the strip that just changed, keep everything else.
  const handleSelectionChange = useCallback((selection: MediaStripSelection) => {
    setSelectedIds((prev) => {
      const changedCollectionItemIds = new Set(
        collections.get(selection.collectionId)?.items.map((item) => item.id) ?? []
      );
      const otherStripsSelectedIds = prev.filter((id) => !changedCollectionItemIds.has(id));
      return [...otherStripsSelectedIds, ...selection.selectedIds];
    });
  }, [collections]);

  const visibleCollectionIds = useMemo(
    () => [trustedCollectionId("strip-a"), trustedCollectionId("strip-b"), trustedCollectionId("strip-c")],
    []
  );

  return (
    <MediaStripBoard
      collectionsById={collections}
      dndAdapter={dndAdapter}
      visibleCollectionIds={visibleCollectionIds}
      onMoveItem={handleMoveItem}
    >
      <div className="flex flex-col gap-8 p-4 bg-zinc-950 rounded-lg">
        <div>
          <p className="text-sm text-zinc-400 mb-2">
            Pointer instructions: Drag item from its grab handle (six dots) in the top-right and hover over target areas or empty strips.
            <br />
            Keyboard instructions: Focus the grab handle, press Enter or Space to activate Reorder Mode.
            Use ArrowLeft/Right to reorder, ArrowUp/Down to move between strips, Escape to cancel.
          </p>
        </div>
        <MediaStrip
          collectionId={trustedCollectionId("strip-a")}
          heading="Media Strip A (Red/Pink)"
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
        />
        <MediaStrip
          collectionId={trustedCollectionId("strip-b")}
          heading="Media Strip B (Blue/Cyan)"
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
        />
        <MediaStrip
          collectionId={trustedCollectionId("strip-c")}
          heading="Media Strip C (Green/Emerald with Lots of Items)"
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </MediaStripBoard>
  );
};

export const ReorderableMediaStrips: Story = {
  render: () => <ReorderDemo />,
};

export const SelectionSurvivesAcrossStrips: Story = {
  // Regression test for the selection-clobbering hazard MediaStripSelection
  // used to invite: onSelectionChange only ever reports the strip that
  // fired it, so a consumer using one shared selectedIds array across
  // multiple strips could blindly replace the whole array and silently
  // wipe out other strips' selections. `collectionId` on the payload lets
  // ReorderDemo's handleSelectionChange merge correctly instead — this
  // proves it actually does.
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const itemA1 = canvas.getByRole("button", { name: /item a1/i });
    const itemB1 = canvas.getByRole("button", { name: /item b1/i });

    await userEvent.click(itemA1);
    await waitFor(() => expect(itemA1).toHaveAttribute("aria-pressed", "true"));

    await userEvent.click(itemB1);
    await waitFor(() => expect(itemB1).toHaveAttribute("aria-pressed", "true"));

    // Selecting in Strip B must not have cleared Strip A's selection.
    expect(itemA1).toHaveAttribute("aria-pressed", "true");
  },
};

export const ReorderableMediaStripsPragmaticDnd: Story = {
  render: () => <ReorderDemo dndAdapter={experimentalPragmaticMediaStripDndAdapter} />,
};

export const ReorderableMediaStripsNativeHtml5: Story = {
  render: () => <ReorderDemo dndAdapter={nativeHtml5MediaStripDndAdapter} />,
};

export const MultiStripDragRegression: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    // Locate the first item reorder handle in the DOM
    const firstHandle = canvasElement.querySelector("[data-reorder-handle]") as HTMLElement;
    const targetItem = canvasElement.querySelector("[data-strip-id='strip-b'] [data-value]") as HTMLElement;
    if (!firstHandle || !targetItem) return;

    await simulateDragOscillation(firstHandle, targetItem);
  },
};

export const ReorderHandlesAreDistinguishableToScreenReaders: Story = {
  // Regression guard for the handle a11y fix: the long keyboard grammar
  // lives in an aria-describedby description (not the name), and that
  // description names its item so a screen reader user can tell handles
  // apart instead of hearing a wall of identical "Reorder handle".
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const a1Handle = canvasElement.querySelector("[data-reorder-handle='item-a1']") as HTMLElement;
    const a2Handle = canvasElement.querySelector("[data-reorder-handle='item-a2']") as HTMLElement;

    // The name is short and must NOT carry the instruction wall.
    expect(a1Handle.getAttribute("aria-label")).not.toMatch(/ArrowLeft/i);

    // aria-describedby is a space-separated id list (the adapter's own DnD
    // instructions plus ours); resolve and concatenate every referenced
    // element's text, the way a screen reader announces it.
    const resolveDescription = (handle: HTMLElement) => {
      const ids = (handle.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      expect(ids.length).toBeGreaterThan(0);
      return ids
        .map((id) => canvasElement.querySelector(`#${CSS.escape(id)}`)?.textContent ?? "")
        .join(" ");
    };

    const a1Desc = resolveDescription(a1Handle);
    const a2Desc = resolveDescription(a2Handle);

    // Our keyboard grammar lives in the description...
    expect(a1Desc).toMatch(/ArrowLeft\/Right to reorder/i);
    // ...and it names its own item (via the card's own name element),
    // distinctly per handle.
    expect(a1Desc).toMatch(/Item A1/);
    expect(a2Desc).toMatch(/Item A2/);
    expect(a1Desc).not.toMatch(/Item A2/);
  },
};

export const KeyboardReorderWithinStrip: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    handle.focus();
    await userEvent.keyboard(" ");

    // Reorder right: moves from index 0 -> index 1
    await userEvent.keyboard("{ArrowRight}");
    await expect(await canvas.findByText(/moved "item a1" to position 2/i)).toBeInTheDocument();

    // Reorder left: moves from index 1 -> index 0
    await userEvent.keyboard("{ArrowLeft}");
    await expect(await canvas.findByText(/moved "item a1" to position 1/i)).toBeInTheDocument();

    // Drop
    await userEvent.keyboard(" ");
    await expect(await canvas.findByText(/dropped "item a1" at position 1/i)).toBeInTheDocument();
  },
};

export const KeyboardReorderBetweenStrips: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Reorder down to Strip B
    await userEvent.keyboard("{ArrowDown}");
    await expect(await canvas.findByText(/moved "item a1" to collection "Media Strip B" at position/i)).toBeInTheDocument();
  },
};

export const KeyboardReorderCancel: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Move to position 2
    await userEvent.keyboard("{ArrowRight}");
    await expect(await canvas.findByText(/moved "item a1" to position 2/i)).toBeInTheDocument();

    // Cancel reorder using Escape, reverting the move
    await userEvent.keyboard("{Escape}");
    await expect(await canvas.findByText(/reverted "item a1" to position 1/i)).toBeInTheDocument();
  },
};

export const PointerDragWithinStrip: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const secondItem = canvas.getByRole("button", { name: /item a2/i });

    // Drag horizontally to index 1 over Item A2 using programmatic pointer events
    await simulatePointerDrag(handle, secondItem);

    await expect(await canvas.findByText(/dropped "item a1" at position/i)).toBeInTheDocument();
  },
};

export const PointerDragBetweenStrips: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const targetItem = canvas.getByRole("button", { name: /item b1/i });

    // Drag vertically down to Strip B over Item B1 using programmatic pointer events
    await simulatePointerDrag(handle, targetItem);

    await expect(await canvas.findByText(/dropped "item a1" at position/i)).toBeInTheDocument();
  },
};

const EmptyStripDropDemo = ({
  dndAdapter = dndKitMediaStripDndAdapter,
}: {
  dndAdapter?: MediaStripDndAdapter;
}) => {
  const [stripA, setStripA] = useState<TimelineItem[]>([
    unwrapResult(
      createImageTimelineItem({
        id: "item-1",
        name: "Item 1",
        src: "img.png",
        startTimeSeconds: 0,
        durationSeconds: 4,
      })
    ),
  ]);
  const [stripB, setStripB] = useState<TimelineItem[]>([]);

  const handleMoveItem = useCallback(
    (command: TimelineItemCommand) => {
      if (command.type !== "move") return;
      const { itemId, toCollectionId: toStripId } = command;
      const item = stripA.find((i) => i.id === itemId);
      if (item && toStripId === "strip-b") {
        setStripB([item]);
        setStripA([]);
      }
    },
    [stripA]
  );

  const collectionsById = useMemo(() => new Map<CollectionId, TimelineCollection>([
    [trustedCollectionId("strip-a"), { id: trustedCollectionId("strip-a"), name: "Strip A", items: stripA }],
    [trustedCollectionId("strip-b"), { id: trustedCollectionId("strip-b"), name: "Strip B", items: stripB }],
  ]), [stripA, stripB]);
  const visibleCollectionIds = useMemo(() => [trustedCollectionId("strip-a"), trustedCollectionId("strip-b")], []);

  return (
    <MediaStripBoard
      collectionsById={collectionsById}
      dndAdapter={dndAdapter}
      visibleCollectionIds={visibleCollectionIds}
      onMoveItem={handleMoveItem}
    >
      <div className="flex flex-col gap-8 p-4">
        <MediaStrip collectionId={trustedCollectionId("strip-a")} heading="Strip A" selectedIds={[]} onSelectionChange={() => { }} />
        <MediaStrip collectionId={trustedCollectionId("strip-b")} heading="Strip B" selectedIds={[]} onSelectionChange={() => { }} />
      </div>
    </MediaStripBoard>
  );
};

export const PointerDragIntoEmptyStrip: Story = {
  render: () => <EmptyStripDropDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item 1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;
    const emptyDroppable = canvasElement.querySelector("[data-strip-id='strip-b'] .border-dashed") as HTMLElement;

    // Drag down to empty Strip B droppable container using programmatic pointer events
    await simulatePointerDrag(handle, emptyDroppable);

    await waitFor(() => {
      const stripB = canvasElement.querySelector("[data-strip-id='strip-b']") as HTMLElement;
      expect(within(stripB).queryByText(/no media items yet/i)).not.toBeInTheDocument();
      expect(within(stripB).getByRole("button", { name: /item 1/i })).toBeInTheDocument();
    });
  },
};

export const PointerDragIntoEmptyStripNativeHtml5: Story = {
  render: () => <EmptyStripDropDemo dndAdapter={nativeHtml5MediaStripDndAdapter} />,
};

export const SelectedItemRemainsSelected: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });

    // Select the first item by focusing it and pressing Enter
    firstItem.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(firstItem).toHaveAttribute("aria-pressed", "true");
    });

    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;
    handle.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");

    // Assert that the item remains selected after reordering
    const movedItem = await canvas.findByRole("button", { name: /item a1/i });
    await waitFor(() => {
      expect(movedItem).toHaveAttribute("aria-pressed", "true");
    });
  },
};

export const DraggingScrollAreaDoesNotSelect: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollArea = canvasElement.querySelector("[data-testid^='media-strip-drag-scroll-']") as HTMLElement;

    // Perform a pointer drag on the scroll area background to scroll it using programmatic pointer events
    await simulateScrollAreaDrag(scrollArea);

    // Assert that selection remains unchanged
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    await expect(firstItem).not.toHaveAttribute("aria-pressed", "true");
  },
};

export const ReorderHandleArrowKeysDoNotNavigate: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Focus the reorder handle
    handle.focus();

    // Press ArrowRight (WITHOUT entering reorder mode first)
    await userEvent.keyboard("{ArrowRight}");

    // Focus should remain on the handle, NOT jump to the next item
    await expect(canvasElement.ownerDocument.activeElement).toBe(handle);
  },
};

export const KeyboardReorderBoundaryAnnouncements: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Focus and activate reorder
    handle.focus();
    await userEvent.keyboard("{Enter}");

    // 1. Move Left at first item
    await userEvent.keyboard("{ArrowLeft}");
    const announcer = canvasElement.ownerDocument.body.querySelector("[aria-live='polite']") as HTMLElement;
    expect(announcer.textContent).toContain("Already first in collection.");

    // 2. Move Up at top strip
    await userEvent.keyboard("{ArrowUp}");
    expect(announcer.textContent).toContain("Already at the top collection.");

    // Confirm reorder
    await userEvent.keyboard("{Enter}");
  },
};

export const EscapeCancelAcrossStrips: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Pick up item a1 from Strip A (index 0)
    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Move to Strip B (ArrowDown)
    await userEvent.keyboard("{ArrowDown}");

    // Move within Strip B (ArrowRight)
    await userEvent.keyboard("{ArrowRight}");

    // Cancel (Escape)
    await userEvent.keyboard("{Escape}");

    // Assert it returned to Strip A at index 0
    const stripA = canvasElement.querySelector("[data-strip-id='strip-a']") as HTMLElement;
    await waitFor(() => {
      expect(within(stripA).getByRole("button", { name: /item a1/i })).toBeInTheDocument();
    });
  },
};

export const PointerDragCancelLeavesModelUnchanged: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const secondItem = canvas.getByRole("button", { name: /item a2/i });

    // dnd-kit's own closest-center collision search has no distance cutoff,
    // so dropping far away still resolves to *some* target rather than
    // `over: null` — pressing Escape mid-drag (dnd-kit's PointerSensor
    // handles this natively) is the real way a pointer drag gets cancelled.
    await waitForLayout(secondItem);
    const targetRect = secondItem.getBoundingClientRect();
    await simulatePointerDragHoldAt(
      handle,
      { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 },
      100
    );
    // dnd-kit's PointerSensor checks `event.code` (not `event.key`) for its
    // built-in Escape-to-cancel handling.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));

    await expect(await canvas.findByText(/^cancelled drag\.$/i)).toBeInTheDocument();

    // The model must be untouched: item a1 is still Strip A's first item.
    const stripA = canvasElement.querySelector("[data-strip-id='strip-a']") as HTMLElement;
    const stripAButtons = within(stripA).getAllByRole("button", { name: /item a/i });
    await expect(stripAButtons[0].getAttribute("aria-label")).toMatch(/item a1/i);
  },
};

export const PointerDragBeforeTargetInsertsBeforeIt: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const thirdItem = canvas.getByRole("button", { name: /item a3/i });

    // Regression test for the drop-placement fix: dropping on the LEFT
    // quarter of a.3 must insert a1 immediately BEFORE it ([a2, a1, a3]),
    // not always "at a3's raw index" (which used to land one slot off).
    await waitForLayout(thirdItem);
    const targetRect = thirdItem.getBoundingClientRect();
    await simulatePointerDragToPoint(handle, {
      x: targetRect.left + targetRect.width * 0.15,
      y: targetRect.top + targetRect.height / 2,
    });

    const stripA = canvasElement.querySelector("[data-strip-id='strip-a']") as HTMLElement;
    await waitFor(() => {
      const names = within(stripA)
        .getAllByRole("button", { name: /item a/i })
        .map((el) => el.getAttribute("aria-label"));
      expect(names[0]).toMatch(/item a2/i);
      expect(names[1]).toMatch(/item a1/i);
      expect(names[2]).toMatch(/item a3/i);
    });
  },
};

export const PointerDragAfterTargetInsertsAfterIt: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const thirdItem = canvas.getByRole("button", { name: /item a3/i });

    // Regression test for the drop-placement fix: dropping on the RIGHT
    // quarter of a3 must insert a1 immediately AFTER it ([a2, a3, a1]).
    // Before the fix, a same-collection forward drag like this used a's
    // raw (pre-removal) target index as the post-removal insertion index,
    // landing one slot too far right of where "after a3" actually is.
    await waitForLayout(thirdItem);
    const targetRect = thirdItem.getBoundingClientRect();
    await simulatePointerDragToPoint(handle, {
      x: targetRect.left + targetRect.width * 0.85,
      y: targetRect.top + targetRect.height / 2,
    });

    const stripA = canvasElement.querySelector("[data-strip-id='strip-a']") as HTMLElement;
    await waitFor(() => {
      const names = within(stripA)
        .getAllByRole("button", { name: /item a/i })
        .map((el) => el.getAttribute("aria-label"));
      expect(names[0]).toMatch(/item a2/i);
      expect(names[1]).toMatch(/item a3/i);
      expect(names[2]).toMatch(/item a1/i);
    });
  },
};

export const PointerDragShowsBeforeAfterIndicator: Story = {
  render: () => <ReorderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const thirdItem = canvas.getByRole("button", { name: /item a3/i });

    await waitForLayout(thirdItem);
    const targetRect = thirdItem.getBoundingClientRect();
    const thirdItemWrapper = thirdItem.closest(".group") as HTMLElement;

    try {
      // Hold over the LEFT quarter of item a3 and verify the "before" bar shows.
      await simulatePointerDragHoldAt(
        handle,
        { x: targetRect.left + targetRect.width * 0.15, y: targetRect.top + targetRect.height / 2 },
        150
      );
      await waitFor(() => {
        expect(thirdItemWrapper.querySelector('[data-drop-indicator="before"]')).not.toBeNull();
        expect(thirdItemWrapper.querySelector('[data-drop-indicator="after"]')).toBeNull();
      });

      // Move to the RIGHT quarter and verify the indicator flips to "after".
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          pointerId: 1,
          isPrimary: true,
          clientX: targetRect.left + targetRect.width * 0.85,
          clientY: targetRect.top + targetRect.height / 2,
        })
      );
      await waitFor(() => {
        expect(thirdItemWrapper.querySelector('[data-drop-indicator="after"]')).not.toBeNull();
        expect(thirdItemWrapper.querySelector('[data-drop-indicator="before"]')).toBeNull();
      });
    } finally {
      await releasePointerDragAt({ x: targetRect.left + targetRect.width * 0.85, y: targetRect.top + targetRect.height / 2 });
    }
  },
};

export const PointerDragIntoEmptyStripWithOtherItemsOnBoard: Story = {
  // Regression test for a collision-detection bug: getClosestCenterCollisions
  // has no distance cutoff, so a naive "fall back to container backgrounds
  // only when zero item collisions exist" strategy is effectively dead code
  // whenever ANY other item exists anywhere on the board — it would always
  // find "some item, somewhere" first. Unlike EmptyStripDropDemo (which has
  // only one item on the entire board, accidentally avoiding this), this
  // fixture has items in strips A and C so the empty strip B must win on
  // its own merits (the pointer is actually within it), not because
  // nothing else was available to match.
  render: () => {
    const [collections, setCollections] = useState<TimelineCollectionsById>(() =>
      new Map<CollectionId, TimelineCollection>([
        [trustedCollectionId("multi-a"), {
          id: trustedCollectionId("multi-a"), name: "Strip A",
          items: [createImg("multi-a1", "Item A1", "#f43f5e", 5), createImg("multi-a2", "Item A2", "#ec4899", 6)],
        }],
        [trustedCollectionId("multi-b-empty"), { id: trustedCollectionId("multi-b-empty"), name: "Strip B (Empty)", items: [] }],
        [trustedCollectionId("multi-c"), {
          id: trustedCollectionId("multi-c"), name: "Strip C",
          items: [createImg("multi-c1", "Item C1", "#10b981", 4), createImg("multi-c2", "Item C2", "#059669", 5)],
        }],
      ])
    );

    const handleMoveItem = useCallback((command: TimelineItemCommand) => {
      setCollections((prev) => {
        const result = applyTimelineItemCommand({ collectionsById: prev, command });
        return result.ok ? result.collectionsById : prev;
      });
    }, []);

    const visibleCollectionIds = useMemo(
      () => [trustedCollectionId("multi-a"), trustedCollectionId("multi-b-empty"), trustedCollectionId("multi-c")],
      []
    );

    return (
      <MediaStripBoard
        collectionsById={collections}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
        onMoveItem={handleMoveItem}
      >
        <div className="flex flex-col gap-8 p-4">
          <MediaStrip collectionId={trustedCollectionId("multi-a")} heading="Strip A" selectedIds={[]} onSelectionChange={() => { }} />
          <MediaStrip collectionId={trustedCollectionId("multi-b-empty")} heading="Strip B (Empty)" selectedIds={[]} onSelectionChange={() => { }} />
          <MediaStrip collectionId={trustedCollectionId("multi-c")} heading="Strip C" selectedIds={[]} onSelectionChange={() => { }} />
        </div>
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const emptyDroppable = canvasElement.querySelector("[data-strip-id='multi-b-empty'] .border-dashed") as HTMLElement;

    await simulatePointerDrag(handle, emptyDroppable);

    await waitFor(() => {
      const stripB = canvasElement.querySelector("[data-strip-id='multi-b-empty']") as HTMLElement;
      expect(within(stripB).getByRole("button", { name: /item a1/i })).toBeInTheDocument();
    });

    // And it must be gone from Strip A, not merely duplicated.
    const stripA = canvasElement.querySelector("[data-strip-id='multi-a']") as HTMLElement;
    expect(within(stripA).queryByRole("button", { name: /item a1/i })).not.toBeInTheDocument();
  },
};

export const ShortStripDroppableFillsWideContainer: Story = {
  // Regression test for a droppable-sizing bug: the non-empty-strip
  // droppable (the ToggleGroup in media-strip.tsx) is also the
  // container-background droppable for this strip
  // (setViewportAndDroppableRef attaches both refs to the same node) — but
  // it used to be sized to its *content* width, not the visible viewport.
  // A short strip in a wide container had dead space to the right of its
  // last item that simply wasn't part of any droppable, unlike the
  // empty-state branch (a plain div with no explicit width, which
  // naturally fills its parent).
  //
  // This asserts the geometry directly rather than simulating a drag into
  // that dead space: dnd-kit's "closest item anywhere" fallback (see the
  // detectCollision invariant in ARCHITECTURE.md) means a drag dropped near
  // a short strip's only item still resolves correctly via that fallback
  // regardless of this bug, as long as no *other* item is fortuitously
  // closer — which makes an end-to-end drop assertion an unreliable way to
  // pin this down. The actual guarantee this fix provides is a geometric
  // one: the droppable's rendered width, not an emergent property of
  // whichever item happens to be nearest.
  render: () => {
    const [collections] = useState<TimelineCollectionsById>(() =>
      new Map<CollectionId, TimelineCollection>([
        [trustedCollectionId("whitespace-target"), {
          id: trustedCollectionId("whitespace-target"), name: "Target (short)",
          items: [createImg("whitespace-tgt-1", "Target Item", "#3b82f6", 2)],
        }],
      ])
    );

    const visibleCollectionIds = useMemo(() => [trustedCollectionId("whitespace-target")], []);

    return (
      <MediaStripBoard
        collectionsById={collections}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
      >
        <MediaStrip collectionId={trustedCollectionId("whitespace-target")} heading="Target (short)" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="w-[1200px] border border-blue-500/25 p-2 rounded">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const targetItem = canvas.getByRole("button", { name: /target item/i });
    await waitForLayout(targetItem);

    const scrollArea = canvasElement.querySelector("[data-scroll-area='true']") as HTMLElement;
    const droppable = canvasElement.querySelector("[data-slot='toggle-group']") as HTMLElement;
    expect(scrollArea).toBeTruthy();
    expect(droppable).toBeTruthy();

    const scrollAreaWidth = scrollArea.getBoundingClientRect().width;
    const droppableWidth = droppable.getBoundingClientRect().width;
    const itemWidth = targetItem.getBoundingClientRect().width;

    // The single item alone is nowhere near the viewport's width, so this
    // only passes if the droppable is actually stretched to fill the
    // viewport, not merely sized to fit the item.
    expect(itemWidth).toBeLessThan(scrollAreaWidth / 2);
    expect(droppableWidth).toBeGreaterThanOrEqual(scrollAreaWidth - 1);
  },
};


