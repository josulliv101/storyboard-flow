import { describe, expect, it, vi } from "vitest";

import {
  createS3AssetProvider,
  readS3Config,
  S3_PROVIDER_ID,
  type S3Deps,
  type S3ObjectSummary,
} from "./s3-provider";

const ENV = {
  S3_ASSETS_BUCKET: "media-bucket",
  S3_ASSETS_REGION: "us-east-1",
  S3_ASSETS_PREFIX: "media/",
  S3_ASSETS_PUBLIC_URL: "https://cdn.test",
} as const;

function deps(objects: readonly S3ObjectSummary[]): S3Deps {
  return {
    listObjects: async () => objects,
    // Public-base style: encoded key appended. The presigned path is exercised
    // separately below.
    urlFor: async (key) =>
      `https://cdn.test/${key.split("/").map(encodeURIComponent).join("/")}`,
  };
}

function provider(objects: readonly S3ObjectSummary[], env = ENV) {
  const created = createS3AssetProvider(env, deps(objects));
  if (created === null) throw new Error("expected S3 provider to register");
  return created;
}

describe("readS3Config", () => {
  it("returns null unless BOTH bucket and region are set", () => {
    expect(readS3Config({})).toBeNull();
    expect(readS3Config({ S3_ASSETS_BUCKET: "b" })).toBeNull();
    expect(readS3Config({ S3_ASSETS_REGION: "r" })).toBeNull();
    expect(readS3Config({ S3_ASSETS_BUCKET: "b", S3_ASSETS_REGION: "r" })).not.toBeNull();
  });

  it("normalizes the prefix to 'seg/seg/' or '' whatever the author typed", () => {
    const base = { S3_ASSETS_BUCKET: "b", S3_ASSETS_REGION: "r" };
    expect(readS3Config({ ...base, S3_ASSETS_PREFIX: "media" })?.prefix).toBe("media/");
    expect(readS3Config({ ...base, S3_ASSETS_PREFIX: "/media/" })?.prefix).toBe("media/");
    expect(readS3Config({ ...base, S3_ASSETS_PREFIX: "a/b" })?.prefix).toBe("a/b/");
    expect(readS3Config({ ...base })?.prefix).toBe("");
  });

  it("strips a trailing slash from the public URL base", () => {
    const config = readS3Config({ ...ENV, S3_ASSETS_PUBLIC_URL: "https://cdn.test/" });
    expect(config?.publicUrlBase).toBe("https://cdn.test");
  });
});

describe("createS3AssetProvider", () => {
  it("is null (unregistered) when S3 isn't configured", () => {
    expect(createS3AssetProvider({})).toBeNull();
  });

  it("maps object keys to neutral assets, folders from the key path", async () => {
    const s3 = provider([
      { key: "media/root.png", size: 10, lastModified: "2026-07-01T00:00:00Z" },
      { key: "media/Scenes/a.jpg" },
      { key: "media/Scenes/Heist/b.png" },
    ]);
    const flat = await s3.list({ uid: "u" }, {});
    expect(flat.assets.map((entry) => entry.id)).toEqual([
      "media/root.png",
      "media/Scenes/a.jpg",
      "media/Scenes/Heist/b.png",
    ]);
    expect(flat.assets[0]).toMatchObject({
      providerId: S3_PROVIDER_ID,
      name: "root.png",
      kind: "image",
      src: "https://cdn.test/media/root.png",
      thumbnailUrl: "https://cdn.test/media/root.png",
      folderPath: [], // the configured prefix is stripped — user-visible tree
      bytes: 10,
      createdAt: "2026-07-01T00:00:00Z",
    });
    expect(flat.folders).toEqual([{ name: "Scenes", path: ["Scenes"] }]);
  });

  it("scopes a folder query exactly like the Cloudinary adapter (shared derivation)", async () => {
    const s3 = provider([
      { key: "media/root.png" },
      { key: "media/Scenes/a.jpg" },
      { key: "media/Scenes/Heist/b.png" },
    ]);
    const scenes = await s3.list({ uid: "u" }, { folder: ["Scenes"] });
    expect(scenes.assets.map((entry) => entry.id)).toEqual(["media/Scenes/a.jpg"]);
    expect(scenes.folders).toEqual([{ name: "Heist", path: ["Scenes", "Heist"] }]);
  });

  it("skips non-media keys instead of surfacing broken tiles", async () => {
    const s3 = provider([
      { key: "media/a.png" },
      { key: "media/notes.txt" },
      { key: "media/manifest.json" },
      { key: "media/subdir/" }, // S3 directory marker
    ]);
    expect((await s3.list({ uid: "u" }, {})).assets.map((entry) => entry.id)).toEqual([
      "media/a.png",
    ]);
  });

  it("uses a sibling image as a video's poster, and an empty thumb when none", async () => {
    const s3 = provider([
      { key: "media/clip.mp4" },
      { key: "media/clip.jpg" },
      { key: "media/lonely.mp4" },
    ]);
    const assets = (await s3.list({ uid: "u" }, {})).assets;
    const withPoster = assets.find((entry) => entry.id === "media/clip.mp4");
    const noPoster = assets.find((entry) => entry.id === "media/lonely.mp4");
    expect(withPoster?.thumbnailUrl).toBe("https://cdn.test/media/clip.jpg");
    expect(withPoster?.src).toBe("https://cdn.test/media/clip.mp4");
    expect(noPoster?.thumbnailUrl).toBe("");
  });

  it("declares folders and search on, tags off — its Folders/Tags toggle disappears", async () => {
    const s3 = provider([]);
    expect(s3.capabilities).toEqual({
      folders: true,
      tags: false,
      // S3 has no search API and needs none: the same in-memory derivation
      // over the same listing that already serves folders.
      search: true,
      upload: false,
      delete: false,
    });
    // A stray tagPath is ignored (contract: never throw), served as folders.
    const page = await s3.list({ uid: "u" }, { tagPath: ["anything"] });
    expect(page.assets).toEqual([]);
  });

  it("labels itself by bucket, so the picker distinguishes two S3 buckets", () => {
    expect(provider([]).label).toBe("S3 (media-bucket)");
  });

  it("caches the listing within its TTL — one sweep serves several browses", async () => {
    const listObjects = vi.fn(async () => [{ key: "media/a.png" }] as S3ObjectSummary[]);
    const created = createS3AssetProvider(ENV, {
      listObjects,
      urlFor: async (key) => `https://cdn.test/${key}`,
    });
    if (created === null) throw new Error("expected provider");
    await created.list({ uid: "u" }, {});
    await created.list({ uid: "u" }, { folder: ["x"] });
    expect(listObjects).toHaveBeenCalledTimes(1);
  });
});
