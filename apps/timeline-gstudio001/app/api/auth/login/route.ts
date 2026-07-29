import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { sendFirebaseEmailSignInLink } from "@/lib/firebase-auth-rest";
import { clientAddress, createRateLimiter } from "@/lib/rate-limit";
import { readJsonObject } from "@/lib/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Being unauthenticated is correct for a login endpoint. What was not: it
// accepted unlimited requests, validated only "is a non-empty string", and
// returned Firebase's (and its own configuration's) error text verbatim.
//
// So it could be driven to exhaust the project's email quota — locking out
// every legitimate sign-in — or used to send repeated sign-in mail to arbitrary
// addresses from this project's sender. And `getReadableAuthError` maps
// `EMAIL_NOT_FOUND` to "No Firebase account exists for that email", which made
// the response an account-enumeration oracle, while a misconfigured deployment
// leaked "Add FIREBASE_WEB_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY" to anyone
// who asked.
//
// Now: a shape-validated address, two rate-limit buckets, one generic answer
// whatever happens, and the detail kept server-side in the log.

const LoginBody = z.object({
  // Not a full RFC 5322 parse — just enough that obvious garbage never costs a
  // provider call. The length cap is the real bound.
  email: z.string().trim().min(3).max(254).email(),
});

/** Per-ADDRESS: the anti-harassment bucket — how often one mailbox can be
 *  mailed, regardless of who asks. */
const perAddress = createRateLimiter({ limit: 3, windowMs: 15 * 60_000 });
/** Per-CALLER: the anti-quota-exhaustion bucket — how many addresses one
 *  source can enumerate. */
const perSource = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 });

/** Addresses are personal data and these maps outlive the request; a bucket
 *  only needs a stable key, not the value. */
const bucketKey = (value: string) =>
  createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 32);

/**
 * ONE answer for every outcome — sent, address rate-limited, unknown account,
 * provider hiccup. Anything that varies by whether the address exists is an
 * enumeration oracle.
 */
function acceptedResponse() {
  return NextResponse.json({
    success: true,
    message: "If that address has an account, a sign-in link is on its way.",
  });
}

export async function POST(request: Request) {
  const parsed = LoginBody.safeParse(await readJsonObject(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const email = parsed.data.email;

  const source = perSource.check(bucketKey(clientAddress(request)));
  if (!source.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(source.retryAfterSeconds) } },
    );
  }

  // An address over its own limit gets the SAME success shape as a delivered
  // link: answering "that one is rate-limited" would confirm the address is
  // worth hammering.
  if (!perAddress.check(bucketKey(email)).allowed) {
    return acceptedResponse();
  }

  try {
    const { origin } = new URL(request.url);
    await sendFirebaseEmailSignInLink(email, origin);
  } catch (error) {
    // Detail stays here. The caller gets the same answer either way.
    console.error("[GSTUDIO_AUTH_LOGIN_ERROR]", error);
  }

  return acceptedResponse();
}
