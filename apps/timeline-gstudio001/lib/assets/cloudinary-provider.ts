// Cloudinary behind the neutral seam. The vendor store (cloudinary-media-store)
// stays exactly what it was — the upload route and document healing still use
// it directly; this adapter only translates its LISTING into the neutral
// `Asset` shape for the panel/API surface.

import { listCloudinaryAssets, type CloudinaryAsset } from "@/lib/cloudinary-media-store";

import { pageFromFlatListing } from "./path-folders";
import type { AssetContext, AssetProvider } from "./provider";
import type { Asset } from "./types";

export const CLOUDINARY_PROVIDER_ID = "cloudinary";

/**
 * One vendor row → one neutral asset. `id` stays the Cloudinary public id
 * (path-shaped, may contain "/") — it is the durable name deletion and
 * re-resolution use, and exactly what a clip's `sourceAsset.assetId` records.
 * The folder path comes from `relativePath` (the public id with the app/user
 * root prefix stripped by the store), so folders are the folders the USER
 * sees, not the storage-internal `<root>/<uid>/` plumbing.
 */
export function cloudinaryAssetToAsset(vendorAsset: CloudinaryAsset): Asset {
  const relative = vendorAsset.relativePath ?? vendorAsset.pathname;
  const segments = relative.split("/").filter((segment) => segment.length > 0);
  return {
    id: vendorAsset.id,
    providerId: CLOUDINARY_PROVIDER_ID,
    name: segments[segments.length - 1] ?? relative,
    kind: vendorAsset.resourceType,
    src: vendorAsset.url,
    thumbnailUrl: vendorAsset.thumbnailUrl,
    folderPath: segments.slice(0, -1),
    // Phase 3 (tags browse) teaches the store's listing to carry tags; until
    // then Cloudinary reports none and declares the capability off.
    tags: [],
    ...(vendorAsset.width === undefined ? {} : { width: vendorAsset.width }),
    ...(vendorAsset.height === undefined ? {} : { height: vendorAsset.height }),
    ...(vendorAsset.duration === undefined ? {} : { durationSeconds: vendorAsset.duration }),
    ...(vendorAsset.size === undefined ? {} : { bytes: vendorAsset.size }),
    ...(vendorAsset.createdAt === undefined ? {} : { createdAt: vendorAsset.createdAt }),
  };
}

export const cloudinaryAssetProvider: AssetProvider = {
  id: CLOUDINARY_PROVIDER_ID,
  label: "Cloudinary",
  capabilities: {
    folders: true,
    // Declared OFF until the adapter actually serves them — the UI offers
    // only what list() honours today.
    tags: false,
    search: false,
    upload: false,
    delete: false,
  },
  async list(ctx: AssetContext, query) {
    // The store's listing is already user-scoped and paginated at the vendor
    // boundary; folder scoping is derived from it in memory (the documented
    // fallback in path-folders — a native `prefix` query is the upgrade path
    // if libraries outgrow it).
    const vendorAssets = await listCloudinaryAssets(ctx.uid);
    return pageFromFlatListing(vendorAssets.map(cloudinaryAssetToAsset), query);
  },
};
