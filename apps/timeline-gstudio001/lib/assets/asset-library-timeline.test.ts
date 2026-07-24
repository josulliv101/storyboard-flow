import { describe, expect, it } from "vitest";

import { encodeFolderPath } from "@storyboard/timeline-model";
import type { CollectionTimelineClip, TimelineClip } from "@storyboard/timeline-model/types";

import { buildAssetLibraryClips } from "./asset-library-timeline";
import type { Asset, AssetFolder, AssetPage } from "./types";

const UID = "user-1";

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id,
    providerId: "cloudinary",
    name: `${id}.png`,
    kind: "image",
    src: `https://cdn.test/${id}`,
    thumbnailUrl: `https://cdn.test/${id}.thumb`,
    folderPath: [],
    tags: [],
    ...over,
  };
}

function folder(...path: string[]): AssetFolder {
  return { name: path[path.length - 1], path };
}

function page(over: Partial<AssetPage> = {}): AssetPage {
  return { assets: [], folders: [], ...over };
}

const childId = (segments: string[]) =>
  `asset-library-col-${UID}-${encodeFolderPath(segments.join("/"))}`;

describe("buildAssetLibraryClips", () => {
  it("maps subfolders to navigable collections and assets to media, folders first", () => {
    const clips = buildAssetLibraryClips(
      page({
        folders: [folder("Scenes")],
        assets: [asset("pic-1"), asset("clip-1", { kind: "video", durationSeconds: 12 })],
      }),
      UID,
    );
    expect(clips.map((clip) => clip.kind)).toEqual(["collection", "image", "video"]);

    const collection = clips[0] as CollectionTimelineClip;
    expect(collection.title).toBe("Scenes");
    expect(collection.childTimelineId).toBe(childId(["Scenes"]));
    expect(collection.id).toBe(`dynamic-col-${encodeFolderPath("Scenes")}`);

    // A nested subfolder's child id embeds its FULL path.
    const nested = buildAssetLibraryClips(page({ folders: [folder("Scenes", "Heist")] }), UID);
    expect((nested[0] as CollectionTimelineClip).childTimelineId).toBe(childId(["Scenes", "Heist"]));
  });

  it("records sourceAsset provenance and strips the extension from the name", () => {
    // asset("beach") -> name "beach.png"; stripExtension -> "beach".
    const [image] = buildAssetLibraryClips(page({ assets: [asset("beach")] }), UID);
    expect(image).toMatchObject({
      kind: "image",
      alt: "beach", // extension stripped from the .png name
      src: "https://cdn.test/beach",
      sourceAsset: { providerId: "cloudinary", assetId: "beach" },
    });
  });

  it("uses the asset's real duration for video, default 4s for image", () => {
    const clips = buildAssetLibraryClips(
      page({
        assets: [asset("v", { kind: "video", durationSeconds: 9.5 }), asset("i")],
      }),
      UID,
    );
    expect(clips[0].duration).toBe(9.5);
    expect(clips[1].duration).toBe(4);
  });

  it("packs with a 1s leading pad and 1s gaps, reindexed", () => {
    const clips = buildAssetLibraryClips(
      page({ assets: [asset("a"), asset("b")] }),
      UID,
    );
    // image duration 4, gap 1 -> starts at 1, then 1+4+1 = 6
    expect(clips.map((clip) => [clip.index, clip.startTime])).toEqual([
      [0, 1],
      [1, 6],
    ]);
  });

  it("keeps a persisted clip's order and drops stale ones on refresh", () => {
    const persisted: TimelineClip[] = [
      // still-live asset, out of listing order — its position must survive
      { ...(buildAssetLibraryClips(page({ assets: [asset("b")] }), UID)[0]) },
      // stale media (asset deleted) — must be dropped
      { ...(buildAssetLibraryClips(page({ assets: [asset("gone")] }), UID)[0]) },
    ];
    const clips = buildAssetLibraryClips(
      page({ assets: [asset("a"), asset("b")] }),
      UID,
      persisted,
    );
    // b (persisted, kept first) then a (newly appended); "gone" dropped.
    expect(clips.map((clip) => clip.id)).toEqual([
      `asset-${"b"}`,
      `asset-${"a"}`,
    ]);
  });

  it("drops a persisted collection whose folder no longer exists", () => {
    const persisted = buildAssetLibraryClips(page({ folders: [folder("Old")] }), UID);
    // The live page has a different folder — the stale collection must not
    // survive, and the live one is appended.
    const clips = buildAssetLibraryClips(page({ folders: [folder("New")] }), UID, persisted);
    expect(clips.map((clip) => (clip as CollectionTimelineClip).childTimelineId)).toEqual([
      childId(["New"]),
    ]);
  });

  it("is empty for an empty page", () => {
    expect(buildAssetLibraryClips(page(), UID)).toEqual([]);
  });
});
