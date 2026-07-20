import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { TimelineDocument, TimelineClip } from "@storyboard/timeline-model/types";
import { getFirebaseDb } from "./firebase-admin";
import { firstFrameUrl } from "./project-thumbnail";
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
  /** Monotonic save counter, stamped on EVERY write (absent = 0, legacy).
   *  Clients that carry an expected revision into a batch write get
   *  compare-and-set semantics; clients that don't (legacy views) keep
   *  last-write-wins. */
  revision?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

/** A document plus the revision that read observed — the token a client
 *  hands back as `expectedRevision` to detect concurrent writers. */
export type TimelineEntry = {
  document: TimelineDocument;
  revision: number;
};

export type TimelineBatchWrite = {
  document: TimelineDocument;
  /** Omit for last-write-wins (legacy semantics). When present, the write
   *  only applies if the stored revision still matches. */
  expectedRevision?: number;
};

export type TimelineRevisionConflict = {
  id: string;
  actualRevision: number;
};

/** A batch was rejected because at least one expected revision no longer
 *  matched — NOTHING in the batch was written. */
export class TimelineRevisionConflictError extends Error {
  readonly conflicts: readonly TimelineRevisionConflict[];

  constructor(conflicts: readonly TimelineRevisionConflict[]) {
    super(
      `Timeline write conflict: ${conflicts.map((conflict) => conflict.id).join(", ")} changed since they were read.`,
    );
    this.name = "TimelineRevisionConflictError";
    this.conflicts = conflicts;
  }
}

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

