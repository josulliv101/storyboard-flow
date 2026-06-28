import { NextResponse } from "next/server";

import { sendFirebaseEmailSignInLink } from "@/lib/firebase-auth-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const { origin } = new URL(request.url);
    await sendFirebaseEmailSignInLink(email, origin);

    return NextResponse.json({ success: true, email });
  } catch (error) {
    console.error("[GSTUDIO_AUTH_LOGIN_ERROR]", error);
    const message = error instanceof Error ? error.message : "Unable to send sign-in link.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
