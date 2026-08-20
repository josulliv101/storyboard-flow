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

import { GRAPH_VIEW_COMPONENTS } from "./graph-item-content";
import { VideoFrameLookAhead } from "./graph-card-frame-loading";
import { GraphDetailsProvider } from "./graph-details-context";
import { createGraphDetailsStore } from "@/lib/graph-details-store";
import { ClipNamesProvider } from "./graph-clip-names";

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

/** A HYDRATED collection whose first child is audio. Audio is skipped by the
 *  preview walk (it has no frame), so this card has nothing to draw — and the
 *  film-leader glyph it used to fall back to says "no picture" where the true
 *  answer is "this is sound". */
const AUDIO_COLLECTION_ID = "audio-col" as NodeId;
const audioCollectionGraph = (() => {
  const result = buildGraph([
    {
      kind: "collection",
      id: AUDIO_COLLECTION_ID,
      name: "Voice takes",
      children: [
        {
          kind: "media",
          id: "vo-1" as NodeId,
          name: "Pat VO",
          mediaKind: "audio",
          src: "data:audio/wav;base64,UklGRg==",
          fullDurationSeconds: 8,
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();


/** An audio MEDIA card — the clip itself, not a collection that leads with one.
 *  #314: the feature shipped without this. An audio card has no frame to draw
 *  and no poster to fall back to, so what it paints is the placeholder, and
 *  the kind stamp has to say AUDIO rather than defaulting to IMAGE. */
const AUDIO_CLIP_ID = "vo-solo" as NodeId;
const audioClipGraph = (() => {
  const result = buildGraph([
    {
      kind: "collection",
      id: "audio-parent" as NodeId,
      name: "Takes",
      children: [
        {
          kind: "media",
          id: AUDIO_CLIP_ID,
          name: "Pat VO",
          mediaKind: "audio",
          src: "data:audio/wav;base64,UklGRg==",
          fullDurationSeconds: 8,
        },
      ],
    },
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
function renderWithDetail(previewItems: PreviewItem[], trackIndex = 0) {
  const detail: ClipDetail = {
    alt: "A timeline",
    aspect: 16 / 9,
    hydrated: false,
    itemCount: previewItems.length,
    duration: previewItems.length * 4,
    previewItems,
  };
  const store = createGraphDetailsStore({ [COLLECTION_ID]: detail });
  // The LANE lives on the node, so it is built into the graph rather than
  // merged into the detail — see the note on `set-node-placement`.
  const graph = (() => {
    const result = buildGraph([
      {
        kind: "collection",
        id: COLLECTION_ID,
        name: "A timeline",
        children: [],
        ...(trackIndex === 0 ? {} : { trackIndex }),
      },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  })();
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
    // NO TIME on a placeholder. This fixture is un-hydrated, so the seconds
    // could only come from the stored summary — and those are wrong on 58.4% of
    // collection clips, with nothing on screen marking which. The count is
    // still shown; the time arrives when the branch loads.
    await expect(canvasElement).toHaveTextContent(/1 item/);
    await expect(canvasElement.textContent ?? "").not.toContain("4.0s");
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
    //
    // NAME FIRST, then context — a speech-input user says what they see.
    // The duration is deliberately absent: folding it in makes the accessible
    // name change when a branch finishes loading (see the card).
    await expect(surface.getAttribute("aria-label")).toBe("A timeline, collection, 2 items");
    // The COUNT survives on a placeholder and the time does not, which is the
    // asymmetry worth pinning: one level of reading settles a count exactly
    // (measured 0/3 wrong), while a duration sums the whole subtree and cannot
    // be known without it.
    await expect(canvasElement).toHaveTextContent(/2 items/);
    await expect(canvasElement.textContent ?? "").not.toContain("8.0s");

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

/**
 * The collection mark — the Layers glyph dead centre over the frames — sits on
 * a translucent disc.
 *
 * The glyph alone is white-on-whatever-the-children-happen-to-be: over a pale
 * or busy frame its strokes break up, and the drop-shadow under it outlines
 * them rather than giving them a ground. The disc is that ground.
 *
 * Asserted on COMPUTED style, not the class string. `bg-black/25` is a
 * spelling; `rgba(0, 0, 0, 0.25)` is what the user actually sees, and the two
 * stop agreeing the moment the utility is renamed or the token is re-themed.
 *
 * The alpha lives on the BACKGROUND rather than on the wrapper's `opacity`,
 * which is why the wrapper's own opacity is pinned at 1: `opacity` there would
 * multiply with the glyph's 0.5 and take it to an eighth, and the resulting
 * card would look like a rendering bug rather than a mark.
 */
export const CollectionMarkSitsOnATranslucentDisc: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B])],
  play: async ({ canvasElement }) => {
    const mark = canvasElement.querySelector<HTMLElement>("[data-collection-mark]");
    await expect(mark).not.toBeNull();

    const disc = mark!.firstElementChild as HTMLElement | null;
    await expect(disc).not.toBeNull();
    await expect(disc!.querySelector("svg")).not.toBeNull();

    const style = getComputedStyle(disc!);
    // The ALPHA, parsed out of whatever colour space the toolchain serialises
    // in — Tailwind v4 resolves this to `oklab(0 0 0 / 0.45)`, not the
    // `rgba(0, 0, 0, 0.45)` the utility name suggests, and pinning either
    // literal makes this story a test of the build rather than of the design.
    // Both spellings put the alpha last, which is the part worth pinning.
    const alpha = Number.parseFloat(/([\d.]+)\s*\)\s*$/.exec(style.backgroundColor)?.[1] ?? "1");
    await expect(alpha).toBeCloseTo(0.45, 2);
    await expect(style.opacity).toBe("1");

    // A CIRCLE, which is a square box plus a radius — checking the radius
    // alone would pass on a pill, and checking the box alone on a square.
    const box = disc!.getBoundingClientRect();
    await expect(Math.round(box.width)).toBe(Math.round(box.height));
    await expect(style.borderRadius).not.toBe("0px");

    // It has to sit OVER the frame, not beside it: the mark is positioned by
    // the wrapper, and a disc that shrank the glyph out of the artwork would
    // still satisfy every assertion above.
    const frame = previewImages(canvasElement)[0]!.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(frame.left);
    await expect(box.right).toBeLessThanOrEqual(frame.right);
  },
};

/**
 * …and over the EMPTY state too, which is a reversal worth recording.
 *
 * The mark used to be withheld here, because the empty slot drew an academy
 * leader — a ring and a crosshair — and two glyphs stacked in one centre read
 * as a bug. That placeholder is a flat gradient now, so the reason is gone and
 * the opposite rule applies: a collection wears its mark whether or not it has
 * anything in it, because that mark is the only thing on the card saying what
 * KIND of thing it is.
 */
export const EmptyCollectionAlsoWearsTheCollectionMark: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([])],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-empty-collection-preview]")).not.toBeNull();
    const mark = canvasElement.querySelector("[data-collection-mark]");
    await expect(mark).not.toBeNull();
    // The same disc-and-glyph a populated card gets, not a second treatment.
    await expect(mark!.querySelector("svg")).not.toBeNull();
  },
};

/** An empty or unresolved collection shows a bare graded panel: no fallback
 * copy is allowed to bleed through behind the centred collection mark. */
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

    // The empty slot itself draws NOTHING now — it is a bare gradient panel,
    // which is what lets the centred collection mark be the single thing
    // saying "collection" on every card. The glyph is therefore a SIBLING of
    // this element rather than a child of it; asserting it here would have
    // quietly kept passing on the old leader drawing.
    await expect(fallback!.querySelector("svg")).toBeNull();
    await expect(canvasElement.querySelector("[data-collection-mark] svg")).not.toBeNull();
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
/**
 * A collection that LEADS WITH AUDIO shows the music glyph, not the leader.
 *
 * The thumbnail is the first child's frame and audio has none, so a collection
 * of voice takes fell through to `EmptyCollectionPlaceholder` — the film
 * crosshair, which means "no picture here". For sound that is the wrong
 * sentence, and the audio media card already had the right glyph.
 */
export const AudioLedCollectionShowsMusicGlyph: Story = {
  args: { ...baseArgs, id: AUDIO_COLLECTION_ID },
  decorators: [
    (Story) => {
      // HYDRATED, unlike the other stories here: the audio branch reads the
      // collection's live graph children, which is the only place the lead
      // child's kind exists. A stored summary carries no entry for audio.
      const store = createGraphDetailsStore({
        [AUDIO_COLLECTION_ID]: {
          alt: "Voice takes",
          aspect: 16 / 9,
          hydrated: true,
          itemCount: 1,
          duration: 8,
          previewItems: [],
        } satisfies ClipDetail,
      });
      return (
        <DndCollections initialGraph={audioCollectionGraph}>
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
    const fallback = canvasElement.querySelector<HTMLElement>(
      "[data-empty-collection-preview]",
    );
    await expect(fallback).not.toBeNull();
    // The marker is what distinguishes the two glyphs — both are bare SVGs, so
    // asserting "an svg is present" would pass for the leader too and prove
    // nothing about this change.
    await expect(fallback!.getAttribute("data-collection-preview-kind")).toBe("audio");
    await expect(previewImages(canvasElement)).toHaveLength(0);
  },
};

/**
 * #314 item 2: an audio CLIP had no card story at all — and writing one found
 * a live bug.
 *
 * The media card here is the PACKAGE default (`NodeThumbnail`); the graph view
 * registers its own shell for COLLECTIONS only. That default asked "is it
 * video?", and everything else took the image branch — so an audio node, which
 * does have a `src`, rendered `<img src="…take.flac">`: a broken image on
 * every audio card. Exactly the shape of #312.
 */
export const AudioClipCardDoesNotRenderItsFlacAsAnImage: Story = {
  args: { ...baseArgs, id: AUDIO_CLIP_ID },
  decorators: [
    (Story) => {
      const store = createGraphDetailsStore({
        [AUDIO_CLIP_ID]: {
          alt: "Pat VO",
          aspect: 16 / 9,
          duration: 8,
        } satisfies ClipDetail,
      });
      return (
        <DndCollections initialGraph={audioClipGraph}>
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
    // THE REGRESSION GUARD. One <img> here means the audio branch is gone and
    // a .flac is being painted as a picture.
    await expect(previewImages(canvasElement)).toHaveLength(0);
    await expect(
      canvasElement.querySelector("[data-node-thumbnail='image']"),
    ).toBeNull();

    // And it says what it IS. "No preview" would describe a picture that
    // failed; there was never going to be one.
    await expect(canvasElement.textContent).toContain("Audio");
    await expect(canvasElement.textContent).not.toContain("No image");
  },
};

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
      expect(surface!.getAttribute("aria-label")).toMatch(/^Renamed timeline,/),
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
 * A card disabled on ITSELF: badged with the word that names why, and knocked
 * back HARD — 45% and grayscale.
 *
 * The heavy treatment earns its place here specifically: this card sits among
 * siblings that are ON, and separating it from them is the entire job. The
 * inherited case below is deliberately lighter — see its note.
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

    // The dimming lives on the inner span, not the surface — which is what
    // keeps the checkbox and the chip readable while the artwork fades.
    const visuals = canvasElement.querySelector<HTMLElement>("[data-disabled-visuals]")!;
    await expect(visuals.dataset.disabledVisuals).toBe("true");
    await expect(getComputedStyle(visuals).opacity).toBe("0.45");
    await expect(getComputedStyle(visuals).filter).toBe("grayscale(1)");
  },
};

/**
 * A card that is off only because a collection ABOVE it is — and it is
 * knocked back LESS than the self-disabled card, on purpose.
 *
 * These two used to render identically, on the reasoning that a viewer sees
 * neither. That reasoning breaks in the case that matters most: drill INTO a
 * disabled collection and every card on screen is inherited-off, so uniform
 * heavy dimming has nothing to contrast against and only costs you the
 * legibility of the content you came in to look at. Nothing was decided about
 * this item, so it stays readable and the chip carries the message.
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

    // LIGHTER than DisabledCard, and NOT grayscale. Both halves are asserted:
    // dropping either one is what would quietly collapse this back into the
    // self-disabled treatment.
    const visuals = canvasElement.querySelector<HTMLElement>("[data-disabled-visuals]")!;
    await expect(visuals.dataset.disabledVisuals).toBe("inherited");
    await expect(getComputedStyle(visuals).opacity).toBe("0.75");
    await expect(getComputedStyle(visuals).filter).toBe("none");
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

// ── Lanes ───────────────────────────────────────────────────────────────────
//
// Lane 0 is the picture; anything above it plays UNDER the picture at the same
// time. The chip exists because that placement is invisible otherwise: the
// card sits in the same strip either way, and nothing else on it says that it
// will be heard rather than watched in turn.

/**
 * NO CHIP ON A LANE-1 CARD EITHER, while lane tracks are flagged off.
 *
 * This story used to assert the opposite — `L1` in sky, a lane being a
 * placement rather than a warning — and the inversion is the point rather than
 * a loss of coverage. The chip names the ROW a clip sits on, and with
 * `LANE_TRACKS_ENABLED` false the board draws no such row: the clip is in the
 * picture with everything else, so a badge pointing at lane 1 would describe a
 * placement the board is not showing.
 *
 * WHERE THE ENABLED BEHAVIOUR IS COVERED INSTEAD: `graph-lane-rows.test.ts`,
 * which drives the split both ways because it takes the flag as a parameter.
 * A component reading a module constant cannot be driven that way from a
 * story, which is exactly why the model takes it as an argument and this does
 * not — the arithmetic is where the risk lives, and it is the half that stayed
 * testable in both states.
 *
 * Turn `NEXT_PUBLIC_GSTUDIO_LANE_TRACKS=on` back on and this story is the one
 * to invert again.
 */
export const NoLaneChipWhileLanesAreOff: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B], 1)],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-lane-chip]")).toBeNull();
  },
};

/**
 * The PICTURE carries no chip at all. Almost every card is lane 0, and a badge
 * that appeared on everything would say nothing — the chip earns its place by
 * marking the surprising case only.
 */
export const NoLaneChipOnThePicture: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B], 0)],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-lane-chip]")).toBeNull();
  },
};

