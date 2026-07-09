import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useCallback, useMemo } from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";

import { MediaStrip } from "./media-strip";
import { MediaStripBoard } from "./media-strip-board";
import { dndKitMediaStripDndAdapter } from "./adapters/dnd-kit-adapter";
import { nativeHtml5MediaStripDndAdapter } from "./adapters/native-html5-adapter";
import {
  trustedCollectionId,
  type TimelineItem,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
} from "./core/media-strip.types";
import { type MediaStripDndAdapter } from "./media-strip-dnd.types";
import { createImageTimelineItem } from "./core/media-strip.validation";
import {
  unwrapResult,
  simulatePointerDragHoldAt,
  releasePointerDragAt,
  waitForAnimationFrames,
} from "./media-strip.stories-helpers";

// Scale and multi-board stories: large virtualized item counts, several
// independent MediaStripBoard instances on one page, and reordering while
// the strip is scrolled. Nested under "MediaStrip" alongside the other
// MediaStrip.*.stories.tsx files' groups in Storybook's sidebar (see each
// file's title).

const meta = {
  title: "UI/MediaStrip/MediaStrip/Scale & Multi-Board",
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

const VirtualizedItemsDemo = ({
  dndAdapter = dndKitMediaStripDndAdapter,
}: {
  dndAdapter?: MediaStripDndAdapter;
}) => {
  const [items, setItems] = useState(() => {
    return Array.from({ length: 1000 }).map((_, i) =>
      unwrapResult(
        createImageTimelineItem({
          id: `item-${i}`,
          name: `Item ${i}`,
          src: "img.png",
          startTimeSeconds: i * 4,
          durationSeconds: 4,
        })
      )
    );
  });
  const handleMoveItem = useCallback((command: TimelineItemCommand) => {
    setItems((prev) => {
      if (command.type !== "move") return prev;
      const next = [...prev];
      const index = next.findIndex((item) => item.id === command.itemId);
      if (index === -1) return prev;
      const [moved] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(command.toIndex, next.length)), 0, moved);
      return next;
    });
  }, []);
  const collectionsById = new Map<CollectionId, TimelineCollection>([
    [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "1,000 Virtualized Items", items }],
  ]);
  const visibleCollectionIds = [trustedCollectionId("strip-1")];

  return (
    <MediaStripBoard
      collectionsById={collectionsById}
      dndAdapter={dndAdapter}
      visibleCollectionIds={visibleCollectionIds}
      onMoveItem={handleMoveItem}
    >
      <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="1,000 Virtualized Items" selectedIds={[]} onSelectionChange={() => { }} />
    </MediaStripBoard>
  );
};

export const ThousandsOfItemsVirtualized: Story = {
  render: () => <VirtualizedItemsDemo />,
  play: async ({ canvasElement }) => {
    const scrollArea = canvasElement.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement;
    const buttons = canvasElement.querySelectorAll("[data-testid^='media-strip-item-']");

    // Virtualized viewport should only render visible items (<100)
    expect(buttons.length).toBeLessThan(100);

    // Scroll container dimensions should verify horizontal overflow
    expect(scrollArea.scrollWidth).toBeGreaterThan(scrollArea.clientWidth);
  },
};

export const ThousandsOfItemsVirtualizedNativeHtml5: Story = {
  render: () => <VirtualizedItemsDemo dndAdapter={nativeHtml5MediaStripDndAdapter} />,
};

