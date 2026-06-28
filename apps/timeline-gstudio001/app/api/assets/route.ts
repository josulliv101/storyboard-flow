import { NextResponse } from "next/server";

import { listCloudinaryAssets } from "@/lib/cloudinary-media-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { response } = await requireAuthUser();
    if (response) return response;

    return NextResponse.json({ assets: await listCloudinaryAssets() });
  } catch (error) {
    console.error("[GSTUDIO_ASSETS_LIST_ERROR]", error);
    const message =
      error instanceof Error ? error.message : "Unable to load Cloudinary assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
