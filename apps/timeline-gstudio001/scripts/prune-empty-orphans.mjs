#!/usr/bin/env node
// Delete the EMPTY unreachable documents that `audit:orphans` reports.
//
// The audit found 139 unreachable documents. Most are not work: they are empty
// shells left behind by a "new collection" button pressed and abandoned, over
// months, made permanent by an Empty Trash that never deleted anything and a
// reachability rule nothing enforced. Reviewing 139 by hand to find the ten
// that matter is the reason nobody ever cleans this up, so this removes the
// obviously-nothing and leaves a list a person can actually read.
//
//   npm run prune:orphans                  # dry run
//   npm run prune:orphans -- --offline     # dry run from the last snapshot, ZERO reads
//   npm run prune:orphans -- --apply       # delete (note the bare -- separator)
//   PRUNE_APPLY=1 npm run prune:orphans    # delete, in a form npm cannot swallow
//
// A dry run reading the whole collection to tell you what it WOULD do is the
// clearest case of a read that need not be live: --offline answers from the
// snapshot the last live run wrote. --offline with --apply is REFUSED — see
// refuseOfflineWrite in timeline-snapshot.mjs.
//
// `npm run prune:orphans --apply` WITHOUT the separator is discarded by npm
// before the script runs — see scripts/apply-flag.mjs.
//
// SAFETY, and this is the whole design:
//
//   ZERO CLIPS ONLY. A document holding anything at all — one media clip, one
//   sub-collection — is never touched, whatever it is called. "New Collection"
//   with eight clips in it is still eight clips of somebody's work, and a bulk
//   pass that eats those is worse than a long review list. Naming is used only
//   to narrow an already-empty set, never to justify deleting content.
//
//   REACHABLE DOCUMENTS ARE NEVER TOUCHED. The walk is the same one
//   `audit-orphaned-timelines.mjs` does, including the trash bin as a root, so
//   anything sitting in the bin is out of scope by construction.
//
//   ASSET LIBRARIES ARE SKIPPED. They are addressed directly rather than
//   through a project tree, so the walk cannot see them and they are not
//   orphans.
//
// It is a hard delete, not a move to the trash. These documents hold nothing,
// so there is nothing to recover; putting 87 empty shells in the bin would just
// move the mess. Anything with content goes to review instead — see the list
// this prints under KEEPING.

import { getFirestore } from "firebase-admin/firestore";

import { dryRunNotice, readApplyFlag } from "./apply-flag.mjs";
import {
  COLLECTION,
  announceSnapshot,
  clipsOf,
  childIdsOf,
  loadDocuments,
  refuseOfflineWrite,
  snapshotFlags,
  walkReachable,
} from "./timeline-snapshot.mjs";

const apply = readApplyFlag("prune:orphans", "PRUNE_APPLY");
const { offline, snapshotPath } = snapshotFlags();

/** Titles that mean "made by a button, never used". Only ever consulted for a
 *  document already proven to hold nothing. */
const SCRATCH_TITLE = /^(new collection|new timeline|untitled|\(untitled\))$/i;

async function main() {
  if (refuseOfflineWrite({ offline, apply, script: "prune:orphans" })) return;

  const loaded = await loadDocuments({ offline, snapshotPath });
  if (loaded === null) return;
  const { documents } = loaded;
  announceSnapshot(loaded);

  const { reachable } = walkReachable(documents);

  const deletable = [];
  const keeping = [];
  for (const [id, data] of documents) {
    if (reachable.has(id)) continue;
    if (id.startsWith("asset-library")) continue;
    const clips = clipsOf(data);
    const title = String(data?.title ?? "(untitled)").trim();
    const media = clips.filter((clip) => clip?.kind !== "collection").length;
    const row = { id, title, clips: clips.length, media, subs: childIdsOf(data).length };
    // The rule: empty AND named like scratch. Either alone is not enough.
    if (clips.length === 0 && SCRATCH_TITLE.test(title)) deletable.push(row);
    else keeping.push(row);
  }
  keeping.sort((a, b) => b.media - a.media || b.clips - a.clips);

  console.log(`collection:   ${COLLECTION}`);
  console.log(`documents:    ${documents.size}`);
  console.log(`unreachable:  ${deletable.length + keeping.length}`);
  console.log(`  deletable (empty + scratch name): ${deletable.length}`);
  console.log(`  KEEPING for review:               ${keeping.length}`);
  console.log("");

  if (keeping.length > 0) {
    console.log("KEEPING — unreachable but holding something. Not this script's job:");
    for (const row of keeping) {
      console.log(
        `  ${row.id.padEnd(32)} ${String(row.clips).padStart(3)}c ` +
          `${String(row.media).padStart(3)}m ${String(row.subs).padStart(2)}s  ${row.title}`,
      );
    }
    console.log("");
  }

  if (deletable.length === 0) {
    console.log("Nothing to prune.");
    return;
  }

  const byTitle = new Map();
  for (const row of deletable) byTitle.set(row.title, (byTitle.get(row.title) ?? 0) + 1);
  console.log(`${apply ? "Deleting" : "Would delete"} ${deletable.length} empty document(s):`);
  for (const [title, count] of [...byTitle].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${title}`);
  }
  console.log("");

  if (!apply) {
    console.log(dryRunNotice("prune:orphans", "PRUNE_APPLY"));
    return;
  }

  // Live only — refuseOfflineWrite above guarantees it, so the app is
  // initialized and this handle is safe to take.
  const db = getFirestore();

  // Firestore caps a batch at 500 writes; chunk well under it.
  const CHUNK = 200;
  let deleted = 0;
  for (let index = 0; index < deletable.length; index += CHUNK) {
    const slice = deletable.slice(index, index + CHUNK);
    const batch = db.batch();
    for (const row of slice) batch.delete(db.collection(COLLECTION).doc(row.id));
    await batch.commit();
    deleted += slice.length;
  }
  console.log(`Deleted ${deleted} document(s). Re-run audit:orphans to confirm the new total.`);
}

main().catch((error) => {
  console.error("Prune failed:", error.message);
  process.exitCode = 2;
});
