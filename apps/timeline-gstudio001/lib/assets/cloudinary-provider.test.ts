import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudinaryAsset } from "@/lib/cloudinary-media-store";

// The adapter under its process boundary: the vendor store is faked, the
// mapping and the provider's list() run for real.
const state = vi.hoisted(() => ({
  vendorAssets: [] as CloudinaryAsset[],
  listedForUid: null as string | null,
}));

vi.mock("@/lib/cloudinary-media-store", () => ({
  listCloudinaryAssets: async (uid: string) => {
    state.listedForUid = uid;
    return state.vendorAssets;
  },
}));

import {
  CLOUDINARY_PROVIDER_ID,
  cloudinaryAssetProvider,
  cloudinaryAssetToAsset,
} from "./cloudinary-provider";

function vendorAsset(overrides: Partial<CloudinaryAsset>): CloudinaryAsset {
  return {
    id: "gstudio/user-1/pic-123",
    pathname: "gstudio/user-1/pic-123",
    url: "https://res.cloudinary.test/image/upload/gstudio/user-1/pic-123.png",
    thumbnailUrl: "https://res.cloudinary.test/thumb/pic-123.jpg",
    resourceType: "image",
    relativePath: "pic-123",
    ...overrides,
  };
}

beforeEach(() => {
  state.vendorAssets = [];
  state.listedForUid = null;
});

describe("cloudinaryAssetToAsset", () => {
  it("maps a vendor row to the neutral shape, folders from relativePath", () => {
    const mapped = cloudinaryAssetToAsset(
      vendorAsset({
        relativePath: "Foobar 001/Scenes/beach-178.png",
        width: 1600,
        height: 900,
        size: 12345,
        createdAt: "2026-07-01T00:00:00Z",
      }),
    );
    expect(mapped).toEqual({
      id: "gstudio/user-1/pic-123",
      providerId: CLOUDINARY_PROVIDER_ID,
      name: "beach-178.png",
      kind: "image",
      src: "https://res.cloudinary.test/image/upload/gstudio/user-1/pic-123.png",
      thumbnailUrl: "https://res.cloudinary.test/thumb/pic-123.jpg",
      folderPath: ["Foobar 001", "Scenes"],
      tags: [],  // absent upstream -> none, not undefined
      width: 1600,
      height: 900,
      bytes: 12345,
      createdAt: "2026-07-01T00:00:00Z",
    });
  });

  it("keeps the vendor id verbatim — it IS what sourceAsset.assetId records", () => {
    const mapped = cloudinaryAssetToAsset(vendorAsset({ id: "gstudio/u/deep/path/name-1" }));
    expect(mapped.id).toBe("gstudio/u/deep/path/name-1");
  });

  it("maps a video's duration to durationSeconds", () => {
    const mapped = cloudinaryAssetToAsset(
      vendorAsset({ resourceType: "video", duration: 12.4, relativePath: "clip.mp4" }),
    );
    expect(mapped.kind).toBe("video");
    expect(mapped.durationSeconds).toBe(12.4);
    expect(mapped.folderPath).toEqual([]);
  });

  it("falls back to the pathname when relativePath is absent", () => {
    const mapped = cloudinaryAssetToAsset(
      vendorAsset({ relativePath: undefined, pathname: "gstudio/user-1/pic-123" }),
    );
    expect(mapped.name).toBe("pic-123");
  });
});

describe("cloudinaryAssetProvider.list", () => {
  it("lists for the CALLER's uid and scopes by the queried folder", async () => {
    state.vendorAssets = [
      vendorAsset({ id: "a", relativePath: "root-a.png" }),
      vendorAsset({ id: "b", relativePath: "Scenes/b.png" }),
      vendorAsset({ id: "c", relativePath: "Scenes/Heist/c.png" }),
    ];
    const flat = await cloudinaryAssetProvider.list({ uid: "user-1" }, {});
    expect(state.listedForUid).toBe("user-1");
    expect(flat.assets.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(flat.folders.map((folder) => folder.name)).toEqual(["Scenes"]);

    const scenes = await cloudinaryAssetProvider.list({ uid: "user-1" }, { folder: ["Scenes"] });
    expect(scenes.assets.map((entry) => entry.id)).toEqual(["b"]);
    expect(scenes.folders).toEqual([{ name: "Heist", path: ["Scenes", "Heist"] }]);
  });

  it("declares folders and tags on, the not-yet-served capabilities off", () => {
    expect(cloudinaryAssetProvider.capabilities).toEqual({
      folders: true,
      tags: true,
      search: false,
      upload: false,
      delete: false,
    });
  });

  it("carries vendor tags through and serves a tagPath query as a TAG page", async () => {
    state.vendorAssets = [
      vendorAsset({ id: "plain", relativePath: "plain.png" }),
      vendorAsset({ id: "tagged", relativePath: "Scenes/t.png", tags: ["scene/heist"] }),
    ];
    const root = await cloudinaryAssetProvider.list({ uid: "user-1" }, { tagPath: [] });
    // Tag space ignores folders entirely: the untagged asset sits at the tags
    // root even though it also sits at the folder root, and the tagged one is
    // reachable only through its tag group.
    expect(root.assets.map((entry) => entry.id)).toEqual(["plain"]);
    expect(root.folders).toEqual([{ name: "scene", path: ["scene"] }]);

    const heist = await cloudinaryAssetProvider.list(
      { uid: "user-1" },
      { tagPath: ["scene", "heist"] },
    );
    expect(heist.assets.map((entry) => entry.id)).toEqual(["tagged"]);
  });
});
