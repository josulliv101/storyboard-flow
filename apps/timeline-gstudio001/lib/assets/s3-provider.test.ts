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

function deps(
  objects: readonly S3ObjectSummary[],
  deletes: string[] = [],
): S3Deps {
  return {
    listObjects: async () => objects,
    // Public-base style: encoded key appended. The presigned path is exercised
    // separately below.
    urlFor: async (key) =>
      `https://cdn.test/${key.split("/").map(encodeURIComponent).join("/")}`,
    deleteObject: async (key) => {
      deletes.push(key);
    },
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
      {
        key: "media/u/project-a/root.png",
        size: 10,
        lastModified: "2026-07-01T00:00:00Z",
      },
      { key: "media/u/project-a/Scenes/a.jpg" },
      { key: "media/u/project-a/Scenes/Heist/b.png" },
      { key: "media/u/project-b/other.png" },
    ]);
    const flat = await s3.list({ uid: "u", projectId: "project-a" }, {});
    expect(flat.assets.map((entry) => entry.id)).toEqual([
      "media/u/project-a/root.png",
      "media/u/project-a/Scenes/a.jpg",
      "media/u/project-a/Scenes/Heist/b.png",
    ]);
    expect(flat.assets[0]).toMatchObject({
      providerId: S3_PROVIDER_ID,
      projectIds: ["project-a"],
      name: "root.png",
      kind: "image",
      src: "https://cdn.test/media/u/project-a/root.png",
      thumbnailUrl: "https://cdn.test/media/u/project-a/root.png",
      folderPath: [], // the configured prefix is stripped — user-visible tree
      bytes: 10,
      createdAt: "2026-07-01T00:00:00Z",
    });
    expect(flat.folders).toEqual([{ name: "Scenes", path: ["Scenes"] }]);
  });

  it("scopes a folder query exactly like the Cloudinary adapter (shared derivation)", async () => {
    const s3 = provider([
      { key: "media/u/project-a/root.png" },
      { key: "media/u/project-a/Scenes/a.jpg" },
      { key: "media/u/project-a/Scenes/Heist/b.png" },
    ]);
    const scenes = await s3.list(
      { uid: "u", projectId: "project-a" },
      { folder: ["Scenes"] },
    );
    expect(scenes.assets.map((entry) => entry.id)).toEqual([
      "media/u/project-a/Scenes/a.jpg",
    ]);
    expect(scenes.folders).toEqual([{ name: "Heist", path: ["Scenes", "Heist"] }]);
  });

  it("skips non-media keys instead of surfacing broken tiles", async () => {
    const s3 = provider([
      { key: "media/u/project-a/a.png" },
      { key: "media/u/project-a/notes.txt" },
      { key: "media/u/project-a/manifest.json" },
      { key: "media/u/project-a/subdir/" }, // S3 directory marker
    ]);
    expect(
      (
        await s3.list({ uid: "u", projectId: "project-a" }, {})
      ).assets.map((entry) => entry.id),
    ).toEqual(["media/u/project-a/a.png"]);
  });

  it("uses a sibling image as a video's poster, and an empty thumb when none", async () => {
    const s3 = provider([
      { key: "media/u/project-a/clip.mp4" },
      { key: "media/u/project-a/clip.jpg" },
      { key: "media/u/project-a/lonely.mp4" },
    ]);
    const assets = (await s3.list({ uid: "u", projectId: "project-a" }, {})).assets;
    const withPoster = assets.find(
      (entry) => entry.id === "media/u/project-a/clip.mp4",
    );
    const noPoster = assets.find(
      (entry) => entry.id === "media/u/project-a/lonely.mp4",
    );
    expect(withPoster?.thumbnailUrl).toBe(
      "https://cdn.test/media/u/project-a/clip.jpg",
    );
    expect(withPoster?.src).toBe("https://cdn.test/media/u/project-a/clip.mp4");
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
      // Nothing uploads to S3 through this app yet; deleting is implemented
      // (see the remove tests below).
      upload: false,
      delete: true,
    });
    // A stray tagPath is ignored (contract: never throw), served as folders.
    const page = await s3.list(
      { uid: "u", projectId: "project-a" },
      { tagPath: ["anything"] },
    );
    expect(page.assets).toEqual([]);
  });

  it("labels itself by bucket, so the picker distinguishes two S3 buckets", () => {
    expect(provider([]).label).toBe("S3 (media-bucket)");
  });

  it("caches the listing within its TTL — one sweep serves several browses", async () => {
    const listObjects = vi.fn(
      async () =>
        [
          { key: "media/u/project-a/a.png" },
          { key: "media/u/project-b/b.png" },
        ] as S3ObjectSummary[],
    );
    const created = createS3AssetProvider(ENV, {
      listObjects,
      urlFor: async (key) => `https://cdn.test/${key}`,
      deleteObject: async () => {},
    });
    if (created === null) throw new Error("expected provider");
    await created.list({ uid: "u", projectId: "project-a" }, {});
    await created.list({ uid: "u", projectId: "project-b" }, { folder: ["x"] });
    expect(listObjects).toHaveBeenCalledTimes(1);
  });
});

describe("remove", () => {
  it("deletes the object by key", async () => {
    const deletes: string[] = [];
    const created = createS3AssetProvider(ENV, deps([], deletes));
    if (created === null) throw new Error("expected provider");

    await created.remove?.({ uid: "u" }, { assetId: "media/u/project-a/a.png", kind: "image" });
    expect(deletes).toEqual(["media/u/project-a/a.png"]);
  });

  it("refuses a key outside the owner's prefix", async () => {
    // The listing only ever exposes `<prefix>/<uid>/<projectId>/…`, so that is
    // the boundary a delete has to be held to as well.
    const deletes: string[] = [];
    const created = createS3AssetProvider(ENV, deps([], deletes));
    if (created === null) throw new Error("expected provider");

    for (const assetId of [
      "media/other-user/project-a/a.png",
      // The trailing slash in the prefix is what stops a uid prefix-matching a
      // longer one.
      "media/u2/project-a/a.png",
      "somewhere/else.png",
    ]) {
      await expect(created.remove?.({ uid: "u" }, { assetId, kind: "image" })).rejects.toThrow(
        /outside the owner's prefix/,
      );
    }
    expect(deletes).toEqual([]);
  });

  it("declares the capability it implements", () => {
    expect(provider([]).capabilities.delete).toBe(true);
    expect(provider([]).remove).toBeTypeOf("function");
  });

  it("drops the listing cache, so a deleted object stops being served", async () => {
    const listObjects = vi.fn(async () => [{ key: "media/u/p/a.png" }] as S3ObjectSummary[]);
    const created = createS3AssetProvider(ENV, {
      listObjects,
      urlFor: async (key) => `https://cdn.test/${key}`,
      deleteObject: async () => {},
    });
    if (created === null) throw new Error("expected provider");

    await created.list({ uid: "u", projectId: "p" }, {});
    await created.remove?.({ uid: "u" }, { assetId: "media/u/p/a.png", kind: "image" });
    await created.list({ uid: "u", projectId: "p" }, {});
    // Without the invalidation the second browse is served from the 30s cache
    // and renders a tile whose URL now 404s.
    expect(listObjects).toHaveBeenCalledTimes(2);
  });
});
