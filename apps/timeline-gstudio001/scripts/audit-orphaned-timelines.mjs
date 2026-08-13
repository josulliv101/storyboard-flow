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
//   npm run audit:orphans -- --offline       re-read the last snapshot, ZERO reads
//   npm run audit:orphans -- --assets        also: would deleting them lose anything?
//
// A LIVE RUN IS NOT FREE, and this is why --offline exists. Every run is a
// full-collection `.get()` — one document read per document, ~300-400 here.
// That is invisible at the call site and cumulative: a single review session
// that ran this, the prune's dry run, and a few one-off analysis scripts
// twenty-odd times exhausted the project's daily free-tier read quota, and the
// LIVE APP went down with `RESOURCE_EXHAUSTED` for the rest of the day.
//
// So every live run now writes what it read to a snapshot, at no extra cost,
// and --offline answers the same questions from that file. Every follow-up
// question in that session — how many orphans hold media, which assets are
// unique to them, does the arithmetic reconcile — was answerable from ONE
// scan. Re-scanning to confirm a number you already have is the mistake.
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

import { readFileSync, writeFileSync } from "node:fs";
import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";
const listAll = process.argv.includes("--list");
const offline = process.argv.includes("--offline");
const withAssets = process.argv.includes("--assets");
const uidIndex = process.argv.indexOf("--uid");
const onlyUid = uidIndex === -1 ? null : process.argv[uidIndex + 1];
const snapshotIndex = process.argv.indexOf("--snapshot");
const SNAPSHOT_PATH =
  snapshotIndex === -1 ? ".orphan-snapshot.json" : process.argv[snapshotIndex + 1];

/**
 * The subset of a document this audit reasons about. Deliberately NOT the raw
 * document: the snapshot exists to be re-read many times, and the media `src`
 * strings alone are most of the payload. Everything below is needed —
 * `clips` for reachability and counts, `src` for the --assets cross-reference.
 */
function toSnapshotEntry(data) {
  return {
    title: data?.title ?? null,
    ownerUid: data?.ownerUid ?? null,
    isProject: data?.isProject === true,
    clips: clipsOf(data).map((clip) => ({
      kind: clip?.kind ?? null,
      childTimelineId: clip?.childTimelineId ?? null,
      src: clip?.src ?? clip?.assetId ?? null,
    })),
  };
}

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

/** A clip's asset identity, or null when it names none. Collection clips have
 *  no src — they are the edges of the graph, not its payload. */
function srcOf(clip) {
  const value = clip?.src ?? clip?.assetId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The documents, from Firestore or from the last snapshot.
 *
 * A live read always writes the snapshot back. That costs nothing — the data
 * is already in hand — and it means the NEXT question can be asked for free
 * instead of re-reading the collection.
 */
async function loadDocuments() {
  if (offline) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    } catch (error) {
      console.error(`No usable snapshot at ${SNAPSHOT_PATH}: ${error.message}`);
      console.error("Run the audit live once (without --offline) to create one.");
      process.exitCode = 2;
      return null;
    }
    return {
      documents: new Map(Object.entries(raw.documents ?? {})),
      takenAt: raw.takenAt ?? "unknown",
      forUid: raw.forUid ?? null,
    };
  }

  initializeApp(credential());
  const db = getFirestore();
  const query = onlyUid
    ? db.collection(COLLECTION).where("ownerUid", "==", onlyUid)
    : db.collection(COLLECTION);
  const snapshot = await query.get();

  const documents = new Map();
  snapshot.forEach((doc) => documents.set(doc.id, doc.data()));

  const takenAt = new Date().toISOString();
  try {
    writeFileSync(
      SNAPSHOT_PATH,
      JSON.stringify({
        takenAt,
        forUid: onlyUid,
        documents: Object.fromEntries(
          [...documents].map(([id, data]) => [id, toSnapshotEntry(data)]),
        ),
      }),
    );
  } catch (error) {
    // Never fail the audit over the cache.
    console.error(`(could not write ${SNAPSHOT_PATH}: ${error.message})`);
  }
  return { documents, takenAt, forUid: onlyUid };
}