/**
 * A phantom lane index reads as the picture, matching how the model packs it.
 *
 * `validate` admits any finite number for `trackIndex`, so stored data can
 * carry a fractional or negative one. It packs as lane 0, so a chip claiming
 * otherwise would describe a placement the file does not have.
 */
export const PhantomLaneShowsNoChip: Story = {
  args: baseArgs,
  decorators: [renderWithDetail([ASSET_A, ASSET_B], -2)],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-lane-chip]")).toBeNull();
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
      const current = offsets[i];
      const previous = offsets[i - 1];
      if (current === undefined || previous === undefined) throw new Error(`missing offset ${i}`);
      expect(current).toBeGreaterThan(previous);
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
    // The time is absent here for the same reason as the other placeholder
    // stories, not because disabling hid it — the disabled CHIP and the
    // metadata row are what this story is about, and both still render.
    await expect(metadata.textContent).not.toContain("8.0s");
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
function renderWithTags(
  tags: string[],
  surface: "grid" | "strip" = "strip",
  selectMode = false,
) {
  const detail: ClipDetail = {
    alt: "A timeline",
    aspect: 16 / 9,
    hydrated: false,
    itemCount: 2,
    previewItems: [ASSET_A, ASSET_B],
    tags,
  };
  const store = createGraphDetailsStore({ [COLLECTION_ID]: detail });
  const decorator: Decorator = (Story) => (
    // `keepMultiSelectModeWhenEmpty` is REQUIRED for a select-mode story, not
    // decoration: without it the store disarms the mode the moment the
    // selection is empty, so arming it with nothing selected turns straight
    // back off and the checkbox never appears. The media decorator has carried
    // this from the start; this one did not need it until a story armed the
    // mode here.
    <DndCollections initialGraph={providerGraph} keepMultiSelectModeWhenEmpty>
      <GraphDetailsProvider store={store}>
        {selectMode ? <ArmSelectMode /> : null}
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

/**
 * The clip-name overlay's harness: a media card with an AUTHORED title, in the
 * strip (the grid caption carries the name there instead), inside the provider
 * that carries the board's setting.
 */
function renderNamedClip(shown: boolean): Decorator {
  return function NamedClipDecorator(Story) {
    const store = createGraphDetailsStore({
      [VIDEO_ID as string]: {
        alt: "A video",
        // The overlay renders ONLY for a real authored name — an `alt` is a
        // filename and deliberately does not count.
        title: "S01 — Pat briefing",
        aspect: 16 / 9,
        hydrated: false,
      },
    });
    return (
      <DndCollections initialGraph={videoGraph} components={GRAPH_VIEW_COMPONENTS}>
        <GraphDetailsProvider store={store}>
          <ClipNamesProvider shown={shown}>
            <VideoFrameLookAhead>
              <div className="bg-zinc-950 p-2">
                <div style={{ width: 260, height: 120 }}>
                  <Story />
                </div>
              </div>
            </VideoFrameLookAhead>
          </ClipNamesProvider>
        </GraphDetailsProvider>
      </DndCollections>
    );
  };
}

const mediaArgs = { id: VIDEO_ID, className: "h-full w-full" };

/**
 * OFF BY DEFAULT: a named clip stamps nothing over its artwork.
 *
 * The pair below is the whole feature. It is covered here rather than by
 * clicking the menu in the app because the two states have to be compared, and
 * a story can hold both at once.
 */
export const ClipNameHiddenByDefault: Story = {
  args: mediaArgs,
  decorators: [renderNamedClip(false)],
  play: async ({ canvasElement }) => {
    // The clip HAS a name — this is the setting hiding it, not a missing title.
    await expect(canvasElement.querySelector("[data-clip-title]")).toBeNull();
  },
};

/** Turned on, the same clip wears it. */
export const ClipNameShownWhenEnabled: Story = {
  args: mediaArgs,
  decorators: [renderNamedClip(true)],
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector<HTMLElement>("[data-clip-title]");
    await expect(title).not.toBeNull();
    await expect(title!.textContent).toBe("S01 — Pat briefing");
  },
};

/**
 * The same pair in the GRID, where the name is not stamped on the artwork at
 * all — it heads the caption underneath, beside the kind icon.
 *
 * Covered separately because the two surfaces render the name in two different
 * places, and the setting was only reaching one of them: switching to the grid
 * brought every name back however the option was set. The strip pair above
 * watches the overlay; this one watches the caption.
 *
 * `data-virtual-grid` is what puts a card in its grid shape — the caption is
 * `hidden` without it — so the wrapper is not decoration, it is the condition
 * being tested.
 */
function renderNamedClipInGrid(shown: boolean): Decorator {
  return function NamedGridClipDecorator(Story) {
    const store = createGraphDetailsStore({
      [VIDEO_ID as string]: {
        alt: "A video",
        title: "S01 — Pat briefing",
        tags: ["night"],
        aspect: 16 / 9,
        hydrated: false,
      },
    });
    return (
      <DndCollections initialGraph={videoGraph} components={GRAPH_VIEW_COMPONENTS}>
        <GraphDetailsProvider store={store}>
          <ClipNamesProvider shown={shown}>
            <VideoFrameLookAhead>
              <div data-virtual-grid className="bg-zinc-950 p-2">
                <div style={{ width: 260, height: 180 }}>
                  <Story />
                </div>
              </div>
            </VideoFrameLookAhead>
          </ClipNamesProvider>
        </GraphDetailsProvider>
      </DndCollections>
    );
  };
}

/**
 * OFF: the caption keeps everything that is not the name.
 *
 * The kind icon, the duration and the tag row are facts you cannot read off
 * the artwork, so they are not what the setting is about — and the row was
 * already built to lose the name without moving, since an unnamed clip has
 * always been a case it had to handle.
 */
export const GridCaptionNameHiddenByDefault: Story = {
  args: mediaArgs,
  decorators: [renderNamedClipInGrid(false)],
  play: async ({ canvasElement }) => {
    const caption = canvasElement.querySelector<HTMLElement>("[data-clip-caption]");
    await expect(caption).not.toBeNull();
    // The clip HAS a name — this is the setting, not a missing title.
    await expect(caption!.querySelector("[data-clip-caption-name]")).toBeNull();
    // Still says what it is, how long it is, and how it is filed.
    await expect(caption!.querySelector("svg")).not.toBeNull();
    await expect(caption!.textContent).toContain("0:08");
    await expect(caption!.querySelector("[data-clip-caption-tag-row]")).not.toBeNull();
  },
};

/** Turned on, the same clip's caption leads with its name. */
export const GridCaptionNameShownWhenEnabled: Story = {
  args: mediaArgs,
  decorators: [renderNamedClipInGrid(true)],
  play: async ({ canvasElement }) => {
    const name = canvasElement.querySelector<HTMLElement>("[data-clip-caption-name]");
    await expect(name).not.toBeNull();
    await expect(name!.textContent).toBe("S01 — Pat briefing");
  },
};

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

/**
 * The caption block's height — the SAME on both card kinds, tagged or not.
 *
 * Two rows always: identity on top, tags underneath, and an untagged card keeps
 * an empty second row rather than collapsing. Both halves of that were broken
 * and neither was visible to a test that looked at one card alone:
 *
 *  - `min-h` on the tag row reserved the wrong thing. Under `border-box` it
 *    includes the element's own padding, and the collection's row carries
 *    `pt-1 pb-1.5` where the media card's carries none — so it reserved 14px
 *    total, got 4px of content, and jumped to 24px once real chips arrived.
 *    A tagged collection was 10px taller than an untagged one beside it.
 *  - Row one collapsed to its ICON (16px) on a card with no name, against a
 *    text line's 20px on a named one.
 *
 * Asserted in four stories against this one number rather than against each
 * other, because a story renders one card and these two kinds cannot share a
 * canvas. If a redesign moves it, move all four together.
 */
const CAPTION_BLOCK_PX = 54;

/** Measure the caption block, whichever card kind rendered it. */
async function expectCaptionBlockHeight(canvasElement: HTMLElement): Promise<void> {
  const media = canvasElement.querySelector<HTMLElement>("[data-clip-caption]");
  if (media !== null) {
    await expect(Math.round(media.getBoundingClientRect().height)).toBe(CAPTION_BLOCK_PX);
    return;
  }
  // The collection's two rows are siblings on the selection surface rather than
  // children of one box (row one is the STRIP's footer too), so the block is
  // measured across them — plus row one's top MARGIN, which is that card's
  // version of the media caption's top padding.
  const row = canvasElement.querySelector<HTMLElement>("[data-collection-metadata]")!;
  const tags = canvasElement.querySelector<HTMLElement>("[data-collection-caption-tags]")!;
  const marginTop = Number.parseFloat(getComputedStyle(row).marginTop) || 0;
  const height =
    tags.getBoundingClientRect().bottom - row.getBoundingClientRect().top + marginTop;
  await expect(Math.round(height)).toBe(CAPTION_BLOCK_PX);
}

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
    // ...and the same HEIGHT as one, with no tags to fill row two.
    await expectCaptionBlockHeight(canvasElement);

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

    // TAGGED, and exactly as tall as the untagged twin — the half the empty-row
    // reservation exists for. See CAPTION_BLOCK_PX.
    await expectCaptionBlockHeight(canvasElement);
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
 * Outside select mode there is NO checkbox — not a transparent one, none.
 *
 * It used to be rendered and revealed by CSS `:hover`, which made this story
 * an opacity measurement. The element is gone now, so the assertion is back to
 * presence — and presence is the stronger property: a transparent control is
 * still a click target, which is why the old code had to keep
 * `pointer-events-none` welded to the opacity in one rule.
 *
 * Why it went: this is a dragging board, the cursor is over cards constantly
 * because things are being moved rather than chosen, and a checkbox appearing
 * under it every time was noise during the gesture the board is for.
 */
export const NoCheckboxOutsideSelectMode: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid" })],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-selection-indicator]")).toBeNull();
  },
};

