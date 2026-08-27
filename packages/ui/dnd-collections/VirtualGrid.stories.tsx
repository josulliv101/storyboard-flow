import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "@storyboard/collections-core/graph";
import { DndCollections } from "./react/DndCollections";
import { PaletteItem } from "./react/palette";
import { VirtualGrid } from "./virtual/VirtualGrid";
import { VirtualStrip } from "./virtual/VirtualStrip";
import {
  dispatchPointerSequence,
  dragHoldAt,
  dragToPoint,
  gapBetween,
  nodeCard,
  nodeHandle,
  rectCenter,
  releaseAt,
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

export const InvalidNumericOptionsUseSafeDefaults: Story = {
  render: () => (
    <DndCollections initialGraph={gridGraph()}>
      <div className="w-[600px]">
        <VirtualGrid
          collectionId={parseNodeId("grid")}
          cellWidth={Number.NaN}
          cellHeight={Number.POSITIVE_INFINITY}
          gap={-1}
          columns={1.5}
          overscan={-1}
          height={Number.NaN}
        />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "m0"));
    const grid = canvasElement.querySelector<HTMLElement>('[data-virtual-grid="grid"]')!;
    const columns = Number(grid.dataset.gridColumns);
    expect(Number.isInteger(columns) && columns > 0).toBe(true);
    expect(parseFloat(grid.style.maxHeight)).toBe(480);
    const cell = nodeCard(canvasElement, "m0").closest<HTMLElement>('[role="gridcell"]')!;
    // Rendered width STRETCHES to fill the container (gap defaults to 8 after
    // the invalid -1 normalizes) — no longer pinned to the 128 default target.
    const cellWidth = Number(grid.dataset.gridCellWidth);
    expect(parseFloat(cell.style.width)).toBeCloseTo(cellWidth, 5);
    expect(cellWidth).toBeGreaterThanOrEqual(128);
    expect(parseFloat(cell.style.height)).toBe(96);
  },
};

/** Regression coverage: a row never ends with unused trailing space, for
 *  both the responsive-columns path and a pinned-`columns` path. */
export const FillsFullWidth: Story = {
  render: () => (
    <DndCollections initialGraph={gridGraph()}>
      <div className="flex flex-col gap-4">
        <div className="w-[601px]" data-testid="responsive-container">
          <VirtualGrid collectionId={parseNodeId("grid")} cellWidth={160} gap={8} />
        </div>
        <div className="w-[601px]" data-testid="pinned-container">
          <VirtualGrid collectionId={parseNodeId("grid")} columns={4} gap={8} />
        </div>
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "m0"));

    const checkFill = (containerTestId: string) => {
      const container = canvasElement.querySelector<HTMLElement>(
        `[data-testid="${containerTestId}"]`,
      )!;
      const grid = container.querySelector<HTMLElement>("[data-virtual-grid]")!;
      // Measure the SPACER (contentRef) directly — it's unpadded, so its
      // width is exactly the content-box width VirtualGrid itself measures
      // to compute fillCellWidth. Avoids assuming the container's border/
      // padding box math independently.
      const spacer = grid.querySelector<HTMLElement>(":scope > div")!;
      const measuredWidth = spacer.getBoundingClientRect().width;
      const columns = Number(grid.dataset.gridColumns);
      const cellWidth = Number(grid.dataset.gridCellWidth);
      const gap = 8;
      const rendered = columns * cellWidth + (columns - 1) * gap;
      expect(rendered).toBeCloseTo(measuredWidth, 0);
    };

    checkFill("responsive-container");
    checkFill("pinned-container");
  },
};

/**
 * A GRID NEVER SCROLLS SIDEWAYS, and saying so out loud is the point.
 *
 * `overflow-y-auto` on its own does not leave the other axis alone: CSS
 * resolves a `visible` axis to `auto` as soon as the other one is not visible,
 * so the box was horizontally scrollable without anyone choosing that. Settled,
 * it never overflows — columns are measured from this very box — so nothing
 * showed. It surfaced when the box was ANIMATED narrower (the app's sidebar
 * rail expanding over 200ms): for those frames the columns were still sized for
 * the old width, and a horizontal scrollbar flashed in and out at the bottom of
 * the grid.
 *
 * Asserted on the computed style rather than by measuring an overflow, because
 * the defect is the CAPABILITY, not any particular frame of it. A test that
 * waited to catch the flash would be a race; this one fails the moment someone
 * tidies the class list back to a single overflow rule.
 */
