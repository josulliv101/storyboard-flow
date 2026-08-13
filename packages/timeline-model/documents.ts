// Pure document/clip functions shared by the server routes, the graph
// adapter, and the legacy document store. Framework-free by contract —
// anything that needs React, fixtures, or store state stays in
// packages/ui/timeline (which re-exports these for its consumers).

import {
  CLIP_GAP_SECONDS,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "./constants";
import { isVisualClip } from "./types";
import type { ImageTimelineClip, VideoTimelineClip } from "./types";
import type { TimelineClip, TimelineDocument } from "./types";

/** First/middle/last media of a collection's clips, as stored preview
 *  entries. The server's read-time summary derivation must produce
 *  byte-identical previews to the legacy store's own recompute — both call
 *  THIS. */
export function previewItemsFrom(clips: TimelineClip[]) {
  // VISUAL, not merely media: an audio clip has a `src` and would otherwise
  // qualify, then be rendered as an <img> pointing at a .flac. Preview items
  // are persisted, so letting one through writes the mistake to storage.
  const mediaClips = clips.filter(isVisualClip);
  // Pick INDICES, then read them back through a bounds check rather than
  // building an array of `T | undefined` and asserting the holes away. All
  // three are provably in range (the branch guarantees length > 3), so
  // `flatMap` drops nothing in practice — but writing it this way means a
  // future change to the arithmetic gets caught by the compiler instead of
  // producing a preview entry with `undefined` fields.
  const indices =
    mediaClips.length <= 3
      ? mediaClips.map((_clip, index) => index)
      : [0, Math.floor(mediaClips.length / 2), mediaClips.length - 1];

  return indices.flatMap((index) => {
    const clip = mediaClips[index];
    return clip === undefined ? [] : [previewItemOf(clip)];
  });
}

function previewItemOf(clip: ImageTimelineClip | VideoTimelineClip) {
  return {
    id: clip.id,
    kind: clip.kind,
    src: clip.src,
    poster: clip.poster,
    ...(clip.kind === "video" && clip.trimIn > 0 ? { trimIn: clip.trimIn } : {}),
    alt: clip.alt,
  };
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

/** The clips that actually play and count. Absent `disabled` means enabled. */
export function enabledClips(clips: readonly TimelineClip[]): TimelineClip[] {
  return clips.filter((clip) => clip.disabled !== true);
}

/**
 * The span a document of these clips occupies — the number a referring
 * collection clip carries as its own duration. Trailing padding mirrors the
 * leading padding `packTimelineClips` adds.
 *
 * An EMPTY list is 3 seconds, not zero: a zero-width collection card cannot be
 * seen or clicked, and a collection whose children are all disabled reaches
 * this same floor through the enabled-only projection — all-disabled and empty
 * are the same thing to a reader.
 *
 * One definition, two callers, and they must not drift: the summary derivation
 * feeds it ALL clips for the layout span and the enabled ones for the playable
 * span.
 */
export function collectionSpanSeconds(clips: readonly TimelineClip[]): number {
  const last = clips[clips.length - 1];
  // The empty case and the unreachable out-of-range case answer alike: a
  // zero-width collection card cannot be seen or clicked either way.
  if (last === undefined) return 3;
  return last.startTime + last.duration + TIMELINE_LEADING_PADDING_SECONDS;
}

/**
 * A document as the READ models should see it: disabled clips dropped, and
 * the survivors repacked so the gap they left closes.
 *
 * The repack is the whole point, and it is why this cannot be a `filter` at
 * the point of use. Dropping a clip without repacking leaves its span empty,
 * and an empty span is not silence — the workbench player HOLDS the last
 * drawn frame across a gap (see `getContainingClip`), so a disabled clip
 * would freeze-frame for its own duration instead of being skipped.
 *
 * The STORED document keeps its disabled clips at their original positions:
 * the board still shows them in place. Only what plays and what counts is
 * computed from this projection.
 */
export function effectiveDocument(document: TimelineDocument): TimelineDocument {
  const kept = enabledClips(document.clips);
  if (kept.length === document.clips.length) return document;
  return { ...document, clips: packTimelineClips(kept) };
}

/**
 * `effectiveDocument` across a whole closure, keyed the same way. A nested
 * collection is skipped by dropping its CLIP in the parent, which removes the
 * entire subtree from the projection without having to walk into it.
 */
export function effectiveDocuments(
  documents: Readonly<Record<string, TimelineDocument>>,
): Record<string, TimelineDocument> {
  const result: Record<string, TimelineDocument> = {};
  for (const [id, document] of Object.entries(documents)) {
    result[id] = effectiveDocument(document);
  }
  return result;
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