function toProjectSummary(id: string, data: Partial<TimelineDocumentRecord>): TimelineProjectSummary {
  const document = toTimelineDocument(id, data);

  return {
    id: document.id,
    title: document.title,
    description: document.description,
    clipCount: document.clips.length,
    thumbnailUrl: firstFrameUrl(document.clips),
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

export async function getFirebaseTimelineEntry(
  id: string,
  requesterUid: string,
): Promise<TimelineEntry | null> {
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
  return {
    document: toTimelineDocument(snapshot.id, data),
    revision: data.revision ?? 0,
  };
}

export async function getFirebaseTimelineDocument(id: string, requesterUid: string) {
  const entry = await getFirebaseTimelineEntry(id, requesterUid);
  return entry?.document ?? null;
}

/** The one Firestore payload both write paths (single save, atomic batch)
 *  produce — shared so revision stamping and ownership claiming can't drift
 *  between them. */
function buildSavePayload(
  normalizedDocument: TimelineDocument,
  existing: TimelineDocumentRecord | undefined,
  requesterUid: string,
  revision: number,
  options?: { isProject?: boolean },
) {
  return {
    id: normalizedDocument.id,
    title: normalizedDocument.title,
    description: normalizedDocument.description || null,
    document: normalizedDocument,
    clips: normalizedDocument.clips,
    ...(normalizedDocument.clips.length > 0
      ? { lastNonEmptyDocument: normalizedDocument }
      : {}),
    isProject: options?.isProject ?? existing?.isProject === true,
    // Ownership: a save CREATES with the requester as owner, CLAIMS a legacy
    // unowned record, and was refused earlier on someone else's. Children
    // minted implicitly through writes (collection drops) are stamped too.
    ownerUid: existing?.ownerUid ?? requesterUid,
    revision,
    createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function saveFirebaseTimelineEntry(
  document: TimelineDocument,
  requesterUid: string,
  options?: { isProject?: boolean },
): Promise<TimelineEntry> {
  if (isUnsavedProjectPlaceholder(document)) {
    throw new Error("Refusing to save an unloaded project placeholder.");
  }

  const normalizedDocument = normalizeDocument(document);
  const ref = collection().doc(normalizedDocument.id);
  const existing = await withFirebaseTimeout(ref.get(), "Loading timeline document");
  const existingData = existing.exists
    ? (existing.data() as TimelineDocumentRecord)
    : undefined;
  if (existingData && resolveOwnership(existingData.ownerUid, requesterUid) === "denied") {
    throw new TimelineAccessDeniedError(normalizedDocument.id);
  }
  const existingDocument = existingData
    ? toTimelineDocument(existing.id, existingData)
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

  // No expectation here: the single-save path keeps last-write-wins (legacy
  // views). It still STAMPS the next revision so batch writers see honest
  // counters.
  const revision = (existingData?.revision ?? 0) + 1;
  await withFirebaseTimeout(
    ref.set(
      buildSavePayload(normalizedDocument, existingData, requesterUid, revision, options),
      { merge: true },
    ),
    "Saving timeline document",
  );

  const snapshot = await withFirebaseTimeout(ref.get(), "Loading timeline document");
  const savedData = snapshot.data() as TimelineDocumentRecord;
  return {
    document: toTimelineDocument(snapshot.id, savedData),
    revision: savedData.revision ?? revision,
  };
}

export async function saveFirebaseTimelineDocument(
  document: TimelineDocument,
  requesterUid: string,
  options?: { isProject?: boolean },
) {
  return (await saveFirebaseTimelineEntry(document, requesterUid, options)).document;
}

/**
 * ALL-OR-NOTHING multi-document save in one Firestore transaction — the
 * write path for changes that span documents (a cross-timeline move touches
 * two), where independent PATCHes could apply half a change. Per-write
 * `expectedRevision` gives compare-and-set: any mismatch aborts the WHOLE
 * batch with a TimelineRevisionConflictError listing every conflicted id
 * (so a stale client can't silently overwrite a newer writer). Ownership
 * and the empty-over-nonempty guard match the single-save path exactly.
 */
export async function saveFirebaseTimelineDocumentsAtomic(
  writes: readonly TimelineBatchWrite[],
  requesterUid: string,
): Promise<{ id: string; revision: number }[]> {
  for (const write of writes) {
    if (isUnsavedProjectPlaceholder(write.document)) {
      throw new Error("Refusing to save an unloaded project placeholder.");
    }
  }
  const ids = writes.map((write) => write.document.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("A batch write must not repeat a timeline id.");
  }

  return withFirebaseTimeout(
    getFirebaseDb().runTransaction(async (tx) => {
      // Firestore transactions require every read before the first write.
      const refs = ids.map((id) => collection().doc(id));
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));

      const conflicts: TimelineRevisionConflict[] = [];
      const staged: {
        ref: (typeof refs)[number];
        id: string;
        revision: number;
        payload: ReturnType<typeof buildSavePayload>;
      }[] = [];

      for (let index = 0; index < writes.length; index += 1) {
        const normalizedDocument = normalizeDocument(writes[index].document);
        const snapshot = snapshots[index];
        const existingData = snapshot.exists
          ? (snapshot.data() as TimelineDocumentRecord)
          : undefined;

        if (existingData && resolveOwnership(existingData.ownerUid, requesterUid) === "denied") {
          throw new TimelineAccessDeniedError(normalizedDocument.id);
        }

        const actualRevision = existingData?.revision ?? 0;
        const expected = writes[index].expectedRevision;
        if (expected !== undefined && expected !== actualRevision) {
          conflicts.push({ id: normalizedDocument.id, actualRevision });
          continue;
        }

        const existingDocument = existingData
          ? toTimelineDocument(snapshot.id, existingData)
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

        staged.push({
          ref: refs[index],
          id: normalizedDocument.id,
          revision: actualRevision + 1,
          payload: buildSavePayload(
            normalizedDocument,
            existingData,
            requesterUid,
            actualRevision + 1,
          ),
        });
      }

      if (conflicts.length > 0) throw new TimelineRevisionConflictError(conflicts);

      for (const entry of staged) tx.set(entry.ref, entry.payload, { merge: true });
      return staged.map(({ id, revision }) => ({ id, revision }));
    }),
    "Saving timeline documents",
  );
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
