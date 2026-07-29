// Cloudinary behind the neutral seam.
//
// The vendor store (cloudinary-media-store) stays exactly what it was — the
// upload route and document healing still use it directly. This adapter used to
// translate its LISTING into neutral `Asset`s for the tray; with the tray gone
// (PL12-005/006) the one thing left above the seam is deletion, which is what
// the reclaim sweep asks for.

import {
  cloudinaryUserPrefix,
  deleteCloudinaryAsset,
} from "@/lib/cloudinary-media-store";

import type { AssetProvider } from "./provider";

export const CLOUDINARY_PROVIDER_ID = "cloudinary";

export const cloudinaryAssetProvider: AssetProvider = {
  id: CLOUDINARY_PROVIDER_ID,
  label: "Cloudinary",
  capabilities: { delete: true },
  async remove(ctx, target) {
    // The id has to be one of THIS user's. Nothing upstream can currently send
    // another user's id — tombstones are written from the owner's own clips —
    // but a delete is the one operation where "currently" is not good enough,
    // and the public id carries the owner, so the check is free.
    const prefix = cloudinaryUserPrefix(ctx.uid);
    if (!target.assetId.startsWith(prefix)) {
      throw new Error("Refusing to delete a Cloudinary asset outside the owner's folder.");
    }
    // Cloudinary answers a destroy for a missing public id with 200 and
    // `{ result: "not found" }`, so an already-deleted asset resolves rather
    // than throwing — which is what the sweep needs (see `remove` on the
    // provider type: the desired end state is "not there").
    await deleteCloudinaryAsset(target.assetId, target.kind);
  },
};
