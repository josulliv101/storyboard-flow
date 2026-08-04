import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { getFirebaseDb } from "@/lib/firebase-admin";
import type { TimelineDocument } from "@storyboard/timeline-model/types";

// An append-only record of who changed which timeline, and to what.
//
// Written because there was NO way to answer "what wrote this document, when,
// and what did it contain before?". A project silently reverted while an agent
// edited it over MCP and a browser tab held a stale graph, and reconstructing
// that took an hour of inference from `trashedAt` stamps on surviving clips.
// `revision` and `updatedAt` only ever describe the LATEST state.
//
// `clipIds` is the load-bearing field: it is what makes "Scene one went from
// [a,b,c] to [a,b], written by mcp at 01:02" answerable. Full document
// snapshots are deliberately NOT stored — they would multiply the collection's
// size for little extra signal, and the ids are what identifies a structural
// change.
//
// Best-effort by contract. Every caller must treat a logging failure as
// nothing: an audit trail that can fail a user's edit is worse than no audit
// trail. Same posture as the trash route's post-commit asset marking.

const CHANGE_LOG_COLLECTION = "timelineChanges";

/** Which surface performed the write. */
export type ChangeSource = "app" | "mcp";

export type ChangeLogDocument = Readonly<{
  id: string;
  /** Revision read before the write; absent for a create. */
  fromRevision?: number;
  /** Revision the write produced. */
  toRevision: number;
  clipIds: readonly string[];
}>;

export type ChangeLogEntry = Readonly<{
  uid: string;
  source: ChangeSource;
  documents: readonly ChangeLogDocument[];
}>;

/**
 * Append one entry describing a committed write.
 *
 * Call AFTER the write succeeds and outside its transaction — the log must not
 * be able to abort a save, and it must never claim a change that did not land.
 * Never throws.
 */
export async function recordChange(entry: ChangeLogEntry): Promise<void> {
  if (entry.documents.length === 0) return;
  try {
    await getFirebaseDb()
      .collection(CHANGE_LOG_COLLECTION)
      .add({
        uid: entry.uid,
        source: entry.source,
        at: FieldValue.serverTimestamp(),
        // Denormalized so the common query ("what touched this timeline?")
        // needs no collection-group scan over the nested array.
        timelineIds: entry.documents.map((document) => document.id),
        documents: entry.documents.map((document) => ({
          id: document.id,
          ...(document.fromRevision === undefined
            ? {}
            : { fromRevision: document.fromRevision }),
          toRevision: document.toRevision,
          clipIds: document.clipIds,
        })),
      });
  } catch {
    // Swallowed on purpose — see the contract above.
  }
}

/**
 * Build the per-document part of an entry from what a write already had to
 * hand, so callers don't re-derive it and can't disagree about what "changed".
 */
export function changeLogDocuments(
  written: readonly { id: string; revision: number }[],
  documents: Readonly<Record<string, TimelineDocument>>,
  priorRevisions: Readonly<Record<string, number | undefined>> = {},
): ChangeLogDocument[] {
  return written.map(({ id, revision }) => ({
    id,
    ...(priorRevisions[id] === undefined ? {} : { fromRevision: priorRevisions[id] }),
    toRevision: revision,
    clipIds: (documents[id]?.clips ?? []).map((clip) => clip.id),
  }));
}

/**
 * The most recent changes touching a timeline, newest first.
 *
 * Deliberately queried on the denormalized `timelineIds` array rather than the
 * nested `documents` — Firestore cannot index into an array of objects.
 */
export async function recentChanges(timelineId: string, limit = 25) {
  const snapshot = await getFirebaseDb()
    .collection(CHANGE_LOG_COLLECTION)
    .where("timelineIds", "array-contains", timelineId)
    .orderBy("at", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => doc.data());
}
