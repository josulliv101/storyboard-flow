import { beforeEach, describe, expect, it, vi } from "vitest";

// The adapter under its process boundary: the vendor store is faked, the
// provider's own guard and capability claim run for real.
//
// This file used to be mostly LISTING tests — the mapping into neutral assets,
// folder scoping, tag pages, search. All of that went with the asset tray
// (PL12-005/006); what a Cloudinary provider is asked for now is a delete.
const state = vi.hoisted(() => ({
  deletes: [] as { publicId: string; resourceType: string }[],
}));

vi.mock("@/lib/cloudinary-media-store", () => ({
  cloudinaryUserPrefix: (uid: string) => `gstudio/${uid}/`,
  deleteCloudinaryAsset: async (publicId: string, resourceType: string) => {
    state.deletes.push({ publicId, resourceType });
  },
}));

import { CLOUDINARY_PROVIDER_ID, cloudinaryAssetProvider } from "./cloudinary-provider";

beforeEach(() => {
  state.deletes.length = 0;
});

describe("cloudinaryAssetProvider", () => {
  it("declares delete, and implements it", () => {
    // The capability and the method are ONE claim; a provider declaring the
    // first without the second is a bug the registry cannot catch.
    expect(cloudinaryAssetProvider.id).toBe(CLOUDINARY_PROVIDER_ID);
    expect(cloudinaryAssetProvider.capabilities).toEqual({ delete: true });
    expect(cloudinaryAssetProvider.remove).toBeTypeOf("function");
  });

  it("destroys the public id, per resource type", async () => {
    // The kind is not decoration: Cloudinary's destroy endpoint is per
    // resource type, and the sweep calling this has no clip left to ask.
    await cloudinaryAssetProvider.remove?.(
      { uid: "user-1" },
      { assetId: "gstudio/user-1/project-a/clip.mp4", kind: "video" },
    );
    expect(state.deletes).toEqual([
      { publicId: "gstudio/user-1/project-a/clip.mp4", resourceType: "video" },
    ]);
  });

  it("refuses a public id outside the owner's folder", async () => {
    for (const assetId of [
      "gstudio/user-2/project-a/clip.png",
      // The prefix's trailing slash is what stops "user-1" matching "user-10".
      "gstudio/user-10/project-a/clip.png",
      "somewhere-else/clip.png",
    ]) {
      await expect(
        cloudinaryAssetProvider.remove?.({ uid: "user-1" }, { assetId, kind: "image" }),
      ).rejects.toThrow(/outside the owner's folder/);
    }
    expect(state.deletes).toEqual([]);
  });
});
