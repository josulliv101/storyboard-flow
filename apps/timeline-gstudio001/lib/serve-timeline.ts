import "server-only";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { listCloudinaryAssets } from "./cloudinary-media-store";
import {
  collectionChildIds,
  deriveCollectionSummaries,
} from "./derive-collection-summaries";
import {
  getFirebaseTimelineDocument,
  getFirebaseTimelineEntry,
  saveFirebaseTimelineEntry,
} from "./firebase-timeline-store";
import { healTimelineDocument } from "./heal-timeline-document";

// The ONE serve path for a stored timeline document — used by the
// GET /api/timelines/[id] route AND the RSC payload loaders, so the two
// transports can never drift: load-time self-heal (persisted only when it
// changed, with the served revision reflecting the heal write), then
// read-time collection-summary derivation from the child documents.

export type ServedTimeline = Readonly<{
  document: TimelineDocument;
  revision: number;
}>;

/** Null when the document doesn't exist; throws TimelineAccessDeniedError
 *  for someone else's (callers map it to their 404). */
export async function serveTimelineDocument(
  id: string,
  requesterUid: string,
): Promise<ServedTimeline | null> {
  const entry = await getFirebaseTimelineEntry(id, requesterUid);
  if (!entry) return null;

  const cloudinaryAssets = await listCloudinaryAssets(requesterUid).catch(() => []);
  const { document: healedDocument, changed } = healTimelineDocument(
    entry.document,
    cloudinaryAssets,
  );

  // The served revision must reflect the heal write (it bumps the counter)
  // or the client's first expected-revision write would conflict spuriously.
  let revision = entry.revision;
  if (changed) {
    const saved = await saveFirebaseTimelineEntry(healedDocument, requesterUid).catch(() => null);
    if (saved) revision = saved.revision;
  }

  // Collection summaries derive from the CHILD documents at read time
  // (see deriveCollectionSummaries) — served fresh, never persisted. A
  // child that fails to load (missing, or not this user's) keeps the
  // stored summary.
  const childIds = collectionChildIds(healedDocument);
  const childDocuments = new Map(
    await Promise.all(
      childIds.map(async (childId) => {
        const child = await getFirebaseTimelineDocument(childId, requesterUid).catch(() => null);
        return [childId, child] as const;
      }),
    ),
  );
  const derived = deriveCollectionSummaries(healedDocument, childDocuments);

  return { document: derived.document, revision };
}

/** The user's trash document — an empty default (revision 0 = the first
 *  write compare-and-set creates it) until something is stored. */
export async function serveTrashDocument(
  id: string,
  requesterUid: string,
): Promise<ServedTimeline> {
  const entry = await getFirebaseTimelineEntry(id, requesterUid);
  return {
    document: entry?.document ?? { id, title: "Trash Bin", clips: [] },
    revision: entry?.revision ?? 0,
  };
}