async function main() {
  const loaded = await loadDocuments();
  if (loaded === null) return;
  const { documents, takenAt } = loaded;

  if (offline) {
    // Say it loudly. An offline run answering a question about live data is
    // only safe if the reader knows how old the answer is — and the whole
    // point of the mode is that it will be re-run many times.
    console.log(`SNAPSHOT from ${takenAt} — no reads. Live state may differ.`);
    if (loaded.forUid !== null) console.log(`snapshot covers only uid ${loaded.forUid}`);
    console.log("");
  }

  const roots = [...documents.entries()]
    .filter(([id, data]) => data?.isProject === true || isTrashBin(id))
    .map(([id]) => id);

  // Breadth-first from every root. A child appearing under two parents is
  // legal (duplicate-reference cards), so `seen` is what keeps this linear and
  // cycle-proof rather than a tree walk.
  //
  // A childTimelineId can name a document that does not exist — the mirror
  // image of an orphan, and just as invisible: the parent shows a collection
  // card that opens onto nothing. Those ids are recorded separately and kept
  // OUT of `reachable`, which otherwise counts them and reports more reachable
  // documents than the collection contains.
  const reachable = new Set();
  const dangling = new Map();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const childId of childIdsOf(documents.get(id))) {
      if (!documents.has(childId)) {
        if (!dangling.has(childId)) dangling.set(childId, []);
        dangling.get(childId).push(id);
        continue;
      }
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
  console.log(`DANGLING refs:     ${dangling.size} (parent points at a document that does not exist)`);
  console.log("");

  // These three plus the dangling count must account for every document. If
  // they do not, the walk is wrong and so is everything below it.
  const accounted = reachable.size + stranded.length + library.length;
  if (accounted !== documents.size) {
    console.log(`INTERNAL: ${accounted} accounted for vs ${documents.size} documents — the`);
    console.log("walk is inconsistent. Do not act on the list below.");
    console.log("");
    process.exitCode = 2;
    return;
  }

  if (dangling.size > 0) {
    console.log("Referenced as a child, but no such document exists. The parent shows a");
    console.log("collection card that opens onto nothing:");
    for (const [childId, parents] of dangling) {
      console.log(`  ${childId}  referenced by ${parents.join(", ")}`);
    }
    console.log("");
  }

  if (stranded.length === 0) {
    console.log("Every document is reachable from a project or the trash.");
    return;
  }

  // The question anyone actually has before deleting these: would it lose
  // anything? An orphaned collection is a GROUPING, not the footage — if every
  // asset it holds is also reachable elsewhere, binning it costs an
  // arrangement. If not, that document is the last handle on the asset.
  //
  // This decided the real case: 49 unreachable documents holding 90 media
  // clips, and ZERO assets held only by an orphan — which is what made a bulk
  // sweep safe rather than merely plausible. Worth having in the tool that
  // reports the orphans, instead of a throwaway script written under pressure.
  if (withAssets) {
    const safe = new Set();
    for (const [id, data] of documents) {
      if (!reachable.has(id) && !isAssetLibrary(id)) continue;
      for (const clip of clipsOf(data)) {
        const src = srcOf(clip);
        if (src !== null) safe.add(src);
      }
    }
    const orphanOnly = new Map();
    for (const [id, data] of documents) {
      if (reachable.has(id) || isAssetLibrary(id)) continue;
      for (const clip of clipsOf(data)) {
        if (clip?.kind === "collection") continue;
        const src = srcOf(clip);
        if (src !== null && !safe.has(src)) {
          if (!orphanOnly.has(src)) orphanOnly.set(src, []);
          orphanOnly.get(src).push(id);
        }
      }
    }
    console.log(`assets reachable elsewhere:            ${safe.size}`);
    console.log(`DISTINCT assets held only by an orphan: ${orphanOnly.size}`);
    if (orphanOnly.size === 0) {
      console.log("  Deleting the orphans below would lose arrangements, not footage.");
    } else {
      console.log("  These have no other handle — re-file before deleting anything:");
      for (const [src, holders] of orphanOnly) {
        console.log(`    ${src}`);
        console.log(`      held by ${holders.join(", ")}`);
      }
    }
    console.log("");
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
