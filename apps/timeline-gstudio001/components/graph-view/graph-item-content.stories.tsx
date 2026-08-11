import { useEffect, useState } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "storybook/test";

import type { ClipDetail } from "@storyboard/timeline-domain";
import {
  DndCollections,
  buildGraph,
  useCollectionsStore,
  type CollectionGhostContentComponent,
  type CollectionItemShellComponent,
  type CollectionItemShellProps,
  type CollectionTrimOverviewContentComponent,
  type CollectionsGraph,
  type NodeId,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import {
  GRAPH_VIEW_COMPONENTS,
  VideoFrameLookAhead,
} from "./graph-item-content";
import { GraphDetailsProvider } from "./graph-details-context";
import { createGraphDetailsStore } from "@/lib/graph-details-store";

// The COMPOSED collection card, exactly as the graph renders it: the
// registered ItemShell routes collections through CollectionItem primitives,
// so the folder drill-in and the rename editor are real interactive elements
// composed as SIBLINGS of the card's selection <button> — the structure the
// direct-ItemContent stories could never exercise (review finding 1). These
// deterministic, offline stories (data-URI posters, an in-memory details
// store) cover the preview-frame cases the repo rules require AND pin the
// composed card's DOM validity.

// The registry field is optional in the type; the graph view always registers
// it, so narrow to the defined component for `Meta`.
const ItemShell: CollectionItemShellComponent = GRAPH_VIEW_COMPONENTS.ItemShell!;
const GhostContent: CollectionGhostContentComponent = GRAPH_VIEW_COMPONENTS.GhostContent!;

const COLLECTION_ID = "col-1" as NodeId;
const EMPTY_COLLECTION_ID = "empty-col" as NodeId;

/** A one-node graph: the shell reads the node (kind, name) from the store.
 *  The card renders un-hydrated here, so its preview frames come from the
 *  stored `previewItems` below, not from graph children. */
const providerGraph = (() => {
  const result = buildGraph([{ kind: "collection", id: COLLECTION_ID, name: "A timeline", children: [] }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

const emptyCollectionGraph = (() => {
  const result = buildGraph([
    { kind: "collection", id: EMPTY_COLLECTION_ID, name: "Empty timeline", children: [] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

const emptyCollectionNode = emptyCollectionGraph.nodesById.get(EMPTY_COLLECTION_ID);
if (emptyCollectionNode?.kind !== "collection") {
  throw new Error("Empty collection ghost fixture did not build.");
}

/** A deterministic, fully-offline poster (a solid-colour SVG data URI). */
function poster(label: string, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="45"><rect width="80" height="45" fill="${fill}"/><text x="40" y="26" font-size="12" fill="white" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type PreviewItem = NonNullable<ClipDetail["previewItems"]>[number];

const ASSET_A: PreviewItem = {
  id: "asset-a",
  kind: "image",
  src: poster("A", "#0ea5e9"),
  poster: poster("A", "#0ea5e9"),
  alt: "Asset A",
};
const ASSET_B: PreviewItem = {
  id: "asset-b",
  kind: "image",
  src: poster("B", "#f59e0b"),
  poster: poster("B", "#f59e0b"),
  alt: "Asset B",
};

/** Wraps the composed card in a collections store (the shell and its rename
 *  dispatch need one) and a details store (so `useClipDetail` resolves).
 *  `hydrated: false` keeps the frames coming from the stored `previewItems`
 *  here — a hydrated card would instead derive them from live graph children,
 *  which this offline fixture deliberately does not carry. */
function renderWithDetail(previewItems: PreviewItem[]) {
  const detail: ClipDetail = {
    alt: "A timeline",
    aspect: 16 / 9,
    trackIndex: 0,
    hydrated: false,
    itemCount: previewItems.length,
    duration: previewItems.length * 4,
    previewItems,
  };
  const store = createGraphDetailsStore({ [COLLECTION_ID]: detail });
  const decorator: Decorator = (Story) => (
    <DndCollections initialGraph={providerGraph}>
      <GraphDetailsProvider store={store}>
        <div className="h-32 w-40 bg-zinc-950 p-2">
          <Story />
        </div>
      </GraphDetailsProvider>
    </DndCollections>
  );
  return decorator;
}

/** The preview `<img>`s carry empty alt (decorative), so they expose no ARIA
 *  role — query the DOM directly rather than through role helpers. */
function previewImages(root: HTMLElement): HTMLImageElement[] {
  return Array.from(root.querySelectorAll("img"));
}

const baseArgs: CollectionItemShellProps = {
  id: COLLECTION_ID,
  className: "h-full w-full",
  dragActivation: "hold",
};

const meta = {
  title: "GStudio/GraphView/CollectionCardContent",
  component: ItemShell,
  tags: ["autodocs"],
} satisfies Meta<typeof ItemShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The ordinary collection card: ONE frame, full width (PL13-003).
 *
 * It used to be a first/last PAIR, which at card size meant two ~80px slots —
 * too narrow to recognize a face, and the crop turned a composition into a
 * slice of one. What is worth pinning now is WHICH frame: the first child's,
 * not the last, not an arbitrary one.
 */
export const DistinctFrames: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B])],
  play: async ({ canvasElement }) => {
    const images = previewImages(canvasElement);
    await expect(images).toHaveLength(1);
    await expect(images[0]).toHaveAttribute("src", ASSET_A.poster);
  },
};

/*
 * REMOVED with the frame pair (PL13-003): `RepeatedFirstAndLastFrame`.
 *
 * It pinned a real regression — the same asset as BOTH the first and last
 * preview item shares an id, which used to collide on the React key and
 * reconcile to one stretched frame, fixed by keying on the SLOT. A card that
 * renders a single frame cannot have two slots to collide, so the story could
 * only have asserted "one image", which is what every other story here already
 * says. Deleted rather than kept as a vacuous pin. If the pair ever returns,
 * so should it — the fixture was [ASSET_A, ASSET_B, ASSET_A] and the rule is
 * key by slot, never by content.
 */

/** A single-item collection shows one frame across the full width. */
export const SingleFrame: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A])],
  play: async ({ canvasElement }) => {
    const images = previewImages(canvasElement);
    await expect(images).toHaveLength(1);
    await expect(canvasElement).toHaveTextContent(/4\.0s\s*\/\s*1 item/);
  },
};

/**
 * The surface's accessible name reports the count the card SHOWS, not the live
 * graph child count (review finding 4). This fixture is exactly the placeholder
 * case: the provider graph carries zero children, but the stored summary says
 * two — a screen reader must hear "2 items", matching the visible badge, rather
 * than "0 items" from the un-hydrated live count.
 */
export const PlaceholderAriaCountMatchesBadge: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B])],
  play: async ({ canvasElement }) => {
    const surface = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
    // The stored summary (itemCount 2), not the live childCount (0).
    await expect(surface.getAttribute("aria-label")).toBe("A timeline (collection, 2 items)");
    await expect(canvasElement).toHaveTextContent(/8\.0s\s*\/\s*2 items/);

    const name = canvasElement.querySelector<HTMLElement>(
      '[title="Click or press F2 to rename"]',
    )!;
    const surfaceRect = surface.getBoundingClientRect();
    const nameRect = name.getBoundingClientRect();
    // The name's TEXT must clear the card's edges — so its own padding counts.
    //
    // The label carries `-mx-1 px-1`: the box reaches 4px further out on each
    // side to give the rename hover a target bigger than the glyphs, while the
    // padding puts the text back exactly where it was. Measuring the raw box
    // therefore reports a text inset 4px smaller than the one on screen, which
    // is what this assertion used to do — it failed on a card whose text had
    // not moved a pixel.
    const style = getComputedStyle(name);
    const padLeft = Number.parseFloat(style.paddingLeft) || 0;
    const padRight = Number.parseFloat(style.paddingRight) || 0;
    await expect(nameRect.left + padLeft - surfaceRect.left).toBeGreaterThanOrEqual(9);
    await expect(surfaceRect.right - (nameRect.right - padRight)).toBeGreaterThanOrEqual(9);
    await expect(surfaceRect.bottom - nameRect.bottom).toBeGreaterThanOrEqual(7);
  },
};

