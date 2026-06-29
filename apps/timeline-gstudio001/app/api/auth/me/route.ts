import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/firebase-auth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ user: await getAuthUser() });
  } catch (error) {
    console.error("[GSTUDIO_AUTH_ME_ERROR]", error);
    return NextResponse.json({ user: null });
  }
}
