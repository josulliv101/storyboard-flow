import { packTimelineClips } from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineDocument } from "@storyboard/ui/timeline/types";

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
// the caller can skip the write.

/** Durations within this many seconds are treated as already correct. */
const DURATION_EPSILON = 0.05;

/** Asset filename as stored (public_id leaf) — the key the src match uses. */
function assetFilename(asset: CloudinaryAsset): string | undefined {
  return asset.relativePath?.split("/").pop() || asset.pathname?.split("/").pop() || undefined;
}

/** A clip's source URL reduced to the same filename key (extension stripped —
 *  Cloudinary public_ids carry none, but the delivery URL does). */
function clipAssetKey(src: string): string | undefined {
  return src.split("/").pop()?.split("?")[0]?.replace(/\.[^/.]+$/, "") || undefined;
}

export function healTimelineDocument(
  document: TimelineDocument,
  assets: readonly CloudinaryAsset[],
): { document: TimelineDocument; changed: boolean } {
  if (assets.length === 0) return { document, changed: false };

  const assetMap = new Map<string, CloudinaryAsset>();
  for (const asset of assets) {
    const filename = assetFilename(asset);
    if (filename) assetMap.set(filename, asset);
  }

  let changed = false;
  let durationsChanged = false;

  const healed = document.clips.map((clip) => {
    if (clip.kind !== "video" && clip.kind !== "image") return clip;

    const key = clipAssetKey(clip.src);
    if (!key) return clip;
    const asset = assetMap.get(key);
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
