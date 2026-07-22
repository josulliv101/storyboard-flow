import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "storybook/test";

import type { ClipDetail } from "@storyboard/timeline-domain";
import {
  DndCollections,
  buildGraph,
  type CollectionItemShellComponent,
  type CollectionItemShellProps,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { GRAPH_VIEW_COMPONENTS } from "./graph-item-content";
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

const COLLECTION_ID = "col-1" as NodeId;

/** A one-node graph: the shell reads the node (kind, name) from the store.
 *  The card renders un-hydrated here, so its preview frames come from the
 *  stored `previewItems` below, not from graph children. */
const providerGraph = (() => {
  const result = buildGraph([{ kind: "collection", id: COLLECTION_ID, name: "A timeline", children: [] }]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

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

/** Distinct first/last assets: the ordinary two-frame collection card. */
export const DistinctFrames: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B])],
  play: async ({ canvasElement }) => {
    const images = previewImages(canvasElement);
    await expect(images).toHaveLength(2);
  },
};

/**
 * The regression: the same asset is BOTH the first and last preview item (the
 * same clip placed at the start and end of a child timeline — real data per
 * the adapter's demotion comment). First and last therefore share an id, which
 * used to collide on the React key and reconcile to a single stretched frame.
 * Both frames must render.
 */
export const RepeatedFirstAndLastFrame: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B, ASSET_A])],
  play: async ({ canvasElement }) => {
    const images = previewImages(canvasElement);
    // Both frames render despite first and last sharing an asset id — the
    // regression rendered a single stretched frame after React collapsed the
    // duplicate key.
    await expect(images).toHaveLength(2);
    await expect(images[0]).toHaveAttribute("src", ASSET_A.poster);
    await expect(images[1]).toHaveAttribute("src", ASSET_A.poster);
  },
};

/** A single-item collection shows one frame across the full width. */
export const SingleFrame: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A])],
  play: async ({ canvasElement }) => {
    const images = previewImages(canvasElement);
    await expect(images).toHaveLength(1);
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
  },
};

/**
 * The composed card's STRUCTURE (review finding 1): the selection surface is
 * a real <button> with zero interactive content inside it, the folder
 * drill-in is a real <button> sibling, and the rename editor is a real
 * <input> sibling — and renaming through it updates the graph node (the
 * surface's accessible name) in place.
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

    // The folder control is a REAL button OUTSIDE the surface.
    const folder = canvasElement.querySelector<HTMLElement>('button[aria-label^="Open "]');
    await expect(folder).not.toBeNull();
    await expect(surface!.contains(folder)).toBe(false);

    // Double-click the name label → a REAL input opens outside the surface...
    const label = Array.from(surface!.querySelectorAll("span")).find(
      (el) => el.textContent === "A timeline",
    )!;
    await userEvent.dblClick(label);
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
