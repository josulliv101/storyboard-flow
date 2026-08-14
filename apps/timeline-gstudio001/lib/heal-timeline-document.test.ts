import { describe, expect, it } from "vitest";

import { CLIP_GAP_SECONDS } from "@storyboard/timeline-model/constants";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import type { CloudinaryAsset } from "./cloudinary-media-store";
import { healTimelineDocument } from "./heal-timeline-document";
import { at } from "../lib/test-support/at";

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
    const a = at(document.clips, 0);
    const b = at(document.clips, 1);
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
    expect(at(document.clips, 0).sourceDuration).toBe(8);
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
    expect(srcOf(at(document.clips, 0))).toBe(moved);
    expect(posterOf(at(document.clips, 0))).toBe(`${CLOUD}/v-a.jpg`);
    // No duration moved → startTimes preserved, not repacked.
    expect(at(document.clips, 1).startTime).toBe(5.12);
  });

  it("does both heals at once and repacks from the duration change", () => {
    const moved = `${CLOUD}/v-a-moved.mp4`;
    const input = doc([videoClip("v-a", 0, 0, 8), imageClip("i-b", 1, 8.12)]);

    const { document, changed } = healTimelineDocument(input, [videoAsset("v-a", 3, moved)]);

    expect(changed).toBe(true);
    expect(srcOf(at(document.clips, 0))).toBe(moved);
    expect(at(document.clips, 0).duration).toBe(3);
    expect(at(document.clips, 1).startTime).toBeCloseTo(3 + CLIP_GAP_SECONDS, 5);
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

// The matcher used to reduce BOTH sides to a bare filename leaf, so assets
// sharing a leaf across folders/projects overwrote each other in one flat map
// and a clip was silently re-pointed at whichever was listed last — with the
// caller persisting the result, from a plain GET.
describe("asset resolution", () => {
  /** `videoClip` is typed as the whole TimelineClip union, so spreading it to
   *  add `sourceAsset` (a MEDIA-only field) needs the narrowed variant. */
  function videoOf(publicId: string): Extract<TimelineClip, { kind: "video" }> {
    const clip = videoClip(publicId, 0, 0, 8);
    if (clip.kind !== "video") throw new Error("fixture is a video");
    return clip;
  }

  function inFolder(folder: string, publicId: string, duration: number, url: string): CloudinaryAsset {
    return {
      ...videoAsset(publicId, duration, url),
      id: `${folder}/${publicId}`,
      pathname: `${folder}/${publicId}`,
      relativePath: `${folder}/${publicId}`,
    };
  }

  it("refuses a legacy filename that names more than one asset", () => {
    const input = doc([videoClip("alley", 0, 0, 8)]);

    const { document, changed } = healTimelineDocument(input, [
      inFolder("project-a", "alley", 3, `${CLOUD}/a/alley.mp4`),
      inFolder("project-b", "alley", 30, `${CLOUD}/b/alley.mp4`),
    ]);

    // Ambiguous: no rewrite in either direction, and no duration guess.
    expect(changed).toBe(false);
    expect(document).toBe(input);
  });

  it("still heals a legacy filename that names exactly one asset", () => {
    const input = doc([videoClip("alley", 0, 0, 8)]);

    const { document, changed } = healTimelineDocument(input, [
      inFolder("project-a", "alley", 3, `${CLOUD}/a/alley.mp4`),
      inFolder("project-b", "brook", 30, `${CLOUD}/b/brook.mp4`),
    ]);

    expect(changed).toBe(true);
    expect(srcOf(at(document.clips, 0))).toBe(`${CLOUD}/a/alley.mp4`);
  });

  it("resolves by sourceAsset provenance even when the leaf is ambiguous", () => {
    const input = doc([
      { ...videoOf("alley"), sourceAsset: { providerId: "cloudinary", assetId:"project-b/alley" } },
    ]);

    const { document, changed } = healTimelineDocument(input, [
      inFolder("project-a", "alley", 3, `${CLOUD}/a/alley.mp4`),
      inFolder("project-b", "alley", 30, `${CLOUD}/b/alley.mp4`),
    ]);

    expect(changed).toBe(true);
    expect(srcOf(at(document.clips, 0))).toBe(`${CLOUD}/b/alley.mp4`);
    expect(at(document.clips, 0).duration).toBe(30);
  });

  it("does not fall back to a same-named asset when provenance names a missing one", () => {
    const input = doc([
      { ...videoOf("alley"), sourceAsset: { providerId: "cloudinary", assetId:"deleted/alley" } },
    ]);

    const { document, changed } = healTimelineDocument(input, [
      inFolder("project-a", "alley", 3, `${CLOUD}/a/alley.mp4`),
    ]);

    // The asset it was placed from is gone. A same-named neighbour is not it.
    expect(changed).toBe(false);
    expect(document).toBe(input);
  });
});
