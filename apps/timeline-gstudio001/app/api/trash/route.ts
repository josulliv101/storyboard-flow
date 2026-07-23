import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  collectMediaReferences,
  getFirebaseTimelineDocument,
  saveFirebaseTimelineDocument,
} from "@/lib/firebase-timeline-store";
import { deleteCloudinaryAsset } from "@/lib/cloudinary-media-store";
import {
  isStillReferenced,
  mediaMatchKeys,
  referenceIndex,
  type MediaMatchKeys,
} from "@/lib/media-references";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Empty the signed-in user's trash bin: clear the document, and permanently
 * delete the uploaded assets behind its clips.
 *
 * The asset half is REFERENCE-CHECKED. The same upload can be referenced from
 * several timelines (this app mints stable per-asset clip ids, so placing one
 * asset twice makes two clips of one asset), which means "this clip is in the
 * bin" does not mean "nobody is using this file". Anything another document
 * still points at is kept; only assets no live document references are
 * destroyed. The check fails SAFE in every direction — a scan that errors, or
 * that hit its document cap and so can't prove absence, keeps every asset and
 * still empties the bin, which is the part the user actually asked for.
 */
export async function DELETE() {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const trashId = `trash-${user.uid}`;
    const trashDoc = await getFirebaseTimelineDocument(trashId, user.uid);
    const cleared = trashDoc?.clips.length ?? 0;
    let assetsDeleted = 0;
    let assetsKept = 0;

    if (trashDoc && cleared > 0) {
      // Everything the rest of the library still points at. The bin itself is
      // excluded — its own clips are what we are about to delete, so counting
      // them would keep every asset forever.
      const scan = await collectMediaReferences([trashId]).catch((error: unknown) => {
        console.warn("[TRASH_EMPTY] media reference scan failed; keeping assets", error);
        return { urls: new Set<string>(), complete: false };
      });
      const referenced = referenceIndex(scan.urls);

      // De-duplicated by asset: the bin can hold several clips of one upload
      // (that is exactly the case this check exists for), and the second
      // delete of the same public id would 404 against Cloudinary.
      const seen = new Set<string>();
      for (const clip of trashDoc.clips) {
        const clipSrc = (clip as { src?: unknown }).src;
        if (typeof clipSrc !== "string") continue;
        const keys: MediaMatchKeys | null = mediaMatchKeys(clipSrc);
        if (keys === null) continue;
        if (seen.has(keys.publicId)) continue;
        seen.add(keys.publicId);

        // Incomplete scan = no evidence either way, so the asset stays.
        if (!scan.complete || isStillReferenced(referenced, keys)) {
          assetsKept += 1;
          continue;
        }

        const resourceType = clip.kind === "video" ? "video" : "image";
        try {
          await deleteCloudinaryAsset(keys.publicId, resourceType);
          assetsDeleted += 1;
        } catch (err) {
          console.warn(`Failed to delete Cloudinary asset ${keys.publicId}:`, err);
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

    return NextResponse.json({ success: true, cleared, assetsDeleted, assetsKept });
  } catch (error) {
    console.error("[TRASH_EMPTY_ERROR]", error);
    return NextResponse.json({ error: "Unable to empty the trash." }, { status: 500 });
  }
}
