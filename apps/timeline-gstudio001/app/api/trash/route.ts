import { NextResponse } from "next/server";
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