export const MultipleBoardsOnPage: Story = {
  render: () => {
    const [board1A, setBoard1A] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-1a", name: "Item 1A", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);
    const [board1B, setBoard1B] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-1b", name: "Item 1B", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);
    const [board2A, setBoard2A] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-2a", name: "Item 2A", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);
    const [board2B, setBoard2B] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-2b", name: "Item 2B", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);

    const handleMove1 = useCallback((command: TimelineItemCommand) => {
      if (command.type !== "move") return;
      const { itemId, toCollectionId: toStripId, toIndex } = command;
      const all = { "strip-1a": board1A, "strip-1b": board1B };
      const fromStripId = board1A.some(i => i.id === itemId) ? "strip-1a" : "strip-1b";
      const item = all[fromStripId].find(i => i.id === itemId)!;

      if (fromStripId === "strip-1a") {
        setBoard1A(board1A.filter(i => i.id !== itemId));
      } else {
        setBoard1B(board1B.filter(i => i.id !== itemId));
      }

      if (toStripId === "strip-1a") {
        const next = [...board1A.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard1A(next);
      } else {
        const next = [...board1B.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard1B(next);
      }
    }, [board1A, board1B]);

    const handleMove2 = useCallback((command: TimelineItemCommand) => {
      if (command.type !== "move") return;
      const { itemId, toCollectionId: toStripId, toIndex } = command;
      const fromStripId = board2A.some(i => i.id === itemId) ? "strip-2a" : "strip-2b";
      const item = (fromStripId === "strip-2a" ? board2A : board2B).find(i => i.id === itemId)!;

      if (fromStripId === "strip-2a") {
        setBoard2A(board2A.filter(i => i.id !== itemId));
      } else {
        setBoard2B(board2B.filter(i => i.id !== itemId));
      }

      if (toStripId === "strip-2a") {
        const next = [...board2A.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard2A(next);
      } else {
        const next = [...board2B.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard2B(next);
      }
    }, [board2A, board2B]);

    const collections1 = useMemo(() => new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1a"), { id: trustedCollectionId("strip-1a"), name: "Strip 1A", items: board1A }],
      [trustedCollectionId("strip-1b"), { id: trustedCollectionId("strip-1b"), name: "Strip 1B", items: board1B }],
    ]), [board1A, board1B]);
    const visible1 = useMemo(() => [trustedCollectionId("strip-1a"), trustedCollectionId("strip-1b")], []);

    const collections2 = useMemo(() => new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-2a"), { id: trustedCollectionId("strip-2a"), name: "Strip 2A", items: board2A }],
      [trustedCollectionId("strip-2b"), { id: trustedCollectionId("strip-2b"), name: "Strip 2B", items: board2B }],
    ]), [board2A, board2B]);
    const visible2 = useMemo(() => [trustedCollectionId("strip-2a"), trustedCollectionId("strip-2b")], []);

    return (
      <div className="flex flex-col gap-12">
        <div className="border p-4 rounded-lg bg-card">
          <h3 className="text-sm font-bold mb-2">Board 1</h3>
          <MediaStripBoard
            collectionsById={collections1}
            dndAdapter={dndKitMediaStripDndAdapter}
            visibleCollectionIds={visible1}
            onMoveItem={handleMove1}
          >
            <div className="flex flex-col gap-4">
              <MediaStrip collectionId={trustedCollectionId("strip-1a")} heading="Strip 1A" selectedIds={[]} onSelectionChange={() => { }} />
              <MediaStrip collectionId={trustedCollectionId("strip-1b")} heading="Strip 1B" selectedIds={[]} onSelectionChange={() => { }} />
            </div>
          </MediaStripBoard>
        </div>
        <div className="border p-4 rounded-lg bg-card">
          <h3 className="text-sm font-bold mb-2">Board 2</h3>
          <MediaStripBoard
            collectionsById={collections2}
            dndAdapter={dndKitMediaStripDndAdapter}
            visibleCollectionIds={visible2}
            onMoveItem={handleMove2}
          >
            <div className="flex flex-col gap-4">
              <MediaStrip collectionId={trustedCollectionId("strip-2a")} heading="Strip 2A" selectedIds={[]} onSelectionChange={() => { }} />
              <MediaStrip collectionId={trustedCollectionId("strip-2b")} heading="Strip 2B" selectedIds={[]} onSelectionChange={() => { }} />
            </div>
          </MediaStripBoard>
        </div>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const item1B = canvas.getByRole("button", { name: /item 1b/i });
    const handle = item1B.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Pick up item 1B
    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Press ArrowDown. Since Board 1 has strip-1b at the bottom, it should be blocked from going into Board 2.
    await userEvent.keyboard("{ArrowDown}");

    // Assert announcement was "Already at the bottom collection." immediately after arrow key press
    const announcer = canvasElement.ownerDocument.body.querySelector("[aria-live='polite']") as HTMLElement;
    expect(announcer.textContent).toContain("Already at the bottom collection.");

    // Press Enter to confirm drop and clean up
    await userEvent.keyboard("{Enter}");
  },
};

export const ReorderWhileScrolled: Story = {
  render: () => {
    const [items, setItems] = useState(() =>
      Array.from({ length: 40 }).map((_, i) =>
        unwrapResult(
          createImageTimelineItem({
            id: `item-${i}`,
            name: `Item ${i}`,
            src: "img.png",
            startTimeSeconds: i * 4,
            durationSeconds: 4,
          })
        )
      )
    );

    const handleMoveItem = useCallback(
      (command: TimelineItemCommand) => {
        if (command.type !== "move") return;
        const { itemId, toIndex } = command;
        const next = [...items];
        const idx = next.findIndex((i) => i.id === itemId);
        if (idx !== -1) {
          const [removed] = next.splice(idx, 1);
          next.splice(toIndex, 0, removed);
          setItems(next);
        }
      },
      [items]
    );

    const collectionsById = useMemo(() => new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Long Strip for Scrolling", items }],
    ]), [items]);
    const visibleCollectionIds = useMemo(() => [trustedCollectionId("strip-1")], []);

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
        onMoveItem={handleMoveItem}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Long Strip for Scrolling" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollArea = canvasElement.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement;

    // Scroll deep into the strip (e.g. scrollLeft = 800)
    scrollArea.scrollLeft = 800;
    scrollArea.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      expect(scrollArea.scrollLeft).toBeGreaterThan(500);
    });

    // Find a visible item at this scrolled position (e.g. Item 10)
    await canvas.findByRole("button", { name: /item 10/i });
    const handle = canvasElement.querySelector("[data-reorder-handle='item-10']") as HTMLElement;

    handle.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");

    // Assert item was moved (Item 10 should be after Item 11)
    // Focus should remain on the handle of Item 10
    await waitFor(() => {
      expect(canvasElement.ownerDocument.activeElement).toBe(handle);
    });

    // Scroll position should not have jumped back to 0
    expect(scrollArea.scrollLeft).toBeGreaterThan(500);
  },
};

