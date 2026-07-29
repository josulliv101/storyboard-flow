import "server-only";

import { getFirebaseDb } from "./firebase-admin";
import { assetRefKey, type AssetDeletionCandidate } from "./assets/asset-references";
import type { AssetKind, AssetSourceRef } from "./assets/types";

/**
 * Assets marked for deletion, and the 30 days they get to be un-marked in.
 *
 * A tombstone is an INTENTION, never an authority: the sweep re-checks
 * references before it deletes anything, so a mark placed by an imperfect scan
 * self-corrects if the asset is referenced again inside the window. That is
 * what the grace period buys beyond user forgiveness — it turns "the scan must
 * be right" into "the scan must be roughly right".
 *
 * DO NOT give this collection a Firestore TTL policy. This repo already uses
 * TTL (`mcpOAuthCodes`, `mcpOAuthRefreshTokens` in `firestore.indexes.json`)
 * and reaching for it here is the obvious mistake: TTL would expire the RECORD
 * at day 30 and leave the FILE forever — the exact inverse of the job. A
 * tombstone must outlive its own deadline until a sweeper honours it and
 * removes it deliberately.
 */
const TOMBSTONE_COLLECTION = "gstudioAssetTombstones";

/** How long a marked asset survives before the sweep may delete it. */
export const ASSET_DELETE_GRACE_DAYS = 30;
const GRACE_MS = ASSET_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** Firestore's WriteBatch ceiling. */
const BATCH_LIMIT = 500;

export type AssetTombstone = Readonly<{
  ref: AssetSourceRef;
  kind: AssetKind;
  /** Display snapshot, taken at mark time — see `AssetDeletionCandidate`.
   *  Nothing looks anything up with these. */
  name: string;
  thumbnailUrl: string;
  ownerUid: string;
  markedAtMs: number;
  /** Epoch millis after which the sweep may delete. Stored as a NUMBER rather
   *  than a Timestamp: it is only ever compared, it queries identically, and it
   *  survives every serialization boundary between here and a cron job. */
  deleteAfterMs: number;
}>;

type TombstoneRecord = {
  providerId?: string;
  assetId?: string;
  kind?: string;
  name?: string;
  thumbnailUrl?: string;
  ownerUid?: string;
  markedAtMs?: number;
  deleteAfterMs?: number;
};

function tombstones() {
  return getFirebaseDb().collection(TOMBSTONE_COLLECTION);
}

/**
 * The document id: owner, then the asset ref key, every part percent-encoded
 * and joined with "|".
 *
 * Scoped by OWNER even though asset ids are already per-user in both installed
 * providers — a tombstone is a statement about one person's library, and an id
 * that can only ever describe one is the cheap way to keep it that way.
 */
function tombstoneId(ownerUid: string, ref: AssetSourceRef): string {
  return `${encodeURIComponent(ownerUid)}|${assetRefKey(ref)}`;
}

function toTombstone(data: TombstoneRecord): AssetTombstone | null {
  const { providerId, assetId, kind, name, thumbnailUrl, ownerUid, markedAtMs, deleteAfterMs } =
    data;
  if (typeof providerId !== "string" || typeof assetId !== "string") return null;
  if (kind !== "image" && kind !== "video") return null;
  if (typeof ownerUid !== "string" || ownerUid.length === 0) return null;
  if (typeof deleteAfterMs !== "number" || typeof markedAtMs !== "number") return null;
  return {
    ref: { providerId, assetId },
    kind,
    // The DISPLAY fields are the only ones allowed to be missing without
    // voiding the record: a tombstone written before they existed still names
    // a real file with a real deadline, and the sweep needs nothing else. A
    // row with no snapshot prints its id's leaf instead of disappearing.
    name: typeof name === "string" && name.length > 0 ? name : assetId,
    thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl : "",
    ownerUid,
    markedAtMs,
    deleteAfterMs,
  };
}

/**
 * Mark assets for deletion, `ASSET_DELETE_GRACE_DAYS` from now.
 *
 * Idempotent by document id, and a re-mark RESTARTS the clock rather than
 * preserving the original deadline. That is the correct reading rather than a
 * shortcut: a tombstone is cleared the moment anything references the asset
 * again, so a second mark means it became unreferenced a second time, and the
 * grace period is measured from that.
 */
export async function markAssetsForDeletion(
  ownerUid: string,
  candidates: readonly AssetDeletionCandidate[],
  now: number = Date.now(),
): Promise<number> {
  if (candidates.length === 0) return 0;
  const db = getFirebaseDb();
  for (let start = 0; start < candidates.length; start += BATCH_LIMIT) {
    const batch = db.batch();
    for (const candidate of candidates.slice(start, start + BATCH_LIMIT)) {
      batch.set(tombstones().doc(tombstoneId(ownerUid, candidate.ref)), {
        providerId: candidate.ref.providerId,
        assetId: candidate.ref.assetId,
        kind: candidate.kind,
        name: candidate.name,
        thumbnailUrl: candidate.thumbnailUrl,
        ownerUid,
        markedAtMs: now,
        deleteAfterMs: now + GRACE_MS,
      });
    }
    await batch.commit();
  }
  return candidates.length;
}

/** Un-mark — what restoring from the bin does, and what the sweep does to an
 *  asset that got referenced again. The file never moved during the window, so
 *  this is bookkeeping and not a re-upload. */
export async function clearAssetTombstones(
  ownerUid: string,
  refs: readonly AssetSourceRef[],
): Promise<number> {
  if (refs.length === 0) return 0;
  const db = getFirebaseDb();
  for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
    const batch = db.batch();
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) {
      batch.delete(tombstones().doc(tombstoneId(ownerUid, ref)));
    }
    await batch.commit();
  }
  return refs.length;
}

/** One user's marked assets — what the trash drawer's recently-deleted section
 *  reads (PL12-004). */
export async function listAssetTombstones(
  ownerUid: string,
): Promise<readonly AssetTombstone[]> {
  const snapshot = await tombstones().where("ownerUid", "==", ownerUid).get();
  return snapshot.docs.flatMap((doc) => {
    const tombstone = toTombstone(doc.data() as TombstoneRecord);
    return tombstone === null ? [] : [tombstone];
  });
}

/**
 * Tombstones whose grace period has run out, oldest deadline first.
 *
 * A single-field inequality — served by Firestore's automatic index, so this
 * needs no deploy. The limit is the sweep's batch size, not a filter: what it
 * does not reach stays due and is taken by the next run.
 */
export async function listDueAssetTombstones(
  now: number = Date.now(),
  limit = 200,
): Promise<readonly AssetTombstone[]> {
  const snapshot = await tombstones()
    .where("deleteAfterMs", "<=", now)
    .orderBy("deleteAfterMs")
    .limit(limit)
    .get();
  return snapshot.docs.flatMap((doc) => {
    const tombstone = toTombstone(doc.data() as TombstoneRecord);
    return tombstone === null ? [] : [tombstone];
  });
}
