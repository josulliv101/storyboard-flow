import { describe, expect, it } from "vitest";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { buildFocusedGraph } from "./adapter";

// Reproduction for the deployed-app report: an audio clip renders with the
// IMAGE chip. The stored document is correct (kind: "audio"), and mediaSpec has
// an audio branch, so the question is what the GRAPH ends up holding — that is
// what the card reads.

const audioDoc: TimelineDocument = {
  id: "col",
  title: "Audio",
  clips: [
    {
      id: "audio-db58631e",
      index: 0,
      kind: "audio",
      alt: 'Brian VO — "You worry about the door"',
      aspect: 16 / 9,
      trackIndex: 0,
      startTime: 0,
      duration: 5.875,
      sourceDuration: 5.875,
      trimIn: 0,
      trimOut: 0,
      src: "https://res.cloudinary.com/x/video/upload/brian.flac",
      sourceAsset: { providerId: "cloudinary", assetId: "brian" },
    },
  ],
};

describe("audio clip document -> graph", () => {
  it("keeps mediaKind audio on the built node", () => {
    const built = buildFocusedGraph({ col: audioDoc }, "col", 1);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.error);

    const node = built.value.graph.nodesById.get("audio-db58631e" as never);
    expect(node).toBeDefined();
    if (!node || node.kind !== "media") throw new Error("expected a media node");

    // THE ASSERTION THAT MATTERS: the card reads node.mediaKind, and "image"
    // here is exactly what puts an IMAGE chip and an <img> on an audio card.
    expect(node.mediaKind).toBe("audio");
  });
});
