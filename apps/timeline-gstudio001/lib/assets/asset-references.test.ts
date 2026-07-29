import { describe, expect, it } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

import {
  assetCandidatesFromClips,
  assetKeysFromClips,
  assetRefKey,
  unreferencedCandidates,
} from "./asset-references";

function mediaClip(
  id: string,
  source?: { providerId: string; assetId: string },
  kind: "image" | "video" = "image",
): TimelineClip {
  return {
    id,
    index: 0,
    kind,
    src: `https://example.test/${id}`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
    ...(source === undefined ? {} : { sourceAsset: source }),
  } as TimelineClip;
}

function collectionClip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: id,
    childTimelineId: `${id}-child`,
    itemCount: 2,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 8,
    sourceDuration: 8,
    trimIn: 0,
    trimOut: 0,
  } as TimelineClip;
}

describe("assetRefKey", () => {
  it("survives a path-shaped asset id", () => {
    // Cloudinary public ids contain "/" — the key must stay one Firestore-legal
    // segment, so the encoding has to escape it.
    const key = assetRefKey({ providerId: "cloudinary", assetId: "root/user-a/proj/clip.mp4" });
    expect(key).toBe("cloudinary|root%2Fuser-a%2Fproj%2Fclip.mp4");
    expect(key).not.toContain("/");
  });

  it("cannot be forged by an id containing the delimiter", () => {
    // Without encoding, these two collide: "a|b" + "c" vs "a" + "b|c".
    const left = assetRefKey({ providerId: "a|b", assetId: "c" });
    const right = assetRefKey({ providerId: "a", assetId: "b|c" });
    expect(left).not.toBe(right);
  });

  it("distinguishes the same asset id under different providers", () => {
    expect(assetRefKey({ providerId: "cloudinary", assetId: "same" })).not.toBe(
      assetRefKey({ providerId: "s3", assetId: "same" }),
    );
  });
});

describe("assetCandidatesFromClips", () => {
  it("takes provenance and the kind the provider will need", () => {
    const candidates = assetCandidatesFromClips([
      mediaClip("c1", { providerId: "cloudinary", assetId: "a.png" }),
      mediaClip("c2", { providerId: "cloudinary", assetId: "b.mp4" }, "video"),
    ]);

    expect(candidates).toEqual([
      { ref: { providerId: "cloudinary", assetId: "a.png" }, kind: "image" },
      { ref: { providerId: "cloudinary", assetId: "b.mp4" }, kind: "video" },
    ]);
  });

  it("de-duplicates: two clips of one file are one asset", () => {
    // The exact shape that made the old delete-on-empty unsafe.
    const ref = { providerId: "cloudinary", assetId: "shared.png" };
    expect(assetCandidatesFromClips([mediaClip("c1", ref), mediaClip("c2", ref)])).toHaveLength(1);
  });

  it("ignores clips with no provenance, and collections", () => {
    // An asset nobody can name is never deleted: un-provenanced media leaks
    // storage, which is the failure direction this is allowed to have.
    expect(
      assetCandidatesFromClips([mediaClip("legacy"), collectionClip("folder")]),
    ).toEqual([]);
  });
});

describe("unreferencedCandidates", () => {
  const orphan = { providerId: "cloudinary", assetId: "orphan.png" };
  const shared = { providerId: "cloudinary", assetId: "shared.png" };

  it("keeps only what nothing points at", () => {
    const candidates = assetCandidatesFromClips([
      mediaClip("t1", orphan),
      mediaClip("t2", shared),
    ]);
    const referenced = new Set(assetKeysFromClips([mediaClip("live", shared)]));

    expect(unreferencedCandidates(candidates, referenced)).toEqual([
      { ref: orphan, kind: "image" },
    ]);
  });

  it("counts a reference from a DIFFERENT provider as a different asset", () => {
    const candidates = assetCandidatesFromClips([mediaClip("t1", orphan)]);
    const referenced = new Set(
      assetKeysFromClips([mediaClip("live", { providerId: "s3", assetId: "orphan.png" })]),
    );

    expect(unreferencedCandidates(candidates, referenced)).toHaveLength(1);
  });

  it("deletes nothing when everything is still in use", () => {
    const candidates = assetCandidatesFromClips([mediaClip("t1", shared)]);
    const referenced = new Set(assetKeysFromClips([mediaClip("live", shared)]));

    expect(unreferencedCandidates(candidates, referenced)).toEqual([]);
  });
});
