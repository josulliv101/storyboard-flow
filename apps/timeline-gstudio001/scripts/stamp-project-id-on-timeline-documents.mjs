// Backfill `projectId` onto every timeline document, from the project that
// actually reaches it.
//
//   npm run stamp:project-id --workspace=apps/timeline-gstudio001            # dry run
//   npm run stamp:project-id --workspace=apps/timeline-gstudio001 -- --apply # write
//
// WHY IT EXISTS. The closure walk is a waterfall — a level's ids live inside
// the previous level's documents, so opening a 143-document project costs nine
// SEQUENTIAL round trips (#458). A `projectId` on each document lets one query
// address the whole subtree in one trip. New writes stamp it themselves; every
// document written before that shipped needs this.
//
// IT IS A HINT, NOT TRUTH. Nothing reads `projectId` to decide what a project
// contains — the closure walk still does, and still decides. So a document this
// script misses simply keeps today's behaviour, and a document it stamps wrongly
// costs a slower first paint rather than a wrong board. That is the property
// that makes a backfill safe to run before the read path uses it at all.
//
// Reads the whole collection once (~350 documents here), which is a real cost
// — see the quota note in timeline-snapshot.mjs. `--offline` runs the same walk
// against a saved snapshot for free.
import { getFirestore } from "firebase-admin/firestore";

import { dryRunNotice, readApplyFlag } from "./apply-flag.mjs";
import {
  COLLECTION,
  announceSnapshot,
  childIdsOf,
  isAssetLibrary,
  isTrashBin,
  loadDocuments,
  refuseOfflineWrite,
  snapshotFlags,
} from "./timeline-snapshot.mjs";

const apply = readApplyFlag("stamp:project-id", "STAMP_PROJECT_APPLY");
const { offline, snapshotPath } = snapshotFlags();

/** Firestore's hard ceiling on operations in one batched write. */
const MAX_BATCH_OPS = 500;

/**
 * Every document reachable from `rootId`, and the root itself.
 *
 * The same walk the server does, run once per project here rather than once per
 * page load. Cycles are guarded by `seen`, which is not paranoia: a cycle is
 * what `MAX_CLOSURE_DOCUMENTS` protects the server from, and this script has no
 * such ceiling.
 */
function closureOf(documents, rootId) {
  const found = new Set();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (found.has(id)) continue;
    const data = documents.get(id);
    if (data === undefined) continue;
    found.add(id);
    for (const childId of childIdsOf(data)) queue.push(childId);
  }
  return found;
}

async function main() {
  if (refuseOfflineWrite({ offline, apply, script: "stamp:project-id" })) return;

  const loaded = await loadDocuments({ offline, snapshotPath });
  if (loaded === null) return;
  announceSnapshot(loaded);
  const { documents } = loaded;

  const roots = [...documents.entries()]
    .filter(([id, data]) => data?.isProject === true && !isTrashBin(id) && !isAssetLibrary(id))
    .map(([id]) => id);
  console.log(`${roots.length} project roots.`);

  // CLAIMED BY WHICH ROOT, tracked so a document reachable from two projects is
  // reported rather than silently stamped with whichever walk ran last. That
  // should be impossible — a collection belongs to exactly one parent, enforced
  // by the orphan and duplicate-owner guards — so if it happens the data is
  // already wrong and quietly picking a winner would hide it.
  const claimedBy = new Map();
  const contested = [];
  for (const rootId of roots) {
    for (const id of closureOf(documents, rootId)) {
      const existing = claimedBy.get(id);
      if (existing !== undefined && existing !== rootId) {
        contested.push({ id, roots: [existing, rootId] });
        continue;
      }
      claimedBy.set(id, rootId);
    }
  }

  const pending = [];
  for (const [id, rootId] of claimedBy) {
    if (documents.get(id)?.projectId === rootId) continue;
    pending.push({ id, projectId: rootId });
  }

  const unreachable = [...documents.keys()].filter(
    (id) => !claimedBy.has(id) && !isTrashBin(id) && !isAssetLibrary(id),
  );

  console.log(`${pending.length} documents to stamp.`);
  if (contested.length > 0) {
    console.log(`\n${contested.length} document(s) reachable from TWO projects — NOT stamped:`);
    for (const entry of contested) console.log(`  ${entry.id}: ${entry.roots.join(" and ")}`);
    console.log("  A collection belongs to exactly one parent; this is data to fix, not to stamp.");
  }
  if (unreachable.length > 0) {
    // Not an error: the trash and the asset library are excluded above, and a
    // genuinely orphaned document is what `audit:orphans` is for.
    console.log(`\n${unreachable.length} document(s) reachable from no project (left alone).`);
  }

  if (!apply) {
    for (const entry of pending.slice(0, 20)) console.log(`  ${entry.id} -> ${entry.projectId}`);
    if (pending.length > 20) console.log(`  … and ${pending.length - 20} more`);
    dryRunNotice("stamp:project-id");
    return;
  }

  const db = getFirestore();
  let written = 0;
  for (let at = 0; at < pending.length; at += MAX_BATCH_OPS) {
    const chunk = pending.slice(at, at + MAX_BATCH_OPS);
    const batch = db.batch();
    for (const entry of chunk) {
      // MERGE, and only this field. These documents are live; a full set would
      // race an editor and overwrite real work with a snapshot read minutes ago.
      batch.set(db.collection(COLLECTION).doc(entry.id), { projectId: entry.projectId }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${pending.length}`);
  }
  console.log(`Stamped ${written} document(s).`);
}

await main();
