// Shared plumbing for the three timeline scripts: audit:orphans,
// prune:orphans and bin:orphans.
//
// WHY THIS EXISTS. All three begin the same way — read every document in the
// collection, walk reachability from the project roots and the trash — and all
// three had their own copy of that code. Three copies is three chances for the
// walks to disagree about what "reachable" means, which is exactly the
// disagreement that would make one script delete what another considers live.
//
// And all three paid the same cost. A full-collection `.get()` is one read per
// document, ~350 here, invisible at the call site. The audit, the prune's dry
// run, and a few one-off scripts, run twenty-odd times in one review session,
// exhausted the project's daily free-tier read quota and took the live app
// down with RESOURCE_EXHAUSTED for the remainder of the day. A dry run reading
// the whole collection to tell you what it WOULD do is the clearest case of a
// read that did not need to be live.
//
// So: one walk, one snapshot, and an --offline mode any of them can use.

import { readFileSync, writeFileSync } from "node:fs";
import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/** Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts. */
export const COLLECTION = "gstudioTimelineDocuments";

export const isTrashBin = (id) => id.startsWith("trash-");
export const isAssetLibrary = (id) => id.startsWith("asset-library");

/**
 * The stored clips, from whichever field carries them.
 *
 * `document.clips` is the live copy and `clips` the denormalized one; they
 * agree in practice, but a record written by an older path may only have the
 * latter. A snapshot entry stores its clips flat, so the same fallback reads
 * both shapes and callers never care which they hold.
 *
 * `lastNonEmptyDocument` is deliberately NOT consulted — it is a recovery
 * snapshot of content since removed, and treating it as a reference would
 * report a genuinely emptied parent as still holding its children.
 */
export function clipsOf(data) {
  if (Array.isArray(data?.document?.clips)) return data.document.clips;
  if (Array.isArray(data?.clips)) return data.clips;
  return [];
}

export function childIdsOf(data) {
  const ids = [];
  for (const clip of clipsOf(data)) {
    if (clip?.kind !== "collection") continue;
    if (typeof clip.childTimelineId !== "string") continue;
    ids.push(clip.childTimelineId);
  }
  return ids;
}

/** A clip's asset identity, or null when it names none. Collection clips have
 *  no src — they are the edges of the graph, not its payload. */
export function srcOf(clip) {
  const value = clip?.src ?? clip?.assetId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Breadth-first from every root. A child appearing under two parents is legal
 * (duplicate-reference cards), so `seen` is what keeps this linear and
 * cycle-proof rather than a tree walk.
 *
 * A childTimelineId can name a document that does not exist — the mirror image
 * of an orphan, and just as invisible: the parent shows a collection card that
 * opens onto nothing. Those ids are recorded separately and kept OUT of
 * `reachable`, which otherwise reports more reachable documents than the
 * collection contains.
 *
 * WHAT COUNTS AS A ROOT, and why the answer depends on it:
 *   projects (`isProject === true`)  the real entry points.
 *   trash bins (`trash-<uid>`)       a trashed item is reachable and
 *                                    restorable BY DESIGN, so its subtree is
 *                                    not orphaned. Counting the bin as a root
 *                                    keeps "in the bin" separate from "lost".
 */
export function walkReachable(documents) {
  const roots = [...documents.entries()]
    .filter(([id, data]) => data?.isProject === true || isTrashBin(id))
    .map(([id]) => id);

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
  return { roots, reachable, dangling };
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

/** The `--offline` / `--snapshot <path>` pair, read the same way everywhere. */
export function snapshotFlags(argv = process.argv) {
  const index = argv.indexOf("--snapshot");
  return {
    offline: argv.includes("--offline"),
    snapshotPath: index === -1 ? ".orphan-snapshot.json" : argv[index + 1],
  };
}

/**
 * The subset of a document these scripts reason about. Deliberately NOT the
 * raw document: the snapshot exists to be re-read many times, and the media
 * `src` strings alone are most of the payload.
 */
function toSnapshotEntry(data) {
  return {
    title: data?.title ?? null,
    ownerUid: data?.ownerUid ?? null,
    isProject: data?.isProject === true,
    revision: typeof data?.revision === "number" ? data.revision : null,
    clips: clipsOf(data).map((clip) => ({
      kind: clip?.kind ?? null,
      childTimelineId: clip?.childTimelineId ?? null,
      src: srcOf(clip),
      duration: typeof clip?.duration === "number" ? clip.duration : null,
      // Carried so `correct:aspects` can dry-run offline. A snapshot taken
      // before this line has no `aspect` KEY at all, which is why that script
      // tests for the key rather than for undefined — "the snapshot cannot
      // answer this" and "the clip stores nothing" are different answers.
      ...(typeof clip?.aspect === "number" ? { aspect: clip.aspect } : {}),
    })),
  };
}

/**
 * The documents, from Firestore or from the last snapshot.
 *
 * A live read always writes the snapshot back. That costs nothing — the data
 * is already in hand — and it means the NEXT question can be asked for free
 * instead of re-reading the collection.
 *
 * Returns null (having printed why, and set a non-zero exit code) when
 * --offline is asked for and no snapshot exists.
 */
export async function loadDocuments({ offline, snapshotPath, onlyUid = null }) {
  if (offline) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(snapshotPath, "utf8"));
    } catch (error) {
      console.error(`No usable snapshot at ${snapshotPath}: ${error.message}`);
      console.error("Run it live once (without --offline) to create one.");
      process.exitCode = 2;
      return null;
    }
    return {
      documents: new Map(Object.entries(raw.documents ?? {})),
      takenAt: raw.takenAt ?? "unknown",
      forUid: raw.forUid ?? null,
      live: false,
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
      snapshotPath,
      JSON.stringify({
        takenAt,
        forUid: onlyUid,
        documents: Object.fromEntries(
          [...documents].map(([id, data]) => [id, toSnapshotEntry(data)]),
        ),
      }),
    );
  } catch (error) {
    // Never fail over the cache.
    console.error(`(could not write ${snapshotPath}: ${error.message})`);
  }
  return { documents, takenAt, forUid: onlyUid, live: true };
}

/**
 * The line an offline run leads with. A stale answer presented as a live one
 * would be worse than the reads it saves, so this is not optional — and it
 * carries the timestamp, because "how old" is the only thing that decides
 * whether the answer can be acted on.
 */
export function announceSnapshot(loaded) {
  if (loaded.live) return;
  console.log(`SNAPSHOT from ${loaded.takenAt} — no reads. Live state may differ.`);
  if (loaded.forUid !== null) console.log(`snapshot covers only uid ${loaded.forUid}`);
  console.log("");
}

/**
 * Refuse to WRITE from a snapshot.
 *
 * The whole value of --offline is that the data is old, and every one of these
 * scripts decides what to destroy from exactly the data it just read. Applying
 * a delete computed from a stale snapshot would act on a graph that has since
 * changed — deleting something re-filed in the meantime, or missing something
 * newly orphaned. Reading stale is a saving; writing stale is a bug with the
 * same shape as the accident these scripts exist to clean up after.
 */
export function refuseOfflineWrite({ offline, apply, script }) {
  if (!offline || !apply) return false;
  console.error("REFUSING: --offline is for dry runs only.");
  console.error("");
  console.error(`--apply decides what to change from the data it just read, and a`);
  console.error(`snapshot is by definition out of date. Acting on one could touch a`);
  console.error(`document that has been re-filed since, or miss one newly orphaned.`);
  console.error("");
  console.error(`Run \`npm run ${script} -- --apply\` against live data instead.`);
  process.exitCode = 2;
  return true;
}
