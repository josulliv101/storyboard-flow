import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  clearAssetTombstones,
  listDueAssetTombstones,
  type AssetTombstone,
} from "@/lib/asset-tombstones";
import { assetKeysFromClips, assetRefKey } from "@/lib/assets/asset-references";
import { assetProviders } from "@/lib/assets/registry";
import { collectOwnedTimelineClips } from "@/lib/firebase-timeline-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One run's ceiling. Whatever it doesn't reach stays due and is taken by the
 *  next run — a sweep is allowed to be slow, never to be unbounded. */
const SWEEP_LIMIT = 200;

/**
 * The reclaim sweep: delete the uploaded files whose 30 days have run out and
 * that STILL nothing points at.
 *
 * The re-check is the point. A tombstone is an intention recorded 30 days ago
 * by a scan that may have been wrong, or right about a world that has since
 * changed — so this reads the owner's documents again and drops the tombstone
 * instead of the file whenever the asset is back in use. That is what lets the
 * marking side be merely careful rather than perfect.
 *
 * Driven by cron (see vercel.json) rather than by a user path: a lazy sweep on
 * a read is both a write on a read path (which round 12 took out of this app)
 * and useless for the user who stops signing in, who is precisely the one
 * accumulating storage.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret.length === 0) {
    // Refusing beats defaulting to open: this endpoint deletes files, and an
    // unset secret must never mean "anyone may run it".
    return NextResponse.json({ error: "Reclaim is not configured." }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await listDueAssetTombstones(Date.now(), SWEEP_LIMIT);
  const byOwner = new Map<string, AssetTombstone[]>();
  for (const tombstone of due) {
    const owned = byOwner.get(tombstone.ownerUid);
    if (owned === undefined) byOwner.set(tombstone.ownerUid, [tombstone]);
    else owned.push(tombstone);
  }

  let deleted = 0;
  let spared = 0;
  let skipped = 0;
  for (const [ownerUid, tombstones] of byOwner) {
    let referenced: ReadonlySet<string>;
    try {
      referenced = new Set(assetKeysFromClips(await collectOwnedTimelineClips(ownerUid)));
    } catch (error) {
      // Could not establish what this owner still uses — so nothing of theirs
      // can be deleted this run. The tombstones stay due.
      console.error("[ASSET_RECLAIM_SCAN_ERROR]", ownerUid, error);
      skipped += tombstones.length;
      continue;
    }

    // Back in use: the mark is withdrawn, and the file was never touched.
    const spare = tombstones.filter((tombstone) => referenced.has(assetRefKey(tombstone.ref)));
    await clearAssetTombstones(ownerUid, spare.map((tombstone) => tombstone.ref));
    spared += spare.length;

    for (const tombstone of tombstones) {
      if (referenced.has(assetRefKey(tombstone.ref))) continue;
      const outcome = await deleteAsset(ownerUid, tombstone);
      if (outcome === "deleted") deleted += 1;
      else skipped += 1;
    }
  }

  return NextResponse.json({ due: due.length, deleted, spared, skipped });
}

/** Constant-time bearer comparison. Lengths are compared first because
 *  `timingSafeEqual` throws on a mismatch rather than returning false. */
function authorized(header: string | null, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") === true ? header.slice(7) : "";
  const left = Buffer.from(presented);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Delete one asset through its provider, then drop the tombstone.
 *
 * The tombstone is removed ONLY after the provider reports success. A provider
 * that is no longer configured (S3 dropped from the environment), or one that
 * cannot delete, leaves the record in place: forgetting the intention would
 * strand the file with nothing left to say it should go.
 */
async function deleteAsset(
  ownerUid: string,
  tombstone: AssetTombstone,
): Promise<"deleted" | "skipped"> {
  const provider = assetProviders.get(tombstone.ref.providerId);
  if (provider?.remove === undefined) {
    console.warn("[ASSET_RECLAIM_NO_PROVIDER]", tombstone.ref.providerId);
    return "skipped";
  }
  try {
    await provider.remove({ uid: ownerUid }, {
      assetId: tombstone.ref.assetId,
      kind: tombstone.kind,
    });
  } catch (error) {
    // Left due: a transient vendor failure should be retried tomorrow, and a
    // permanent one is a record someone can find.
    console.error("[ASSET_RECLAIM_DELETE_ERROR]", tombstone.ref.assetId, error);
    return "skipped";
  }
  await clearAssetTombstones(ownerUid, [tombstone.ref]);
  return "deleted";
}
