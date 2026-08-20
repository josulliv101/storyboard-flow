/**
 * Times the closure walk BOTH ways against the live database: one `get()` per
 * document at concurrency 12 (what the walk did), and chunked `getAll` (what it
 * does now). Same root, same order, back to back.
 *
 * WHAT IT IS MEASURING, and what it is not. The change is transport only —
 * Firestore bills per document returned, so both runs read the same documents
 * and cost the same. The script prints both counts precisely so that claim can
 * be checked rather than asserted: a difference in DOCUMENTS would mean the
 * walk changed shape, which is a bug, not a speedup.
 *
 * COSTS ONE CLOSURE OF READS PER RUN — ~150 on the project this was written
 * for, ~300 for the pair. It is a benchmark against production data; run it
 * deliberately, not in a loop (see the quota note in timeline-snapshot.mjs).
 *
 *   node scripts/measure-closure-batched-vs-per-document-reads.mjs <rootId> [--repeat 2]
 */
import { config } from "dotenv";
import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

config({ path: ".env" });

const COLLECTION = "gstudioTimelineDocuments";
/** Mirrors READ_CONCURRENCY in lib/load-timeline-closure.ts. */
const READ_CONCURRENCY = 12;
/** Mirrors MAX_BATCH_READ_DOCUMENTS in lib/firebase-timeline-store.ts. */
const CHUNK = 200;

const rootId = process.argv[2];
if (!rootId) {
  console.error("Usage: node scripts/measure-closure-batched-vs-per-document-reads.mjs <rootId>");
  process.exit(2);
}
const repeatIndex = process.argv.indexOf("--repeat");
const repeat = repeatIndex === -1 ? 1 : Number(process.argv[repeatIndex + 1]);

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

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}

/** The walk, parameterised by how one LEVEL is fetched. Everything else —
 *  ordering, the seen set, how children are queued — is identical, so the only
 *  difference between the two runs is the number of requests. */
async function walk(readLevel) {
  const seen = new Set([rootId]);
  let documents = 0;
  let missing = 0;
  let requests = 0;
  let frontier = [rootId];
  let levels = 0;

  while (frontier.length > 0) {
    levels += 1;
    const { snapshots, calls } = await readLevel(frontier);
    requests += calls;
    const next = [];
    for (const snapshot of snapshots) {
      if (!snapshot.exists) {
        missing += 1;
        continue;
      }
      documents += 1;
      for (const childId of childIds(snapshot.data())) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        next.push(childId);
      }
    }
    frontier = next;
  }
  return { documents, missing, requests, levels, read: documents + missing };
}

const perDocument = (ids) =>
  mapWithConcurrency(ids, READ_CONCURRENCY, (id) => db.collection(COLLECTION).doc(id).get()).then(
    (snapshots) => ({ snapshots, calls: ids.length }),
  );

const batched = async (ids) => {
  const chunks = [];
  for (let index = 0; index < ids.length; index += CHUNK) {
    chunks.push(ids.slice(index, index + CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) => db.getAll(...chunk.map((id) => db.collection(COLLECTION).doc(id)))),
  );
  return { snapshots: results.flat(), calls: chunks.length };
};

const time = async (label, readLevel) => {
  const started = Date.now();
  const result = await walk(readLevel);
  const elapsed = Date.now() - started;
  console.log(
    `${label.padEnd(14)} ${String(elapsed).padStart(6)}ms  ` +
      `${result.read} documents read (${result.documents} found, ${result.missing} missing)  ` +
      `${result.requests} requests over ${result.levels} levels`,
  );
  return { elapsed, ...result };
};

for (let run = 1; run <= repeat; run += 1) {
  if (repeat > 1) console.log(`--- run ${run} ---`);
  // Per-document FIRST so it cannot benefit from anything the batched run warms.
  const before = await time("per-document", perDocument);
  const after = await time("batched", batched);
  const sameReads = before.read === after.read;
  console.log(
    `${sameReads ? "SAME" : "DIFFERENT"} read count (${before.read} vs ${after.read}); ` +
      `${before.requests} requests -> ${after.requests}; ` +
      `${(before.elapsed / after.elapsed).toFixed(1)}x faster`,
  );
  if (!sameReads) process.exitCode = 1;
}
