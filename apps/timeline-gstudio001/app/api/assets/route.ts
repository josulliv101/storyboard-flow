import { NextResponse } from "next/server";

import { assetProviders } from "@/lib/assets/registry";
import type { AssetQuery } from "@/lib/assets/types";
import { requireAuthUser } from "@/lib/firebase-auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List assets through the provider seam.
 *
 *   ?provider=<id>      which provider (default: the registry's first)
 *   ?folder=<segment>   repeatable — one param per PATH SEGMENT, so a
 *                       segment containing "/" can never fake a boundary.
 *                       `?browse=1` with no folder params means the ROOT
 *                       folder; no browse and no folder params means the
 *                       FLAT listing (every asset — the palette's view).
 *   ?limit=<n>
 *
 * Response: { providerId, capabilities, assets, folders, nextCursor? } — the
 * neutral shapes from lib/assets/types, whoever the provider is.
 */
export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const providerId = url.searchParams.get("provider");
    const provider =
      providerId === null ? assetProviders.defaultProvider() : assetProviders.get(providerId);
    if (!provider) {
      return NextResponse.json(
        { error: `Unknown asset provider "${providerId}".` },
        { status: 404 },
      );
    }

    const folderSegments = url.searchParams.getAll("folder");
    const browsing = url.searchParams.get("browse") !== null || folderSegments.length > 0;
    const limitParam = Number(url.searchParams.get("limit"));
    const query: AssetQuery = {
      ...(browsing ? { folder: folderSegments } : {}),
      ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: limitParam } : {}),
    };

    const page = await provider.list({ uid: user.uid }, query);
    return NextResponse.json({
      providerId: provider.id,
      capabilities: provider.capabilities,
      ...page,
    });
  } catch (error) {
    console.error("[GSTUDIO_ASSETS_LIST_ERROR]", error);
    const message = error instanceof Error ? error.message : "Unable to load assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
