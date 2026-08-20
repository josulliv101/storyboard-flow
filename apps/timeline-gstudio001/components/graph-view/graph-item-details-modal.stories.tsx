import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "storybook/test";

import type { ClipDetail } from "@storyboard/timeline-domain";
import {
  DndCollections,
  buildGraph,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "@storyboard/ui/dnd-collections";

import { createGraphDetailsStore } from "@/lib/graph-details-store";

import { GraphDetailsProvider } from "./graph-details-context";
import { ItemDetailsProvider, useItemDetails } from "./graph-item-details-context";
import { GraphItemDetailsModal } from "./graph-item-details-modal";

// The details modal's first stories. It had none, which is how it came to
// describe a VOICEOVER as a "still" — the branch that renders the duration
// line is "everything that is not video", and that is images AND audio.
//
// Deterministic and offline: an in-memory graph and details store, no network.

// A `src` is REQUIRED for the modal to mount at all — it gates on
// `!!node.src` for media, since a clip with no source has no hero to show.
// Data URIs, so the fixture stays offline.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const AUDIO: GraphNodeSpec = {
  kind: "media",
  mediaKind: "audio",
  id: "bed",
  name: "Tension drone — bed",
  fullDurationSeconds: 8,
  trimInSeconds: 0,
  trimOutSeconds: 0,
  trackIndex: 1,
  src: SILENCE,
};

const IMAGE: GraphNodeSpec = {
  kind: "media",
  id: "plate",
  name: "Van interior",
  src: PIXEL,
  durationSeconds: 4,
};

/**
 * A distinct, recognisable frame per clip. The filmstrip's whole claim is that
 * you can see what sits either side of a cut, and a fixture of identical blank
 * pixels cannot show that — three black rectangles prove the layout and hide
 * the feature. Flat colour with a big label is enough to tell the seams apart
 * at a glance, and it keeps the story deterministic (no network, no decode).
 */
