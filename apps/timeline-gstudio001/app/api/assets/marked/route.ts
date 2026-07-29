import { NextResponse } from "next/server";

import { clearAssetTombstones, listAssetTombstones } from "@/lib/asset-tombstones";
import type { AssetSourceRef } from "@/lib/assets/types";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readJsonObject } from "@/lib/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user's assets marked for deletion — what the trash drawer's
 * "Recently deleted" section reads.
 *
 * Everything a row prints comes off the tombstone itself (see the display
 * snapshot on `AssetDeletionCandidate`): no provider call, no listing, no
 * project scope. That is not an optimization — the whole point of a marked
 * asset is that no clip names it any more, so there is nothing left to derive
 * a name or a thumbnail FROM.
 *
 * Soonest deadline first: the rows that can still be acted on are the ones
 * running out.
 */
export async function GET() {
  const { user, response } = await requireAuthUser();
  if (response || !user) {
    return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tombstones = await listAssetTombstones(user.uid);
  const assets = [...tombstones]
    .sort((left, right) => left.deleteAfterMs - right.deleteAfterMs)
    .map((tombstone) => ({
      providerId: tombstone.ref.providerId,
      assetId: tombstone.ref.assetId,
      kind: tombstone.kind,
      name: tombstone.name,
      thumbnailUrl: tombstone.thumbnailUrl,
      markedAtMs: tombstone.markedAtMs,
      deleteAfterMs: tombstone.deleteAfterMs,
    }));

  return NextResponse.json({ assets });
}

/**
 * Keep: drop the marks on the named assets.
 *
 * A DELETE that deletes MARKS, not files — which is the whole point. Nothing
 * moved when the asset was marked, so keeping it is pure bookkeeping: the file
 * has been sitting in the library the entire window, and this only withdraws
 * the intention to remove it.
 *
 * Refs are cleared by exact `{providerId, assetId}` pair and scoped to the
 * caller's own tombstone ids, so a request naming someone else's asset finds
 * nothing to clear rather than reaching it.
 */
export async function DELETE(request: Request) {
  const { user, response } = await requireAuthUser();
  if (response || !user) {
    return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  const refs = readRefs(body.assets);
  if (refs.length === 0) {
    return NextResponse.json({ error: "assets is required." }, { status: 400 });
  }

  const kept = await clearAssetTombstones(user.uid, refs);
  return NextResponse.json({ success: true, kept });
}

function readRefs(value: unknown): readonly AssetSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { providerId, assetId } = entry as Partial<AssetSourceRef>;
    if (typeof providerId !== "string" || providerId.length === 0) return [];
    if (typeof assetId !== "string" || assetId.length === 0) return [];
    return [{ providerId, assetId }];
  });
}
