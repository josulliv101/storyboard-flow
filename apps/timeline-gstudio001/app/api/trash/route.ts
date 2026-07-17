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

    if (trashDoc && trashDoc.clips.length > 0) {
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

      trashDoc.clips = [];
      await saveFirebaseTimelineDocument(trashDoc, user.uid);
    }

    return NextResponse.json({ success: true });
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
