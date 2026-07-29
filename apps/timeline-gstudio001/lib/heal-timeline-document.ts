import { packTimelineClips } from "@storyboard/timeline-model";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import type { CloudinaryAsset } from "./cloudinary-media-store";

// Two load-time self-heals for stored timeline documents, in one pass:
//
//   1. src/poster — a clip whose Cloudinary asset moved or was re-uploaded
//      (same filename, new secure_url) is re-pointed at the live URL.
//   2. duration backfill — before the Search-API listing landed, every
//      dropped video got a flat default length (6s/8s) because the listing
//      carried no duration. Now that real durations arrive, an UNTRIMMED
//      video clip (trimIn === 0 && trimOut === 0) is corrected to its true
//      length. Trimmed clips are left ALONE — a stored trim is a user choice,
//      and rewriting sourceDuration under it would break the
//      trimIn+duration+trimOut === sourceDuration invariant.
//
// A duration change shifts every following clip's startTime, so the document
// is repacked (packTimelineClips — the same packing the app uses) whenever a
// duration moved. Returns the SAME document reference when nothing changed so
// the caller can skip the work.
//
// The result is SERVED, never persisted — see lib/serve-timeline.

/** Durations within this many seconds are treated as already correct. */
const DURATION_EPSILON = 0.05;

/**
 * How a clip finds its asset.
 *
 * PROVENANCE FIRST. `sourceAsset` records the provider file a clip was placed
 * from (`{ providerId, assetId }`, written by the asset palette), and
 * `CloudinaryAsset.id` IS that `assetId` — so for anything placed through the
 * palette this is an exact identity match with nothing to guess.
 *
 * The filename path below is the LEGACY fallback, for clips stored before
 * provenance was recorded. It used to be the only path, and it keyed on the
 * bare filename LEAF of both the asset and the clip URL — so two assets named
 * `alley` in different folders or projects collapsed onto one key and the last
 * one listed silently won. Because the caller then PERSISTED the result, a
 * plain GET could rewrite a clip's src, poster and duration to point at a
 * different project's file. Now: the full relative path is the key, and a leaf
 * that resolves to more than one asset is refused rather than guessed.
 */
const CLOUDINARY_PROVIDER_ID = "cloudinary";

function assetPath(asset: CloudinaryAsset): string | undefined {
  return asset.relativePath || asset.pathname || undefined;
}

/** The leaf of a path, extension stripped — Cloudinary public_ids carry none,
 *  but the delivery URL does. */
function leafOf(value: string): string | undefined {
  return value.split("/").pop()?.split("?")[0]?.replace(/\.[^/.]+$/, "") || undefined;
}

type AssetIndex = Readonly<{
  byId: ReadonlyMap<string, CloudinaryAsset>;
  byPath: ReadonlyMap<string, CloudinaryAsset>;
  /** Leaf → asset, but only for leaves that name exactly ONE asset. An
   *  ambiguous leaf maps to null and is refused. */
  byUniqueLeaf: ReadonlyMap<string, CloudinaryAsset | null>;
}>;

function indexAssets(assets: readonly CloudinaryAsset[]): AssetIndex {
  const byId = new Map<string, CloudinaryAsset>();
  const byPath = new Map<string, CloudinaryAsset>();
  const byUniqueLeaf = new Map<string, CloudinaryAsset | null>();

  for (const asset of assets) {
    if (asset.id) byId.set(asset.id, asset);
    const path = assetPath(asset);
    if (path) byPath.set(path.replace(/\.[^/.]+$/, ""), asset);
    const leaf = path ? leafOf(path) : undefined;
    if (!leaf) continue;
    // Second sighting of a leaf poisons it: no legacy clip can be resolved by
    // it any more, in either direction.
    byUniqueLeaf.set(leaf, byUniqueLeaf.has(leaf) ? null : asset);
  }

  return { byId, byPath, byUniqueLeaf };
}

function resolveAsset(
  clip: Extract<TimelineClip, { kind: "video" | "image" }>,
  index: AssetIndex,
): CloudinaryAsset | undefined {
  if (clip.sourceAsset?.providerId === CLOUDINARY_PROVIDER_ID) {
    // Provenance is authoritative: if it names an asset we can't see, the
    // asset is gone, and guessing a same-named neighbour is not a repair.
    return index.byId.get(clip.sourceAsset.assetId);
  }
  const leaf = leafOf(clip.src);
  if (!leaf) return undefined;
  return index.byUniqueLeaf.get(leaf) ?? undefined;
}

export function healTimelineDocument(
  document: TimelineDocument,
  assets: readonly CloudinaryAsset[],
): { document: TimelineDocument; changed: boolean } {
  if (assets.length === 0) return { document, changed: false };

  const index = indexAssets(assets);

  let changed = false;
  let durationsChanged = false;

  const healed = document.clips.map((clip) => {
    if (clip.kind !== "video" && clip.kind !== "image") return clip;

    const asset = resolveAsset(clip, index);
    if (!asset) return clip;

    let next = clip;

    if (next.src !== asset.url) {
      next = {
        ...next,
        src: asset.url,
        poster: next.kind === "video" ? asset.thumbnailUrl : next.poster,
      };
      changed = true;
    }

    if (
      next.kind === "video" &&
      typeof asset.duration === "number" &&
      asset.duration > 0 &&
      next.trimIn === 0 &&
      next.trimOut === 0 &&
      Math.abs(next.sourceDuration - asset.duration) > DURATION_EPSILON
    ) {
      next = { ...next, duration: asset.duration, sourceDuration: asset.duration };
      changed = true;
      durationsChanged = true;
    }

    return next;
  });

  if (!changed) return { document, changed: false };

  // Repack only when a duration moved — a bare src swap keeps every startTime.
  const clips = durationsChanged ? packTimelineClips(healed) : healed;
  return { document: { ...document, clips }, changed: true };
}
