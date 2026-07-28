// The provider-NEUTRAL asset model — what the asset panel, the palette, and
// the /api/assets surface speak. Nothing above this seam names Cloudinary,
// S3, or any other backend; a provider adapter's whole job is to translate
// its vendor's listing into these shapes (see ./provider.ts).
//
// Isomorphic on purpose: client components render `Asset`s, so this module
// must import nothing server-only.

export type AssetKind = "image" | "video";

/** A source-of-truth reference to an asset in its provider's own terms —
 *  ALSO recorded on clips minted from an asset (`sourceAsset` on the stored
 *  model), so a clip can always say where its media came from even after
 *  URLs change or the provider is re-configured. */
export type AssetSourceRef = Readonly<{
  /** Registry id of the provider ("cloudinary", "s3", …). */
  providerId: string;
  /** The provider's own id for the asset (public id, object key, …). */
  assetId: string;
}>;

export type Asset = Readonly<{
  /** The provider's own id — unique within that provider only. Pair with
   *  `providerId` (an `AssetSourceRef`) anywhere two providers can meet. */
  id: string;
  providerId: string;
  /**
   * Project memberships for this asset. Today this contains exactly one id;
   * the array leaves the model ready for explicitly shared assets later.
   */
  projectIds: readonly string[];
  /** Display name — the basename, not a path. */
  name: string;
  kind: AssetKind;
  /** Directly usable media URL. */
  src: string;
  /** Small preview image URL (a poster frame for videos). */
  thumbnailUrl: string;
  /** REAL containment hierarchy, root = []. Providers without folders always
   *  report []. */
  folderPath: readonly string[];
  /** Flat labels; a "/" inside a tag is the pseudo-hierarchy separator the
   *  tags browse mode nests on. Providers without tags report []. */
  tags: readonly string[];
  width?: number;
  height?: number;
  /** Videos only. */
  durationSeconds?: number;
  bytes?: number;
  createdAt?: string;
}>;

export type AssetFolder = Readonly<{
  /** Display name of this folder (its last path segment). */
  name: string;
  /** Full path from the root, ending in `name`. */
  path: readonly string[];
}>;

export type AssetQuery = Readonly<{
  /**
   * Folder to browse. `undefined` = the FLAT listing (every asset, no
   * folder scoping); `[]` = the root folder's direct children; deeper
   * arrays scope to that folder. Distinct on purpose: flat is a view, root
   * is a place.
   */
  folder?: readonly string[];
  /**
   * TAG pseudo-hierarchy to browse instead (capability-gated; wins over
   * `folder` when both are present). Same segment semantics — a tag
   * "scene/heist" is the path ["scene", "heist"] — with the two differences
   * tags force: an asset tagged twice lives in both places, and an UNTAGGED
   * asset lives at the tags root. `[]` = that root.
   */
  tagPath?: readonly string[];
  /** Require every listed tag (an AND filter, capability-gated). */
  tags?: readonly string[];
  /** Free-text filter (capability-gated). */
  search?: string;
  cursor?: string;
  limit?: number;
}>;

export type AssetPage = Readonly<{
  assets: readonly Asset[];
  /** Direct subfolders of the queried folder (or the top-level folders for
   *  the flat/root listing) — the rows a browse UI renders above assets. */
  folders: readonly AssetFolder[];
  nextCursor?: string;
}>;

/** What a provider can actually do — the UI renders only what's true here,
 *  so "any third party" degrades gracefully instead of breaking: a provider
 *  without folders gets a flat panel, one without upload gets no drop zone. */
export type AssetProviderCapabilities = Readonly<{
  folders: boolean;
  tags: boolean;
  search: boolean;
  upload: boolean;
  delete: boolean;
}>;

export type AssetProviderDescriptor = Readonly<{
  id: string;
  /** Human label for the provider picker ("Cloudinary", "S3 — media bucket"). */
  label: string;
  capabilities: AssetProviderCapabilities;
}>;
