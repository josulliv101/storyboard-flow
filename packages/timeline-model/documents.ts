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

/**
 * Which lane a clip plays in. Lanes pack independently, so this is what lets a
 * voiceover run UNDER the picture rather than after it.
 *
 * Defensive rather than trusting: `validate` deliberately admits any finite
 * number here, and a stray `1.5` or `-1` arriving from stored data would mint
 * a phantom lane that nothing can author or see. Anything that is not a
 * non-negative integer is track 0 — the same lane every document written
 * before lanes existed is already on.
 */
export function trackIndexOf(clip: Pick<TimelineClip, "trackIndex">): number {
  const track = clip.trackIndex;
  return Number.isInteger(track) && track >= 0 ? track : 0;
}

/**
 * Derive startTime/index for a clip sequence: leading padding, then each
 * clip's duration plus the standard gap. The one packing definition every
 * write path shares.
 *
 * PACKS PER LANE. Each `trackIndex` gets its own running start, so lane 1
 * begins at the same instant lane 0 does and the two play together. Packing
 * them into one sequence — which is what this did until lanes — is exactly
 * what made a bed or a VO impossible to express: it could only ever be placed
 * AFTER the picture, never under it.
 *
 * `index` stays the ARRAY position, not a per-lane counter. It is the
 * document's own order and the tiebreak readers use; making it lane-relative
 * would give two clips the same index and silently reorder them.
 *
 * Identical to the old behaviour for any document that has never used lanes,
 * because every clip in one is on track 0 — which is every document written
 * before this.
 *
 * HONOURS `placedStart` on lanes 1+, which is what makes a lane a timeline
 * rather than a parallel queue: a voiceover can begin at 7.5s without 7.5s of
 * something in front of it. Absent means queued, so a document with nothing
 * placed packs exactly as it did before the field existed.
 */
export function packTimelineClips(clips: TimelineClip[]) {
  const nextStartByTrack = new Map<number, number>();

  return clips.map((clip, index) => {
    const track = trackIndexOf(clip);
    const placed = placedStartOf(clip, track);
    const startTime = placed ?? nextStartByTrack.get(track) ?? TIMELINE_LEADING_PADDING_SECONDS;
    const nextClip = { ...clip, index, startTime };
    // The cursor NEVER REWINDS. A clip placed earlier than its lane's queue
    // has already reached would otherwise drag the following queued clip back
    // on top of a neighbour — the placement is one clip's business, and it
    // must not reorganise the ones it was dropped in front of.
    //
    // No gap is added BEFORE a placed start: `CLIP_GAP_SECONDS` separates
    // consecutive shots, and a placed start is already exact. It still
    // applies AFTER one, so a queued clip following a placed clip clears it.
    nextStartByTrack.set(
      track,
      Math.max(
        nextStartByTrack.get(track) ?? TIMELINE_LEADING_PADDING_SECONDS,
        startTime + nextClip.duration + CLIP_GAP_SECONDS,
      ),
    );
    return nextClip;
  });
}

/**
 * The authored start this clip should pack at, or undefined to queue it.
 *
 * Defensive in the same way `trackIndexOf` is, and for the same reason: this
 * value is HONOURED rather than recomputed, so anything that is not a real
 * non-negative time has to fall back to queuing instead of placing a clip
 * where nobody asked. Lane 0 never places — the picture is a cut.
 */
export function placedStartOf(
  clip: Pick<TimelineClip, "placedStart">,
  track: number,
): number | undefined {
  if (track <= 0) return undefined;
  const placed = clip.placedStart;
  return typeof placed === "number" && Number.isFinite(placed) && placed >= 0
    ? placed
    : undefined;
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
  // The empty case: a zero-width collection card cannot be seen or clicked.
  if (clips.length === 0) return 3;
  // THE FURTHEST END, not the last clip's.
  //
  // This read `clips[clips.length - 1]` while every document was one sequence,
  // where the two are the same thing. With LANES they are not: a bed on track 1
  // can outlast the picture on track 0 and still sit earlier in the array, and
  // the old reading would have reported a collection SHORTER than its own
  // contents — which shrinks its card, truncates its parent's packing, and
  // clips the tail off a render.
  const end = clips.reduce(
    (furthest, clip) => Math.max(furthest, clip.startTime + clip.duration),
    0,
  );
  return end + TIMELINE_LEADING_PADDING_SECONDS;
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