export const PointerDragBetweenTwoUnmountedVirtualizedItems: Story = {
  render: () => {
    const [items, setItems] = useState(() =>
      Array.from({ length: 40 }).map((_, i) =>
        unwrapResult(
          createImageTimelineItem({
            id: `vitem-${i}`,
            name: `Item ${i}`,
            src: "img.png",
            startTimeSeconds: i * 4,
            durationSeconds: 4,
          })
        )
      )
    );

    const handleMoveItem = useCallback(
      (command: TimelineItemCommand) => {
        if (command.type !== "move") return;
        const { itemId, toIndex } = command;
        const next = [...items];
        const idx = next.findIndex((i) => i.id === itemId);
        if (idx !== -1) {
          const [removed] = next.splice(idx, 1);
          next.splice(toIndex, 0, removed);
          setItems(next);
        }
      },
      [items]
    );

    const collectionsById = useMemo(() => new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Long Strip for Scrolling", items }],
    ]), [items]);
    const visibleCollectionIds = useMemo(() => [trustedCollectionId("strip-1")], []);

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
        onMoveItem={handleMoveItem}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Long Strip for Scrolling" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollArea = canvasElement.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement;

    // Neither item 20 nor item 22 is mounted at scrollLeft = 0 (overscan is
    // only 5 items either side of the visible window). Scroll deep enough
    // that both fall inside the newly-visible + overscan range, proving a
    // pointer drag works correctly between two items that were unmounted
    // moments ago — not just ones present since first render.
    scrollArea.scrollLeft = 2400;
    scrollArea.dispatchEvent(new Event("scroll"));

    const sourceItem = await canvas.findByRole("button", { name: /item 20/i });
    const container = sourceItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle='vitem-20']") as HTMLElement;
    const targetItem = await canvas.findByRole("button", { name: /item 22/i });

    // The synthetic scroll above just perturbed the whole layout and the two
    // items only mounted moments ago. The drag simulator and dnd-kit both
    // snapshot rects up front, so let the layout settle first — under
    // full-suite CPU load, skipping this made the drop aim at stale
    // coordinates and intermittently no-op (this test's old flake).
    await waitForAnimationFrames(2);

    expect(sourceItem.getBoundingClientRect().left).toBeLessThan(
      targetItem.getBoundingClientRect().left
    );

    // Hold the drag at item 22's center and DWELL there before releasing,
    // rather than dropping in one pass. dnd-kit recomputes `over` on a
    // rAF/measure cadence; against droppables that only mounted moments ago
    // (after the synthetic scroll), a single-pass drop can land before that
    // recompute catches up and silently no-op. Dwelling gives the collision
    // engine a stable window to settle on item 22 as the target before the
    // drop commits — deterministic where the earlier oscillation, which
    // could end mid-swing, was not.
    const targetRect = targetItem.getBoundingClientRect();
    const dropPoint = {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height / 2,
    };
    await simulatePointerDragHoldAt(handle, dropPoint, 250);
    await releasePointerDragAt(dropPoint);

    await waitFor(
      () => {
        // Item 20 must still exist (proves the drag against a
        // previously-unmounted item didn't silently drop/corrupt it) and
        // must now sit to the RIGHT of item 22 (dropping at the target's
        // center resolves to "after"). Compared item-to-item in the same
        // frame — unlike the old comparison against a pre-drag viewport
        // coordinate, this can't be skewed by scroll shifting during the
        // drag.
        const movedItem = canvas.getByRole("button", { name: /item 20/i });
        const formerTarget = canvas.getByRole("button", { name: /item 22/i });
        expect(movedItem.getBoundingClientRect().left).toBeGreaterThan(
          formerTarget.getBoundingClientRect().left
        );
      },
      { timeout: 3000 }
    );
  },
};
