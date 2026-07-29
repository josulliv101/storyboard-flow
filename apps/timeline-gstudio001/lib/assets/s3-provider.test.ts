import { describe, expect, it } from "vitest";

import { createS3AssetProvider, readS3Config, S3_PROVIDER_ID, type S3Deps } from "./s3-provider";

// Listing, folder derivation, sibling posters and presigned URLs were this
// file's subject until the asset tray was retired (PL12-005/006). What is left
// is registration, config normalization, and the delete the reclaim sweep uses.

const ENV = {
  S3_ASSETS_BUCKET: "media-bucket",
  S3_ASSETS_REGION: "us-east-1",
  S3_ASSETS_PREFIX: "media/",
} as const;

function deps(deletes: string[] = []): S3Deps {
  return {
    deleteObject: async (key) => {
      deletes.push(key);
    },
  };
}

function provider(deletes: string[] = [], env = ENV) {
  const created = createS3AssetProvider(env, deps(deletes));
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
    expect(readS3Config({ ...base, S3_ASSETS_PREFIX: "" })?.prefix).toBe("");
    expect(readS3Config(base)?.prefix).toBe("");
  });
});

describe("createS3AssetProvider", () => {
  it("does not register without a bucket — no dead provider in the registry", () => {
    expect(createS3AssetProvider({})).toBeNull();
  });

  it("labels itself by bucket, and declares the delete it implements", () => {
    const s3 = provider();
    expect(s3.id).toBe(S3_PROVIDER_ID);
    expect(s3.label).toBe("S3 (media-bucket)");
    expect(s3.capabilities).toEqual({ delete: true });
    expect(s3.remove).toBeTypeOf("function");
  });
});

describe("remove", () => {
  it("deletes the object by key", async () => {
    const deletes: string[] = [];
    await provider(deletes).remove?.(
      { uid: "u" },
      { assetId: "media/u/project-a/a.png", kind: "image" },
    );
    expect(deletes).toEqual(["media/u/project-a/a.png"]);
  });

  it("refuses a key outside the owner's prefix", async () => {
    const deletes: string[] = [];
    const s3 = provider(deletes);

    for (const assetId of [
      "media/other-user/project-a/a.png",
      // The trailing slash in the prefix is what stops a uid prefix-matching a
      // longer one.
      "media/u2/project-a/a.png",
      "somewhere/else.png",
    ]) {
      await expect(s3.remove?.({ uid: "u" }, { assetId, kind: "image" })).rejects.toThrow(
        /outside the owner's prefix/,
      );
    }
    expect(deletes).toEqual([]);
  });
});
