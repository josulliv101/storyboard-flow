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
  kind: "image" | "video" | "audio" = "image",
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
      expect.objectContaining({
        ref: { providerId: "cloudinary", assetId: "a.png" },
        kind: "image",
      }),
      expect.objectContaining({
        ref: { providerId: "cloudinary", assetId: "b.mp4" },
        kind: "video",
      }),
    ]);
  });

  // #314. The polarity here was inverted so audio yields a candidate at all —
  // `sourceAssetOf` excludes COLLECTIONS rather than allow-listing image and
  // video, precisely so a new media kind cannot be silently omitted. Nothing
  // tested it. An omitted kind is never marked for reclaim, so its file lives
  // in storage forever and NOTHING FAILS: the app looks perfect while the
  // bill grows. That is the whole reason this test exists.
  it("yields a reclaim candidate for an AUDIO clip", () => {
    const ref = { providerId: "cloudinary", assetId: "takes/vo.flac" };

    const candidates = assetCandidatesFromClips([mediaClip("a1", ref, "audio")]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ ref });
  });

  it("addresses audio as the provider's `video` resource type", () => {
    // AssetKind is the PROVIDER's taxonomy, not the clip's. Cloudinary serves
    // audio under `video` and its destroy endpoint is per resource type, so
    // `kind: "audio"` here would fail to delete the file — the same leak by a
    // different route.
    const candidates = assetCandidatesFromClips([
      mediaClip("a1", { providerId: "cloudinary", assetId: "takes/vo.flac" }, "audio"),
    ]);

    expect(candidates[0].kind).toBe("video");
  });

  it("gives audio an EMPTY thumbnail rather than its own src", () => {
    // Audio has no poster and is not its own thumbnail. Falling back to `src`
    // would put a .flac URL in the recently-deleted list where a row renders
    // it as an <img> — a broken image for every deleted voice take.
    const candidates = assetCandidatesFromClips([
      mediaClip("a1", { providerId: "cloudinary", assetId: "takes/vo.flac" }, "audio"),
    ]);

    expect(candidates[0].thumbnailUrl).toBe("");
  });

  it("still names an audio candidate from the asset id when it has no title", () => {
    const candidates = assetCandidatesFromClips([
      mediaClip("a1", { providerId: "cloudinary", assetId: "takes/vo.flac" }, "audio"),
    ]);

    // A row that prints nothing at all is worse than one printing the leaf.
    expect(candidates[0].name).toBe("a1");
  });

  it("snapshots a name and a thumbnail, because no clip will be left to ask", () => {
    // Authored title first, then the derived description, then the id's leaf —
    // the same precedence the card reads by (PL11-004). The thumbnail is a
    // video's poster or an image itself.
    const [authored] = assetCandidatesFromClips([
      { ...mediaClip("c1", { providerId: "cloudinary", assetId: "a.png" }), title: "Beach, take 3" } as TimelineClip,
    ]);
    expect(authored).toMatchObject({ name: "Beach, take 3", thumbnailUrl: "https://example.test/c1" });

    const [described] = assetCandidatesFromClips([
      mediaClip("c2", { providerId: "cloudinary", assetId: "b.png" }),
    ]);
    // `alt` is the clip id in this fixture's builder.
    expect(described).toMatchObject({ name: "c2" });

    const [postered] = assetCandidatesFromClips([
      {
        ...mediaClip("c3", { providerId: "cloudinary", assetId: "folder/movie.mp4" }, "video"),
        poster: "https://example.test/poster.jpg",
        alt: "",
      } as TimelineClip,
    ]);
    expect(postered).toMatchObject({
      // No title, no alt: the id's LEAF, never the whole path.
      name: "movie.mp4",
      thumbnailUrl: "https://example.test/poster.jpg",
    });
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
      expect.objectContaining({ ref: orphan, kind: "image" }),
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
