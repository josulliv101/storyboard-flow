import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { getFirebaseTimelineDocument, saveFirebaseTimelineDocument } from "@/lib/firebase-timeline-store";
import { deleteCloudinaryAsset } from "@/lib/cloudinary-media-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const trashId = `trash-${user.uid}`;
    const trashDoc = await getFirebaseTimelineDocument(trashId, user.uid);
    const cleared = trashDoc?.clips.length ?? 0;

    if (trashDoc && cleared > 0) {
      for (const clip of trashDoc.clips) {
        const clipSrc = (clip as any).src;
        if (clipSrc && clipSrc.includes("cloudinary.com")) {
          const publicId = extractCloudinaryPublicId(clipSrc);
          if (publicId) {
            const resourceType = clip.kind === "video" ? "video" : "image";
            try {
              await deleteCloudinaryAsset(publicId, resourceType);
            } catch (err) {
              console.warn(`Failed to delete Cloudinary asset ${publicId}:`, err);
            }
          }
        }
      }

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

function extractCloudinaryPublicId(url: string): string | null {
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (match && match[1]) {
      return match[1].replace(/\.[^/.]+$/, "");
    }
  } catch {}
  return null;
}
