import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { TimelineDocument, TimelineClip } from "@storyboard/ui/timeline/types";
import { getFirebaseDb } from "./firebase-admin";
import { resolveOwnership, TimelineAccessDeniedError } from "./timeline-ownership";

type TimelineDocumentRecord = {
  id: string;
  title: string;
  description?: string;
  document?: TimelineDocument;
  lastNonEmptyDocument?: TimelineDocument;
  clips?: TimelineClip[];
  isProject?: boolean;
  /** Authorization boundary: absent only on legacy records, which are
   *  claimed by the first authenticated toucher (see lib/timeline-ownership). */
  ownerUid?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type TimelineProjectSummary = {
  id: string;
  title: string;
  description?: string;
  clipCount: number;
  thumbnailUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

const TIMELINE_COLLECTION = "gstudioTimelineDocuments";
const FIREBASE_TIMEOUT_MS = 8_000;

async function withFirebaseTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${label} timed out. Check the Firebase project credentials and network access.`,
            ),
          );
        }, FIREBASE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function collection() {
  return getFirebaseDb().collection(TIMELINE_COLLECTION);
}

function normalizeDocument(document: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(document)) as TimelineDocument;
}

function normalizeClips(clips: TimelineClip[]): TimelineClip[] {
  return JSON.parse(JSON.stringify(clips)) as TimelineClip[];
}

function isTimelineDocument(value: unknown): value is TimelineDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<TimelineDocument>;

  return (
    typeof document.id === "string" &&
    typeof document.title === "string" &&
    Array.isArray(document.clips)
  );
}

function isUnsavedProjectPlaceholder(document: TimelineDocument) {
  return (
    document.id.startsWith("project-") &&
    document.title === "Loading Project" &&
    document.clips.length === 0
  );
}

function toTimelineDocument(id: string, data: Partial<TimelineDocumentRecord>) {
  const nestedDocument = isTimelineDocument(data.document)
    ? normalizeDocument(data.document)
    : null;
  const lastNonEmptyDocument = isTimelineDocument(data.lastNonEmptyDocument)
    ? normalizeDocument(data.lastNonEmptyDocument)
    : null;
  const topLevelClips = Array.isArray(data.clips)
    ? normalizeClips(data.clips)
    : null;

  if (nestedDocument) {
    if (nestedDocument.clips.length > 0) {
      return nestedDocument;
    }

    if (topLevelClips && topLevelClips.length > 0) {
      return {
        ...nestedDocument,
        clips: topLevelClips,
      };
    }

    if (lastNonEmptyDocument) {
      return {
        ...lastNonEmptyDocument,
        id: nestedDocument.id,
        title: nestedDocument.title,
        description: nestedDocument.description,
      };
    }

    return nestedDocument;
  }

  if (lastNonEmptyDocument) {
    return lastNonEmptyDocument;
  }

  return {
    id: typeof data.id === "string" ? data.id : id,
    title: data.title || id,
    description: data.description,
    clips: topLevelClips ?? [],
  } satisfies TimelineDocument;
}

function toIsoDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return undefined;
}

function getDocumentThumbnailUrl(document?: TimelineDocument) {
  const mediaClip = document?.clips.find(
    (clip) => clip.kind === "image" || clip.kind === "video",
  );

  if (!mediaClip) return undefined;
  return mediaClip.kind === "video" ? mediaClip.poster || mediaClip.src : mediaClip.src;
}

function toProjectSummary(id: string, data: Partial<TimelineDocumentRecord>): TimelineProjectSummary {
  const document = toTimelineDocument(id, data);

  return {
    id: document.id,
    title: document.title,
    description: document.description,
    clipCount: document.clips.length,
    thumbnailUrl: getDocumentThumbnailUrl(document),
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
  };
}

export async function listFirebaseTimelineProjects(requesterUid: string) {
  const snapshot = await withFirebaseTimeout(
    collection().where("isProject", "==", true).limit(100).get(),
    "Loading timeline projects",
  );

  // The scan (not an ownerUid where-clause) is deliberate while legacy
  // records exist: unowned projects must surface here so the first
  // authenticated visit CLAIMS them — otherwise they'd silently vanish from
  // the list until a manual migration ran. Other users' projects are
  // filtered out; claims are stamped before returning.
  const visible: { id: string; data: TimelineDocumentRecord }[] = [];
  const toClaim: string[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as TimelineDocumentRecord;
    const decision = resolveOwnership(data.ownerUid, requesterUid);
    if (decision === "denied") continue;
    if (decision === "claim") toClaim.push(doc.id);
    visible.push({ id: doc.id, data });
  }
  if (toClaim.length > 0) {
    const batch = getFirebaseDb().batch();
    for (const id of toClaim) {
      batch.set(collection().doc(id), { ownerUid: requesterUid }, { merge: true });
    }
    await withFirebaseTimeout(batch.commit(), "Claiming legacy timeline projects");
  }

  return visible
    .map(({ id, data }) => toProjectSummary(id, data))
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
}

export async function getFirebaseTimelineDocument(id: string, requesterUid: string) {
  const snapshot = await withFirebaseTimeout(
    collection().doc(id).get(),
    "Loading timeline document",
  );

  if (!snapshot.exists) return null;
  const data = snapshot.data() as TimelineDocumentRecord;
  const decision = resolveOwnership(data.ownerUid, requesterUid);
  if (decision === "denied") throw new TimelineAccessDeniedError(id);
  if (decision === "claim") {
    await withFirebaseTimeout(
      collection().doc(id).set({ ownerUid: requesterUid }, { merge: true }),
      "Claiming legacy timeline document",
    );
  }
  return toTimelineDocument(snapshot.id, data);
}

export async function saveFirebaseTimelineDocument(
  document: TimelineDocument,
  requesterUid: string,
  options?: { isProject?: boolean },
) {
  if (isUnsavedProjectPlaceholder(document)) {
    throw new Error("Refusing to save an unloaded project placeholder.");
  }

  const normalizedDocument = normalizeDocument(document);
  const ref = collection().doc(normalizedDocument.id);
  const existing = await withFirebaseTimeout(ref.get(), "Loading timeline document");
  const existingIsProject = existing.exists ? existing.get("isProject") === true : false;
  // Ownership: a save CREATES with the requester as owner, CLAIMS a legacy
  // unowned record, and is refused on someone else's. Children minted
  // implicitly through PATCH (collection drops) are stamped here too.
  const existingOwnerUid = existing.exists
    ? (existing.data() as TimelineDocumentRecord).ownerUid
    : undefined;
  if (existing.exists && resolveOwnership(existingOwnerUid, requesterUid) === "denied") {
    throw new TimelineAccessDeniedError(normalizedDocument.id);
  }
  const existingDocument = existing.exists
    ? toTimelineDocument(existing.id, existing.data() as TimelineDocumentRecord)
    : null;

  if (
    existingDocument &&
    existingDocument.clips.length > 0 &&
    normalizedDocument.clips.length === 0
  ) {
    throw new Error(
      "Refusing to save an empty timeline over an existing non-empty document.",
    );
  }

  await withFirebaseTimeout(
    ref.set(
      {
        id: normalizedDocument.id,
        title: normalizedDocument.title,
        description: normalizedDocument.description || null,
        document: normalizedDocument,
        clips: normalizedDocument.clips,
        ...(normalizedDocument.clips.length > 0
          ? { lastNonEmptyDocument: normalizedDocument }
          : {}),
        isProject: options?.isProject ?? existingIsProject,
        ownerUid: existingOwnerUid ?? requesterUid,
        createdAt: existing.exists ? existing.get("createdAt") || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
    "Saving timeline document",
  );

  const snapshot = await withFirebaseTimeout(ref.get(), "Loading timeline document");
  return toTimelineDocument(snapshot.id, snapshot.data() as TimelineDocumentRecord);
}

export async function createFirebaseTimelineProject(requesterUid: string, title?: string) {
  const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cleanTitle = title?.trim().slice(0, 80) || "Untitled Project";
  const document: TimelineDocument = {
    id,
    title: cleanTitle,
    description: "Custom timeline project.",
    clips: [],
  };
  await saveFirebaseTimelineDocument(document, requesterUid, { isProject: true });
  return document;
}

export async function deleteFirebaseTimelineDocument(id: string, requesterUid: string) {
  const ref = collection().doc(id);
  const docSnap = await withFirebaseTimeout(ref.get(), "Loading timeline document for deletion");

  if (docSnap.exists) {
    const data = docSnap.data() as TimelineDocumentRecord;
    if (resolveOwnership(data.ownerUid, requesterUid) === "denied") {
      throw new TimelineAccessDeniedError(id);
    }
    const document = data.document;
    if (document && document.clips) {
      const deleteQueue: string[] = [];
      const extractChildTimelineIds = (clips: TimelineClip[]) => {
        for (const clip of clips) {
          if (clip.kind === "collection" && clip.childTimelineId) {
            deleteQueue.push(clip.childTimelineId);
          }
        }
      };
      extractChildTimelineIds(document.clips);

      for (const childId of deleteQueue) {
        try {
          await deleteFirebaseTimelineDocument(childId, requesterUid);
        } catch (error) {
          // A child owned by someone else (shouldn't happen, but ids are
          // attacker-suppliable in stored clips) is skipped, not fatal —
          // the requester's own tree still deletes.
          if (!(error instanceof TimelineAccessDeniedError)) throw error;
        }
      }
    }
  }

  await withFirebaseTimeout(ref.delete(), "Deleting timeline document");
}
