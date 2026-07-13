import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "./core/graph";
import { DndCollections } from "./react/DndCollections";
import { CollectionPanels } from "./react/node-views";
import { nodeCard, waitForLayout } from "./stories-helpers";

// Cards render REAL media (deterministic local fixtures, no network): an image
// shows its single poster; a video shows a SEQUENCE of frames (never a <video>
// element), more frames for a longer clip, cycling the available posters. No
// media falls back to a labeled placeholder. Covers the media-story matrix the
// package rules call for: image thumb, video sequence (short/long), and the
// missing-poster fallback.

// Two real frames sampled from a dog clip; longer videos repeat them to fill.
const dogFrames = [
  new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href,
  new URL("./fixtures/dog-exit-4s.png", import.meta.url).href,
] as const;
const missingFrame = "/__dnd-collections-missing-frame__.png";

const graph = () => {
  const result = buildGraph([
    {
      kind: "collection",
      id: "shots",
      name: "Shots",
      children: [
        // Image: a single poster from its src.
        { kind: "media", id: "still", name: "Still Frame", src: dogFrames[0], durationSeconds: 4 },
        // Short video (4s effective) -> 2 frames.
        {
          kind: "media",
          mediaKind: "video",
          id: "clip-short",
          name: "Short Clip",
          posterSrcs: dogFrames,
          fullDurationSeconds: 4,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
        // Long video (12s effective) -> capped at 5 frames.
        {
          kind: "media",
          mediaKind: "video",
          id: "clip-long",
          name: "Long Clip",
          posterSrcs: dogFrames,
          fullDurationSeconds: 12,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
        // Video with no posters -> fallback.
        {
          kind: "media",
          mediaKind: "video",
          id: "clip-bare",
          name: "No Posters",
          fullDurationSeconds: 6,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
        // Image with no src -> fallback.
        { kind: "media", id: "still-bare", name: "No Image", durationSeconds: 3 },
        // Failed URLs -> runtime fallback states.
        { kind: "media", id: "still-broken", name: "Broken Image", src: missingFrame, durationSeconds: 3 },
        {
          kind: "media",
          mediaKind: "video",
          id: "clip-broken",
          name: "Broken Clip",
          posterSrcs: [missingFrame],
          fullDurationSeconds: 4,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
        {
          kind: "media",
          mediaKind: "video",
          id: "clip-mixed",
          name: "Mixed Clip",
          posterSrcs: [missingFrame, dogFrames[0]],
          fullDurationSeconds: 4,
          trimInSeconds: 0,
          trimOutSeconds: 0,
        },
      ],
    },
  ] satisfies GraphNodeSpec[]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

function MediaBoard() {
  return (
    <DndCollections initialGraph={graph()}>
      <div className="max-w-xl">
        <CollectionPanels collectionIds={[parseNodeId("shots")]} />
      </div>
    </DndCollections>
  );
}

const meta = {
  title: "UI/DndCollectionsMedia",
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

export const RealImageAndVideoSequences: Story = {
  render: () => <MediaBoard />,
  play: async ({ canvasElement }) => {
    const thumb = (id: string) =>
      nodeCard(canvasElement, id).querySelector<HTMLElement>("[data-node-thumbnail]");

    await waitForLayout(nodeCard(canvasElement, "still"));

    // Image: one <img> from its src.
    await waitFor(() => {
      const t = thumb("still");
      expect(t?.dataset.nodeThumbnail).toBe("image");
      expect(t?.querySelectorAll("img")).toHaveLength(1);
    });

    // Short video (4s) -> 2 frames; long video (12s) -> capped at 5.
    const short = thumb("clip-short");
    expect(short?.dataset.nodeThumbnail).toBe("video");
    expect(short?.dataset.frameCount).toBe("2");
    expect(short?.querySelectorAll("img")).toHaveLength(2);

    const long = thumb("clip-long");
    expect(long?.dataset.nodeThumbnail).toBe("video");
    expect(long?.dataset.frameCount).toBe("5");
    expect(long?.querySelectorAll("img")).toHaveLength(5);

    // Missing media -> labeled fallback, no <img>.
    for (const id of ["clip-bare", "still-bare"]) {
      const t = thumb(id);
      expect(t?.dataset.nodeThumbnail).toBe("fallback");
      expect(t?.querySelectorAll("img")).toHaveLength(0);
    }

    await waitFor(() => {
      expect(thumb("still-broken")?.dataset.nodeThumbnail).toBe("fallback");
      expect(thumb("still-broken")?.textContent).toMatch(/image unavailable/i);
      expect(thumb("clip-broken")?.dataset.nodeThumbnail).toBe("fallback");
      expect(thumb("clip-broken")?.textContent).toMatch(/preview unavailable/i);
      expect(thumb("clip-mixed")?.querySelectorAll("[data-thumbnail-frame-fallback]")).toHaveLength(1);
      expect(thumb("clip-mixed")?.querySelectorAll("img")).toHaveLength(1);
    });
  },
};
