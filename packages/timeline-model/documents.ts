// Pure document/clip functions shared by the server routes, the graph
// adapter, and the legacy document store. Framework-free by contract —
// anything that needs React, fixtures, or store state stays in
// packages/ui/timeline (which re-exports these for its consumers).

import {
  CLIP_GAP_SECONDS,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "./constants";
import type { TimelineClip, TimelineDocument } from "./types";

/** First/middle/last media of a collection's clips, as stored preview
 *  entries. The server's read-time summary derivation must produce
 *  byte-identical previews to the legacy store's own recompute — both call
 *  THIS. */
export function previewItemsFrom(clips: TimelineClip[]) {
  const mediaClips = clips.filter(
    (clip) => clip.kind === "image" || clip.kind === "video",
  );
  const previewClips =
    mediaClips.length <= 3
      ? mediaClips
      : [
          mediaClips[0],
          mediaClips[Math.floor(mediaClips.length / 2)],
          mediaClips[mediaClips.length - 1],
        ];

  return previewClips.map((clip) => ({
    id: clip.id,
    kind: clip.kind,
    src: clip.src,
    poster: clip.poster,
    alt: clip.alt,
  }));
}

/** Derive startTime/index for a clip sequence: leading padding, then each
 *  clip's duration plus the standard gap. The one packing definition every
 *  write path shares. */
export function packTimelineClips(clips: TimelineClip[]) {
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  return clips.map((clip, index) => {
    const nextClip = {
      ...clip,
      index,
      startTime: nextStartTime,
    };
    nextStartTime += nextClip.duration + CLIP_GAP_SECONDS;
    return nextClip;
  });
}

export function cloneTimelineDocument(document: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(document)) as TimelineDocument;
}

export function cloneTimelineClip(clip: TimelineClip): TimelineClip {
  return JSON.parse(JSON.stringify(clip)) as TimelineClip;
}

export function isUnsavedProjectPlaceholder(document: TimelineDocument) {
  return (
    document.id.startsWith("project-") &&
    document.title === "Loading Project" &&
    document.clips.length === 0
  );
}

/** URL-safe base64 of a Cloudinary folder path — embedded in
 *  asset-library-col-<uid>-<encoded> timeline ids. Node and browser safe. */
export function encodeFolderPath(folderPath: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(folderPath, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  const base64 = btoa(encodeURIComponent(folderPath).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  }));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeFolderPath(encoded: string): string {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  return decodeURIComponent(
    Array.prototype.map
      .call(atob(base64), (c: string) => {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join("")
  );
}

export function getFolderPathFromTimelineId(id: string, userId: string): string {
  if (id === `asset-library-${userId}`) return "";
  const prefix = `asset-library-col-${userId}-`;
  if (id.startsWith(prefix)) {
    const encoded = id.slice(prefix.length);
    try {
      return decodeFolderPath(encoded);
    } catch {
      return "";
    }
  }
  return "";
}
