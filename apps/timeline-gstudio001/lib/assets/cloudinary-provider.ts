// Cloudinary behind the neutral seam. The vendor store (cloudinary-media-store)
// stays exactly what it was — the upload route and document healing still use
// it directly; this adapter only translates its LISTING into the neutral
// `Asset` shape for the panel/API surface.

import {
  cloudinaryUserPrefix,
  deleteCloudinaryAsset,
  listCloudinaryAssets,
  type CloudinaryAsset,
} from "@/lib/cloudinary-media-store";

import { pageFromFlatListing, pageFromSearch, pageFromTagListing } from "./path-folders";
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
export function cloudinaryAssetToAsset(
  vendorAsset: CloudinaryAsset,
  projectId: string,
): Asset {
  const relative = vendorAsset.relativePath ?? vendorAsset.pathname;
  const segments = relative.split("/").filter((segment) => segment.length > 0);
  return {
    id: vendorAsset.id,
    providerId: CLOUDINARY_PROVIDER_ID,
    projectIds: [projectId],
    name: segments[segments.length - 1] ?? relative,
    kind: vendorAsset.resourceType,
    src: vendorAsset.url,
    thumbnailUrl: vendorAsset.thumbnailUrl,
    folderPath: segments.slice(0, -1),
    tags: vendorAsset.tags ?? [],
    ...(vendorAsset.width === undefined ? {} : { width: vendorAsset.width }),
    ...(vendorAsset.height === undefined ? {} : { height: vendorAsset.height }),
    ...(vendorAsset.duration === undefined ? {} : { durationSeconds: vendorAsset.duration }),
    ...(vendorAsset.size === undefined ? {} : { bytes: vendorAsset.size }),
    ...(vendorAsset.createdAt === undefined ? {} : { createdAt: vendorAsset.createdAt }),
  };
}

export async function listCloudinaryProjectAssets(
  ctx: AssetContext,
): Promise<readonly Asset[]> {
  return (await listCloudinaryAssets(ctx.uid, ctx.projectId)).map((asset) =>
    cloudinaryAssetToAsset(asset, ctx.projectId),
  );
}

export const cloudinaryAssetProvider: AssetProvider = {
  id: CLOUDINARY_PROVIDER_ID,
  label: "Cloudinary",
  capabilities: {
    folders: true,
    tags: true,
    // Declared OFF until the adapter actually serves them — the UI offers
    // only what list() honours today.
    // Derived in memory from the SAME full listing folders and tags are
    // derived from (see pageFromSearch) — no vendor search API involved, so
    // this is as complete as browsing is.
    search: true,
    upload: false,
    // The seam's `remove` is implemented below. Uploading still happens through
    // the vendor store directly (the drop-on-board route), so that one stays
    // honestly off until it moves behind the seam.
    delete: true,
  },
  async list(ctx: AssetContext, query) {
    // The store's listing is already user/project-scoped and paginated at the vendor
    // boundary; folder/tag scoping is derived from it in memory (the
    // documented fallback in path-folders — a native `prefix`/tag query is
    // the upgrade path if libraries outgrow it).
    const assets = await listCloudinaryProjectAssets(ctx);
    // Search wins over both browse modes: a query spans the whole library, so
    // scoping it to the folder or tag the user happened to be standing in
    // would hide the results they asked for.
    if (query.search !== undefined && query.search.trim().length > 0) {
      return pageFromSearch(assets, query);
    }
    return query.tagPath !== undefined
      ? pageFromTagListing(assets, query)
      : pageFromFlatListing(assets, query);
  },
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
