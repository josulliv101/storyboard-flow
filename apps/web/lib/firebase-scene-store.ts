import 'server-only';

import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type Query } from 'firebase-admin/firestore';
import { getFirebaseDb } from './firebase-admin';

export type TimelineProjectJson = any;

export type SavedSceneSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  isPublished: boolean;
  hasAnalysis: boolean;
  publishedAt?: string;
  publisherName?: string;
};

export type SavedScene = SavedSceneSummary & {
  project: TimelineProjectJson;
};

type SavedSceneDocument = {
  name: string;
  project: TimelineProjectJson;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  isPublished?: boolean;
  publishedAt?: Timestamp | null;
  publishedByUserId?: string | null;
  publisherName?: string | null;
};

const SAVED_SCENES_COLLECTION = 'savedScenes';
const SCENE_STORAGE_TIMEOUT_MS = 8_000;

function withFirebaseTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    operation.finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out. Check the Firebase project credentials and network access.`));
      }, SCENE_STORAGE_TIMEOUT_MS);
    }),
  ]);
}

function collection() {
  return getFirebaseDb().collection(SAVED_SCENES_COLLECTION);
}

function toIsoDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return new Date().toISOString();
}

function getSceneThumbnailUrl(project?: TimelineProjectJson) {
  return project?.scenes
    ?.find((scene: any) => typeof scene.thumbnailUrl === 'string' && scene.thumbnailUrl.trim().length > 0)
    ?.thumbnailUrl;
}

function hasAnalysis(project?: TimelineProjectJson) {
  return Boolean(project?.scenes?.some((scene: any) => scene.analysisModel || scene.analysisReport));
}

function toSummary(id: string, data: SavedSceneDocument): SavedSceneSummary {
  return {
    id,
    name: data.name,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    thumbnailUrl: getSceneThumbnailUrl(data.project),
    isPublished: !!data.isPublished,
    hasAnalysis: hasAnalysis(data.project),
    publishedAt: data.publishedAt ? toIsoDate(data.publishedAt) : undefined,
    publisherName: data.publisherName || undefined,
  };
}

export async function listSavedScenes(onlyPublished = false): Promise<SavedSceneSummary[]> {
  let query: Query = collection();
  if (onlyPublished) {
    query = query.where('isPublished', '==', true);
  }

  const snapshot = await withFirebaseTimeout(
    query.orderBy('updatedAt', 'desc').limit(30).get(),
    'Loading saved scenes',
  );

  return snapshot.docs.map(doc => toSummary(doc.id, doc.data() as SavedSceneDocument));
}

export async function saveScene(name: string, project: TimelineProjectJson): Promise<SavedSceneSummary> {
  const id = randomUUID();
  const now = FieldValue.serverTimestamp();
  const serializedProject = JSON.parse(JSON.stringify(project)) as TimelineProjectJson;
  const ref = collection().doc(id);

  await withFirebaseTimeout(ref.set({
    name,
    project: serializedProject,
    isPublished: false,
    publishedAt: null,
    publishedByUserId: null,
    publisherName: null,
    createdAt: now,
    updatedAt: now,
  }), 'Saving scene');

  const snapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  return toSummary(snapshot.id, snapshot.data() as SavedSceneDocument);
}

export async function getSavedScene(id: string): Promise<SavedScene | null> {
  const snapshot = await withFirebaseTimeout(collection().doc(id).get(), 'Loading saved scene');
  if (!snapshot.exists) return null;

  const data = snapshot.data() as SavedSceneDocument;
  return {
    ...toSummary(snapshot.id, data),
    project: data.project,
  };
}

export async function updateSavedSceneThumbnail(id: string, thumbnailUrl: string): Promise<SavedSceneSummary | null> {
  const ref = collection().doc(id);
  const snapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  if (!snapshot.exists) return null;

  const data = snapshot.data() as SavedSceneDocument;
  const project = JSON.parse(JSON.stringify(data.project || {})) as TimelineProjectJson;
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) return null;
  project.scenes[0] = { ...project.scenes[0], thumbnailUrl };

  await withFirebaseTimeout(ref.update({
    project,
    updatedAt: FieldValue.serverTimestamp(),
  }), 'Updating saved scene thumbnail');

  const updatedSnapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  return toSummary(updatedSnapshot.id, updatedSnapshot.data() as SavedSceneDocument);
}

export async function updateSavedSceneProject(id: string, project: TimelineProjectJson): Promise<SavedSceneSummary | null> {
  const ref = collection().doc(id);
  const snapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  if (!snapshot.exists) return null;

  const sceneName = typeof project?.scenes?.[0]?.name === 'string' ? project.scenes[0].name : undefined;
  const serializedProject = JSON.parse(JSON.stringify(project)) as TimelineProjectJson;

  await withFirebaseTimeout(ref.update({
    ...(sceneName ? { name: sceneName } : {}),
    project: serializedProject,
    updatedAt: FieldValue.serverTimestamp(),
  }), 'Updating saved scene project');

  const updatedSnapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  return toSummary(updatedSnapshot.id, updatedSnapshot.data() as SavedSceneDocument);
}

export async function updateSavedScenePublishStatus(
  id: string,
  isPublished: boolean,
  publisherUserId?: string,
  publisherName?: string,
): Promise<SavedSceneSummary | null> {
  const ref = collection().doc(id);
  const snapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  if (!snapshot.exists) return null;

  await withFirebaseTimeout(ref.update({
    isPublished,
    publishedAt: isPublished ? FieldValue.serverTimestamp() : null,
    publishedByUserId: isPublished ? (publisherUserId || null) : null,
    publisherName: isPublished ? (publisherName || null) : null,
    updatedAt: FieldValue.serverTimestamp(),
  }), 'Updating saved scene publish status');

  const updatedSnapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  return toSummary(updatedSnapshot.id, updatedSnapshot.data() as SavedSceneDocument);
}

export async function getOtherSavedSceneProjects(id: string): Promise<TimelineProjectJson[]> {
  const snapshot = await withFirebaseTimeout(collection().get(), 'Loading saved scene references');
  return snapshot.docs
    .filter(doc => doc.id !== id)
    .map(doc => (doc.data() as SavedSceneDocument).project)
    .filter(Boolean);
}

export async function deleteSavedScene(id: string): Promise<boolean> {
  const ref = collection().doc(id);
  const snapshot = await withFirebaseTimeout(ref.get(), 'Loading saved scene');
  if (!snapshot.exists) return false;

  await withFirebaseTimeout(ref.delete(), 'Deleting saved scene');
  return true;
}