/** An empty or unresolved collection shows only the collection affordance;
 * no fallback copy is allowed to bleed through behind the folder glyph. */
export const EmptyCardUsesCleanIconFallback: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([])],
  play: async ({ canvasElement }) => {
    const fallback = canvasElement.querySelector<HTMLElement>(
      "[data-empty-collection-preview]",
    );
    await expect(fallback).not.toBeNull();
    await expect(fallback!.textContent).toBe("");
    await expect(previewImages(canvasElement)).toHaveLength(0);
    await expect(canvasElement).not.toHaveTextContent(/open to load|empty|no media preview/i);

    // What the card shows INSTEAD: the leader glyph, drawn into the empty
    // frame. This used to check for the corner drill button on the same
    // reasoning — "an empty card still says collection" — but that button is
    // gone (a plain click opens the card now), and the glyph was always the
    // part of the answer that belongs to this story.
    await expect(fallback!.querySelector("svg")).not.toBeNull();
  },
};

/**
 * The composed card's STRUCTURE (review finding 1): the selection surface is
 * a real <button> with zero interactive content inside it, and the rename
 * editor is a real <input> SIBLING — and renaming through it updates the
 * graph node (the surface's accessible name) in place.
 *
 * The folder drill-in used to be the other sibling checked here. It is gone: a
 * plain click opens the collection now, so a 28px corner button was a second
 * way to do the easy thing, parked over the artwork of every collection card.
 */
export const ComposedCardStructure: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B])],
  play: async ({ canvasElement }) => {
    const surface = canvasElement.querySelector<HTMLElement>("[data-node-id]");
    await expect(surface).not.toBeNull();
    await expect(surface!.tagName).toBe("BUTTON");
    // No nested interactive semantics inside the surface button.
    await expect(
      surface!.querySelectorAll("button, [role='button'], input, textarea, select, a[href], [tabindex]"),
    ).toHaveLength(0);

    // Double-click the name label → a REAL input opens outside the surface...
    const label = Array.from(surface!.querySelectorAll("span")).find(
      (el) => el.textContent === "A timeline",
    )!;
    // ONE click opens it now — the label used to swallow the first click
    // and rename on the second.
    await userEvent.click(label);
    const editor = canvasElement.querySelector<HTMLInputElement>(
      'input[aria-label="Timeline name"]',
    );
    await expect(editor).not.toBeNull();
    await expect(surface!.contains(editor)).toBe(false);

    // ...and committing a new name renames the GRAPH node: the surface's
    // accessible name follows immediately.
    await userEvent.clear(editor!);
    await userEvent.type(editor!, "Renamed timeline{Enter}");
    await waitFor(() =>
      expect(surface!.getAttribute("aria-label")).toMatch(/^Renamed timeline \(collection/),
    );
  },
};

// ── Disabled, and disabled-by-parent ────────────────────────────────────────

/** Builds a details store + provider around an arbitrary graph, so the
 *  disabled cases can nest the card inside a parent collection. */
function renderWithGraph(graph: CollectionsGraph) {
  const detail: ClipDetail = {
    alt: "A timeline",
    aspect: 16 / 9,
    trackIndex: 0,
    hydrated: false,
    itemCount: 2,
    previewItems: [ASSET_A, ASSET_B],
  };
  const store = createGraphDetailsStore({ [COLLECTION_ID]: detail });
  const decorator: Decorator = (Story) => (
    <DndCollections initialGraph={graph}>
      <GraphDetailsProvider store={store}>
        <div className="h-32 w-40 bg-zinc-950 p-2">
          <Story />
        </div>
      </GraphDetailsProvider>
    </DndCollections>
  );
  return decorator;
}

