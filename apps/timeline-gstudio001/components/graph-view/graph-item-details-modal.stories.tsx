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
