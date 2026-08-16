#!/usr/bin/env node
// WHO ELSE HAS AN ACCOUNT, and what did they make.
//
// Sign-in is open: `app/api/auth/login/route.ts` mails a link to any address
// that asks, with no allowlist, so anyone who finds the site can create an
// account. Ownership still holds — `resolveOwnership` denies every read and
// write whose `ownerUid` is not the requester's — so a stranger gets an empty
// workspace of their own and cannot see anyone else's work. What they CAN do
// is spend this project's Firestore and Cloudinary quota, which is not
// theoretical: the daily read quota ran out yesterday.
//
// READ ONLY. It never writes, claims, or deletes.
//
//   npm run audit:accounts --workspace=apps/timeline-gstudio001
//   npm run audit:accounts --workspace=apps/timeline-gstudio001 -- --uid <uid>
//
// CHEAP ON PURPOSE, because a full-collection scan is what exhausted the quota:
//
//   - the sweep reads PROJECTS only (`isProject == true`), which is a small
//     fraction of the collection — every scene, shot and bin is a document too;
//   - it `select()`s four fields, so no clip arrays cross the wire;
//   - per-owner totals come from `count()`, an aggregation billed per ~1000
//     index entries rather than per document.
//
// `--uid` then lists one owner's projects, for when the summary says something
// worth looking at.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";

const uidFlagIndex = process.argv.indexOf("--uid");
const focusUid = uidFlagIndex === -1 ? null : process.argv[uidFlagIndex + 1];

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

function toIso(value) {
  if (!value) return "unknown";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value);
}

async function main() {
  const { credential: cred, projectId } = credential();
  initializeApp({ credential: cred, projectId });
  const db = getFirestore();

  if (focusUid) {
    const snapshot = await db
      .collection(COLLECTION)
      .where("ownerUid", "==", focusUid)
      .select("title", "isProject", "createdAt", "updatedAt")
      .get();
    console.log(`\nDocuments owned by ${focusUid}: ${snapshot.size}\n`);
    for (const doc of snapshot.docs) {
      const d = doc.data();
      console.log(
        `  ${d.isProject ? "PROJECT " : "        "}${doc.id}` +
          `\n            title=${JSON.stringify(d.title ?? "")}` +
          `  created=${toIso(d.createdAt)}  updated=${toIso(d.updatedAt)}`,
      );
    }
    return;
  }

  // PROJECTS ONLY — the question is "did anyone make anything", and a project
  // is the root of everything a person makes here.
  const projects = await db
    .collection(COLLECTION)
    .where("isProject", "==", true)
    .select("ownerUid", "title", "createdAt", "updatedAt")
    .get();

  const byOwner = new Map();
  for (const doc of projects.docs) {
    const data = doc.data();
    const owner = data.ownerUid ?? "(ownerless)";
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push({
      id: doc.id,
      title: data.title ?? "",
      createdAt: toIso(data.createdAt),
      updatedAt: toIso(data.updatedAt),
    });
  }

  console.log(`\nProjects read: ${projects.size}   Distinct owners: ${byOwner.size}\n`);

  for (const [owner, list] of [...byOwner.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    // Total documents for this owner, WITHOUT reading them.
    const total = await db
      .collection(COLLECTION)
      .where("ownerUid", "==", owner)
      .count()
      .get();
    console.log(`OWNER ${owner}`);
    console.log(`  projects: ${list.length}   documents in total: ${total.data().count}`);
    for (const p of list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      console.log(
        `    ${p.id}  ${JSON.stringify(p.title)}  created=${p.createdAt}  updated=${p.updatedAt}`,
      );
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
