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

/**
 * The cursor for these path-derived providers is simply an OFFSET into the
 * listing, encoded as a decimal string.
 *
 * That is honest for what this is: the whole listing is already in memory and
 * ordered, so there is nothing to keyset against that an index does not
 * already give. The tradeoff is the usual one — if the underlying library
 * changes between two page requests, an offset can repeat or skip an item.
 * In practice the listing is TTL-cached for the whole paging session, so the
 * window a user pages through is fixed; a provider that pushes paging down to
 * a native query (see below) should emit that backend's own cursor instead
 * and this becomes irrelevant.
 *
 * Anything unparseable reads as 0 rather than throwing: a bad cursor should
 * show the first page, not an error.
 */
function offsetFromCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Slice one page out of the matches, and say whether more remain. */
function paginate(matching: readonly Asset[], query: AssetQuery) {
  const offset = offsetFromCursor(query.cursor);
  if (query.limit === undefined || query.limit < 0) {
    return { assets: matching.slice(offset), nextCursor: undefined };
  }
  const end = offset + query.limit;
  return {
    assets: matching.slice(offset, end),
    nextCursor: end < matching.length ? String(end) : undefined,
  };
}

function pageFromLocations(
  assets: readonly Asset[],
  locationsOf: (asset: Asset) => readonly Location[],
  base: Location | undefined,
  query: AssetQuery,
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

  const { assets: limited, nextCursor } = paginate(matching, query);
  return {
    assets: limited,
    // Folders belong to the FIRST page only. They are the place, not the
    // contents — repeating them under every page would redraw the whole
    // folder row each time the user asked for more files.
    folders: offsetFromCursor(query.cursor) === 0 ? folders : [],
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
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
  return pageFromLocations(assets, (asset) => [asset.folderPath], query.folder, query);
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
  return pageFromLocations(assets, locationsOf, query.tagPath ?? [], query);
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

  const { assets: page, nextCursor } = paginate(matches, query);
  return { assets: page, folders: [], ...(nextCursor === undefined ? {} : { nextCursor }) };
}