const graphWithNodeDisabled = (() => {
  const result = buildGraph([
    { kind: "collection", id: COLLECTION_ID, name: "A timeline", children: [], disabled: true },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

const graphWithParentDisabled = (() => {
  const result = buildGraph([
    {
      kind: "collection",
      id: "parent" as NodeId,
      name: "Off parent",
      disabled: true,
      children: [{ kind: "collection", id: COLLECTION_ID, name: "A timeline", children: [] }],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

/**
 * A card disabled on ITSELF: muted, and badged with the word that names why.
 * The badge is what distinguishes it from the inherited case below — the two
 * look identical otherwise, on purpose, because a viewer sees neither.
 */
export const DisabledCard: Story = {
  args: baseArgs,
  decorators: [renderWithGraph(graphWithNodeDisabled)],
  play: async ({ canvasElement }) => {
    const surface = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
    // Marker CLASS, not data-disabled: SelectionSurface has an explicit prop
    // list with no rest spread, so a hyphenated attribute would be dropped.
    await expect(surface.classList.contains("is-disabled-card")).toBe(true);
    await expect(surface.classList.contains("is-parent-disabled-card")).toBe(false);

    const chip = canvasElement.querySelector<HTMLElement>("[data-disabled-chip]")!;
    await expect(chip).not.toBeNull();
    await expect(chip.dataset.disabledChip).toBe("self");
    await expect(chip.textContent).toBe("DISABLED");
    await expect(getComputedStyle(surface).opacity).toBe("1");
    await expect(getComputedStyle(surface).filter).toBe("none");
    await expect(getComputedStyle(chip).opacity).toBe("1");
    await expect(getComputedStyle(chip).filter).toBe("none");
  },
};

/**
 * A card that is off only because a collection ABOVE it is. It carries the
 * same muted treatment but its own flag is clear, so re-enabling it here would
 * do nothing — the chip says where to go instead.
 */
export const DisabledByParentCard: Story = {
  args: baseArgs,
  decorators: [renderWithGraph(graphWithParentDisabled)],
  play: async ({ canvasElement }) => {
    const surface = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
    await expect(surface.classList.contains("is-disabled-card")).toBe(true);
    await expect(surface.classList.contains("is-parent-disabled-card")).toBe(true);

    const chip = canvasElement.querySelector<HTMLElement>("[data-disabled-chip]")!;
    await expect(chip.dataset.disabledChip).toBe("inherited");
    await expect(chip.textContent).toBe("PARENT OFF");
    await expect(getComputedStyle(surface).opacity).toBe("1");
    await expect(getComputedStyle(surface).filter).toBe("none");
    await expect(getComputedStyle(chip).opacity).toBe("1");
    await expect(getComputedStyle(chip).filter).toBe("none");
  },
};

/** The ordinary case carries no chip at all. */
export const NoDisabledChipWhenEnabled: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B])],
  play: async ({ canvasElement }) => {
    const surface = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
    await expect(surface.classList.contains("is-disabled-card")).toBe(false);
    await expect(canvasElement.querySelector("[data-disabled-chip]")).toBeNull();
  },
};

// ── Filmstrip resample settling (P3) ────────────────────────────────────────

const VIDEO_ID = "vid-1" as NodeId;

const videoGraph = (() => {
  const result = buildGraph([
    {
      kind: "collection",
      id: "root-video",
      name: "Root",
      children: [
        {
          kind: "media",
          id: VIDEO_ID as string,
          mediaKind: "video",
          name: "A video",
          src: poster("V", "#334155"),
          posterSrcs: [poster("V", "#334155")],
          fullDurationSeconds: 8,
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

/** A VIDEO card at a controllable size. Media routes through NodeCard, which
 *  reads its pixels from the provider `components` registry — so this
 *  renders the registered GraphClipContent, filmstrip and all. */
function FilmstripSettleHarness() {
  const [store] = useState(() => createGraphDetailsStore({}));
  return (
    <DndCollections initialGraph={videoGraph} components={GRAPH_VIEW_COMPONENTS}>
      <GraphDetailsProvider store={store}>
        <VideoFrameLookAhead>
          <div data-resize-host style={{ width: 192, height: 96 }}>
            <ItemShell id={VIDEO_ID} className="h-full w-full" />
          </div>
        </VideoFrameLookAhead>
      </GraphDetailsProvider>
    </DndCollections>
  );
}

/**
 * The filmstrip's frame count SETTLES instead of chasing every size change
 * (P3): a zoom drag sweeps a card's width→count ratio through several
 * integers, and adopting each crossing re-timed every frame slot — swapping
 * every `<img>` src per crossing, per video card. The first measurement
 * adopts immediately (a virtualization remount must not show a blank card),
 * but a CHANGED measurement must hold for the settle delay before one
 * resample lands on the final count.
 */
export const FilmstripResampleSettles: Story = {
  args: { id: VIDEO_ID, className: "h-full w-full" },
  render: () => <FilmstripSettleHarness />,
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>("[data-resize-host]")!;
    // First measurement adopts immediately: 192×96 → 2 frames.
    await waitFor(() => expect(previewImages(canvasElement)).toHaveLength(2));
    // Mounted video cards are already inside the virtual strip's bounded
    // look-ahead window, so their frames must be discovered immediately.
    expect(previewImages(canvasElement).every((image) => image.loading === "eager")).toBe(true);
    const kind = canvasElement.querySelector<HTMLElement>('[data-media-kind="video"]')!;
    const card = kind.parentElement?.parentElement;
    expect(card).not.toBeNull();
    // A FLOOR, not an exact size. The badge was raised 9px -> 11px when the
    // type floor landed, and this assertion kept demanding 9px — it went
    // unnoticed because the browser story project was not in CI. Asserting the
    // minimum keeps the accessibility guarantee without breaking on the next
    // deliberate type change.
    expect(Number.parseFloat(getComputedStyle(kind).fontSize)).toBeGreaterThanOrEqual(11);
    const kindRect = kind.getBoundingClientRect();
    const cardRect = card!.getBoundingClientRect();
    expect(kindRect.left - cardRect.left).toBeGreaterThanOrEqual(7);
    expect(cardRect.bottom - kindRect.bottom).toBeGreaterThanOrEqual(7);

    // Grow the card as a zoom drag would. The filmstrip must NOT adopt the
    // new count as soon as the resize lands (80ms is plenty for the
    // ResizeObserver + re-render, and well inside the settle delay)…
    host.style.width = "480px";
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(previewImages(canvasElement).length).toBeLessThan(6);

    // …and once the size holds still past the delay, ONE resample lands on
    // the final count. The measured contentRect excludes the card's p-1.5
    // artwork frame: (480 − 12) / (96 − 12) ≈ 5.6 → 6 frames.
    await waitFor(() => expect(previewImages(canvasElement)).toHaveLength(6), {
      timeout: 2000,
    });
  },
};

// ── Trim overview sampling (R7 #2/#3) ───────────────────────────────────────

/** A frame-addressable source URL: `.invalid` is an IETF-reserved TLD that
 *  can never resolve, so nothing is fetched — while the `/video/upload/`
 *  path shape lets the Cloudinary builder rewrite per-frame `so_` offsets,
 *  which is exactly what this story asserts on. */
const OVERVIEW_POSTER = "https://cdn.invalid/video/upload/so_0.35,f_jpg/scene.jpg";

const OVERVIEW_NODE: VideoMediaNode = {
  id: "vid-overview" as NodeId,
  kind: "media",
  mediaKind: "video",
  name: "A video",
  posterSrcs: [OVERVIEW_POSTER],
  fullDurationSeconds: 10,
  trimInSeconds: 1,
  trimOutSeconds: 2,
};

/**
 * The registered OverviewContent (the "sequence above" a selected video)
 * SAMPLES its frames — the package default tiles the 1–2 stored posters by
 * modulo, so a one-poster clip painted the same still into every slot (R7
 * #2). Each slot must carry its own source time, the last one pinned to the
 * source's end (R7 #3), and the default's "full clip x.xs" readout must be
 * gone (R7 #3).
 */
export const TrimOverviewSamplesDistinctFrames: Story = {
  args: baseArgs,
  render: () => {
    const Overview =
      GRAPH_VIEW_COMPONENTS.OverviewContent as CollectionTrimOverviewContentComponent;
    return (
      <div className="relative h-11 w-[440px] overflow-hidden bg-zinc-950">
        <Overview
          node={OVERVIEW_NODE}
          pixelsPerSecond={44}
          trimInSeconds={1}
          trimOutSeconds={2}
          fullWidth={440}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    // 440px of strip at 44px square frames → 10 slots.
    const images = previewImages(canvasElement);
    await expect(images).toHaveLength(10);

    // Every slot samples its OWN time: all so_ offsets distinct, ascending.
    const offsets = images.map((img) => {
      const match = /[/,]so_([\d.]+)/.exec(img.getAttribute("src") ?? "");
      return match ? Number(match[1]) : NaN;
    });
    expect(new Set(offsets).size).toBe(offsets.length);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }

    // The last slot is pinned to the source's end (10s − 0.05 back-off) —
    // not its slot centre (9.5s).
    expect(offsets[offsets.length - 1]).toBeCloseTo(9.95);

    // The overview covers the FULL source, not the trimmed window: the
    // first slot's centre lives in the leading trimmed-away region.
    expect(offsets[0]).toBeLessThan(1);

    // The stock "full clip x.xs" readout is dropped (R7 #3).
    expect(canvasElement.textContent).not.toContain("full clip");
  },
};

/** An empty collection has no preview frame to paint, so its drag ghost uses
 * the exact same light-stroke folder/arrow glyph as the collection card. */
export const EmptyCollectionGhostUsesFolderGlyph: Story = {
  args: baseArgs,
  render: () => {
    const store = createGraphDetailsStore({});
    return (
      <DndCollections initialGraph={emptyCollectionGraph}>
        <GraphDetailsProvider store={store}>
          <div className="h-24 w-24">
            <GhostContent node={emptyCollectionNode} extraCount={0} />
          </div>
        </GraphDetailsProvider>
      </DndCollections>
    );
  },
  play: async ({ canvasElement }) => {
    const ghost = canvasElement.querySelector<HTMLElement>("[data-empty-collection-ghost]")!;
    await expect(ghost).not.toBeNull();
    await expect(ghost.textContent).toBe("");
    const glyph = ghost.querySelector<SVGElement>("svg")!;
    await expect(glyph.getAttribute("stroke-width")).toBe("1.5");
    await expect(glyph.classList.contains("h-7")).toBe(true);
    await expect(glyph.classList.contains("w-7")).toBe(true);
  },
};

/**
 * A DISABLED collection: skipped in playback, counts and time totals, but it
 * keeps its slot and its full width — its duration still shapes the board.
 * So it must read as muted, never as missing or as an error. Grayscale plus
 * reduced opacity is what survives on top of arbitrary artwork, where a tint
 * would not.
 */
export const DisabledCollection: Story = {
  args: baseArgs,
  decorators: [
    (Story) => {
      const graph = buildGraph([
        {
          kind: "collection",
          id: COLLECTION_ID,
          name: "A timeline",
          children: [],
          disabled: true,
        },
      ]);
      if (!graph.ok) throw new Error(JSON.stringify(graph.error));
      const store = createGraphDetailsStore({
        [COLLECTION_ID]: {
          alt: "A timeline",
          aspect: 16 / 9,
          trackIndex: 0,
          hydrated: false,
          itemCount: 2,
          duration: 8,
          previewItems: [ASSET_A, ASSET_B],
        },
      });
      return (
        <DndCollections initialGraph={graph.value}>
          <GraphDetailsProvider store={store}>
            <div className="h-32 w-40 bg-zinc-950 p-2">
              <Story />
            </div>
          </GraphDetailsProvider>
        </DndCollections>
      );
    },
  ],
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector(".is-disabled-card");
    await expect(card).not.toBeNull();
    await expect(getComputedStyle(card as Element).filter).toBe("none");
    await expect(getComputedStyle(card as Element).opacity).toBe("1");
    const visuals = canvasElement.querySelector<HTMLElement>("[data-disabled-visuals]")!;
    await expect(getComputedStyle(visuals).filter).toBe("grayscale(1)");
    await expect(Number(getComputedStyle(visuals).opacity)).toBeLessThan(1);
    const chip = canvasElement.querySelector<HTMLElement>("[data-disabled-chip]")!;
    await expect(getComputedStyle(chip).filter).toBe("none");
    await expect(getComputedStyle(chip).opacity).toBe("1");
    await expect(chip.classList.contains("right-2")).toBe(true);
    await expect(chip.classList.contains("bottom-2")).toBe(true);
    const metadata = canvasElement.querySelector<HTMLElement>("[data-collection-metadata]")!;
    await expect(getComputedStyle(metadata).filter).toBe("none");
    await expect(getComputedStyle(metadata).opacity).toBe("1");
    await expect(metadata.textContent).toContain("A timeline");
    await expect(metadata.textContent).toContain("8.0s");
    await expect(metadata.textContent).toContain("2 items");
    // The corner drill control used to be checked here too (its glyph's stroke
    // weight). It is gone, and its Layers glyph survives as the caption's KIND
    // icon — a label, not a control — which is grid-only and so belongs to
    // CollectionGridCaptionLeadsWithItsKind below, not to a story about
    // disabled visuals in a strip-sized box.
    await userEvent.click(card as HTMLElement);
    await expect((card as HTMLElement).className).toContain("ring-blue-500");
    await expect((card as HTMLElement).className).toContain("ring-inset");
    // The frame still renders — a disabled card shows its content, muted.
    await expect(previewImages(canvasElement)).toHaveLength(1);
  },
};

/** Two sibling cards, so selecting one can be checked against the other. */
const SIB_A = "sib-a" as NodeId;
const SIB_B = "sib-b" as NodeId;
/** Never clicked — the bystander the assertion is actually about. */
const SIB_C = "sib-c" as NodeId;
const siblingGraph = (() => {
  const result = buildGraph([
    {
      kind: "collection",
      id: "sib-root",
      name: "Root",
      children: [
        { kind: "media", id: SIB_A, name: "A", src: poster("A", "#0ea5e9"), durationSeconds: 4 },
        { kind: "media", id: SIB_B, name: "B", src: poster("B", "#f59e0b"), durationSeconds: 4 },
        { kind: "media", id: SIB_C, name: "C", src: poster("C", "#22c55e"), durationSeconds: 4 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

export const SelectingOneCardDoesNotRerenderTheOther: Story = {
  // The package's bystander guarantee, asserted through the APP's own card
  // registry rather than the package's defaults — this is the composition the
  // graph actually ships, and nothing else covered it.
  //
  // Written while reviewing PL14-007, on a suspicion that turned out to be
  // WRONG and is worth recording: the right-click menu wraps every card via
  // the registered ItemShell and subscribed to `interaction.selectedIds` (the
  // Set, which `setSelection` replaces on every change), which looked like it
  // would re-render every card on any selection. It does not. `GraphMediaItem`
  // and `GraphCollectionItem` are both `memo`, so the re-render stops at the
  // thin wrapper and never reaches the card. This story PASSES against that
  // version too — it is not a regression test for it.
  //
  // What it is worth: the memo boundary is the only thing holding that line,
  // and nothing was asserting it. Remove a `memo`, or give the wrapper a prop
  // that changes per selection, and this fails.
  args: { id: SIB_A },
  decorators: [
    (Story) => (
      <DndCollections initialGraph={siblingGraph}>
        <GraphDetailsProvider store={createGraphDetailsStore({})}>
          <div className="flex h-32 gap-2 bg-zinc-950 p-2">
            <Story />
          </div>
        </GraphDetailsProvider>
      </DndCollections>
    ),
  ],
  render: () => (
    <>
      <ItemShell id={SIB_A} className="h-full w-24" />
      <ItemShell id={SIB_B} className="h-full w-24" />
      <ItemShell id={SIB_C} className="h-full w-24" />
    </>
  ),
  play: async ({ canvasElement }) => {
    // The count lives on the NodeCard button (`[data-node-id]`) for media
    // cards, not on the CollectionItem wrapper.
    const card = (id: string) =>
      canvasElement.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
    const renders = (id: string) => card(id).getAttribute("data-render-count");

    await waitFor(() => expect(card(SIB_C)).toBeTruthy());
    expect(renders(SIB_C)).not.toBeNull();

    // C is never touched. Two selection changes happen around it, and its
    // render count must not move for either — that is the whole guarantee.
    const bystander = renders(SIB_C);

    await userEvent.click(card(SIB_A));
    await waitFor(() => expect(card(SIB_A).getAttribute("data-selected")).toBe("true"));
    expect(renders(SIB_C)).toBe(bystander);

    await userEvent.click(card(SIB_B));
    await waitFor(() => expect(card(SIB_B).getAttribute("data-selected")).toBe("true"));
    expect(card(SIB_A).getAttribute("data-selected")).toBeNull();
    expect(renders(SIB_C)).toBe(bystander);
  },
};

/**
 * The anchor's `⋮` and its count badge (spec v3, §5–§6).
 *
 * Covers the three states the corner slot has to hold apart: unselected (no
 * control beyond the card's own), selected-but-not-anchor (badge, no `⋮`), and
 * anchor (`⋮` + count). The v2 pill this replaces had a width-driven fold
 * ladder and could not be covered by one story at all — which is most of why
 * it is gone.
 */
export const AnchorControlAndCountBadge: Story = {
  args: { id: SIB_A },
  decorators: [
    (Story) => (
      <DndCollections initialGraph={siblingGraph}>
        <GraphDetailsProvider store={createGraphDetailsStore({})}>
          <div className="flex h-32 gap-2 bg-zinc-950 p-2">
            <Story />
          </div>
        </GraphDetailsProvider>
      </DndCollections>
    ),
  ],
  render: () => (
    <>
      <ItemShell id={SIB_A} className="h-full w-24" />
      <ItemShell id={SIB_B} className="h-full w-24" />
      <ItemShell id={SIB_C} className="h-full w-24" />
    </>
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const card = (id: string) =>
      canvasElement.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
    const controls = () => doc.querySelectorAll("[data-anchor-menu]");
    const badges = () => doc.querySelectorAll("[data-anchor-count-badge]");

    // ONE session, because the modifier below has to be held ACROSS a click —
    // the static `userEvent` API resets keyboard state per call, so a held
    // Control never reaches the second click.
    const user = userEvent.setup();

    await waitFor(() => expect(card(SIB_A)).toBeTruthy());
    // Nothing selected: no anchor, so no control (R5.5).
    expect(controls()).toHaveLength(0);

    // One selected: the `⋮` appears on it, and NO badge — the glyph alone
    // marks the anchor and there is no scope ambiguity at one item (R6.5).
    await user.click(card(SIB_A));
    await waitFor(() => expect(controls()).toHaveLength(1));
    expect(controls()[0]?.getAttribute("data-anchor-menu")).toBe(SIB_A);
    expect(badges()).toHaveLength(0);

    // Two selected: the badge appears with the count, and the `⋮` moves to the
    // card just clicked. EXACTLY ONE exists on screen (R5.4) — a second would
    // imply a second paste destination.
    await user.keyboard("{Control>}");
    await user.click(card(SIB_B));
    await user.keyboard("{/Control}");
    await waitFor(() => expect(badges()).toHaveLength(1));
    expect(badges()[0]?.textContent).toBe("2");
    expect(controls()).toHaveLength(1);
    expect(controls()[0]?.getAttribute("data-anchor-menu")).toBe(SIB_B);

    // The count is in the accessible NAME (R6.12), because the badge is
    // aria-hidden — this is the only place a screen reader hears it here.
    expect(controls()[0]?.getAttribute("aria-label")).toBe("Actions, 2 items selected");
    expect(badges()[0]?.getAttribute("aria-hidden")).toBe("true");

    // R5.3 used to be checked here as "both selected cards keep their amber
    // badge, the anchor included". That badge is gone — the ring and the
    // checkbox already said the same thing in two other places — so what is
    // left to assert is that the anchor is not marked as LESS selected than its
    // companion, which is the failure R5.3 existed to prevent.
    expect(doc.querySelectorAll("[data-card-selected-badge]")).toHaveLength(0);
    expect(
      Array.from(doc.querySelectorAll("[data-selected]")).map((el) =>
        el.getAttribute("data-selected"),
      ),
    ).toEqual(["true", "true"]);
  },
};

// ── Tags ────────────────────────────────────────────────────────────────────

/** A tagged COLLECTION card. Collections route through
 *  GraphCollectionItemParts rather than GraphClipContent, so they need their
 *  own cover — a media-only implementation would leave tagged collections
 *  showing nothing at all. */
function renderWithTags(tags: string[], surface: "grid" | "strip" = "strip") {
  const detail: ClipDetail = {
    alt: "A timeline",
    aspect: 16 / 9,
    trackIndex: 0,
    hydrated: false,
    itemCount: 2,
    previewItems: [ASSET_A, ASSET_B],
    tags,
  };
  const store = createGraphDetailsStore({ [COLLECTION_ID]: detail });
  const decorator: Decorator = (Story) => (
    <DndCollections initialGraph={providerGraph}>
      <GraphDetailsProvider store={store}>
        {/* The grid marker is what the card matches on, so a "grid" story sets
            it here exactly as VirtualGrid does — and gets the taller box a
            grid cell actually has, since the caption needs somewhere to go. */}
        <div
          {...(surface === "grid" ? { "data-virtual-grid": "story" } : {})}
          className={surface === "grid" ? "h-52 w-64 bg-zinc-950 p-2" : "h-32 w-40 bg-zinc-950 p-2"}
        >
          <Story />
        </div>
      </GraphDetailsProvider>
    </DndCollections>
  );
  return decorator;
}

/** The chips actually on screen, excluding the measuring ruler and the +N. */
function visibleTagChips(canvasElement: HTMLElement): HTMLElement[] {
  const row = canvasElement.querySelector<HTMLElement>("[data-clip-caption-tags]")!;
  return Array.from(
    row.querySelectorAll<HTMLElement>(
      ":scope > [title]:not([data-clip-caption-tags-overflow])",
    ),
  );
}

/** A few tags render in full, in the order they were stored. */
export const TaggedCollectionCard: Story = {
  args: baseArgs,
  decorators: [renderWithTags(["scail-2", "S02"], "grid")],
  play: async ({ canvasElement }) => {
    // GRID, because tags are a grid idea now — the strip's overlay row is gone
    // (see StripCardHasNoTagRow below).
    const row = canvasElement.querySelector<HTMLElement>("[data-clip-caption-tags]")!;
    await expect(row).not.toBeNull();
    await expect(row.dataset.clipCaptionTags).toBe("2");

    // Both fit at this width, so nothing folds.
    const chips = visibleTagChips(canvasElement);
    await expect(chips.map((chip) => chip.title)).toEqual(["scail-2", "S02"]);
    await expect(canvasElement.querySelector("[data-clip-caption-tags-overflow]")).toBeNull();
    for (const chip of chips) {
      await expect(chip.getBoundingClientRect().width).toBeGreaterThan(0);
    }

    // Nothing in here may be interactive — this subtree renders inside the
    // card's selection surface, which is itself a <button>.
    await expect(row.querySelector("button")).toBeNull();
  },
};

/**
 * Too many to fit: whole chips drop and the rest fold into a counter that
 * LISTS them on hover.
 *
 * The failure this guards is INVISIBLE: the row is `overflow-hidden` with no
 * ellipsis, so an unbounded set is clipped with nothing to show it was clipped
 * — a set that reads as complete but is not.
 */
export const ManyTagsFoldIntoACounter: Story = {
  args: baseArgs,
  decorators: [
    renderWithTags(["scail-2", "wan2.1", "S02", "keeper", "multirole"], "grid"),
  ],
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>("[data-clip-caption-tags]")!;
    await expect(row.dataset.clipCaptionTags).toBe("5");

    const overflow = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>(
        "[data-clip-caption-tags-overflow]",
      );
      if (found === null) throw new Error("no overflow counter yet");
      return found;
    });

    // FITTED, not a fixed count. The old row always showed exactly two; this
    // shows however many the width takes, so the assertion is a relationship
    // (some shown, some folded, and the two add up) rather than a magic number
    // that would only be about this machine's text metrics.
    const chips = visibleTagChips(canvasElement);
    await expect(chips.length).toBeGreaterThanOrEqual(1);
    await expect(chips.length).toBeLessThan(5);
    await expect(Number(overflow.dataset.clipCaptionTagsOverflow)).toBe(5 - chips.length);
    await expect(overflow.textContent).toBe(`+${5 - chips.length}`);

    // HOVER LISTS THE REST — and lists exactly the ones NOT on screen, which is
    // the whole point of the counter.
    const shownTitles = chips.map((chip) => chip.title);
    const listed = overflow.title.split("\n");
    await expect(listed.length).toBe(5 - chips.length);
    for (const title of shownTitles) await expect(listed).not.toContain(title);

    // MEASURED, not read. An earlier version asserted `textContent` and passed
    // while every chip was flex-shrunk to ZERO width — text present, nothing on
    // screen. And the row must stay inside the card, which clips silently.
    for (const chip of chips) {
      await expect(chip.getBoundingClientRect().width).toBeGreaterThan(0);
      await expect(chip.getBoundingClientRect().height).toBeGreaterThan(0);
    }
    const cardBox = canvasElement
      .querySelector<HTMLElement>("[data-node-id]")!
      .getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    await expect(rowBox.left).toBeGreaterThanOrEqual(cardBox.left);
    await expect(rowBox.right).toBeLessThanOrEqual(cardBox.right + 0.5);
  },
};

/**
 * The STRIP shows no tags at all.
 *
 * A strip clip's width IS its duration, so the overlay row this replaces let a
 * clip's LENGTH decide which of its tags you saw — two clips with identical
 * tags disagreed about them, and a short one covered its own frame to do it.
 */
export const StripCardHasNoTagRow: Story = {
  args: baseArgs,
  decorators: [renderWithTags(["scail-2", "wan2.1", "S02"], "strip")],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-clip-tags]")).toBeNull();
    const caption = canvasElement.querySelector<HTMLElement>("[data-clip-caption-tags]");
    // The caption row is CSS-gated rather than unmounted, so absence is not the
    // assertion — zero height is.
    await expect(caption?.getBoundingClientRect().height ?? 0).toBe(0);
  },
};

/** An untagged card grows no row at all — absence is the default everywhere
 *  else in this model, and an empty chip strip would read as a data glitch. */
export const UntaggedCardHasNoTagRow: Story = {
  args: baseArgs,
  decorators: [renderWithTags([], "grid")],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-clip-caption-tags]")).toBeNull();
    await expect(canvasElement.querySelector("[data-clip-tags]")).toBeNull();
  },
};

// ---------------------------------------------------------------------------
// The GRID card's caption, and the select-mode checkbox.
//
// Both are surface-dependent, and the surface is signalled by a CSS ancestor
// marker (`[data-virtual-grid]`) rather than a prop — the card renderer is
// shared and has no idea which view it is in. So these stories set that marker
// themselves, exactly as VirtualGrid does, and a strip story simply omits it.
// ---------------------------------------------------------------------------

/** Arms select mode from inside the provider, where the store is reachable. */
function ArmSelectMode() {
  const store = useCollectionsStore();
  useEffect(() => {
    store.setMultiSelectMode(true);
  }, [store]);
  return null;
}

function renderMediaCard(
  options: Readonly<{ surface: "grid" | "strip"; tags?: string[]; selectMode?: boolean }>,
): Decorator {
  const { surface, tags = [], selectMode = false } = options;
  return function MediaCardDecorator(Story) {
    const store = createGraphDetailsStore({
      [VIDEO_ID as string]: {
        alt: "A video",
        aspect: 16 / 9,
        trackIndex: 0,
        hydrated: false,
        tags,
      },
    });
    return (
      <DndCollections
        initialGraph={videoGraph}
        components={GRAPH_VIEW_COMPONENTS}
        keepMultiSelectModeWhenEmpty
      >
        <GraphDetailsProvider store={store}>
          {selectMode ? <ArmSelectMode /> : null}
          <VideoFrameLookAhead>
            {/* The grid marker goes on an ANCESTOR, which is the whole point:
                the card matches `[[data-virtual-grid]_&]` through the DOM, so
                nothing has to be threaded down to it. */}
            <div
              {...(surface === "grid" ? { "data-virtual-grid": "story" } : {})}
              className="bg-zinc-950 p-2"
            >
              <div style={{ width: 260, height: surface === "grid" ? 210 : 120 }}>
                <Story />
              </div>
            </div>
          </VideoFrameLookAhead>
        </GraphDetailsProvider>
      </DndCollections>
    );
  };
}

const mediaArgs = { id: VIDEO_ID, className: "h-full w-full" };

/**
 * The collection twin of `renderMediaCard`, in the grid with select mode armed.
 *
 * `keepMultiSelectModeWhenEmpty` for the same reason that one needs it: nothing
 * is selected in a story, and the mode otherwise stands itself down.
 */
function renderCollectionInSelectMode(): Decorator {
  return function CollectionSelectModeDecorator(Story) {
    const store = createGraphDetailsStore({
      [COLLECTION_ID]: {
        alt: "A timeline",
        aspect: 16 / 9,
        trackIndex: 0,
        hydrated: false,
        itemCount: 2,
        duration: 51.8,
        previewItems: [ASSET_A, ASSET_B],
      },
    });
    return (
      <DndCollections
        initialGraph={providerGraph}
        components={GRAPH_VIEW_COMPONENTS}
        keepMultiSelectModeWhenEmpty
      >
        <GraphDetailsProvider store={store}>
          <ArmSelectMode />
          <div data-virtual-grid="story" className="h-52 w-64 bg-zinc-950 p-2">
            <Story />
          </div>
        </GraphDetailsProvider>
      </DndCollections>
    );
  };
}

/**
 * The caption geometry EVERY grid card shares, media and collection alike:
 * the distance from the card's outer edge to its caption icon, and that icon's
 * box. 13px = 1px border + 6px card padding + 6px caption padding.
 *
 * Asserted in both card kinds' stories against these numbers rather than
 * against each other, because the two cannot be rendered in one canvas — which
 * is exactly how they drifted apart. Media was 4px in with a 14px icon,
 * collection 6px with a 16px one; and even after matching those, media still
 * landed a pixel left, because the collection's dashed border consumes layout
 * where media's `ring` does not. All three had to agree.
 *
 * If a redesign moves these, move BOTH stories together. The shared number is
 * the contract; either story alone can be made to pass by breaking alignment.
 */
const CAPTION_INSET_PX = 13;
const CAPTION_ICON_PX = 16;

/** The caption's leading icon must start at the same inset on any card kind. */
async function expectCaptionIconAligned(
  canvasElement: HTMLElement,
  icon: Element,
): Promise<void> {
  const card = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
  const iconBox = icon.getBoundingClientRect();
  await expect(Math.round(iconBox.left - card.getBoundingClientRect().left)).toBe(
    CAPTION_INSET_PX,
  );
  await expect(Math.round(iconBox.width)).toBe(CAPTION_ICON_PX);
}

/**
 * In the GRID the chrome sits UNDER the artwork, not stamped across it.
 *
 * The two overlays it replaces have to go, or the card says everything twice
 * and covers its own picture to do it.
 */
export const GridCardCaptionSitsUnderTheArtwork: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid" })],
  play: async ({ canvasElement }) => {
    const caption = canvasElement.querySelector<HTMLElement>("[data-clip-caption]")!;
    await expect(caption).not.toBeNull();
    await expect(caption.getBoundingClientRect().height).toBeGreaterThan(0);
    // An unnamed clip captions as NOTHING — no filler word.
    //
    // This used to assert the opposite: the caption fell back to the KIND, so
    // an un-authored clip read "Video" in the name's own weight and size and
    // looked like it had been named that. PL11-004 keeps `title` absent until
    // someone authors one; the fallback quietly undid it. The kind ICON holds
    // the row instead, which is what keeps the line from collapsing.
    await expect(caption.textContent).not.toContain("Video");
    await expect(caption.querySelector("svg")).not.toBeNull();
    await expect(caption.getBoundingClientRect().height).toBeGreaterThan(0);

    // ALIGNED with a collection card's caption — see CAPTION_INSET_PX.
    await expectCaptionIconAligned(canvasElement, caption.querySelector("svg")!);

    // BELOW the frame, not over it. Measured, because the whole change is a
    // geometric one and a caption that rendered on top of the artwork would
    // still satisfy every text assertion above.
    const artwork = canvasElement.querySelector<HTMLElement>("img")!;
    await expect(caption.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      artwork.getBoundingClientRect().bottom - 1,
    );

    // The overlay the caption replaces is gone in this surface.
    const kindChip = canvasElement.querySelector<HTMLElement>("[data-media-kind]")!;
    await expect(kindChip.getBoundingClientRect().height).toBe(0);
  },
};

/**
 * The STRIP keeps its overlays and grows no caption.
 *
 * The divergence is deliberate: a strip card's width IS its duration, so a
 * caption row is fixed overhead on every clip and unreadable on a short one.
 * Pinned as a pair with the story above, because the two are one decision and
 * a regression would most likely make both surfaces the same again.
 */
export const StripCardKeepsItsOverlays: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "strip" })],
  play: async ({ canvasElement }) => {
    const caption = canvasElement.querySelector<HTMLElement>("[data-clip-caption]");
    // Present in the DOM but not laid out — it is CSS-gated, not conditionally
    // rendered, so `toBeNull` would be the wrong assertion and would pass for
    // the wrong reason if the gate were ever removed.
    await expect(caption?.getBoundingClientRect().height ?? 0).toBe(0);

    const kindChip = canvasElement.querySelector<HTMLElement>("[data-media-kind]")!;
    await expect(kindChip.getBoundingClientRect().height).toBeGreaterThan(0);
    await expect(kindChip.textContent).toBe("VIDEO");
  },
};

/**
 * Caption tags fold into a counter, and STATUS survives the fold.
 *
 * The ordering is the assertion that matters. Card space runs out before tags
 * do, so whatever sorts last is what disappears — and "approved" is not
 * recoverable from the picture the way "night" is.
 */
export const CaptionTagsFoldStatusFirst: Story = {
  args: mediaArgs,
  decorators: [
    renderMediaCard({ surface: "grid", tags: ["night", "approved", "scail-2", "wip"] }),
  ],
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>("[data-clip-caption-tags]")!;
    await expect(row.dataset.clipCaptionTags).toBe("4");

    const chips = visibleTagChips(canvasElement);
    // The two STATUS tags LEAD, though neither was stored first.
    //
    // Asserted as an ordering rather than as an exact kept-set: the row fits as
    // many chips as the width takes now, so pinning "exactly these two survive"
    // would be a test about this machine's text metrics. What must hold at any
    // width is that status sorts to the front — so if anything folds, the
    // status tags are never what goes.
    await expect(chips.length).toBeGreaterThanOrEqual(2);
    await expect(chips.slice(0, 2).map((chip) => chip.title)).toEqual(["approved", "wip"]);
    for (const chip of chips) {
      await expect(chip.getBoundingClientRect().width).toBeGreaterThan(0);
    }

    // And whatever folded, if anything did, holds NO status tag.
    const overflow = canvasElement.querySelector<HTMLElement>(
      "[data-clip-caption-tags-overflow]",
    );
    if (overflow !== null) {
      const folded = overflow.title.split("\n");
      await expect(folded).not.toContain("approved");
      await expect(folded).not.toContain("wip");
    }

    // Colour is DERIVED, so the two status words must land in their own
    // families rather than sharing one — that is what the dot is for. Scoped to
    // the two leading chips for the same reason as above: how many chips follow
    // them depends on the width, and those carry their own (non-status) accent.
    const accents = chips
      .slice(0, 2)
      .map((chip) => chip.querySelector("[data-tag-accent]")?.getAttribute("data-tag-accent"));
    await expect(accents).toEqual(["ok", "progress"]);
  },
};

/**
 * A GRID video is ONE frame, full width — a thumbnail, like an image card.
 *
 * It used to split the cell between a first and last frame at 50% each, which
 * showed two half-width crops and said nothing about duration that the cell's
 * own width could carry (a grid cell's width is the cell's, not the clip's).
 * Pinned as a PAIR with the strip story below, because the two are one decision
 * and a regression would most likely make both surfaces the same again.
 */
export const GridVideoIsASingleFrame: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid" })],
  play: async ({ canvasElement }) => {
    const frames = await waitFor(() => {
      const found = Array.from(canvasElement.querySelectorAll<HTMLImageElement>("img"));
      if (found.length === 0) throw new Error("no frames yet");
      return found;
    });
    await expect(frames).toHaveLength(1);

    // FULL WIDTH, which is the half that "one frame" alone does not promise —
    // a single frame flex-shrunk into half the card would satisfy a count.
    const artwork = frames[0]!.getBoundingClientRect();
    const card = canvasElement
      .querySelector<HTMLElement>("[data-node-id]")!
      .getBoundingClientRect();
    await expect(artwork.width).toBeGreaterThan(card.width * 0.8);
  },
};

/** The STRIP keeps its filmstrip: there, a card's width IS its duration, so
 *  extra width is extra time and a sequence of frames is what belongs in it. */
export const StripVideoKeepsItsFilmstrip: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "strip" })],
  play: async ({ canvasElement }) => {
    const frames = await waitFor(() => {
      const found = Array.from(canvasElement.querySelectorAll<HTMLImageElement>("img"));
      if (found.length < 2) throw new Error("filmstrip has not sampled yet");
      return found;
    });
    await expect(frames.length).toBeGreaterThan(1);
  },
};

