import 'server-only';

import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

type FirebaseGlobals = typeof globalThis & {
  storyboardFirebaseApp?: App;
};

const globals = globalThis as FirebaseGlobals;

function getPrivateKey() {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
}

export function getFirebaseApp() {
  if (globals.storyboardFirebaseApp) return globals.storyboardFirebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!storageBucket) {
    throw new Error('Firebase Storage is not configured. Add FIREBASE_STORAGE_BUCKET to the web app environment.');
  }

  const existingApp = getApps()[0];
  if (existingApp) {
    globals.storyboardFirebaseApp = existingApp;
    return existingApp;
  }

  const credential = clientEmail && privateKey
    ? cert({ projectId, clientEmail, privateKey })
    : applicationDefault();

  globals.storyboardFirebaseApp = initializeApp({
    credential,
    projectId,
    storageBucket,
  });

  return globals.storyboardFirebaseApp;
}

export function getFirebaseDb() {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseBucket() {
  return getStorage(getFirebaseApp()).bucket();
}
