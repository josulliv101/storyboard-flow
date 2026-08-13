#!/usr/bin/env node
// File every unreachable document into its owner's trash bin.
//
// `prune:orphans` deliberately only removes documents that are BOTH empty and
// scratch-named, and it has run: it now matches zero. What is left are
// unreachable documents that hold something — 49 of them, 90 media clips —
// which that script will never touch by design.
//
// This is the other half. It does NOT delete: it re-parents each one into
// `trash-<uid>`, which makes it reachable again, visible in the app, and
// restorable. Emptying the bin from the UI is what finally deletes, and that
// path now removes owning collections too rather than only unlinking them.
//
//   npm run bin:orphans                  # dry run
//   npm run bin:orphans -- --apply       # file them (note the bare -- separator)
//
// WHY TRASH RATHER THAN DELETE. The standing rule for this data is that a node
// must never be left parentless — a removal either refuses or routes to the
// bin. A bulk hard-delete of 49 documents is the exact shape of the accident
// that started all of this, and "unreachable" is a statement about the graph,
// not a judgement that the contents are worthless. Trash is reversible; the
// operator can empty it in one click once they have looked.
//
// SAFETY:
//
//   APPEND, NEVER REPLACE. The bin already holds 78 clips. Its existing
//   contents are read and preserved; new references go after them. A script
//   that rewrote `document.clips` wholesale would silently empty the bin.
//
//   SKIP WHAT IS ALREADY THERE. A document already referenced by the bin is
//   left alone, so re-running cannot double-file anything.
//
//   REACHABLE DOCUMENTS ARE NEVER TOUCHED, and asset libraries are skipped —
//   they are addressed directly rather than through a project tree, so the
//   walk cannot see them and they are not orphans.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { dryRunNotice, readApplyFlag } from "./apply-flag.mjs";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";
const apply = readApplyFlag("bin:orphans", "BIN_APPLY");

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

const clipsOf = (data) =>
  Array.isArray(data?.document?.clips)
    ? data.document.clips
    : Array.isArray(data?.clips)
      ? data.clips
      : [];

const childIdsOf = (data) =>
  clipsOf(data)
    .filter((clip) => clip?.kind === "collection" && typeof clip.childTimelineId === "string")
    .map((clip) => clip.childTimelineId);

/** A collection clip in the shape the app stores, so a filed document is
 *  indistinguishable from one binned through the UI. `id === childTimelineId`
 *  marks the owning placement, which is how a real parent is told from a
 *  duplicate reference. */
function collectionClip(id, data, index, startTime) {
  const clips = clipsOf(data);
  const media = clips.filter((clip) => clip?.kind !== "collection");
  const duration = clips.reduce((total, clip) => total + (Number(clip?.duration) || 0), 0) || 3;
  const title = String(data?.title ?? "Untitled");
  return {
    id,
    index,
    kind: "collection",
    title,
    childTimelineId: id,
    itemCount: clips.length,
    previewItems: media.slice(0, 3).map((clip) => ({
      id: String(clip?.id ?? ""),
      kind: String(clip?.kind ?? "video"),
      src: String(clip?.src ?? ""),
      ...(clip?.poster ? { poster: String(clip.poster) } : {}),
      alt: String(clip?.alt ?? title),
    })),
    alt: `${title} collection`,
    aspect: 1.7777777777777777,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

async function main() {
  initializeApp(credential());
  const db = getFirestore();

  const snapshot = await db.collection(COLLECTION).get();
  const documents = new Map();
  snapshot.forEach((doc) => documents.set(doc.id, doc.data()));

  const reachable = new Set();
  const queue = [...documents.entries()]
    .filter(([id, data]) => data?.isProject === true || id.startsWith("trash-"))
    .map(([id]) => id);
  while (queue.length > 0) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const childId of childIdsOf(documents.get(id))) {
      if (!reachable.has(childId)) queue.push(childId);
    }
  }

  // Group by owner: each owner's orphans go to that owner's bin, never a
  // shared one.
  const byOwner = new Map();
  for (const [id, data] of documents) {
    if (reachable.has(id) || id.startsWith("asset-library")) continue;
    const uid = data?.ownerUid;
    if (typeof uid !== "string" || uid === "") {
      console.log(`  SKIP ${id} — no ownerUid, so there is no bin to file it in`);
      continue;
    }
    if (!byOwner.has(uid)) byOwner.set(uid, []);
    byOwner.get(uid).push({ id, data });
  }

  if (byOwner.size === 0) {
    console.log("Nothing unreachable. Every document hangs off a project or the bin.");
    return;
  }

  let planned = 0;
  const plans = [];
  for (const [uid, orphans] of byOwner) {
    const binId = `trash-${uid}`;
    const bin = documents.get(binId);
    if (!bin) {
      console.log(`  SKIP ${orphans.length} document(s) — no bin ${binId} exists`);
      continue;
    }
    const existing = clipsOf(bin);
    const alreadyThere = new Set(childIdsOf(bin));
    const fresh = orphans.filter((entry) => !alreadyThere.has(entry.id));

    let startTime = existing.reduce(
      (end, clip) => Math.max(end, (Number(clip?.startTime) || 0) + (Number(clip?.duration) || 0)),
      0,
    );
    const additions = [];
    for (const [offset, entry] of fresh.entries()) {
      const clip = collectionClip(entry.id, entry.data, existing.length + offset, startTime);
      additions.push(clip);
      startTime += clip.duration + 0.12;
    }

    plans.push({ binId, bin, existing, additions });
    planned += additions.length;

    console.log(`bin ${binId}  (revision ${bin?.revision}, ${existing.length} clips already)`);
    console.log(`  filing ${additions.length} of ${orphans.length} unreachable document(s)` +
      (orphans.length - fresh.length > 0
        ? `; ${orphans.length - fresh.length} already referenced there`
        : ""));
    for (const clip of additions) {
      console.log(
        `    + ${clip.childTimelineId.padEnd(32)} ${String(clip.itemCount).padStart(3)} items  ${clip.title}`,
      );
    }
    console.log("");
  }

  if (planned === 0) {
    console.log("Nothing to file.");
    return;
  }

  if (!apply) {
    console.log(`Would file ${planned} document(s) into the trash. They stay recoverable.`);
    console.log(dryRunNotice("bin:orphans", "BIN_APPLY", "file"));
    return;
  }

  for (const plan of plans) {
    if (plan.additions.length === 0) continue;
    await db
      .collection(COLLECTION)
      .doc(plan.binId)
      .update({
        // APPEND. Rewriting this field wholesale would empty the bin.
        "document.clips": [...plan.existing, ...plan.additions],
        revision: (Number(plan.bin?.revision) || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    console.log(`${plan.binId}: filed ${plan.additions.length}`);
  }
  console.log("");
  console.log(`Filed ${planned} document(s) into the trash — nothing was deleted.`);
  console.log("They are now visible and restorable in the app. Empty the bin there");
  console.log("to delete them for good.");
}

main().catch((error) => {
  console.error("Binning failed:", error.message);
  process.exitCode = 2;
});
