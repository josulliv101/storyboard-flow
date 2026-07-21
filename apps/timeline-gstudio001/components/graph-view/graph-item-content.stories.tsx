import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";

import type { ClipDetail } from "@storyboard/timeline-domain";
import {
  DndCollections,
  buildGraph,
  type CollectionItemContentComponent,
  type CollectionItemContentProps,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { GRAPH_VIEW_COMPONENTS } from "./graph-item-content";
import { GraphDetailsProvider } from "./graph-details-context";
import { createGraphDetailsStore } from "@/lib/graph-details-store";

// The collection card's ItemContent renders two preview frames — the child
// timeline's FIRST and LAST preview items. Stored clip ids are NOT unique
// across positions (the same asset placed twice mints the same stable id — see
// the duplicate-media machinery in `packages/timeline-domain/src/adapter.ts`),
// so a collection whose first and last preview items reference the SAME asset
// used to render two frames with the same React key. These deterministic,
// offline stories (data-URI posters, an in-memory details store) cover the
// "repeated thumbnails" case the repo rules require and pin the fix: both
// frames must render, with no duplicate-key collision.

// The registry field is optional in the type; the graph view always registers
// it, so narrow to the defined component for `Meta`.
const ItemContent: CollectionItemContentComponent = GRAPH_VIEW_COMPONENTS.ItemContent!;

const COLLECTION_ID = "col-1" as NodeId;

/** A one-node graph so the card's collections-store hooks have a provider.
 *  Its contents are irrelevant: the card renders un-hydrated here, so its
 *  preview frames come from the stored `previewItems` below, not the graph. */
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

/** Wraps the card content in a collections store (its preview-derivation hook
 *  needs one) and a details store (so `useClipDetail` resolves). `hydrated:
 *  false` keeps the frames coming from the stored `previewItems` here — a
 *  hydrated card would instead derive them from live graph children, which
 *  this offline fixture deliberately does not carry. */
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

const baseArgs: CollectionItemContentProps = {
  id: COLLECTION_ID,
  node: { id: COLLECTION_ID, kind: "collection", name: "A timeline" },
  childCount: 2,
  selected: false,
  rejected: false,
  isDragSource: false,
  dragActivation: "body",
  trimEnabled: false,
};

const meta = {
  title: "GStudio/GraphView/CollectionCardContent",
  component: ItemContent,
  tags: ["autodocs"],
} satisfies Meta<typeof ItemContent>;

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