/**
 * A GRID THAT IS HIDDEN KEEPS THE LAYOUT IT HAD.
 *
 * `display: none` gives every descendant a client width of 0, and a
 * ResizeObserver reports that as a resize. Fed through the responsive column
 * arithmetic, 0 floors to ONE COLUMN — so a grid that is merely out of sight
 * re-lays itself as a single tall stack of every row, and the page it sits in
 * grows to match until it is shown and measured again.
 *
 * The app hides its board exactly this way while the details view is up (it
 * keeps the board mounted so selection and in-flight drags survive), so this
 * ran on every close. Measured there with four cards: the spacer went to 944
 * (4 rows) against a settled 472, the document to 1565 against a settled 615,
 * and the browser drew a scrollbar thumb for a page two and a half times the
 * real height before correcting it (#541).
 *
 * TWO FRAMES BEFORE ASSERTING, and that is the whole test. ResizeObserver
 * delivers before paint but not synchronously, so an assertion made in the same
 * tick as the hide would pass without the observer ever having run — vacuously,
 * and just as green with the guard removed. Waiting is what makes this a test.
 */
export const HiddenGridKeepsItsColumns: Story = {
  render: () => (
    <DndCollections initialGraph={gridGraph()}>
      <div className="w-[601px]" data-testid="hideable">
        <VirtualGrid collectionId={parseNodeId("grid")} cellWidth={160} gap={8} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "m0"));
    const container = canvasElement.querySelector<HTMLElement>('[data-testid="hideable"]')!;
    const grid = container.querySelector<HTMLElement>("[data-virtual-grid]")!;
    const spacer = grid.querySelector<HTMLElement>(":scope > div")!;

    const columns = grid.dataset.gridColumns;
    const spacerHeight = Math.round(spacer.getBoundingClientRect().height);
    // The fixture is 1000 items at 160px in a 601px box, so this is several
    // columns — a grid that was ALREADY one column could not show the defect.
    expect(Number(columns)).toBeGreaterThan(1);

    const settle = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    container.style.display = "none";
    await settle();
    // Still what it was. Without the zero-width guard this is "1".
    expect(grid.dataset.gridColumns).toBe(columns);

    container.style.display = "";
    await settle();
    expect(grid.dataset.gridColumns).toBe(columns);
    // And the row count it implies never moved either, which is the number the
    // page height is actually made of.
    expect(Math.round(spacer.getBoundingClientRect().height)).toBe(spacerHeight);
  },
};

export const GridNeverScrollsHorizontally: Story = {
  render: () => (
    <DndCollections initialGraph={gridGraph()}>
      <div className="w-[601px]" data-testid="clip-container">
        <VirtualGrid collectionId={parseNodeId("grid")} cellWidth={160} gap={8} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "m0"));
    const grid = canvasElement.querySelector<HTMLElement>("[data-virtual-grid]")!;
    const styles = getComputedStyle(grid);
    expect(styles.overflowX).toBe("hidden");
    // The vertical axis is what this box is FOR — clipping both would trap
    // content in a grid too tall to read.
    expect(styles.overflowY).toBe("auto");
  },
};

/** Play-less twin for e2e. */
export const GridPlayground: Story = {
  render: () => <GridHarness />,
};