/**
 * And in select mode it is there, opaque, with no pointer anywhere near it.
 *
 * The pair is the point: absence alone would pass just as well if the checkbox
 * were broken in BOTH states, which is exactly the failure a one-sided test
 * cannot see.
 */
export const CheckboxAppearsInSelectMode: Story = {
  args: mediaArgs,
  decorators: [renderMediaCard({ surface: "grid", selectMode: true })],
  play: async ({ canvasElement }) => {
    const indicator = canvasElement.querySelector<HTMLElement>("[data-selection-indicator]");
    await expect(indicator).not.toBeNull();
    await expect(indicator!.dataset.selectionIndicatorReveal).toBe("armed");
    await expect(getComputedStyle(indicator!).opacity).toBe("1");
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

    // TAGGED, and exactly as tall as the untagged twin — this is the pairing
    // that caught the reservation being 10px short. See CAPTION_BLOCK_PX.
    await expectCaptionBlockHeight(canvasElement);
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
    await expectCaptionBlockHeight(canvasElement);

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
 * The collection card, both ways — and it is the kind that pays for this.
 *
 * A plain click on a collection DRILLS IN, so the checkbox was the only thing
 * on the card saying it could be picked at all. Removing it outside select mode
 * means there is no pointer route to selecting a collection until the mode is
 * on. That is the accepted trade, and this pair is where it is visible.
 *
 * Its own story rather than a case in the media one, because the two card kinds
 * are rendered by DIFFERENT components — collections through the composed
 * CollectionItem shell, media through NodeCard — so nothing structural forces
 * them to agree, and they have diverged before.
 */
export const CollectionHasNoCheckboxOutsideSelectMode: Story = {
  args: baseArgs,
  decorators: [renderWithTags([], "grid")],
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-selection-indicator]")).toBeNull();
  },
};

