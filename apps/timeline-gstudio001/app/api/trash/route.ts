import { NextResponse } from "next/server";

import { readJsonObject } from "@/lib/read-json-body";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  collectOwnedTimelineClips,
  deleteFirebaseTimelineDocument,
  readStoredTimelineDocument,
  saveFirebaseTimelineDocument,
} from "@/lib/firebase-timeline-store";
import type { TimelineClip } from "@storyboard/timeline-model/types";
import {
  assetCandidatesFromClips,
  assetKeysFromClips,
  unreferencedCandidates,
} from "@/lib/assets/asset-references";
import { markAssetsForDeletion } from "@/lib/asset-tombstones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The collection documents a set of bin entries OWNS.
 *
 * A trashed collection sits in the bin as a clip whose id is the child
 * timeline's own id. Dropping that clip without deleting the document behind
 * it leaves the document in storage with nothing pointing at it — invisible in
 * the UI, absent from the bin it was just removed from, and reachable only by
 * querying the database. Emptying the bin did exactly that, to every
 * collection in it, every time.
 *
 * A clip whose `id` differs from its `childTimelineId` is a duplicate
 * reference and owns nothing, so it is excluded — the same rule the write
 * guard uses (`owningCollectionChildIds` in firebase-timeline-store).
 */
function owningCollectionIds(clips: readonly TimelineClip[]): string[] {
  const ids: string[] = [];
  for (const clip of clips) {
    if (clip.kind !== "collection") continue;
    if (clip.childTimelineId !== clip.id) continue;
    ids.push(clip.childTimelineId);
  }
  return ids;
}

/**
 * Delete the documents behind trashed collections, BEFORE the bin lets go.
 *
 * The order is the whole point, and it is the OPPOSITE of the asset marking
 * below. Marking leaks storage when it fails, which is the failure direction
 * that design deliberately chose. This one cannot use the same order: clear
 * first and fail here, and the documents are stranded — the exact state the
 * app is now supposed to be unable to reach. Delete first and fail to clear,
 * and the bin points at documents that no longer exist: visible, harmless, and
 * tidied by the next empty.
 *
 * So unlike marking, this is allowed to FAIL THE REQUEST. The bin stays as it
 * was and the user can retry; nothing is stranded either way.
 */
async function deleteTrashedCollections(
  clips: readonly TimelineClip[],
  requesterUid: string,
): Promise<void> {
  // Sequential on purpose: each of these walks and deletes a whole subtree, so
  // running them together is a burst of unbounded width. A bin holds tens of
  // entries, not thousands.
  for (const id of owningCollectionIds(clips)) {
    await deleteFirebaseTimelineDocument(id, requesterUid);
  }
}

/**
 * Empty the signed-in user's trash bin, and MARK the uploaded files nothing
 * points at any more.
 *
 * Marking, not deleting. An earlier version of this endpoint deleted the
 * Cloudinary asset behind every trashed clip, which was unsafe for a reason
 * that has not gone away: one upload can back several clips (this app mints
 * stable per-asset clip ids, so placing an asset twice makes two clips of one
 * file), and the bin is per-USER while an asset is per-project, so one bin
 * spans everything its owner owns. The rule is therefore REFERENCES — an asset
 * is marked only when no document of this user's still points at it — and even
 * then the file survives a 30-day grace period the sweep re-checks before
 * honouring (see lib/asset-tombstones).
 *
 * A failure to mark leaks storage. That is the failure direction this whole
 * design is built to have, so marking runs AFTER the bin is safely emptied and
 * never fails the request.
 */
export async function DELETE() {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const trashId = `trash-${user.uid}`;
    const trashDoc = await readStoredTimelineDocument(trashId, user.uid);
    const cleared = trashDoc?.clips.length ?? 0;
    if (!trashDoc || cleared === 0) return NextResponse.json({ success: true, cleared });

    const candidates = assetCandidatesFromClips(trashDoc.clips);

    // BEFORE the bin lets go — see `deleteTrashedCollections`. A failure here
    // aborts the request with the bin intact rather than stranding documents.
    await deleteTrashedCollections(trashDoc.clips, user.uid);

    // `allowEmptying` is what makes this work at all. The save path refuses
    // an empty write over a non-empty document (a stale client erasing real
    // work) and, separately, reads `lastNonEmptyDocument` back whenever the
    // stored clips are empty — so without the opt-in this endpoint threw
    // 500, and had it not thrown the bin would have re-read full anyway.
    // A copy, not a mutation of the loaded document.
    await saveFirebaseTimelineDocument({ ...trashDoc, clips: [] }, user.uid, {
      allowEmptying: true,
    });

    const marked = await markUnreferencedAssets(user.uid, trashId, candidates);
    return NextResponse.json({ success: true, cleared, marked });
  } catch (error) {
    console.error("[TRASH_EMPTY_ERROR]", error);
    return NextResponse.json({ error: "Unable to empty the trash." }, { status: 500 });
  }
}

