#!/usr/bin/env node
// Reachability audit for the timelines collection.
//
// A timeline document is reachable only through a clip inside some parent:
// `kind: "collection"` carrying its `childTimelineId`. Nothing in the app has
// ever checked that every document still has such a path. When the last one
// goes, the document stays in storage and vanishes from the product — invisible
// in the UI, absent from the trash it was removed from, and findable only by a
// query like this one.
//
// That is not hypothetical. Two collections went that way in one session, and
// the first run of this audit found 148 unreachable documents out of 391.
//
// This measures it. READ ONLY: it never writes, moves, or deletes.
//
// Lives in this workspace because firebase-admin is installed here, not at the
// repo root — a root-level script cannot resolve it.
//
//   npm run audit:orphans
//   npm run audit:orphans -- --list          every orphan, not the top 25
//   npm run audit:orphans -- --uid <uid>     one owner instead of all
//
// Reads FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY,
// falling back to application-default credentials — the same inputs as
// lib/firebase-admin.ts.
//
// WHAT COUNTS AS A ROOT, and why the answer depends on it:
//
//   projects (`isProject === true`)  the real entry points.
//   trash bins (`trash-<uid>`)       a trashed item is reachable and
//                                    restorable BY DESIGN, so its subtree is
//                                    not orphaned. Counting the bin as a root
//                                    is what keeps "in the bin" separate from
//                                    "lost".
//   asset libraries                  addressed directly rather than through a
//                                    project tree, so they are reported apart
//                                    from the rest and are probably fine.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";
const listAll = process.argv.includes("--list");
const uidIndex = process.argv.indexOf("--uid");
const onlyUid = uidIndex === -1 ? null : process.argv[uidIndex + 1];

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

/**
 * The stored clips, from whichever field carries them.
 *
 * `document.clips` is the live copy and `clips` the denormalized one; they
 * agree in practice, but a record written by an older path may only have the
 * latter. `lastNonEmptyDocument` is deliberately NOT consulted — it is a
 * recovery snapshot of content that has since been removed, and treating it as
 * a reference would report a genuinely emptied parent as still holding its
 * children.
 */
function clipsOf(data) {
  if (Array.isArray(data?.document?.clips)) return data.document.clips;
  if (Array.isArray(data?.clips)) return data.clips;
  return [];
}

function childIdsOf(data) {
  const ids = [];
  for (const clip of clipsOf(data)) {
    if (clip?.kind !== "collection") continue;
    if (typeof clip.childTimelineId !== "string") continue;
    ids.push(clip.childTimelineId);
  }
  return ids;
}

const isTrashBin = (id) => id.startsWith("trash-");
const isAssetLibrary = (id) => id.startsWith("asset-library");

async function main() {
  initializeApp(credential());
  const db = getFirestore();

  const query = onlyUid
    ? db.collection(COLLECTION).where("ownerUid", "==", onlyUid)
    : db.collection(COLLECTION);
  const snapshot = await query.get();

  const documents = new Map();
  snapshot.forEach((doc) => documents.set(doc.id, doc.data()));

  const roots = [...documents.entries()]
    .filter(([id, data]) => data?.isProject === true || isTrashBin(id))
    .map(([id]) => id);

  // Breadth-first from every root. A child appearing under two parents is
  // legal (duplicate-reference cards), so `seen` is what keeps this linear and
  // cycle-proof rather than a tree walk.
  const reachable = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const childId of childIdsOf(documents.get(id))) {
      if (!reachable.has(childId)) queue.push(childId);
    }
  }

  const orphans = [];
  for (const [id, data] of documents) {
    if (reachable.has(id)) continue;
    const clips = clipsOf(data);
    orphans.push({
      id,
      title: data?.title ?? "(untitled)",
      clips: clips.length,
      media: clips.filter((clip) => clip?.kind !== "collection").length,
      children: childIdsOf(data).length,
      library: isAssetLibrary(id),
      ownerUid: data?.ownerUid ?? "(none)",
    });
  }
  // Biggest first — the ones holding real work are what a person acts on.
  orphans.sort((a, b) => b.clips - a.clips || a.id.localeCompare(b.id));

  const library = orphans.filter((entry) => entry.library);
  const stranded = orphans.filter((entry) => !entry.library);
  const withMedia = stranded.filter((entry) => entry.media > 0);
  const mediaClips = stranded.reduce((total, entry) => total + entry.media, 0);

  console.log(`collection:        ${COLLECTION}`);
  if (onlyUid) console.log(`owner filter:      ${onlyUid}`);
  console.log(`documents:         ${documents.size}`);
  console.log(`roots:             ${roots.length} (${roots.filter(isTrashBin).length} trash)`);
  console.log(`reachable:         ${reachable.size}`);
  console.log(`ORPHANED:          ${stranded.length}`);
  console.log(`  holding media:     ${withMedia.length} (${mediaClips} clips)`);
  console.log(`asset libraries:   ${library.length} (reported apart — addressed directly)`);
  console.log("");

  if (stranded.length === 0) {
    console.log("Every document is reachable from a project or the trash.");
    return;
  }

  console.log("Unreachable from any project root or trash bin. These are");
  console.log("invisible in the app and cannot be restored through it.");
  console.log("");

  const shown = listAll ? stranded : stranded.slice(0, 25);
  for (const entry of shown) {
    console.log(
      `  ${entry.id}  [${entry.clips} clips, ${entry.media} media, ` +
        `${entry.children} sub]  ${entry.title}`,
    );
  }
  if (!listAll && stranded.length > shown.length) {
    console.log(`  ... and ${stranded.length - shown.length} more (--list to see all)`);
  }

  // Non-zero exit so this can gate a release check.
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Audit failed:", error.message);
  process.exitCode = 2;
});