/**
 * A GRID card carries NO corner `⋮`, even as the anchor.
 *
 * Everything it opened lives in the select row now, so a per-card menu was a
 * second route to the same list parked in every cell. Hidden rather than
 * deleted — see CardCornerSlot, which still renders and still anchors; the grid
 * just does not show it.
 */
export const GridCardHasNoCornerMenu: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid", selectMode: true })],
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
    await userEvent.click(card);
    await waitFor(() => expect(card.getAttribute("data-selected")).toBe("true"));

    // ANCHORED — so the slot's own condition is met and the only thing keeping
    // the control off screen is the grid rule. Asserting mere absence would
    // pass just as well on a card that was never the anchor, which is the
    // wrong reason and would not catch the rule being dropped.
    const menu = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-anchor-menu]");
    await expect(menu?.getBoundingClientRect().height ?? 0).toBe(0);
  },
};

/** The STRIP keeps its corner `⋮`: narrow cards with no caption band, and no
 *  select-row equivalent to fall back on. Pinned as a pair with the story
 *  above — a regression would most likely make both surfaces agree again. */
export const StripCardKeepsItsCornerMenu: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "strip", selectMode: true })],
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
    await userEvent.click(card);
    await waitFor(() => expect(card.getAttribute("data-selected")).toBe("true"));

    const menu = await waitFor(() => {
      const found = canvasElement.ownerDocument.querySelector<HTMLElement>("[data-anchor-menu]");
      if (found === null) throw new Error("no corner menu yet");
      return found;
    });
    await expect(menu.getBoundingClientRect().height).toBeGreaterThan(0);
  },
};

