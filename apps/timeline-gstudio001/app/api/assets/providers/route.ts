import { NextResponse } from "next/server";

import { assetProviders } from "@/lib/assets/registry";
import { requireAuthUser } from "@/lib/firebase-auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The installed asset providers, with their capabilities — what the panel's
 *  provider picker renders, and how it knows which controls (folders, tags,
 *  search, upload) each provider can honour. */
export async function GET() {
  const { user, response } = await requireAuthUser();
  if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ providers: assetProviders.describeAll() });
}