/**
 * Which of the emptied bin's assets nothing else points at, marked.
 *
 * The bin itself is EXCLUDED from the scan — its clips are the candidates, and
 * a candidate is not a reference to itself. (It has already been written empty
 * by the time this runs, but excluding it explicitly means the rule does not
 * depend on that ordering.)
 *
 * Never throws. Emptying the bin is the user's request and it has already
 * succeeded; a scan that failed, or that could not be completed, must leave the
 * files alone rather than fail the response — and an incomplete scan
 * (`TimelineScanIncompleteError`) must never be read as "nothing references
 * this".
 */
async function markUnreferencedAssets(
  uid: string,
  trashId: string,
  candidates: ReturnType<typeof assetCandidatesFromClips>,
): Promise<number> {
  if (candidates.length === 0) return 0;
  try {
    const liveClips = await collectOwnedTimelineClips(uid, { excludeIds: [trashId] });
    const orphans = unreferencedCandidates(candidates, new Set(assetKeysFromClips(liveClips)));
    return await markAssetsForDeletion(uid, orphans);
  } catch (error) {
    console.error("[TRASH_MARK_ERROR]", error);
    return 0;
  }
}

/**
 * Discard SPECIFIC entries from the bin, without restoring them.
 *
 * The trash holds one row per IMAGE, not per clip: deleting a clip and its
 * duplicate puts two identical entries in the bin, and adding that image back
 * takes one of them. The others have to go, or the row would linger holding
 * copies of something the user has already taken back.
 *
 * Same shape as emptying, and the same two constraints. `allowEmptying` is
 * needed because discarding the last entries leaves the document empty, and
 * the save path otherwise refuses an empty write over a non-empty document.
 * And like emptying, the caller MUST tell the graph to rebuild afterwards —
 * a mounted graph view holds these clips as nodes under its trash root and
 * would write them straight back on the next commit that touches the trash.
 *
 * Uploaded files are untouched, and UNLIKE emptying this path marks nothing.
 * The asymmetry is deliberate: discarding is what a RESTORE does to the
 * leftover copies (see lib/graph-trash-discard — the drawer restores one clip
 * and discards its duplicates), so a discard usually means an asset is coming
 * back into use, not going out of it. Emptying the bin is the deliberate "I am
 * finished with this" that earns a mark.
 */
export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await readJsonObject(request);
    const clipIds = Array.isArray(body.clipIds)
      ? body.clipIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (clipIds.length === 0) {
      return NextResponse.json({ error: "clipIds is required." }, { status: 400 });
    }

    const trashId = `trash-${user.uid}`;
    const trashDoc = await readStoredTimelineDocument(trashId, user.uid);
    if (!trashDoc) return NextResponse.json({ success: true, discarded: 0 });

    // Drop ONE entry per requested id, not every clip sharing it: the bin can
    // legitimately hold the same id twice (stable per-asset ids mean one file
    // trashed from two timelines arrives twice), and a caller asking to
    // discard one of them must not lose the other.
    const remaining = [...trashDoc.clips];
    const dropped: TimelineClip[] = [];
    for (const clipId of clipIds) {
      const index = remaining.findIndex((clip) => clip.id === clipId);
      if (index === -1) continue;
      const removed = remaining[index];
      if (removed !== undefined) dropped.push(removed);
      remaining.splice(index, 1);
    }
    const discarded = dropped.length;
    if (discarded === 0) return NextResponse.json({ success: true, discarded: 0 });

    // Only what this request actually drops, and only the OWNING entry: the bin
    // can hold the same id twice, and a copy staying behind still needs its
    // document or restoring it would restore nothing. Before the write, for the
    // reason in `deleteTrashedCollections`.
    await deleteTrashedCollections(dropped, user.uid);

    await saveFirebaseTimelineDocument({ ...trashDoc, clips: remaining }, user.uid, {
      allowEmptying: true,
    });
    return NextResponse.json({ success: true, discarded });
  } catch (error) {
    console.error("[TRASH_DISCARD_ERROR]", error);
    return NextResponse.json({ error: "Unable to update the trash." }, { status: 500 });
  }
}