function plate(label: string, fill: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
    `<rect width="320" height="180" fill="${fill}"/>` +
    `<text x="160" y="100" font-family="sans-serif" font-size="34" font-weight="700" ` +
    `fill="#0b0b0d" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A scene shaped like the case the filmstrip exists for: the subject is the
 * LAST clip of a nested collection, so its next neighbour is only reachable by
 * climbing out of that collection, and its previous one by staying inside it.
 */
const SEAM_SCENE: GraphNodeSpec = {
  kind: "collection",
  id: "root",
  name: "Root",
  children: [
    {
      kind: "collection",
      id: "sub",
      name: "Van Interior",
      children: [
        { kind: "media", id: "before", name: "Before", src: plate("BEFORE", "#7dd3fc"), durationSeconds: 3 },
        { kind: "media", id: "subject", name: "Subject", src: plate("SUBJECT", "#bef264"), durationSeconds: 4 },
      ],
    },
    { kind: "media", id: "after", name: "After", src: plate("AFTER", "#fca5a5"), durationSeconds: 2 },
  ],
};

function graphOfRoot(root: GraphNodeSpec): CollectionsGraph {
  const result = buildGraph([root]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function SeamHarness() {
  const store = createGraphDetailsStore({
    before: DETAIL,
    subject: DETAIL,
    after: DETAIL,
  });
  return (
    <div className="graph-view-theme min-h-[600px] bg-zinc-950">
      <DndCollections initialGraph={graphOfRoot(SEAM_SCENE)}>
        <GraphDetailsProvider store={store}>
          <ItemDetailsProvider>
            <OpenOnMount id="subject" />
            <GraphItemDetailsModal />
          </ItemDetailsProvider>
        </GraphDetailsProvider>
      </DndCollections>
    </div>
  );
}

function graphOf(spec: GraphNodeSpec): CollectionsGraph {
  const result = buildGraph([
    { kind: "collection", id: "root", name: "Root", children: [spec] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const DETAIL: ClipDetail = { alt: "clip", aspect: 16 / 9 };

/** Opens the modal on mount — the board normally does this from a menu row. */
function OpenOnMount({ id }: Readonly<{ id: string }>) {
  const { setOpenId } = useItemDetails();
  useEffect(() => setOpenId(id), [id, setOpenId]);
  return null;
}

function Harness({ spec }: Readonly<{ spec: GraphNodeSpec }>) {
  const store = createGraphDetailsStore({ [spec.id]: DETAIL });
  return (
    <div className="graph-view-theme min-h-[600px] bg-zinc-950">
      <DndCollections initialGraph={graphOf(spec)}>
        <GraphDetailsProvider store={store}>
          <ItemDetailsProvider>
            <OpenOnMount id={spec.id} />
            <GraphItemDetailsModal />
          </ItemDetailsProvider>
        </GraphDetailsProvider>
      </DndCollections>
    </div>
  );
}

const meta: Meta<typeof GraphItemDetailsModal> = {
  title: "graph-view/GraphItemDetailsModal",
  component: GraphItemDetailsModal,
};
export default meta;
type Story = StoryObj<typeof GraphItemDetailsModal>;

/** A SOUND is not a still. The duration line shares a branch with images, and
 *  called a voiceover a "still on screen" until this pinned it. */
export const AudioReadsAsSound: Story = {
  render: () => <Harness spec={AUDIO} />,
  play: async () => {
    // The modal opens from an effect, so nothing is mounted on the first tick
    // — asserting straight away reads an empty document and an ABSENCE check
    // would pass against it having proved nothing.
    const canvas = within(document.body);
    await waitFor(() => expect(canvas.getByText(/^sound · /)).toBeInTheDocument());
    expect(canvas.queryByText(/still · /)).toBeNull();
  },
};

/** …and an image still does. */
export const AnImageStillReadsAsAStill: Story = {
  render: () => <Harness spec={IMAGE} />,
  play: async () => {
    const canvas = within(document.body);
    await waitFor(() => expect(canvas.getByText(/^still · /)).toBeInTheDocument());
    expect(canvas.queryByText(/^sound · /)).toBeNull();
  },
};

/** The inset picker is for clips with a PICTURE that run under one. Audio has
 *  no picture to place, so the section is absent rather than disabled. */
export const AudioHasNoInsetPicker: Story = {
  render: () => <Harness spec={AUDIO} />,
  play: async () => {
    const canvas = within(document.body);
    // Wait for the modal to be REALLY up before asserting the section is
    // missing — otherwise this passes against a document that has not
    // rendered, which is exactly how it passed the first time it was written.
    // Gated on the clip's NAME rather than the duration line, so this stays a
    // test about the picker even if that wording changes.
    await waitFor(() => expect(canvas.getByText("Tension drone — bed")).toBeInTheDocument());
    expect(canvas.queryByText("Inset")).toBeNull();
  },
};

/**
 * THE FILMSTRIP: the clip you opened, with what plays either side of it.
 *
 * The scene is built so neither neighbour is a sibling — `after` lives one
 * level UP from the subject, which is the case that made this need the
 * playback order rather than a look at the subject's own parent.
 */
export const FlankedByItsNeighbours: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    const canvas = within(document.body);
    await waitFor(() =>
      expect(document.querySelector("[data-details-filmstrip]")).not.toBeNull(),
    );

    const previous = document.querySelector('[data-details-neighbour="previous"]');
    const next = document.querySelector('[data-details-neighbour="next"]');
    // Named in the title, which is also how a reader tells which is which.
    expect(previous?.getAttribute("title")).toBe("Previous: Before");
    // `after` is NOT a sibling of the subject — reaching it means leaving the
    // collection, which is the whole reason this is the playback order.
    expect(next?.getAttribute("title")).toBe("Next: After");

    // Same size as the subject, which is what makes it read as a strip rather
    // than a card with two thumbnails bolted on.
    const strip = document.querySelector("[data-details-filmstrip]")!;
    const widths = Array.from(strip.children).map((child) =>
      Math.round(child.getBoundingClientRect().width),
    );
    expect(new Set(widths).size).toBe(1);
    // And wider than the strip itself: three of them cannot fit, which is the
    // truncation that gives the film its edges.
    const total = widths.reduce((sum, width) => sum + width, 0);
    expect(total).toBeGreaterThan(strip.getBoundingClientRect().width);

    void canvas;
  },
};

/** Clicking a neighbour re-centres on it, and the strip re-resolves around the
 *  new subject — the previous clip becomes the next one. */
export const ClickingANeighbourRecentres: Story = {
  render: () => <SeamHarness />,
  play: async () => {
    await waitFor(() =>
      expect(document.querySelector('[data-details-neighbour="next"]')).not.toBeNull(),
    );
    (document.querySelector('[data-details-neighbour="next"]') as HTMLElement).click();

    await waitFor(() => {
      // `after` is now the subject, so what WAS the subject is now behind it.
      const previous = document.querySelector('[data-details-neighbour="previous"]');
      expect(previous?.getAttribute("title")).toBe("Previous: Subject");
    });
    // Nothing plays after `after`, so that side is blank rather than wrapped
    // back to the start.
    expect(document.querySelector('[data-details-neighbour="next"]')).toBeNull();
  },
};
