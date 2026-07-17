import { describe, expect, it } from "vitest";

import { CLIP_GAP_SECONDS } from "@storyboard/ui/timeline/constants";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import type { CloudinaryAsset } from "./cloudinary-media-store";
import { healTimelineDocument } from "./heal-timeline-document";

const CLOUD = "https://res.cloudinary.com/demo/video/upload/v1";

function videoClip(
  publicId: string,
  index: number,
  startTime: number,
  duration: number,
  sourceDuration = duration,
  trimIn = 0,
  trimOut = 0,
): TimelineClip {
  return {
    id: `clip-${publicId}`,
    index,
    kind: "video",
    src: `${CLOUD}/${publicId}.mp4`,
    poster: `${CLOUD}/${publicId}.jpg`,
    alt: publicId,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration,
    trimIn,
    trimOut,
  };
}

function imageClip(publicId: string, index: number, startTime: number): TimelineClip {
  return {
    id: `clip-${publicId}`,
    index,
    kind: "image",
    src: `${CLOUD}/${publicId}.jpg`,
    alt: publicId,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  };
}

function videoAsset(publicId: string, duration: number | undefined, url?: string): CloudinaryAsset {
  return {
    id: publicId,
    pathname: `folder/${publicId}`,
    relativePath: publicId,
    url: url ?? `${CLOUD}/${publicId}.mp4`,
    thumbnailUrl: `${CLOUD}/${publicId}.jpg`,
    resourceType: "video",
    duration,
  };
}

function doc(clips: TimelineClip[]): TimelineDocument {
  return { id: "project-1", title: "Doc", clips };
}

const srcOf = (clip: TimelineClip): string => (clip.kind === "collection" ? "" : clip.src);
const posterOf = (clip: TimelineClip): string | undefined =>
  clip.kind === "collection" ? undefined : clip.poster;

describe("healTimelineDocument", () => {
  it("backfills a real duration onto an untrimmed defaulted video and repacks", () => {
    const input = doc([
      videoClip("v-a", 0, 0, 8), // defaulted 8s, untrimmed
      videoClip("v-b", 1, 8.12, 5),
    ]);

    const { document, changed } = healTimelineDocument(input, [
      videoAsset("v-a", 12.4),
      videoAsset("v-b", 5), // already correct — no change
    ]);

    expect(changed).toBe(true);
    const [a, b] = document.clips;
    expect(a.duration).toBe(12.4);
    expect(a.sourceDuration).toBe(12.4);
    // Downstream clip repacked behind the longer first clip.
    expect(b.startTime).toBeCloseTo(12.4 + CLIP_GAP_SECONDS, 5);
    expect(b.duration).toBe(5); // untouched
  });

  it("never rewrites a trimmed clip (a stored trim is a user choice)", () => {
    // Shows 6s of a source the listing reports as 12.4s, but the user trimmed
    // it: trimIn+duration+trimOut === sourceDuration must stay intact.
    const input = doc([videoClip("v-a", 0, 0, 6, 8, 1, 1)]);

    const { document, changed } = healTimelineDocument(input, [videoAsset("v-a", 12.4)]);

    expect(changed).toBe(false);
    expect(document).toBe(input); // same reference — caller skips the write
    expect(document.clips[0].sourceDuration).toBe(8);
  });

  it("leaves an already-correct untrimmed video alone (within epsilon)", () => {
    const input = doc([videoClip("v-a", 0, 0, 8.33, 8.33)]);
    const { changed } = healTimelineDocument(input, [videoAsset("v-a", 8.333333)]);
    expect(changed).toBe(false);
  });

  it("heals a moved asset's src without repacking when no duration changed", () => {
    const moved = `${CLOUD}/v-a-moved.mp4`;
    const input = doc([videoClip("v-a", 0, 0, 5), imageClip("i-b", 1, 5.12)]);

    const { document, changed } = healTimelineDocument(input, [
      // Same filename key, new url, correct duration → src heal only.
      videoAsset("v-a", 5, moved),
    ]);

    expect(changed).toBe(true);
    expect(srcOf(document.clips[0])).toBe(moved);
    expect(posterOf(document.clips[0])).toBe(`${CLOUD}/v-a.jpg`);
    // No duration moved → startTimes preserved, not repacked.
    expect(document.clips[1].startTime).toBe(5.12);
  });

  it("does both heals at once and repacks from the duration change", () => {
    const moved = `${CLOUD}/v-a-moved.mp4`;
    const input = doc([videoClip("v-a", 0, 0, 8), imageClip("i-b", 1, 8.12)]);

    const { document, changed } = healTimelineDocument(input, [videoAsset("v-a", 3, moved)]);

    expect(changed).toBe(true);
    expect(srcOf(document.clips[0])).toBe(moved);
    expect(document.clips[0].duration).toBe(3);
    expect(document.clips[1].startTime).toBeCloseTo(3 + CLIP_GAP_SECONDS, 5);
  });

  it("is a no-op with no assets", () => {
    const input = doc([videoClip("v-a", 0, 0, 8)]);
    const result = healTimelineDocument(input, []);
    expect(result.changed).toBe(false);
    expect(result.document).toBe(input);
  });

  it("ignores videos with no listed duration (degraded listing)", () => {
    const input = doc([videoClip("v-a", 0, 0, 8)]);
    const { changed } = healTimelineDocument(input, [videoAsset("v-a", undefined)]);
    expect(changed).toBe(false);
  });
});
