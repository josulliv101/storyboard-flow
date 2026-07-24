// Builds the legacy asset-library VIRTUAL TIMELINE from a neutral asset page.
//
// The legacy storyboard/workbench asset drawer (components/assets/
// asset-library-drawer) browses folders by loading synthetic TimelineDocuments
// from `/api/timelines/asset-library-<uid>[-col-<folder>]`, rendering them
// through the media-strip. Before phase 5 the route SYNTHESIZED those
// documents by calling Cloudinary directly and hand-rolling folder detection —
// a second, parallel copy of what the provider seam already does.
//
// This module is that synthesis rebuilt ON the seam: the route now asks the
// provider for a folder page (assets + subfolders, the same
// `pageFromFlatListing` the graph palette uses) and this pure function shapes
// it into the media-strip's clip model. The drawer is unchanged; the bespoke
// Cloudinary pipeline is gone, so the seam is the single asset-listing path.

import { encodeFolderPath } from "@storyboard/timeline-model";
import type { TimelineClip } from "@storyboard/timeline-model/types";

import type { AssetPage } from "./types";

/** A media clip's stable id, matching the pre-seam scheme so a persisted
 *  asset-library document (rare, but possible) still reconciles by id. */
function assetClipId(assetId: string): string {
  return `asset-${assetId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

/**
 * Shape a folder page into the asset-library timeline's clips: each subfolder
 * becomes a navigable collection clip pointing at its own
 * `asset-library-col-<uid>-<encoded>` timeline, each asset a media clip
 * carrying its `sourceAsset` provenance. Ordered folders-first (the drawer's
 * long-standing layout), then packed with the leading-pad + 1s-gap spacing the
 * old route used, so the media-strip renders identically.
 *
 * `persistedClips` is the stored document's clips when one exists — kept only
 * where they still correspond to a live folder/asset, so a user's manual order
 * survives a refresh without resurrecting deleted media. Everything not
 * already present is appended.
 */
export function buildAssetLibraryClips(
  page: AssetPage,
  uid: string,
  persistedClips: readonly TimelineClip[] = [],
): TimelineClip[] {
  const liveChildIds = new Set(
    page.folders.map(
      (folder) => `asset-library-col-${uid}-${encodeFolderPath(folder.path.join("/"))}`,
    ),
  );
  const liveAssetClipIds = new Set(page.assets.map((asset) => assetClipId(asset.id)));

  // Keep persisted clips that still exist in this folder, in their stored
  // order; drop stale ones (a collection whose folder vanished, media whose
  // asset was deleted). Tracks what survived so the append step skips dupes.
  const kept: TimelineClip[] = [];
  const seenChildIds = new Set<string>();
  const seenAssetClipIds = new Set<string>();
  for (const clip of persistedClips) {
    if (clip.kind === "collection") {
      if (!liveChildIds.has(clip.childTimelineId) || seenChildIds.has(clip.childTimelineId)) {
        continue;
      }
      seenChildIds.add(clip.childTimelineId);
      kept.push(clip);
    } else {
      if (!liveAssetClipIds.has(clip.id) || seenAssetClipIds.has(clip.id)) continue;
      seenAssetClipIds.add(clip.id);
      kept.push(clip);
    }
  }

  const folderClips: TimelineClip[] = page.folders
    .filter((folder) => {
      const childId = `asset-library-col-${uid}-${encodeFolderPath(folder.path.join("/"))}`;
      return !seenChildIds.has(childId);
    })
    .map((folder) => {
      const childId = `asset-library-col-${uid}-${encodeFolderPath(folder.path.join("/"))}`;
      return {
        id: `dynamic-col-${encodeFolderPath(folder.path.join("/"))}`,
        index: 0,
        kind: "collection",
        title: folder.name,
        childTimelineId: childId,
        itemCount: 0,
        duration: 3,
        sourceDuration: 3,
        trimIn: 0,
        trimOut: 0,
        alt: folder.name,
        aspect: 16 / 9,
        trackIndex: 0,
        startTime: 0,
      } satisfies TimelineClip;
    });

  const assetClips: TimelineClip[] = page.assets
    .filter((asset) => !seenAssetClipIds.has(assetClipId(asset.id)))
    .map((asset) => {
      const duration = asset.kind === "video" ? (asset.durationSeconds ?? 6) : 4;
      const aspect =
        asset.width && asset.height && asset.height > 0 ? asset.width / asset.height : 16 / 9;
      const base = {
        id: assetClipId(asset.id),
        index: 0,
        alt: stripExtension(asset.name),
        aspect,
        trackIndex: 0,
        startTime: 0,
        duration,
        sourceDuration: duration,
        trimIn: 0,
        trimOut: 0,
        // Provenance travels with the clip — `src` renders it, this says
        // which provider file it IS (the model's `sourceAsset`).
        sourceAsset: { providerId: asset.providerId, assetId: asset.id },
      };
      return asset.kind === "video"
        ? { ...base, kind: "video", src: asset.src, poster: asset.thumbnailUrl }
        : { ...base, kind: "image", src: asset.src };
    });

  // Pack: reindex and lay out with the old spacing (1s leading pad, 1s gaps),
  // preserving kept clips' relative order ahead of freshly-appended ones.
  let nextStartTime = 1;
  return [...kept, ...folderClips, ...assetClips].map((clip, index) => {
    const packed = { ...clip, index, startTime: nextStartTime };
    nextStartTime += packed.duration + 1;
    return packed;
  });
}