function shortAndEmptyGraph() {
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < 6; i++) {
    children.push({ kind: "media", id: `s${i}`, name: `S${i}`, durationSeconds: 4 });
  }
  const result = buildGraph([
    { kind: "collection", id: "short", name: "Short", children },
    { kind: "collection", id: "empty", name: "Empty", children: [] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const HeightHugsShortContent: Story = {
  render: () => (
    <DndCollections initialGraph={shortAndEmptyGraph()}>
      <div className="w-[600px] space-y-4">
        <VirtualGrid collectionId={parseNodeId("short")} columns={COLUMNS} height={300} />
        <VirtualGrid collectionId={parseNodeId("empty")} columns={COLUMNS} height={300} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "s0"));

    // `height` is a CAP: 6 items in 4 columns = 2 rows, and the container
    // hugs those rows instead of holding the 300px viewport open.
    const short = canvasElement.querySelector<HTMLElement>('[data-virtual-grid="short"]')!;
    expect(short.clientHeight).toBeGreaterThanOrEqual(2 * ROW_SIZE);
    expect(short.clientHeight).toBeLessThan(300);

    // An empty grid still presents a drop area (one row's worth via the
    // spacer min-height) with the hint visible — not collapsed padding.
    const empty = canvasElement.querySelector<HTMLElement>('[data-virtual-grid="empty"]')!;
    expect(empty.clientHeight).toBeGreaterThanOrEqual(ROW_SIZE);
    expect(empty.clientHeight).toBeLessThan(300);
    expect(empty.textContent).toContain("Drop items here");
  },
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

function GridOverlayExample() {
  // Row 2, column 1 in content coordinates (cellHeight 96 + gap 8 = 104).
  const CELL = 128 + 8;
  const ROW = 96 + 8;
  return (
    <DndCollections initialGraph={gridGraph()}>
      <div className="w-[600px]">
        <VirtualGrid
          collectionId={parseNodeId("grid")}
          columns={COLUMNS}
          height={300}
          overlay={
            <div
              data-grid-playhead
              style={{
                position: "absolute",
                left: 1 * CELL,
                top: 2 * ROW,
                width: 2,
                height: 96,
                background: "red",
              }}
            />
          }
        />
      </div>
    </DndCollections>
  );
}

export const GridOverlay: Story = {
  // The grid overlay renders in CONTENT coordinates inside the scrolling
  // spacer: a marker placed at (col*cellPitch, row*rowPitch) sits at that
  // exact content point and rides vertical scroll — viewport position shifts
  // by exactly the scroll while the content-relative offset never changes.
  render: () => <GridOverlayExample />,
  play: async ({ canvasElement }) => {
    await waitForLayout(nodeCard(canvasElement, "m0"));
    const grid = canvasElement.querySelector<HTMLElement>('[data-virtual-grid="grid"]')!;
    const marker = () => canvasElement.querySelector<HTMLElement>("[data-grid-playhead]")!;
    const spacer = marker().closest("[data-virtual-grid-overlay]")!.parentElement as HTMLElement;
    const contentTop = () =>
      marker().getBoundingClientRect().top - spacer.getBoundingClientRect().top;

    expect(Math.round(contentTop())).toBe(2 * (96 + 8)); // row 2

    const viewportBefore = marker().getBoundingClientRect().top;
    grid.scrollTop = 50;
    await waitFor(() => {
      expect(Math.round(marker().getBoundingClientRect().top)).toBe(
        Math.round(viewportBefore - 50)
      );
    });
    // Content-relative offset unchanged — it rode the scroll.
    expect(Math.round(contentTop())).toBe(2 * (96 + 8));
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

function StripAndGridExample() {
  return (
    <DndCollections initialGraph={stripAndGridGraph()}>
      <div className="flex w-[600px] flex-col gap-6">
        <VirtualStrip collectionId={parseNodeId("strip")} />
        <VirtualGrid collectionId={parseNodeId("grid")} columns={COLUMNS} height={300} />
      </div>
    </DndCollections>
  );
}

export const StripToGridMove: Story = {
  // §6/§7: moving between a horizontal strip and a vertical grid — two
  // virtualized views, one provider, one graph; the drop resolves against
  // whichever container is under the pointer.
  render: () => <StripAndGridExample />,
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

/** Play-less twin for real-mouse cross-view drops in Playwright. */
export const StripToGridPlayground: Story = {
  render: () => <StripAndGridExample />,
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
  // nest into a collection card (center hotspot -> add inside). animateMoves
  // off: back-to-back pointer drops must not target a card mid-FLIP.
  render: () => (
    <DndCollections initialGraph={mixedGridGraph()} animateMoves={false}>
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

    // Palette collection onto the folder card's center: the label remains
    // visible at the bottom-center while the drag ghost occupies the middle.
    const collectionButton = canvasElement.querySelector<HTMLElement>(
      '[data-palette-item="new-collection"]'
    )!;
    const folderPoint = rectCenter(nodeCard(canvasElement, "folder"));
    await dragHoldAt(collectionButton, folderPoint);
    await waitFor(() => {
      const overlay = canvasElement.querySelector<HTMLElement>('[data-nest-state="valid"]');
      expect(overlay).not.toBeNull();
      const label = overlay!.querySelector<HTMLElement>("span");
      expect(label).not.toBeNull();
      const overlayRect = overlay!.getBoundingClientRect();
      const labelRect = label!.getBoundingClientRect();
      expect(labelRect.top).toBeGreaterThan(overlayRect.top + overlayRect.height / 2);
      expect(labelRect.left + labelRect.width / 2).toBeCloseTo(
        overlayRect.left + overlayRect.width / 2,
        0,
      );
      expect(getComputedStyle(label!).fontSize).toBe("12px");
      expect(getComputedStyle(overlay!).backdropFilter).toContain("blur");
      expect(overlay!.className).toContain("bg-muted/70");
    });
    await releaseAt(folderPoint);
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

export const CardBoundaryIndicatorStaysCenteredInGap: Story = {
  render: () => <GridHarness />,
  play: async ({ canvasElement }) => {
    const m0 = nodeCard(canvasElement, "m0");
    const m5 = nodeCard(canvasElement, "m5");
    const m6 = nodeCard(canvasElement, "m6");
    await waitForLayout(m6);
    const m5Rect = m5.getBoundingClientRect();
    const m6Rect = m6.getBoundingClientRect();
    const target = {
      x: m6Rect.left + 2,
      y: m6Rect.top + m6Rect.height / 2,
    };

    await dragHoldAt(m0, target);
    await waitFor(() => {
      const indicator = canvasElement.querySelector<HTMLElement>(
        '[data-drop-indicator="before"]',
      );
      expect(indicator).not.toBeNull();
      const indicatorRect = indicator!.getBoundingClientRect();
      const indicatorCenter = indicatorRect.left + indicatorRect.width / 2;
      const gapCenter = (m5Rect.right + m6Rect.left) / 2;
      expect(indicatorCenter).toBeCloseTo(gapCenter, 0);
    });
    await releaseAt(target);
  },
};

export const RowStartIndicatorsShareOnePosition: Story = {
  render: () => <GridHarness />,
  play: async ({ canvasElement }) => {
    const m4 = nodeCard(canvasElement, "m4");
    const m7 = nodeCard(canvasElement, "m7");
    await waitForLayout(m7);
    const m4Rect = m4.getBoundingClientRect();
    const target = {
      x: m4Rect.left + 2,
      y: m4Rect.top + m4Rect.height / 2,
    };

    await dragHoldAt(m7, target);
    await waitFor(() => {
      const indicators = [
        ...canvasElement.querySelectorAll<HTMLElement>(
          '[data-drop-indicator="before"], [data-drop-indicator="virtual-grid"]',
        ),
      ];
      expect(indicators.length).toBeGreaterThan(0);
      for (const indicator of indicators) {
        const rect = indicator.getBoundingClientRect();
        expect(rect.left + rect.width / 2).toBeCloseTo(m4Rect.left, 0);
      }
    });
    await releaseAt(target);
  },
};

function fullRowGridGraph() {
  // 8 items in 4 columns = two EXACTLY full rows (the edge case).
  const children: GraphNodeSpec[] = [];
  for (let i = 0; i < 8; i++) {
    children.push({ kind: "media", id: `m${i}`, name: `M${i}`, durationSeconds: 4 });
  }
  const result = buildGraph([{ kind: "collection", id: "grid", name: "Grid", children }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const AppendAfterFullLastRowIndicator: Story = {
  // Appending after a FULL last row (index === count, count % cols === 0) must
  // draw the indicator at the right edge of the last row — not at row `rowCount`,
  // which is the bottom edge of the spacer, outside the content.
  render: () => (
    <DndCollections initialGraph={fullRowGridGraph()}>
      <div className="w-[600px]">
        <VirtualGrid collectionId={parseNodeId("grid")} columns={COLUMNS} height={300} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const m7 = nodeCard(canvasElement, "m7");
    await waitForLayout(m7);
    const rect = m7.getBoundingClientRect();
    // Cells now fill flush to the grid's content edge (the fix under test),
    // so there's no guaranteed slack past the last cell — clamp the "just
    // past" offset to stay inside the grid's own bounding box, or the point
    // lands over the page background and the drag never registers a hover.
    const gridRect = canvasElement
      .querySelector('[data-virtual-grid="grid"]')!
      .getBoundingClientRect();
    const appendPoint = {
      x: Math.min(rect.right + 30, gridRect.right - 5),
      y: rect.top + rect.height / 2,
    };

    // Hold m0 just past the last cell -> append at index 8 (after the full row).
    await dragHoldAt(nodeCard(canvasElement, "m0"), appendPoint);
    await waitFor(() => {
      const indicator = canvasElement.querySelector<HTMLElement>(
        '[data-drop-indicator="virtual-grid"]'
      );
      expect(indicator).not.toBeNull();
      // Two full rows -> the last row's top is ROW_SIZE (104), NOT 2*ROW_SIZE
      // (208, the spacer's bottom edge) which the pre-fix formula produced.
      expect(parseFloat(indicator!.style.top)).toBe(ROW_SIZE);
    });
    await releaseAt(appendPoint);
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

    // Reverse column/row navigation returns to the origin.
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => {
      const m4 = nodeCard(canvasElement, "m4");
      expect(m4.ownerDocument.activeElement).toBe(m4);
    });
    await user.keyboard("{ArrowUp}");
    await waitFor(() => {
      const first = nodeCard(canvasElement, "m0");
      expect(first.ownerDocument.activeElement).toBe(first);
      expect(first.tabIndex).toBe(0);
    });
    await user.keyboard("{PageDown}");
    expect(document.activeElement).toBe(nodeCard(canvasElement, "m0"));

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

    await user.keyboard("{Home}");
    await waitFor(() => {
      const first = canvasElement.querySelector<HTMLElement>('[data-node-id="m0"]');
      expect(first).not.toBeNull();
      expect(first!.ownerDocument.activeElement).toBe(first);
    });
  },
};

/** Three cards in a four-column grid: the fourth slot and everything below
 *  the first row are real background — the deselect target. */
function shortGridGraph() {
  const result = buildGraph([
    {
      kind: "collection",
      id: "grid",
      name: "Grid",
      children: [
        { kind: "media", id: "m0", name: "M0", durationSeconds: 4 },
        { kind: "media", id: "m1", name: "M1", durationSeconds: 4 },
        { kind: "media", id: "m2", name: "M2", durationSeconds: 4 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export const BackgroundDragKeepsSelection: Story = {
  // PL7-001's guard, pinned where it carries weight. The grid has no pan hook
  // to squash a trailing click, so a press that TRAVELS across the background
  // and releases delivers a plain click to the container — indistinguishable
  // from a deliberate background click except by where the press started.
  // Without the press-position check, dragging across empty space silently
  // dropped the selection.
  render: () => (
    <DndCollections initialGraph={shortGridGraph()}>
      <div className="w-[600px]">
        <VirtualGrid collectionId={parseNodeId("grid")} columns={COLUMNS} />
      </div>
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector<HTMLElement>('[data-virtual-grid="grid"]')!;
    const m1 = nodeCard(canvasElement, "m1");
    await waitForLayout(m1);

    await userEvent.click(m1);
    await waitFor(() => expect(nodeCard(canvasElement, "m1")).toHaveAttribute("data-selected", "true"));

    // Background: below the only row, inside the container.
    const rowBottom = nodeCard(canvasElement, "m0").getBoundingClientRect().bottom;
    const gridBox = grid.getBoundingClientRect();
    const emptyY = (rowBottom + gridBox.bottom) / 2;
    const emptyX = gridBox.left + gridBox.width / 2;
    expect(emptyY).toBeGreaterThan(rowBottom);

    const click = (x: number, y: number) =>
      grid.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y }),
      );

    // Press, travel well past the slop, release: the selection survives.
    await dispatchPointerSequence([
      { element: grid, type: "pointerdown", clientX: emptyX, clientY: emptyY },
      { element: grid, type: "pointermove", clientX: emptyX - 80, clientY: emptyY, delayAfterMs: 16 },
      { element: grid, type: "pointerup", clientX: emptyX - 80, clientY: emptyY },
    ]);
    click(emptyX - 80, emptyY);
    // Settle first: a clear would land on a later render, so asserting
    // synchronously here would pass even when the guard is gone.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(nodeCard(canvasElement, "m1")).toHaveAttribute("data-selected", "true");

    // A stationary press on the same spot DOES clear — so the assertion above
    // is about the movement, not about background clicks being inert here.
    await dispatchPointerSequence([
      { element: grid, type: "pointerdown", clientX: emptyX, clientY: emptyY },
      { element: grid, type: "pointerup", clientX: emptyX, clientY: emptyY },
    ]);
    click(emptyX, emptyY);
    await waitFor(() =>
      expect(nodeCard(canvasElement, "m1")).not.toHaveAttribute("data-selected", "true"),
    );
  },
};