/** No tags, no row — and the caption still renders its meta line. */
export const CaptionWithoutTagsHasNoTagRow: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid" })],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-clip-caption-tags]")).toBeNull();
    await expect(canvasElement.querySelector("[data-clip-caption]")).not.toBeNull();
  },
};

/**
 * The select-mode checkbox: PINNED ON while the mode is armed.
 *
 * DECORATIVE by necessity — this renders inside NodeCard's real <button>, and a
 * button may not contain interactive content. The assertion that it is not a
 * button is therefore a structural contract, not a style preference: making it
 * one would eject the rest of the card out of its own box. It stays true now
 * that hover reveals the same circle: hovering advertises that the card can be
 * picked, and the click that picks it belongs to the card underneath.
 */
export const SelectModeShowsACheckbox: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid", selectMode: true })],
  play: async ({ canvasElement }) => {
    const indicator = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>("[data-selection-indicator]");
      if (!found) throw new Error("no selection indicator");
      return found;
    });
    await expect(indicator.dataset.selectionIndicator).toBe("off");
    await expect(indicator.dataset.selectionIndicatorReveal).toBe("armed");
    await expect(indicator.getBoundingClientRect().width).toBeGreaterThan(0);
    await expect(indicator.getAttribute("aria-hidden")).toBe("true");
    await expect(indicator.querySelector("button")).toBeNull();
    // Armed means VISIBLE without a pointer anywhere near it. Opacity rather
    // than presence, because the hover path below shares this element and only
    // opacity separates the two states.
    await expect(getComputedStyle(indicator).opacity).toBe("1");

    // ON THE ARTWORK, not on the caption below it. It moved into its own
    // positioning box for exactly this reason, and a regression would drop it
    // onto the caption where it would sit over the tags.
    const artwork = canvasElement.querySelector<HTMLElement>("img")!;
    await expect(indicator.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      artwork.getBoundingClientRect().bottom + 1,
    );
  },
};

