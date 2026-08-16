// The DECISIONS behind `correct-clip-aspects.mjs`, with no Firestore, no
// ffprobe and no argv — so the app suite can exercise them.
//
// Split out for the same reason `ffmpeg-plan.mjs` is split from the worker
// that runs it: this half decides what to WRITE to the user's real documents,
// which is the part most able to be quietly wrong, and a runner that opens a
// database connection at import time cannot be tested.

import { clipsOf, srcOf } from "./timeline-snapshot.mjs";

/** Two clips of the same shape are the same shape. A stored
 *  1.7777777777777777 against a computed one must not read as a difference,
 *  and neither should 1920x1080 against 1280x720. */
export const ASPECT_EPSILON = 1e-4;

/**
 * The ratio, or undefined when the inputs are not a measurement.
 *
 * Mirrors `aspectFromDimensions` in the model. Duplicated rather than imported
 * because that is TypeScript and this is a plain .mjs the worker-style scripts
 * can run without a build step; the model's own test pins the same rule.
 */
export function aspectOf(width, height) {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return undefined;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return undefined;
  return width / height;
}

/**
 * Every document reachable from one project, that project included.
 *
 * Returns null when there is no such document — the caller reports it rather
 * than silently correcting nothing, since a typo'd id and a project with no
 * wrong clips would otherwise print the same reassuring result.
 */
export function scopeFrom(documents, projectId) {
  if (!documents.has(projectId)) return null;
  const scope = new Set();
  const queue = [projectId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (scope.has(id)) continue;
    scope.add(id);
    for (const clip of clipsOf(documents.get(id))) {
      if (clip?.kind === "collection" && typeof clip.childTimelineId === "string") {
        queue.push(clip.childTimelineId);
      }
    }
  }
  return scope;
}

/**
 * The clips whose aspect is a measurement of a file, and could therefore be
 * wrong about one.
 *
 * COLLECTIONS ARE EXCLUDED. A container has no source file, so its aspect is
 * not a reading of anything — deriving one from its children is a different
 * question with a different right answer, and answering it here would write a
 * number no probe supports.
 */
export function correctableClips(documents, scope = null) {
  const found = [];
  for (const [id, data] of documents) {
    if (scope !== null && !scope.has(id)) continue;
    clipsOf(data).forEach((clip, index) => {
      if (clip?.kind === "collection") return;
      const src = srcOf(clip);
      if (src === null) return;
      found.push({
        documentId: id,
        title: data?.title ?? "(untitled)",
        index,
        clipId: clip?.id ?? `#${index}`,
        alt: clip?.alt ?? "",
        src,
        // A snapshot written before this script existed carries no aspect KEY,
        // which is not the same as a clip that stores none — the caller tells
        // the user its snapshot is too old rather than reporting every clip as
        // wrong.
        stored: clip !== null && clip !== undefined && "aspect" in clip ? clip.aspect : undefined,
      });
    });
  }
  return found;
}

/**
 * Sort the clips against what the probe actually read.
 *
 * `unreadable` is not a failure: audio has no video stream, and a source that
 * 404s or times out reads the same way. Leaving a clip alone is always safe;
 * writing a number nothing measured is the thing this exists to undo.
 */
export function classify(clips, measurements) {
  const wrong = [];
  const alreadyRight = [];
  const unreadable = [];
  for (const clip of clips) {
    const measured = measurements.get(clip.src);
    if (!measured) {
      unreadable.push(clip);
      continue;
    }
    if (
      typeof clip.stored === "number" &&
      Math.abs(clip.stored - measured.aspect) < ASPECT_EPSILON
    ) {
      alreadyRight.push(clip);
      continue;
    }
    wrong.push({ ...clip, measured });
  }
  return { wrong, alreadyRight, unreadable };
}

/**
 * The merge payload for one document, or null when there is nothing safe to
 * write. The caller adds `revision` and `updatedAt`.
 *
 * BOTH clip arrays are updated. `document.clips` is the live copy and `clips`
 * the denormalized one — `buildSavePayload` writes both on every save, and
 * `clipsOf` reads whichever exists, so touching only one would leave two
 * records disagreeing about the same clip and the answer would depend on which
 * reader got there first.
 *
 * NESTED, not dotted. A `set(..., {merge: true})` treats `"document.clips"` as
 * a field name that happens to contain a dot, NOT as a path — only `update()`
 * walks one. Writing the dotted form would leave the real clips untouched and
 * add a junk top-level key, and it would look like it worked.
 *
 * `lastNonEmptyDocument` is deliberately left alone. It is a recovery snapshot
 * of content since removed, so its clips need not line up with these at all,
 * and an index-addressed write into it could land anywhere. A document emptied
 * and later recovered comes back with its old aspects; re-running this fixes
 * them, which is a better trade than writing blind into a backup.
 *
 * Each write is IDENTITY-CHECKED, not just positional. Indexes come from the
 * read that produced the report, and a document edited in between would be
 * re-indexed underneath us — writing a measured aspect onto whatever now sits
 * at that index would corrupt the very field this came to repair. A mismatch
 * skips that clip and says so.
 */
export function updateForDocument(data, clips) {
  // Decided ONCE, against the array `clipsOf` reads — the same one whose
  // indexes are in the report. Checking per-array instead would let the two
  // copies disagree about which clips are safe to touch, and would count every
  // clip twice.
  const canonical = clipsOf(data);
  const agreed = [];
  const skipped = [];
  for (const clip of clips) {
    const target = canonical[clip.index];
    if (!target || (target.id ?? `#${clip.index}`) !== clip.clipId) {
      skipped.push(clip);
      continue;
    }
    agreed.push(clip);
  }

  /** The array with the agreed aspects written in, or null when this copy does
   *  not exist or has drifted out of step with the one we measured. */
  const corrected = (array) => {
    if (!Array.isArray(array)) return null;
    const next = array.map((clip) => ({ ...clip }));
    let touched = false;
    for (const clip of agreed) {
      const target = next[clip.index];
      // The two copies are the same clips in the same order in practice, but
      // "in practice" is not a guarantee about someone's stored data — a
      // denormalized copy that has drifted is left alone, not scrambled.
      if (!target || (target.id ?? `#${clip.index}`) !== clip.clipId) continue;
      target.aspect = clip.measured.aspect;
      touched = true;
    }
    return touched ? next : null;
  };

  const live = agreed.length === 0 ? null : corrected(data?.document?.clips);
  const denormalized = agreed.length === 0 ? null : corrected(data?.clips);
  if (live === null && denormalized === null) return { update: null, skipped, applied: 0 };

  return {
    update: {
      ...(live === null ? {} : { document: { clips: live } }),
      ...(denormalized === null ? {} : { clips: denormalized }),
    },
    skipped,
    applied: agreed.length,
  };
}
