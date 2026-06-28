import "server-only";

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

type FirebaseGlobals = typeof globalThis & {
  gstudioFirebaseApp?: App;
};

const globals = globalThis as FirebaseGlobals;

function getPrivateKey() {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

function normalizeBucketName(value: string) {
  return value.trim().replace(/^gs:\/\//, "");
}

export function getFirebaseBucketNames() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const configuredBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const bucketNames = [
    configuredBucket ? normalizeBucketName(configuredBucket) : undefined,
    projectId ? `${projectId}.firebasestorage.app` : undefined,
    projectId ? `${projectId}.appspot.com` : undefined,
  ].filter((bucketName): bucketName is string => !!bucketName);

  return Array.from(new Set(bucketNames));
}

export function getFirebaseApp() {
  if (globals.gstudioFirebaseApp) return globals.gstudioFirebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();
  const storageBucket = getFirebaseBucketNames()[0];

  const existingApp = getApps()[0];
  if (existingApp) {
    globals.gstudioFirebaseApp = existingApp;
    return existingApp;
  }

  const credential =
    clientEmail && privateKey
      ? cert({ projectId, clientEmail, privateKey })
      : applicationDefault();

  globals.gstudioFirebaseApp = initializeApp({
    credential,
    projectId,
    ...(storageBucket ? { storageBucket } : {}),
  });

  return globals.gstudioFirebaseApp;
}

export function getFirebaseDb() {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseBucket() {
  const bucketName = getFirebaseBucketNames()[0];
  if (!bucketName) {
    throw new Error(
      "Firebase Storage is not configured. Add FIREBASE_STORAGE_BUCKET to the timeline-gstudio001 environment.",
    );
  }

  return getStorage(getFirebaseApp()).bucket(bucketName);
}

export function getFirebaseBucketByName(bucketName: string) {
  return getStorage(getFirebaseApp()).bucket(bucketName);
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}