/**
 * Idle, the checkbox is RENDERED but invisible, waiting on hover.
 *
 * The change from "absent" to "transparent" is the whole mechanism: hover is
 * owned by CSS so that no pointer state has to reach React, where a hover that
 * re-rendered every card would land on the drag/INP hot path. So the old
 * `toBeNull` is the wrong assertion now and would pass for the wrong reason if
 * the reveal ever broke — opacity is what to measure.
 *
 * THE REVEAL ITSELF IS NOT TESTABLE HERE, and the first version of this story
 * pretended otherwise. `userEvent.hover` dispatches synthetic pointer events;
 * CSS `:hover` is a browser state driven by real pointer position, and no
 * synthetic event sets it. The story sat at opacity 0 and failed, which was the
 * test being wrong rather than the CSS. Real-mouse hover lives in the e2e suite
 * ("the select checkbox appears on hover…"), which is the layer this repo keeps
 * for trusted input.
 */
export const CheckboxWaitsForHoverOutsideSelectMode: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid" })],
  play: async ({ canvasElement }) => {
    const indicator = canvasElement.querySelector<HTMLElement>("[data-selection-indicator]");
    await expect(indicator).not.toBeNull();
    await expect(indicator!.dataset.selectionIndicatorReveal).toBe("hover");
    await expect(getComputedStyle(indicator!).opacity).toBe("0");
    // Transparent, NOT display:none — it has to keep its box, or the reveal
    // would relayout the card under the pointer.
    await expect(indicator!.getBoundingClientRect().width).toBeGreaterThan(0);
  },
};

