/**
 * Times the two ways to load a project's documents, back to back, live:
 * the BFS walk (batched per level — nine sequential round trips) and ONE query
 * on `ownerUid + projectId`.
 *
 *   node scripts/measure-project-query-vs-closure-walk.mjs <rootId>
 *
 * WHAT IT PROVES, and what it cannot. The query's document count must MATCH the
 * walk's, or the prefetch is not a prefetch — it is a different answer, and the
 * whole safety argument (a hint that can only cost latency) depends on the walk
 * remaining authoritative over it. A mismatch here means documents are unstamped
 * or mis-stamped, not that the walk is wrong.
 *
 * COSTS ONE CLOSURE OF READS PER RUN — ~150 on the project this was written
 * for, ~300 for the pair. Firestore bills per document returned, so the query
 * costs exactly what the walk does; only the round trips differ.
 */
import { config } from "dotenv";
import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

config({ path: ".env" });

const COLLECTION = "gstudioTimelineDocuments";
const CHUNK = 200;

const rootId = process.argv[2];
if (!rootId) {
  console.error("Usage: node scripts/measure-project-query-vs-closure-walk.mjs <rootId>");
  process.exit(2);
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
initializeApp(
  clientEmail && privateKey
    ? { credential: cert({ projectId, clientEmail, privateKey }), projectId }
    : { credential: applicationDefault(), projectId },
);
const db = getFirestore();

const childIds = (data) => {
  const clips = data?.document?.clips ?? data?.clips ?? [];
  return clips
    .filter((clip) => clip?.kind === "collection" && clip?.childTimelineId)
    .map((clip) => clip.childTimelineId);
};

/** The walk, batched per level — what ships today. */
async function walk() {
  const seen = new Set([rootId]);
  const found = new Set();
  let frontier = [rootId];
  let requests = 0;
  let levels = 0;
  let read = 0;

  while (frontier.length > 0) {
    levels += 1;
    const chunks = [];
    for (let at = 0; at < frontier.length; at += CHUNK) chunks.push(frontier.slice(at, at + CHUNK));
    requests += chunks.length;
    const results = await Promise.all(
      chunks.map((chunk) => db.getAll(...chunk.map((id) => db.collection(COLLECTION).doc(id)))),
    );
    const next = [];
    for (const snapshot of results.flat()) {
      read += 1;
      if (!snapshot.exists) continue;
      found.add(snapshot.id);
      for (const childId of childIds(snapshot.data())) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        next.push(childId);
      }
    }
    frontier = next;
  }
  return { found, requests, levels, read };
}

/** One query on the stamped hint. */
async function query(ownerUid) {
  const snapshot = await db
    .collection(COLLECTION)
    .where("ownerUid", "==", ownerUid)
    .where("projectId", "==", rootId)
    .get();
  const found = new Set(snapshot.docs.map((doc) => doc.id));
  return { found, requests: 1, levels: 1, read: snapshot.size };
}

const time = async (label, run) => {
  const started = Date.now();
  const result = await run();
  const elapsed = Date.now() - started;
  console.log(
    `${label.padEnd(12)} ${String(elapsed).padStart(6)}ms  ` +
      `${result.read} documents read  ${result.requests} request(s) over ${result.levels} sequential round(s)`,
  );
  return { elapsed, ...result };
};

// The walk FIRST, so the query cannot benefit from anything it warmed.
const walked = await time("walk", walk);
const root = await db.collection(COLLECTION).doc(rootId).get();
const ownerUid = root.data()?.ownerUid;
if (!ownerUid) {
  console.error(`No ownerUid on ${rootId} — cannot run the query half.`);
  process.exit(1);
}
const queried = await time("query", () => query(ownerUid));

const missing = [...walked.found].filter((id) => !queried.found.has(id));
const extra = [...queried.found].filter((id) => !walked.found.has(id));
console.log(
  `\nwalk found ${walked.found.size}, query found ${queried.found.size} — ` +
    `${missing.length} unstamped, ${extra.length} stamped but unreachable`,
);
if (missing.length > 0) {
  console.log(`  unstamped (the walk still fetches these): ${missing.slice(0, 10).join(", ")}`);
}
if (extra.length > 0) {
  console.log(`  stale hint (primed but not in the closure): ${extra.slice(0, 10).join(", ")}`);
}
console.log(
  `\n${walked.requests} requests over ${walked.levels} rounds -> ${queried.requests} over 1; ` +
    `${(walked.elapsed / queried.elapsed).toFixed(1)}x faster, ` +
    `${walked.read} reads vs ${queried.read} (the bill should not move)`,
);
