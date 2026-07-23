// Folder browsing derived from asset PATHS — shared by every provider whose
// backend is really a flat namespace with path-shaped keys (Cloudinary public
// ids, S3 object keys). Such backends have no folder API to ask; the tree IS
// the set of key prefixes, so one derivation serves them all and a new
// path-based adapter gets browsing for free.

import type { Asset, AssetFolder, AssetPage, AssetQuery } from "./types";

function sameFolder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

function isUnder(path: readonly string[], folder: readonly string[]): boolean {
  return path.length > folder.length && folder.every((segment, i) => segment === path[i]);
}

/**
 * Resolve a query against a fully-mapped flat listing.
 *
 * `folder` undefined → every asset (the flat view) plus the top-level folder
 * rows; `folder` set → that folder's DIRECT assets plus its direct subfolder
 * rows. Assets deeper than the queried folder appear only through their
 * subfolder row, which is what makes drill-in mean something.
 *
 * In-memory on purpose, and marked as the seam to push down: a provider with
 * a native prefix/tag query (S3 `Delimiter`, Cloudinary `prefix`) should
 * translate `query` into it and skip this — the fallback exists so a minimal
 * adapter is a mapping function and nothing more.
 */
export function pageFromFlatListing(assets: readonly Asset[], query: AssetQuery): AssetPage {
  const folder = query.folder;

  const matching =
    folder === undefined
      ? assets
      : assets.filter((asset) => sameFolder(asset.folderPath, folder));

  const base = folder ?? [];
  const seen = new Set<string>();
  const folders: AssetFolder[] = [];
  for (const asset of assets) {
    if (!isUnder(asset.folderPath, base)) continue;
    const name = asset.folderPath[base.length];
    if (seen.has(name)) continue;
    seen.add(name);
    folders.push({ name, path: [...base, name] });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));

  const limited =
    query.limit !== undefined && query.limit >= 0 ? matching.slice(0, query.limit) : matching;
  return { assets: limited, folders };
}
