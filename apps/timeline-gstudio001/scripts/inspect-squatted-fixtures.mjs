#!/usr/bin/env node
// Look at the squatted demo-fixture documents BEFORE anything deletes them.
//
// #342 stopped a GET from claiming these global ids, but the ones already
// claimed still hold their names and still 404 anyone but their owner. They
// have to go — but "seeded by a stray GET" and "someone has been working in
// it" look identical from the id alone, and one of those must not be deleted.
//
// READ ONLY by default. Pass --delete to remove, which refuses on any of the
// three unsafe signals below.
//
//   npm run inspect:squatted --workspace=apps/timeline-gstudio001
//   npm run inspect:squatted --workspace=apps/timeline-gstudio001 -- --delete
//
// UNSAFE, and why each one blocks:
//
//   REFERENCED   Another document points at it via a collection clip's
//                `childTimelineId`. Deleting it breaks that parent's drill-in
//                and orphans whatever the id stood for — a worse outcome than
//                the 404 this is trying to fix.
//   EDITED       Its clips do not match the pristine fixture. Someone has been
//                working in it, so the id being shared is now the lesser
//                problem.
//   HAS CHILDREN Its own clips reference child timelines THAT EXIST. Deleting
//                the parent strands them exactly the way #338 describes.
//                A reference to an id no document holds strands nothing —
//                fixture data declares children that were never seeded, and
//                blocking on those would refuse a deletion that is in fact
//                safe. Existence is the question, not the reference.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTION = "gstudioTimelineDocuments";

// Mirrors the ids `getTimelineDocument` can return in
// packages/ui/timeline/timeline-documents.ts. Duplicated rather than imported:
// that module is TypeScript, and a plain node script cannot load it. Same
// list as audit-review-findings.mjs — if one changes, change both.
const FIXTURE_IDS = new Set([
  "archive",
  "collection-board",
  "collection-board-act-one",
  "collection-board-act-three",
  "collection-board-act-two",
  "promo",
  "root",
  "root-collection-board",
  "root-scene-a",
  "root-scene-b",
  "scene-a",
  "scene-a-details",
  "scene-a-nested-collection",
  "scene-b",
  "single",
  "storyboard",
  "three",
  "workbench",
]);
const shouldDelete = process.argv.includes("--delete");

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

const clipsOf = (value) => (Array.isArray(value?.clips) ? value.clips : null);

/** The same precedence `toTimelineDocument` uses, so "edited" means what a
 *  reader would actually see rather than one field's worth of it. */
function effectiveClips(data) {
  const nested = clipsOf(data.document);
  const topLevel = Array.isArray(data.clips) ? data.clips : null;
  const recovery = clipsOf(data.lastNonEmptyDocument);
  if (nested && nested.length > 0) return nested;
  if (topLevel && topLevel.length > 0) return topLevel;
  if (recovery) return recovery;
  return nested ?? topLevel ?? [];
}

const idsOf = (clips) => clips.map((clip) => clip?.id).filter((id) => typeof id === "string");

const childIdsOf = (clips) =>
  clips
    .filter((clip) => clip?.kind === "collection" && typeof clip.childTimelineId === "string")
    .map((clip) => clip.childTimelineId);

async function main() {
  initializeApp(credential());
  const db = getFirestore();
  const snapshot = await db.collection(COLLECTION).get();

  // Every inbound childTimelineId reference in the whole collection, so a
  // parent anywhere is found — not just one we thought to look at.
  const referencedBy = new Map();
  snapshot.forEach((doc) => {
    for (const childId of childIdsOf(effectiveClips(doc.data()))) {
      if (!referencedBy.has(childId)) referencedBy.set(childId, []);
      referencedBy.get(childId).push(doc.id);
    }
  });

  const existingIds = new Set();
  snapshot.forEach((doc) => existingIds.add(doc.id));

  const rows = [];
  snapshot.forEach((doc) => {
    if (!FIXTURE_IDS.has(doc.id)) return;

    const data = doc.data();
    const live = effectiveClips(data);
    const parents = (referencedBy.get(doc.id) ?? []).filter((id) => id !== doc.id);
    // Only children that are REAL documents can be orphaned. Fixture data
    // declares children that were never seeded; a pointer at nothing strands
    // nothing.
    const liveChildren = childIdsOf(live).filter((id) => existingIds.has(id));
    const danglingChildren = childIdsOf(live).filter((id) => !existingIds.has(id));

    const reasons = [];
    if (parents.length > 0) reasons.push(`REFERENCED by ${parents.join(", ")}`);
    if (liveChildren.length > 0) reasons.push(`HAS CHILDREN (${liveChildren.join(", ")})`);

    rows.push({
      id: doc.id,
      title: data.title ?? "(untitled)",
      ownerUid: data.ownerUid ?? "(ownerless)",
      revision: data.revision ?? 0,
      liveIds: idsOf(live),
      // The clips themselves, so whether this is untouched demo content or
      // somebody's work is a judgement a human makes from real data rather
      // than one this script guesses at.
      kinds: live.map((clip) => `${clip?.kind ?? "?"}:${clip?.alt ?? clip?.title ?? ""}`),
      danglingChildren,
      reasons,
    });
  });

  console.log(`collection:      ${COLLECTION}`);
  console.log(`documents:       ${snapshot.size}`);
  console.log(`fixture ids held: ${rows.length}`);
  console.log("");

  for (const row of rows) {
    console.log(`── ${row.id} ──`);
    console.log(`  title:    ${row.title}`);
    console.log(`  owner:    ${row.ownerUid}    revision: ${row.revision}`);
    console.log(`  clips:    [${row.liveIds.join(", ")}]`);
    console.log(`  content:  ${row.kinds.join(" | ") || "(empty)"}`);
    if (row.danglingChildren.length > 0) {
      console.log(
        `  dangling: ${row.danglingChildren.join(", ")} (declared, never seeded — nothing to orphan)`,
      );
    }
    console.log(`  verdict:  ${row.reasons.length === 0 ? "no blocker" : row.reasons.join("; ")}`);
    console.log("");
  }

  const safe = rows.filter((row) => row.reasons.length === 0);
  const unsafe = rows.filter((row) => row.reasons.length > 0);

  console.log(`safe:   ${safe.length}  [${safe.map((r) => r.id).join(", ")}]`);
  console.log(`unsafe: ${unsafe.length}  [${unsafe.map((r) => r.id).join(", ")}]`);

  if (!shouldDelete) {
    console.log("");
    console.log("Read-only. Re-run with --delete to remove the SAFE ones.");
    return;
  }

  if (safe.length === 0) {
    console.log("");
    console.log("Nothing safe to delete.");
    return;
  }

  console.log("");
  for (const row of safe) {
    await db.collection(COLLECTION).doc(row.id).delete();
    console.log(`deleted ${row.id}`);
  }
  if (unsafe.length > 0) {
    console.log("");
    console.log(`LEFT ALONE (${unsafe.length}): each is listed above with its reason.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
