#!/usr/bin/env node
// One-shot migration: stamp `ownerUid` onto records that predate ownership
// stamping, so the runtime "claim" path can be deleted.
//
// Ordering matters. Removing the claim path FIRST would make every ownerless
// record permanently unreachable — `resolveOwnership` would answer "denied"
// for a document with no owner to compare against. Stamp, verify zero
// remaining, then remove.
//
//   npm run stamp:ownership --workspace=apps/timeline-gstudio001            # dry run
//   npm run stamp:ownership --workspace=apps/timeline-gstudio001 -- --apply # write
//
// SAFETY: refuses to write when the collection has more than one distinct
// owner. With a single owner the assignment is unambiguous; with several,
// "who owned this legacy record" needs human evidence this script cannot see,
// and guessing would hand one user another's work.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { dryRunNotice, readApplyFlag } from "./apply-flag.mjs";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";
const BATCH_SIZE = 400; // Firestore caps a batch at 500 writes.

const apply = readApplyFlag("stamp:ownership", "STAMP_APPLY");

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
  const ownerUid = data.ownerUid;
  return ownerUid === undefined || ownerUid === null || ownerUid === "";
}

async function main() {
  initializeApp(credential());
  const db = getFirestore();
  const snapshot = await db.collection(COLLECTION).get();

  const ownerless = [];
  const owners = new Map();

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (isOwnerless(data)) {
      ownerless.push({ id: doc.id, title: data.title ?? "(untitled)" });
      return;
    }
    owners.set(data.ownerUid, (owners.get(data.ownerUid) ?? 0) + 1);
  });

  console.log(`documents:   ${snapshot.size}`);
  console.log(`ownerless:   ${ownerless.length}`);
  console.log(`owners:      ${owners.size}`);
  for (const [uid, count] of owners) console.log(`  ${uid}  (${count} docs)`);
  console.log("");

  if (ownerless.length === 0) {
    console.log("Nothing to stamp.");
    return;
  }

  if (owners.size !== 1) {
    console.error(
      `Refusing to stamp: ${owners.size} distinct owners. Assignment needs`,
    );
    console.error("evidence of who created each record, which this script cannot infer.");
    process.exitCode = 2;
    return;
  }

  const [ownerUid] = [...owners.keys()];
  console.log(`${apply ? "Stamping" : "Would stamp"} ${ownerless.length} document(s) with ${ownerUid}:`);
  for (const entry of ownerless) console.log(`  ${entry.id}  ${entry.title}`);
  console.log("");

  if (!apply) {
    console.log(dryRunNotice("stamp:ownership", "STAMP_APPLY"));
    return;
  }

  let written = 0;
  for (let index = 0; index < ownerless.length; index += BATCH_SIZE) {
    const chunk = ownerless.slice(index, index + BATCH_SIZE);
    const batch = db.batch();
    for (const entry of chunk) {
      // merge — stamp ownership without touching the document body.
      batch.set(db.collection(COLLECTION).doc(entry.id), { ownerUid }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${ownerless.length}`);
  }

  console.log("");
  console.log(`Stamped ${written} document(s). Re-run the audit to confirm zero remain.`);
}

main().catch((error) => {
  console.error("Stamping failed:", error.message);
  process.exitCode = 2;
});
