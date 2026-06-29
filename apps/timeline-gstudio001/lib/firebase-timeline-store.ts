import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { TimelineDocument, TimelineClip } from "@/components/timeline/types";
import { getFirebaseDb } from "./firebase-admin";

type TimelineDocumentRecord = {
  id: string;
  title: string;
  description?: string;
  document: TimelineDocument;
  isProject?: boolean;
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

function toTimelineDocument(id: string, data: Partial<TimelineDocumentRecord>) {
  return data.document
    ? normalizeDocument(data.document)
    : ({
        id,
        title: data.title || id,
        description: data.description,
        clips: [],
      } satisfies TimelineDocument);
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

export async function listFirebaseTimelineProjects() {
  const snapshot = await withFirebaseTimeout(
    collection().where("isProject", "==", true).limit(100).get(),
    "Loading timeline projects",
  );

  return snapshot.docs
    .map((doc) => toProjectSummary(doc.id, doc.data() as TimelineDocumentRecord))
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
}

export async function getFirebaseTimelineDocument(id: string) {
  const snapshot = await withFirebaseTimeout(
    collection().doc(id).get(),
    "Loading timeline document",
  );

  if (!snapshot.exists) return null;
  return toTimelineDocument(snapshot.id, snapshot.data() as TimelineDocumentRecord);
}

export async function saveFirebaseTimelineDocument(
  document: TimelineDocument,
  options?: { isProject?: boolean },
) {
  const normalizedDocument = normalizeDocument(document);
  const ref = collection().doc(normalizedDocument.id);
  const existing = await withFirebaseTimeout(ref.get(), "Loading timeline document");
  const existingIsProject = existing.exists ? existing.get("isProject") === true : false;

  await withFirebaseTimeout(
    ref.set(
      {
        id: normalizedDocument.id,
        title: normalizedDocument.title,
        description: normalizedDocument.description || null,
        document: normalizedDocument,
        isProject: options?.isProject ?? existingIsProject,
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

export async function createFirebaseTimelineProject(title?: string) {
  const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cleanTitle = title?.trim().slice(0, 80) || "Untitled Project";
  const document: TimelineDocument = {
    id,
    title: cleanTitle,
    description: "Custom timeline project.",
    clips: [],
  };
  await saveFirebaseTimelineDocument(document, { isProject: true });
  return document;
}

export async function deleteFirebaseTimelineDocument(id: string) {
  const ref = collection().doc(id);
  const docSnap = await withFirebaseTimeout(ref.get(), "Loading timeline document for deletion");
  
  if (docSnap.exists) {
    const data = docSnap.data() as TimelineDocumentRecord;
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
        await deleteFirebaseTimelineDocument(childId);
      }
    }
  }

  await withFirebaseTimeout(ref.delete(), "Deleting timeline document");
}