/**
 * In the GRID a collection files its tags in the caption, not over its preview
 * frames — the same split the media card makes.
 *
 * Pinned because the two card kinds are rendered by DIFFERENT components
 * (collections route through the composed CollectionItem shell, media through
 * NodeCard), so nothing structural forces them to agree. They diverged once
 * already: media moved its tags into the caption and collections did not, which
 * put two kinds of card in one grid filing the same thing in two places.
 */
export const CollectionGridTagsSitInTheCaption: Story = {
  args: baseArgs,
  decorators: [renderWithTags(["scail-2", "approved"], "grid")],
  play: async ({ canvasElement }) => {
    const caption = canvasElement.querySelector<HTMLElement>("[data-collection-caption-tags]")!;
    await expect(caption).not.toBeNull();
    await expect(caption.getBoundingClientRect().height).toBeGreaterThan(0);

    // Status first, as everywhere else tags are shown.
    const chips = Array.from(caption.querySelectorAll<HTMLElement>("span[title]"));
    await expect(chips.map((chip) => chip.title)).toEqual(["approved", "scail-2"]);

    // And the OVERLAY row is stood down here, or the card would say it twice.
    const overlay = canvasElement.querySelector<HTMLElement>("[data-clip-tags]");
    await expect(overlay?.getBoundingClientRect().height ?? 0).toBe(0);

    // Below the preview frames, not on them.
    const frame = canvasElement.querySelector<HTMLElement>("img")!;
    await expect(caption.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      frame.getBoundingClientRect().bottom - 1,
    );
  },
};

