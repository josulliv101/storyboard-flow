// Folder browsing derived from asset PATHS — shared by every provider whose
// backend is really a flat namespace with path-shaped keys (Cloudinary public
// ids, S3 object keys). Such backends have no folder API to ask; the tree IS
// the set of key prefixes, so one derivation serves them all and a new
// path-based adapter gets browsing for free.
//
// The same derivation also serves the TAG pseudo-hierarchy: a tag is a path
// ("scene/heist" nests under "scene"), the only difference being that an
// asset has exactly ONE folder location but may carry MANY tags — so the
// core works on a list of locations per asset and the two entry points
// differ only in how they read them.

import type { Asset, AssetFolder, AssetPage, AssetQuery } from "./types";

type Location = readonly string[];

function sameLocation(a: Location, b: Location): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

function isUnder(path: Location, base: Location): boolean {
  return path.length > base.length && base.every((segment, i) => segment === path[i]);
}

function pageFromLocations(
  assets: readonly Asset[],
  locationsOf: (asset: Asset) => readonly Location[],
  base: Location | undefined,
  limit: number | undefined,
): AssetPage {
  const matching =
    base === undefined
      ? assets
      : assets.filter((asset) => locationsOf(asset).some((loc) => sameLocation(loc, base)));

  const groupBase = base ?? [];
  const seen = new Set<string>();
  const folders: AssetFolder[] = [];
  for (const asset of assets) {
    for (const location of locationsOf(asset)) {
      if (!isUnder(location, groupBase)) continue;
      const name = location[groupBase.length];
      if (seen.has(name)) continue;
      seen.add(name);
      folders.push({ name, path: [...groupBase, name] });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));

  const limited = limit !== undefined && limit >= 0 ? matching.slice(0, limit) : matching;
  return { assets: limited, folders };
}

/**
 * Resolve a FOLDER query against a fully-mapped flat listing.
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
  return pageFromLocations(assets, (asset) => [asset.folderPath], query.folder, query.limit);
}

/** How a tag nests: "scene/heist" is the path ["scene", "heist"]. */
function tagSegments(tag: string): Location {
  return tag.split("/").filter((segment) => segment.length > 0);
}

/**
 * Resolve a TAGS-mode browse against the same flat listing. Identical
 * folder semantics over tag paths, with the two differences tags force:
 * an asset tagged twice lives in BOTH places, and an asset with NO tags
 * lives at the tags ROOT (the file-browser convention — root files sit
 * beside the folders). `tagPath` [] is that root; deeper paths scope to
 * assets carrying exactly that tag.
 */
export function pageFromTagListing(assets: readonly Asset[], query: AssetQuery): AssetPage {
  const locationsOf = (asset: Asset): readonly Location[] =>
    asset.tags.length === 0 ? [[]] : asset.tags.map(tagSegments);
  return pageFromLocations(assets, locationsOf, query.tagPath ?? [], query.limit);
}

/**
 * Resolve a SEARCH against the same flat listing every browse mode uses.
 *
 * Search is a third derivation over one listing, not a call to a vendor
 * search API — the same reason folders and tags are derived here. Every
 * path-shaped backend gets it for the same code, and none of them needs a
 * query language.
 *
 * It matches the asset's NAME, its folder PATH, and its TAGS, because all
 * three are things a person types when they are looking for a file: the
 * basename they remember, the folder they filed it under, or the label they
 * gave it. Case-insensitive substring, not fuzzy — "heist" should find
 * "Bank_Heist_01" without also ranking every file with an H, an E and an I.
 *
 * The result is FLAT and carries no folders. A search spans the whole
 * library by definition, so grouping the hits back into the folders they
 * came from would be answering a question the user just stopped asking.
 */
export function pageFromSearch(assets: readonly Asset[], query: AssetQuery): AssetPage {
  const needle = (query.search ?? "").trim().toLowerCase();
  if (needle.length === 0) return { assets: [], folders: [] };

  const matches = assets.filter((asset) => {
    if (asset.name.toLowerCase().includes(needle)) return true;
    if (asset.folderPath.some((segment) => segment.toLowerCase().includes(needle))) return true;
    return asset.tags.some((tag) => tag.toLowerCase().includes(needle));
  });

  const limited = query.limit === undefined ? matches : matches.slice(0, query.limit);
  return { assets: limited, folders: [] };
}
