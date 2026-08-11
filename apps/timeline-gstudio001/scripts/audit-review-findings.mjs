#!/usr/bin/env node
// Reachability audit for two findings a full-repo review filed with an
// explicit confidence limit. Both are confirmed defects in the CODE; what
// neither could establish by reading is whether the stored data can reach
// them. This measures that, so each issue can be prioritised or closed on
// evidence rather than on argument.
//
// READ ONLY: it never writes, claims, or deletes.
//
// Lives in this workspace because firebase-admin is installed here, not at the
// repo root — a root-level script cannot resolve it. Same credential inputs as
// lib/firebase-admin.ts and audit-ownerless-timelines.mjs.
//
//   npm run audit:review-findings --workspace=apps/timeline-gstudio001
//   npm run audit:review-findings --workspace=apps/timeline-gstudio001 -- --list
//
// ── #338: cascade delete reads a narrower clip source than every other reader
//
// `toTimelineDocument` resolves a record's clips from three places in
// precedence order — `document.clips`, the legacy top-level `clips`, and the
// `lastNonEmptyDocument` recovery snapshot — and `collectOwnedTimelineClips`
// deliberately unions all three. `deleteFirebaseTimelineDocument` reads only
// `data.document?.clips`, so a record whose live clips resolve from either of
// the other two has its collection children skipped by the cascade: they
// survive as orphans, unreachable but still counted as live asset references,
// so their media is never eligible for reclaim and there is no path left to
// reach them.
//
//   0 divergent    Latent. Every record's `document.clips` agrees with what
//                  the other readers would return, so the cascade currently
//                  sees everything. Worth fixing anyway — the three readers
//                  should share one definition — but not urgent.
//   > 0 divergent  Live. Deleting any listed record ORPHANS the child
//                  timelines named in the report. Fix before the next delete.
//
// ── #342: GET seeds demo fixtures into global, non-user-scoped ids
//
// `GET /api/timelines/[id]` falls back to a UI-package demo fixture and
// PERSISTS it under the requested id, owned by whoever asked. Those ids are
// short and shared (`root`, `single`, `promo`…), and `checkUserScopedId`
// does not recognise them, so the first user to open one takes it for the
// whole deployment; every other user gets a permanent 404 with no recovery.
//
//   0 seeded       Latent. No demo id has been claimed yet.
//   > 0 seeded     Live. Each listed id is already owned. If more than one
//                  distinct uid appears across the deployment, other users
//                  are ALREADY getting 404s for those ids.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";

// Must track the ids in packages/ui/timeline/timeline-documents.ts that
// `getTimelineDocument` can return — the exact set the GET fallback can seed.
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

const listAll = process.argv.includes("--list");

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

/**
 * The clips the CASCADE sees, versus the clips every OTHER reader sees.
 *
 * Mirrors `toTimelineDocument`'s precedence exactly: a non-empty
 * `document.clips` wins; else a non-empty top-level `clips`; else the
 * recovery snapshot. The cascade's own view is `document.clips` alone.
 */
function clipSources(data) {
  const nested = clipsOf(data.document);
  const topLevel = Array.isArray(data.clips) ? data.clips : null;
  const recovery = clipsOf(data.lastNonEmptyDocument);

  const cascadeSees = nested ?? [];
  let effective;
  if (nested && nested.length > 0) effective = nested;
  else if (topLevel && topLevel.length > 0) effective = topLevel;
  else if (recovery) effective = recovery;
  else effective = nested ?? topLevel ?? [];

  return { cascadeSees, effective };
}

const childIds = (clips) =>
  clips
    .filter((clip) => clip?.kind === "collection" && typeof clip.childTimelineId === "string")
    .map((clip) => clip.childTimelineId);

function toIso(value) {
  if (!value) return "unknown";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value);
}

async function main() {
  initializeApp(credential());
  const db = getFirestore();

  const snapshot = await db.collection(COLLECTION).get();

  const divergent = [];
  const seededFixtures = [];
  const fixtureOwners = new Set();

  snapshot.forEach((doc) => {
    const data = doc.data();

    // #338 — children the cascade would miss.
    const { cascadeSees, effective } = clipSources(data);
    const seen = new Set(childIds(cascadeSees));
    const missed = childIds(effective).filter((id) => !seen.has(id));
    if (missed.length > 0) {
      divergent.push({
        id: doc.id,
        title: data.title ?? "(untitled)",
        hasDocumentField: data.document !== undefined,
        missed,
        updatedAt: toIso(data.updatedAt),
      });
    }

    // #342 — a demo fixture id that has been claimed.
    if (FIXTURE_IDS.has(doc.id)) {
      seededFixtures.push({
        id: doc.id,
        ownerUid: data.ownerUid ?? "(ownerless)",
        isProject: data.isProject === true,
        updatedAt: toIso(data.updatedAt),
      });
      if (data.ownerUid) fixtureOwners.add(data.ownerUid);
    }
  });

  console.log(`collection:  ${COLLECTION}`);
  console.log(`documents:   ${snapshot.size}`);
  console.log("");

  console.log("── #338  cascade-delete clip source ──────────────────────────");
  console.log(`records whose children the cascade would MISS: ${divergent.length}`);
  if (divergent.length === 0) {
    console.log("LATENT. Every record's `document.clips` already names every");
    console.log("collection child the other readers would find, so no delete");
    console.log("can orphan anything today. Still worth making the three");
    console.log("readers share one definition before that stops being true.");
  } else {
    console.log("LIVE. Deleting any record below ORPHANS the children named:");
    for (const entry of divergent.slice(0, listAll ? Infinity : 20)) {
      console.log(
        `  ${entry.id}  (${entry.title})  document field: ${entry.hasDocumentField ? "present" : "ABSENT"}`,
      );
      console.log(`    would orphan: ${entry.missed.join(", ")}`);
    }
    if (!listAll && divergent.length > 20) {
      console.log(`  … and ${divergent.length - 20} more (pass --list)`);
    }
  }
  console.log("");

  console.log("── #342  demo-fixture id squatting ──────────────────────────");
  console.log(`fixture ids already claimed: ${seededFixtures.length} of ${FIXTURE_IDS.size}`);
  if (seededFixtures.length === 0) {
    console.log("LATENT. No demo id has been seeded, so nobody is being 404'd");
    console.log("yet. The GET fallback can still claim one on the next request.");
  } else {
    console.log(`distinct owners holding them: ${fixtureOwners.size}`);
    for (const entry of seededFixtures) {
      console.log(
        `  ${entry.id}  owner ${entry.ownerUid}  ${entry.isProject ? "project" : "child"}  ${entry.updatedAt}`,
      );
    }
    console.log("");
    console.log("Every OTHER user asking for these ids gets 404, permanently.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
