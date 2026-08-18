/**
 * Remove collection clips that point at a document which does not exist.
 *
 * A dangling `childTimelineId` is what the cascade delete used to leave behind:
 * it walks DOWN and removes a subtree, and never asked who pointed INTO it, so
 * a reference from outside survived its target. `TimelineInboundReferenceError`
 * stops new ones; this clears the ones already stored.
 *
 * They are not inert. The card still draws, and until the readout learned to
 * count a missing child as zero, each one contributed its remembered duration —
 * five of them added 33.9s of footage that does not exist to one collection.
 *
 * DRY RUN BY DEFAULT. Prints what it would remove and changes nothing; pass
 * `--apply` to write. `--fixture` operates on the local fixture file instead of
 * Firestore, which is how this was verified.
 *
 *   node scripts/remove-dangling-collection-references.ts <rootId> [--fixture] [--apply]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { packTimelineClips } from "@storyboard/timeline-model";
import type { TimelineDocument } from "@storyboard/timeline-model/types";

config({ path: ".env" });

const COLLECTION = "gstudioTimelineDocuments";
const FIRESTORE_BATCH_LIMIT = 500;

const rootId = process.argv[2] ?? "";
const apply = process.argv.includes("--apply");
const useFixture = process.argv.includes("--fixture");
if (!rootId) {
  console.error(
    "Usage: node scripts/remove-dangling-collection-references.ts <rootId> [--fixture] [--apply]",
  );
  process.exit(2);
}

type Loaded = { documents: Map<string, TimelineDocument>; fixturePath?: string; raw?: unknown };

async function load(): Promise<Loaded> {
  if (useFixture) {
    const path = process.env.GSTUDIO_FIXTURE_TIMELINES ?? "fixtures/local.json";
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      documents: Record<string, TimelineDocument>;
    };
    return { documents: new Map(Object.entries(raw.documents)), fixturePath: path, raw };
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, "\n");
  initializeApp(
    clientEmail && privateKey
      ? { credential: cert({ projectId, clientEmail, privateKey }), projectId }
      : { credential: applicationDefault(), projectId },
  );
  const db = getFirestore();
  // BY PROJECT, one query — the same field that made the delete-time check
  // affordable. A closure walk would cost one read per document instead.
  const snapshot = await db
    .collection(COLLECTION)
    .where("projectId", "==", rootId)
    .get();
  const documents = new Map<string, TimelineDocument>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as { document?: TimelineDocument; clips?: TimelineDocument["clips"] };
    const document = data.document ?? { id: doc.id, title: "", clips: data.clips ?? [] };
    documents.set(doc.id, document);
  }
  // The root itself carries its own id as projectId only if stamped; fetch it
  // directly so a partially stamped project still reports honestly.
  if (!documents.has(rootId)) {
    const root = await db.collection(COLLECTION).doc(rootId).get();
    if (root.exists) {
      const data = root.data() as { document?: TimelineDocument };
      if (data.document) documents.set(rootId, data.document);
    }
  }
  return { documents };
}

async function main(): Promise<void> {
  const { documents, fixturePath, raw } = await load();
  if (!documents.has(rootId)) {
    console.error(`No document "${rootId}" (loaded ${documents.size}).`);
    process.exit(1);
  }

  /** Every document reachable from the root, so a dangling id elsewhere in the
   *  workspace is not silently swept up by a project-scoped run. */
  const reachable = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const clip of documents.get(id)?.clips ?? []) {
      if (clip.kind !== "collection" || !clip.childTimelineId) continue;
      if (reachable.has(clip.childTimelineId)) continue;
      reachable.add(clip.childTimelineId);
      queue.push(clip.childTimelineId);
    }
  }

  const edits = new Map<string, TimelineDocument>();
  let removed = 0;
  for (const id of reachable) {
    const document = documents.get(id);
    if (!document) continue;
    const dangling = document.clips.filter(
      (clip) => clip.kind === "collection" && clip.childTimelineId && !documents.has(clip.childTimelineId),
    );
    if (dangling.length === 0) continue;
    for (const clip of dangling) {
      console.log(
        `  "${document.title}" (${id}) -> "${clip.title}" (${
          clip.kind === "collection" ? clip.childTimelineId : ""
        }) — no document`,
      );
      removed += 1;
    }
    const keep = document.clips.filter((clip) => !dangling.includes(clip));
    // REPACKED with the model's own function, never re-derived here: the packing
    // math has a twin in the graph adapter and the two drifting is exactly the
    // bug the adapter's comments warn about.
    edits.set(id, { ...document, clips: packTimelineClips(keep) });
  }

  console.log(
    `\n${removed} dangling reference(s) across ${edits.size} document(s), ` +
      `from ${reachable.size} reachable.`,
  );
  if (removed === 0) process.exit(0);
  if (!apply) {
    console.log("DRY RUN — nothing written. Re-run with --apply to remove them.");
    process.exit(0);
  }

  if (useFixture && fixturePath) {
    const next = raw as { documents: Record<string, TimelineDocument> };
    for (const [id, document] of edits) next.documents[id] = document;
    writeFileSync(fixturePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Wrote ${edits.size} document(s) to ${fixturePath}.`);
  } else {
    const db = getFirestore();
    const entries = [...edits.entries()];
    for (let i = 0; i < entries.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = db.batch();
      for (const [id, document] of entries.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
        // Both shapes, because readers resolve from either — see
        // `toTimelineDocument`'s precedence.
        batch.set(
          db.collection(COLLECTION).doc(id),
          { document, clips: document.clips },
          { merge: true },
        );
      }
      await batch.commit();
    }
    console.log(`Wrote ${edits.size} document(s).`);
  }
}

// CommonJS via ts-node (the workspace packages use extensionless imports,
// which plain-node ESM will not resolve), so no top-level await.
void main();