/**
 * A grid collection caption leads with its KIND icon, in the same [icon] name
 * shape the media caption uses — so the two card kinds read as one family.
 *
 * The glyph is inherited from the deleted corner drill BUTTON, which is the
 * reason the "not a control" half of this is asserted rather than assumed. The
 * card opens on a plain click now; a clickable Layers in the caption would
 * quietly restore the thing that was removed, in a new place, and look like a
 * label while doing it.
 */
export const CollectionGridCaptionLeadsWithItsKind: Story = {
  args: baseArgs,
  decorators: [renderWithTags([], "grid")],
  play: async ({ canvasElement }) => {
    const kind = canvasElement.querySelector<SVGElement>("[data-collection-kind]")!;
    await expect(kind).not.toBeNull();
    await expect(kind.getBoundingClientRect().width).toBeGreaterThan(0);

    // The OTHER half of the shared caption geometry — the media card's story
    // asserts the identical two numbers, which is what makes a mixed grid line
    // up. See CAPTION_INSET_PX.
    await expectCaptionIconAligned(canvasElement, kind);

    // A LABEL: hidden from the a11y tree, and no control of its own.
    //
    // NOT `closest("button") === null` — the caption row renders INSIDE the
    // card's selection surface, which is a real <button> (that is also why the
    // select-mode checkbox had to be anchored off the frames rather than the
    // card; see the story below). So the assertion is that the nearest button
    // above the glyph is the CARD, with nothing of its own in between.
    await expect(kind.getAttribute("aria-hidden")).toBe("true");
    const surface = canvasElement.querySelector<HTMLElement>("[data-node-id]")!;
    await expect(
      kind.closest("button, [role='button'], a[href], [tabindex]"),
    ).toBe(surface);

    // LEADS the name — left of it, on the same line. Both halves matter: an
    // icon that wrapped above the name would satisfy a left-of test on its own.
    const name = canvasElement.querySelector<HTMLElement>(
      '[title="Click or press F2 to rename"]',
    )!;
    const kindRect = kind.getBoundingClientRect();
    const nameRect = name.getBoundingClientRect();
    await expect(kindRect.right).toBeLessThanOrEqual(nameRect.left + 1);
    await expect(Math.abs(kindRect.top - nameRect.top)).toBeLessThan(nameRect.height);

    // And it is GRID-ONLY: the strip footer is a tight one-liner where this
    // would cost more than it says. CSS-gated, not conditionally rendered, so
    // the assertion is on layout rather than on presence.
    await expect(
      canvasElement.querySelector<HTMLElement>("[data-collection-metadata]"),
    ).not.toBeNull();
  },
};

/** The strip half of the pair above: present in the DOM, laid out at zero. */
export const StripCollectionCaptionHasNoKindIcon: Story = {
  args: baseArgs,
  decorators: [renderWithTags([], "strip")],
  play: async ({ canvasElement }) => {
    const kind = canvasElement.querySelector<SVGElement>("[data-collection-kind]");
    await expect(kind?.getBoundingClientRect().width ?? 0).toBe(0);
  },
};

/**
 * Select mode's checkbox rides the PREVIEW FRAMES, clear of the metadata row.
 *
 * Anchored to the whole card it landed on the name-and-count row underneath and
 * truncated it — "51.8s / 5 it…" — because that row is inside the selection
 * surface too, so a bottom-right box lands on the text rather than on the
 * artwork. The fix was a positioning box around the frames alone; this is the
 * measurement that would have caught it.
 */
export const CollectionSelectModeCheckboxClearsTheMetadata: Story = {
  args: baseArgs,
  decorators: [renderCollectionInSelectMode()],
  play: async ({ canvasElement }) => {
    const indicator = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>("[data-selection-indicator]");
      if (!found) throw new Error("no selection indicator");
      return found;
    });
    await expect(indicator.dataset.selectionIndicator).toBe("off");

    // Over the frames…
    const frame = canvasElement.querySelector<HTMLElement>("img")!;
    await expect(indicator.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      frame.getBoundingClientRect().bottom + 1,
    );

    // …and clear of the metadata row, which is THE regression: they overlap by
    // a pixel or they do not.
    const metadata = canvasElement.querySelector<HTMLElement>("[data-collection-metadata]")!;
    await expect(indicator.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      metadata.getBoundingClientRect().top + 1,
    );
    await expect(metadata.textContent).toContain("2 items");
  },
};

/**
 * The collection card's checkbox waits on hover too.
 *
 * Its own story rather than a second case in the media one, because the two
 * card kinds carry DIFFERENT literal class strings
 * (`group-hover/collection-item` vs `group-hover/media-item`). Tailwind's JIT
 * scans source text, so a wrong or interpolated group name produces a class
 * that is never generated and a checkbox that silently never appears — and the
 * media story would still be green. Two kinds, two literals, two covers.
 *
 * Collections are the kind that needs it most: a plain click drills IN, so this
 * circle is the only thing on the card that says it can be picked at all.
 */
export const CollectionCheckboxWaitsForHover: Story = {
  args: baseArgs,
  decorators: [renderWithTags([], "grid")],
  play: async ({ canvasElement }) => {
    const indicator = canvasElement.querySelector<HTMLElement>("[data-selection-indicator]");
    await expect(indicator).not.toBeNull();
    await expect(indicator!.dataset.selectionIndicatorReveal).toBe("hover");
    await expect(getComputedStyle(indicator!).opacity).toBe("0");
    await expect(indicator!.getBoundingClientRect().width).toBeGreaterThan(0);
  },
};
