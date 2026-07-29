import { NextResponse } from "next/server";

import { readJsonObject } from "@/lib/read-json-body";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  getFirebaseTimelineDocument,
  saveFirebaseTimelineDocument,
} from "@/lib/firebase-timeline-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Empty the signed-in user's trash bin: clear the document, and nothing else.
 *
 * The UPLOADED FILES ARE DELIBERATELY LEFT ALONE. This endpoint used to delete
 * the Cloudinary asset behind every trashed clip, which was unsafe (one upload
 * can be referenced from several timelines — this app mints stable per-asset
 * clip ids, so placing an asset twice makes two clips of one file) and, more
 * to the point, is not what emptying a bin should mean here: the files stay
 * browsable in the Assets library and can be placed again. Reclaiming unused
 * storage is a separate, deliberate job — see the note in the trash drawer.
 */
export async function DELETE() {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const trashId = `trash-${user.uid}`;
    const trashDoc = await getFirebaseTimelineDocument(trashId, user.uid);
    const cleared = trashDoc?.clips.length ?? 0;

    if (trashDoc && cleared > 0) {
      // `allowEmptying` is what makes this work at all. The save path refuses
      // an empty write over a non-empty document (a stale client erasing real
      // work) and, separately, reads `lastNonEmptyDocument` back whenever the
      // stored clips are empty — so without the opt-in this endpoint threw
      // 500, and had it not thrown the bin would have re-read full anyway.
      // A copy, not a mutation of the loaded document.
      await saveFirebaseTimelineDocument({ ...trashDoc, clips: [] }, user.uid, {
        allowEmptying: true,
      });
    }

    return NextResponse.json({ success: true, cleared });
  } catch (error) {
    console.error("[TRASH_EMPTY_ERROR]", error);
    return NextResponse.json({ error: "Unable to empty the trash." }, { status: 500 });
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
 * Uploaded files are untouched, exactly as for emptying: one upload can back
 * several clips, and discarding a bin entry is not deleting a file.
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
    const trashDoc = await getFirebaseTimelineDocument(trashId, user.uid);
    if (!trashDoc) return NextResponse.json({ success: true, discarded: 0 });

    // Drop ONE entry per requested id, not every clip sharing it: the bin can
    // legitimately hold the same id twice (stable per-asset ids mean one file
    // trashed from two timelines arrives twice), and a caller asking to
    // discard one of them must not lose the other.
    const remaining = [...trashDoc.clips];
    let discarded = 0;
    for (const clipId of clipIds) {
      const index = remaining.findIndex((clip) => clip.id === clipId);
      if (index === -1) continue;
      remaining.splice(index, 1);
      discarded += 1;
    }
    if (discarded === 0) return NextResponse.json({ success: true, discarded: 0 });

    await saveFirebaseTimelineDocument({ ...trashDoc, clips: remaining }, user.uid, {
      allowEmptying: true,
    });
    return NextResponse.json({ success: true, discarded });
  } catch (error) {
    console.error("[TRASH_DISCARD_ERROR]", error);
    return NextResponse.json({ error: "Unable to update the trash." }, { status: 500 });
  }
}
