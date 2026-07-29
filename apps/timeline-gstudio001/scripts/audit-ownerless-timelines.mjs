#!/usr/bin/env node
// Ownership audit for the timelines collection.
//
// `lib/timeline-ownership.ts` classifies a record with no `ownerUid` as
// "claim": the first authenticated user who lists projects or opens the id
// becomes its owner. That was a deliberate self-executing migration for
// records predating ownership stamping, with an exposure window of
// "deploy until the real owner's next visit" — but the window only closes
// once no ownerless records remain, and nothing measures that.
//
// This measures it. READ ONLY: it never writes, claims, or deletes.
//
// Lives in this workspace because firebase-admin is installed here, not at the
// repo root — a root-level script cannot resolve it.
//
//   npm run audit:ownership --workspace=apps/timeline-gstudio001
//   npm run audit:ownership --workspace=apps/timeline-gstudio001 -- --list
//
// Reads FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY,
// falling back to application-default credentials — the same inputs as
// lib/firebase-admin.ts.
//
// What the result means:
//
//   0 ownerless    The migration is complete. The `claim` branch is now dead
//                  code that can only ever misfire; delete it and deny
//                  ownerless records outright.
//   > 0 ownerless  Every one is claimable by whoever reaches it first. Assign
//                  owners from evidence a script cannot infer (who created it,
//                  who has been editing it) BEFORE removing the claim path,
//                  or those documents become unreachable.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";
const listAll = process.argv.includes("--list");

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

function isOwnerless(data) {
  // Exactly `resolveOwnership`'s "claim" test — missing, null, or empty.
  const ownerUid = data.ownerUid;
  return ownerUid === undefined || ownerUid === null || ownerUid === "";
}

function toIso(value) {
  if (!value) return "unknown";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value);
}

async function main() {
  initializeApp(credential());
  const db = getFirestore();

  // The full collection, not the app's `.limit(100)` — the point is the total.
  const snapshot = await db.collection(COLLECTION).get();

  const ownerless = [];
  const ownerCounts = new Map();

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (isOwnerless(data)) {
      ownerless.push({
        id: doc.id,
        title: data.title ?? "(untitled)",
        isProject: data.isProject === true,
        clips: Array.isArray(data.clips) ? data.clips.length : 0,
        updatedAt: toIso(data.updatedAt),
      });
      return;
    }
    ownerCounts.set(data.ownerUid, (ownerCounts.get(data.ownerUid) ?? 0) + 1);
  });

  const projects = ownerless.filter((entry) => entry.isProject);

  console.log(`collection:        ${COLLECTION}`);
  console.log(`documents:         ${snapshot.size}`);
  console.log(`distinct owners:   ${ownerCounts.size}`);
  console.log(`ownerless:         ${ownerless.length}`);
  console.log(`  of which projects: ${projects.length}`);
  console.log("");

  if (ownerless.length === 0) {
    console.log("No ownerless documents. The claim path in");
    console.log("lib/timeline-ownership.ts can be removed and ownerless records");
    console.log("denied in every runtime read, write, and delete.");
    return;
  }

  console.log(`${ownerless.length} document(s) are claimable by the first`);
  console.log("authenticated user who lists projects or opens the id.");
  console.log("");
  console.log("Projects are the urgent ones: listing alone stamps every");
  console.log("ownerless project in the first 100 results at once.");
  console.log("");

  const shown = listAll ? ownerless : ownerless.slice(0, 20);
  for (const entry of shown) {
    const kind = entry.isProject ? "project" : "document";
    console.log(
      `  ${entry.id}  [${kind}, ${entry.clips} clips, updated ${entry.updatedAt}]  ${entry.title}`,
    );
  }
  if (!listAll && ownerless.length > shown.length) {
    console.log(`  ... and ${ownerless.length - shown.length} more (--list to see all)`);
  }

  // Non-zero exit so this can gate a release check.
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Audit failed:", error.message);
  process.exitCode = 2;
});
