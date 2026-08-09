// Which uploaded files is anything still pointing at?
//
// PURE and isomorphic — no Firestore, no provider, no clock. The two callers
// that matter (emptying the bin, the nightly reclaim sweep) differ only in
// where they get their documents from, so the RULE lives here on its own and
// unit-tests without a backend.
//
// The rule: an asset dies when nothing references it. Not when its clip is
// deleted — one upload can back several clips (clip ids are minted per
// PLACEMENT, so the same file can sit in several spots, each its own clip), and
// the bin is per-USER while an asset is per-project, so a bin spans everything
// its owner owns.

import type { TimelineClip } from "@storyboard/timeline-model/types";

import type { AssetKind, AssetSourceRef } from "./types";

/**
 * A stable string key for an `AssetSourceRef`, and the id its tombstone is
 * stored under.
 *
 * Both halves are percent-encoded before being joined. `encodeURIComponent`
 * escapes `|` (to `%7C`) and `/` (to `%2F`), so no provider id or asset id can
 * fake the delimiter however path-shaped it is — the NodeId lesson, applied
 * before it can bite: assume the id contains your separator.
 *
 * Escaping `/` is also what makes this a legal Firestore document id. The other
 * id rules are unreachable here: the key always begins with an encoded provider
 * id ("cloudinary", "s3"), so it can be neither "." nor ".." nor a match for
 * the reserved `__.*__`.
 */
export function assetRefKey(ref: AssetSourceRef): string {
  return `${encodeURIComponent(ref.providerId)}|${encodeURIComponent(ref.assetId)}`;
}

/**
 * An asset a caller is considering deleting: the ref, the `kind` its provider
 * needs to address it (Cloudinary's destroy endpoint is per resource type),
 * and a display SNAPSHOT.
 *
 * All three are recorded on the tombstone because the sweep — and the
 * recently-deleted list the user sees — run with no clip in hand. The snapshot
 * follows `TrashOrigin`'s rule: `name` and `thumbnailUrl` are what the row
 * PRINTS, taken at mark time, not keys to look anything up with. There is no
 * clip left to re-derive them from, and the file itself is still there for the
 * whole window, so the thumbnail keeps resolving until the moment it doesn't.
 */
export type AssetDeletionCandidate = Readonly<{
  ref: AssetSourceRef;
  kind: AssetKind;
  name: string;
  thumbnailUrl: string;
}>;

/** Media clips carry provenance; collection clips have no file behind them. */
function sourceAssetOf(clip: TimelineClip): AssetDeletionCandidate | null {
  if (clip.kind !== "image" && clip.kind !== "video") return null;
  if (clip.sourceAsset === undefined) return null;
  return {
    ref: clip.sourceAsset,
    kind: clip.kind,
    // The authored name first, the derived description second — the same
    // precedence the card and the details view read by (PL11-004). Falling
    // back to the id's leaf keeps a row from printing nothing at all.
    name: clip.title || clip.alt || leafOf(clip.sourceAsset.assetId),
    // A video's poster is a still; an image IS its own thumbnail.
    thumbnailUrl: clip.poster || clip.src,
  };
}

function leafOf(assetId: string): string {
  const segments = assetId.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? assetId;
}

/**
 * The distinct assets behind a set of clips, de-duplicated by ref key.
 *
 * A clip WITHOUT `sourceAsset` contributes nothing. That is deliberate and it
 * is the conservative direction: provenance is only recorded on clips minted
 * from the asset seam, so a clip that predates it (or arrived by another path)
 * names no asset, and an asset nobody can name is never deleted. Un-provenanced
 * media leaks storage; it can never lose a file.
 */
export function assetCandidatesFromClips(
  clips: readonly TimelineClip[],
): readonly AssetDeletionCandidate[] {
  const byKey = new Map<string, AssetDeletionCandidate>();
  for (const clip of clips) {
    const candidate = sourceAssetOf(clip);
    if (candidate === null) continue;
    byKey.set(assetRefKey(candidate.ref), candidate);
  }
  return [...byKey.values()];
}

/** Every asset key referenced by a set of clips — the other side of the same
 *  walk, for building the "still in use" set out of live documents. */
export function assetKeysFromClips(clips: readonly TimelineClip[]): readonly string[] {
  return assetCandidatesFromClips(clips).map((candidate) => assetRefKey(candidate.ref));
}

/**
 * The candidates nothing points at.
 *
 * `referenced` is the union of keys found in every document that is NOT the bin
 * being emptied — the caller decides what to exclude, because "the trash's own
 * clips are not references to themselves" is a fact about the caller's
 * situation, not about this rule.
 */
export function unreferencedCandidates(
  candidates: readonly AssetDeletionCandidate[],
  referenced: ReadonlySet<string>,
): readonly AssetDeletionCandidate[] {
  return candidates.filter((candidate) => !referenced.has(assetRefKey(candidate.ref)));
}
