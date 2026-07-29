// The provider-NEUTRAL asset model. Nothing above this seam names Cloudinary,
// S3, or any other backend; a provider adapter's whole job is to translate its
// vendor's terms into these shapes (see ./provider.ts).
//
// Isomorphic on purpose: client components render these, so this module must
// import nothing server-only.
//
// It used to describe BROWSING as well — `Asset`, `AssetFolder`, `AssetQuery`,
// `AssetPage`, and capabilities for folders/tags/search. All of it existed for
// the asset tray, and went with it (PL12-005/006). What a provider is asked for
// now is exactly one thing: delete this file. If browsing ever returns, the
// shapes are in git history rather than in the way.

export type AssetKind = "image" | "video";

/** A source-of-truth reference to an asset in its provider's own terms —
 *  ALSO recorded on clips minted from an asset (`sourceAsset` on the stored
 *  model), so a clip can always say where its media came from even after
 *  URLs change or the provider is re-configured. It is what reference-counted
 *  deletion counts (see lib/assets/asset-references). */
export type AssetSourceRef = Readonly<{
  /** Registry id of the provider ("cloudinary", "s3", …). */
  providerId: string;
  /** The provider's own id for the asset (public id, object key, …). */
  assetId: string;
}>;

/** What a provider can actually do. One capability left, and it is still worth
 *  having: a provider that cannot delete must say so rather than accept a
 *  reclaim request it will silently ignore. */
export type AssetProviderCapabilities = Readonly<{
  delete: boolean;
}>;

export type AssetProviderDescriptor = Readonly<{
  id: string;
  /** Human label ("Cloudinary", "S3 (media-bucket)") — logs and diagnostics
   *  now that no picker renders it. */
  label: string;
  capabilities: AssetProviderCapabilities;
}>;
