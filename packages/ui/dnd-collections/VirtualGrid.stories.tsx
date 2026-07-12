import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { PaletteItem } from "./react/palette";
import { VirtualGrid } from "./virtual/VirtualGrid";
import { VirtualStrip } from "./virtual/VirtualStrip";
import {
  dragToPoint,
  gapBetween,
  nodeCard,
  nodeHandle,
  rectCenter,
  waitForLayout,
} from "./stories-helpers";

// Phase 5 coverage: a fixed-cell, row-virtualized grid — 1,000 nodes with a
// bounded DOM, and gap drops resolving through 2D boundary math into the
// same insert-at-index pipeline the strip uses.

const ITEM_COUNT = 1000;
const COLUMNS = 4;
const ROW_SIZE = 96 + 8;

function gridGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    children.push({ kind: "media", id: `m${i}`, name: `M${i}`, durationSeconds: 4 });
  }
  const result = buildGraph([{ kind: "collection", id: "grid", name: "Grid", children }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function GridHarness() {
  return (
    <DndCollections initialGraph={gridGraph()}>
      <div className="w-[600px]">
        <VirtualGrid collectionId={parseNodeId("grid")} columns={COLUMNS} />
      </div>
    </DndCollections>
  );
}

const meta = {
  title: "UI/DndCollectionsVirtualGrid",
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

/** Play-less twin for e2e. */
export const GridPlayground: Story = {
  render: () => <GridHarness />,
};

export const ThousandItemGrid: Story = {
  render: () => <GridHarness />,
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "m0"));

    // 1,000 nodes, a viewport's worth of cards.
    const mounted = canvasElement.querySelectorAll("[data-node-id]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(60);

    // The scroll range covers every unmounted row.
    const spacer = canvasElement.querySelector<HTMLElement>(
      '[data-virtual-grid="grid"] > div'
    );
    expect(spacer!.style.height).toBe(`${(ITEM_COUNT / COLUMNS) * ROW_SIZE}px`);
  },
};

const gridOrder = (canvasElement: HTMLElement, id: string) =>
  [
    ...canvasElement
      .querySelector(`[data-virtual-grid="${id}"]`)!
      .querySelectorAll<HTMLElement>("[data-node-id]"),
  ].map((el) => el.dataset.nodeId);

function stripAndGridGraph() {
  const grid: GraphNodeSpec[] = [];
  for (let i = 0; i < 8; i++) {
    grid.push({ kind: "media", id: `g${i}`, name: `G${i}`, durationSeconds: 4 });
  }
  const strip: GraphNodeSpec[] = [];
  for (let i = 0; i < 5; i++) {
    strip.push({ kind: "media", id: `s${i}`, name: `S${i}`, durationSeconds: 4 });
  }
  const result = buildGraph([
    { kind: "collection", id: "strip", name: "Strip", children: strip },
    { kind: "collection", id: "grid", name: "Grid", children: grid },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const StripToGridMove: Story = {
  // §6/§7: moving between a horizontal strip and a vertical grid — two
  // virtualized views, one provider, one graph; the drop resolves against
  // whichever container is under the pointer.
  render: () => (
    <DndCollections initialGraph={stripAndGridGraph()}>
      <div className="flex w-[600px] flex-col gap-6">
        <VirtualStrip collectionId={parseNodeId("strip")} />
        <VirtualGrid collectionId={parseNodeId("grid")} columns={COLUMNS} height={300} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    // s0 lives in a strip: item drags start on its grip bar (the body pans).
    const s0 = nodeHandle(canvasElement, "s0");
    const g1 = nodeCard(canvasElement, "g1");
    const g2 = nodeCard(canvasElement, "g2");
    await waitForLayout(g2);

    await dragToPoint(s0, gapBetween(g1, g2));

    await waitFor(() => {
      expect(gridOrder(canvasElement, "grid").slice(0, 4)).toEqual(["g0", "g1", "s0", "g2"]);
      const strip = canvasElement.querySelector('[data-virtual-strip="strip"]')!;
      expect(strip.querySelector<HTMLElement>("[data-node-id]")!.dataset.nodeId).toBe("s1");
    });
  },
};

export const GridKeyboardRowMoves: Story = {
  // Inside a grid container, Alt+ArrowUp/Down are ROW moves (± column
  // count, same column) instead of the global nest/move-out; boundaries
  // announce instead of moving.
  render: () => <GridHarness />,
  play: async ({ canvasElement }) => {
    const m1 = nodeCard(canvasElement, "m1");
    await waitForLayout(m1);
    const user = userEvent.setup();

    // m1 (row 0, col 1) down one row -> index 5 (row 1, col 1).
    await user.click(m1);
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => {
      expect(gridOrder(canvasElement, "grid").slice(0, 7)).toEqual([
        "m0",
        "m2",
        "m3",
        "m4",
        "m5",
        "m1",
        "m6",
      ]);
    });
    // Focus followed the card; up restores the original order.
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await waitFor(() => {
      expect(gridOrder(canvasElement, "grid").slice(0, 3)).toEqual(["m0", "m1", "m2"]);
    });

    // First-row boundary announces instead of moving (or nesting).
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await waitFor(() => {
      expect(canvasElement.ownerDocument.body.textContent).toMatch(/already in the first row/i);
    });

    // Alt+Enter is the grid-safe nest binding (arrows are row moves here);
    // this all-media grid has no neighbor collection, so it announces.
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await waitFor(() => {
      expect(canvasElement.ownerDocument.body.textContent).toMatch(
        /no adjacent collection to nest into/i
      );
    });
  },
};

let paletteCounter = 0;

/** Grid with a collection card ("folder", 1 child) at index 4. */
function mixedGridGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < 8; i++) {
    children.push({ kind: "media", id: `m${i}`, name: `M${i}`, durationSeconds: 4 });
  }
  children.splice(4, 0, {
    kind: "collection",
    id: "folder",
    name: "Folder",
    children: [{ kind: "media", id: "f1", name: "F1", durationSeconds: 4 }],
  });
  const result = buildGraph([{ kind: "collection", id: "grid", name: "Grid", children }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const PaletteIntoGridAndNestIntoCollection: Story = {
  // §11/§22: palette drops land in a virtualized grid (gap -> insert) and
  // nest into a collection card (center hotspot -> add inside).
  render: () => (
    <DndCollections initialGraph={mixedGridGraph()}>
      <div className="flex w-[600px] flex-col gap-3">
        <div className="flex gap-2">
          <PaletteItem
            paletteId="new-video"
            createNode={() => {
              paletteCounter += 1;
              return {
                id: parseNodeId(`vid-${paletteCounter}`),
                kind: "media",
                name: `Video ${paletteCounter}`,
                durationSeconds: 6,
              };
            }}
          >
            + Video
          </PaletteItem>
          <PaletteItem
            paletteId="new-collection"
            createNode={() => {
              paletteCounter += 1;
              return {
                id: parseNodeId(`col-${paletteCounter}`),
                kind: "collection",
                name: `Collection ${paletteCounter}`,
              };
            }}
          >
            + Collection
          </PaletteItem>
        </div>
        <VirtualGrid collectionId={parseNodeId("grid")} columns={COLUMNS} height={300} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const m0 = nodeCard(canvasElement, "m0");
    const m1 = nodeCard(canvasElement, "m1");
    await waitForLayout(m1);

    // Palette video into a grid gap.
    const videoButton = canvasElement.querySelector<HTMLElement>(
      '[data-palette-item="new-video"]'
    )!;
    await dragToPoint(videoButton, gapBetween(m0, m1));
    await waitFor(() => {
      expect(gridOrder(canvasElement, "grid")[1]).toMatch(/^vid-/);
    });

    // Palette collection onto the folder card's center: nest-add inside.
    const collectionButton = canvasElement.querySelector<HTMLElement>(
      '[data-palette-item="new-collection"]'
    )!;
    await dragToPoint(collectionButton, rectCenter(nodeCard(canvasElement, "folder")));
    await waitFor(() => {
      expect(nodeCard(canvasElement, "folder").getAttribute("aria-label")).toMatch(
        /collection, 2 items/i
      );
    });
  },
};

function ResponsiveGridHarness() {
  const [narrow, setNarrow] = useState(false);
  return (
    <DndCollections initialGraph={gridGraph()}>
      <div style={{ width: narrow ? 350 : 600 }} className="flex flex-col gap-3">
        <button type="button" onClick={() => setNarrow(true)}>
          shrink
        </button>
        {/* No columns prop: the count derives from container width. */}
        <VirtualGrid collectionId={parseNodeId("grid")} height={300} />
      </div>
    </DndCollections>
  );
}

export const ResponsiveColumnCount: Story = {
  render: () => <ResponsiveGridHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rowCards = () =>
      canvasElement
        .querySelector('[data-virtual-row="0"]')
        ?.querySelectorAll("[data-node-id]").length ?? 0;

    // 600px container -> 4 columns.
    await waitFor(() => {
      expect(rowCards()).toBe(4);
    });

    const user = userEvent.setup();
    await user.click(canvas.getByRole("button", { name: /shrink/i }));

    // 350px -> ResizeObserver re-derives 2 columns.
    await waitFor(() => {
      expect(rowCards()).toBe(2);
    });
  },
};

export const GridGapDropInsertsAtBoundary: Story = {
  // Drop in the gap between two second-row cells: row from y, column
  // boundary from x -> insert-at-index 6 -> lands between m5 and m6.
  render: () => <GridHarness />,
  play: async ({ canvasElement }) => {
    const m0 = nodeCard(canvasElement, "m0");
    const m5 = nodeCard(canvasElement, "m5");
    const m6 = nodeCard(canvasElement, "m6");
    await waitForLayout(m6);

    await dragToPoint(m0, gapBetween(m5, m6));

    await waitFor(() => {
      const grid = canvasElement.querySelector('[data-virtual-grid="grid"]')!;
      const ids = [...grid.querySelectorAll<HTMLElement>("[data-node-id]")].map(
        (el) => el.dataset.nodeId
      );
      expect(ids.slice(0, 7)).toEqual(["m1", "m2", "m3", "m4", "m5", "m0", "m6"]);
    });
  },
};

export const KeyboardRovingNavigation: Story = {
  // §17/§20: a keyboard user traverses the 1,000-item grid in 2D with arrows —
  // the grid is one roving tab stop, Down/Right move by row/column, and
  // navigating to the end pulls an unmounted row into view. role="grid" +
  // aria-rowcount expose the true size under virtualization. Bare arrows
  // NAVIGATE; Alt+arrows still MOVE (GridKeyboardRowMoves covers that).
  render: () => <GridHarness />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    const m0 = nodeCard(canvasElement, "m0");
    await waitForLayout(m0);

    const grid = canvasElement.querySelector('[data-virtual-grid="grid"]')!;
    expect(grid.getAttribute("role")).toBe("grid");
    expect(grid.getAttribute("aria-rowcount")).toBe(String(ITEM_COUNT / COLUMNS));
    expect(m0.tabIndex).toBe(0);

    // Down = one row (= column count); Right = one column.
    m0.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      const m4 = nodeCard(canvasElement, "m4");
      expect(m4.ownerDocument.activeElement).toBe(m4);
      expect(m4.tabIndex).toBe(0);
    });
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      const m5 = nodeCard(canvasElement, "m5");
      expect(m5.ownerDocument.activeElement).toBe(m5);
    });

    // Navigation must NOT reorder the collection.
    expect(gridOrder(canvasElement, "grid").slice(0, 4)).toEqual(["m0", "m1", "m2", "m3"]);

    // End jumps to the last item — an unmounted, offscreen row — scrolled in.
    expect(canvasElement.querySelector('[data-node-id="m999"]')).toBeNull();
    await user.keyboard("{End}");
    await waitFor(() => {
      const last = canvasElement.querySelector<HTMLElement>('[data-node-id="m999"]');
      expect(last).not.toBeNull();
      expect(last!.ownerDocument.activeElement).toBe(last);
    });
  },
};
