import { NextResponse } from "next/server";

import { isEmailAllowed } from "@/lib/auth-allowlist";
import { completeFirebaseEmailSignInLink } from "@/lib/firebase-auth-rest";
import { createSessionCookie, setSessionCookie } from "@/lib/firebase-auth-session";
import { readJsonObject } from "@/lib/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const oobCode = typeof body.oobCode === "string" ? body.oobCode : "";

    if (!email || !oobCode) {
      return NextResponse.json({ error: "Email and sign-in code are required." }, { status: 400 });
    }

    const authResult = await completeFirebaseEmailSignInLink(email, oobCode);

    // A VALID LINK IS NOT A TICKET. The send path refuses addresses that are
    // not on the list, but links already in an inbox outlive that check — and
    // so does a link mailed before the list existed, or before an address was
    // taken off it. Refused HERE too, so the only thing a stale link buys is
    // this message.
    //
    // Checked against the address Firebase just authenticated, not the one the
    // request claimed, since the two need not agree.
    if (!isEmailAllowed(authResult.email)) {
      console.warn("[GSTUDIO_AUTH_COMPLETE_REFUSED]", { reason: "not-allowlisted" });
      return NextResponse.json(
        { error: "This account does not have access." },
        { status: 403 },
      );
    }

    const sessionCookie = await createSessionCookie(authResult.idToken);

    return setSessionCookie(
      NextResponse.json({
        user: {
          uid: authResult.uid,
          email: authResult.email,
          name: null,
          picture: null,
        },
      }),
      sessionCookie,
    );
  } catch (error) {
    console.error("[GSTUDIO_AUTH_LINK_COMPLETE_ERROR]", error);
    const message = error instanceof Error ? error.message : "Unable to complete sign-in.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