export const CollectionCheckboxAppearsInSelectMode: Story = {
  args: baseArgs,
  decorators: [renderWithTags([], "grid", true)],
  play: async ({ canvasElement }) => {
    // Armed by an effect, so the first committed frame legitimately has no
    // checkbox — `waitFor` covers that, and covers nothing else. It is NOT what
    // made this story pass: it failed for a full second against a decorator
    // missing `keepMultiSelectModeWhenEmpty`, which is the actual reason and is
    // recorded there.
    const indicator = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>("[data-selection-indicator]");
      if (!found) throw new Error("no selection indicator yet");
      return found;
    });
    await expect(indicator.dataset.selectionIndicatorReveal).toBe("armed");
    await expect(getComputedStyle(indicator).opacity).toBe("1");
  },
};

/* ── Vouching: a card shows a time only when it can add one up ────────────── */

const VOUCH_PARENT_ID = "vouch-parent" as NodeId;
const VOUCH_KID_ID = "vouch-kid" as NodeId;

/** A collection holding only MEDIA — everything its time depends on is in the
 *  graph, so it can be added up exactly. 103 of 149 collections in the real
 *  project look like this. */
const mediaOnlyGraph = (() => {
  const result = buildGraph([
    {
      kind: "collection",
      id: VOUCH_PARENT_ID,
      name: "Locations",
      children: [
        { kind: "media", id: "loc-a" as NodeId, name: "Alley", fullDurationSeconds: 4 },
        { kind: "media", id: "loc-b" as NodeId, name: "Diner", fullDurationSeconds: 4 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

/** The same card, but one child is a COLLECTION that has not loaded. Its
 *  seconds are unknowable without reading that branch. */
const nestedCollectionGraph = (() => {
  const result = buildGraph([
    {
      kind: "collection",
      id: VOUCH_PARENT_ID,
      name: "Characters",
      children: [{ kind: "collection", id: VOUCH_KID_ID, name: "Pat", children: [] }],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
})();

const detail = (over: Partial<ClipDetail>): ClipDetail => ({
  alt: "A timeline",
  aspect: 16 / 9,
  hydrated: true,
  itemCount: 2,
  duration: 999,
  previewItems: [],
  ...over,
});

/** Renders as text like "8.1s" or "23:21" — either shape counts as a time. */
const A_TIME = /\d+(\.\d+)?s|\d+:\d{2}/;

function vouchDecorator(
  graph: CollectionsGraph,
  details: Record<string, ClipDetail>,
): Decorator {
  // NAMED, not a bare arrow returned from a factory: `react/display-name`
  // cannot infer a name for the latter, and it is an ERROR in this config —
  // `renderWithDetail` above assigns to a named const for the same reason.
  const WithVouchFixture: Decorator = (Story) => (
    <DndCollections initialGraph={graph}>
      <GraphDetailsProvider store={createGraphDetailsStore(details)}>
        <div className="h-32 w-40 bg-zinc-950 p-2">
          <Story />
        </div>
      </GraphDetailsProvider>
    </DndCollections>
  );
  return WithVouchFixture;
}

/**
 * A collection whose branch is fully loaded SHOWS its time.
 *
 * The board reads one level (`BOARD_OPEN_MAX_DEPTH`), so a media-only
 * collection arrives complete and can be added up exactly. This is the case
 * that keeps the board from being uniformly timeless.
 */
export const VouchedCollectionShowsItsTime: Story = {
  args: { ...baseArgs, id: VOUCH_PARENT_ID },
  decorators: [
    vouchDecorator(mediaOnlyGraph, { [VOUCH_PARENT_ID]: detail({ duration: 999 }) }),
  ],
  play: async ({ canvasElement }) => {
    // NOT 999: the stored summary is deliberately absurd here, so a card
    // reading it rather than its live children fails loudly.
    await expect(canvasElement.textContent ?? "").toMatch(A_TIME);
    await expect(canvasElement.textContent ?? "").not.toContain("999");
  },
};

/**
 * A collection with an unloaded branch shows its COUNT and no time.
 *
 * Previously it fell back to the stored summary, which drifts — measured on a
 * real project, two of the three cards on the board reported a duration up to
 * 40 seconds wrong, and nothing on screen distinguished them from the right
 * one. A count is still exact (these are this collection's own children), so
 * the card stays informative; the time arrives when the branch is opened.
 */
export const UnvouchedCollectionShowsCountOnly: Story = {
  args: { ...baseArgs, id: VOUCH_PARENT_ID },
  decorators: [
    vouchDecorator(nestedCollectionGraph, {
      [VOUCH_PARENT_ID]: detail({ itemCount: 1 }),
      // The child that has not loaded — the reason the parent cannot add up.
      [VOUCH_KID_ID]: detail({ hydrated: false, itemCount: 5, duration: 60 }),
    }),
  ],
  play: async ({ canvasElement }) => {
    const text = canvasElement.textContent ?? "";
    await expect(text).toContain("1 item");
    await expect(text).not.toMatch(A_TIME);
  },
};
