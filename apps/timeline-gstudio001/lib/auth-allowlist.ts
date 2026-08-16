// WHO IS ALLOWED TO SIGN IN.
//
// Sign-in was open to anyone who found the site: `/api/auth/login` mails a
// link to any address that asks. That is not a bug in the sense of something
// misbehaving — access was simply never restricted — and on 2026-08-14 a
// stranger used it, made a project called "gggg" and five empty timelines,
// and left. Ownership held (`resolveOwnership` denies every read and write
// whose `ownerUid` is not the requester's), so nothing of anyone else's was
// reachable. What an account DOES get is this project's Firestore reads and
// Cloudinary storage, and the daily read quota has already run out once.
//
// UNSET MEANS OPEN, deliberately. Local development, the Playwright suite and
// every preview deployment run without this variable, and a default of "deny
// everyone" would lock all three out the moment this shipped — a change that
// breaks the machine you are standing on is a change nobody trusts. The
// consequence is that PRODUCTION IS ONLY CLOSED ONCE `AUTH_ALLOWED_EMAILS` IS
// SET THERE, which is a deployment step, not a code one.
//
// Matching is case-insensitive and whitespace-tolerant, because an address is
// not case-sensitive in its domain and nobody types a comma-separated list
// tidily. No wildcards or domain patterns: this list is short and personal,
// and "@gmail.com" is not an allowlist.

const ENV_KEY = "AUTH_ALLOWED_EMAILS";

/** The parsed list, or null when the variable is unset or holds nothing
 *  usable — both of which mean "do not restrict". */
export function allowedEmails(): readonly string[] | null {
  const raw = process.env[ENV_KEY];
  if (typeof raw !== "string") return null;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  // A variable set to "" or "  ,  " is a configuration accident, not an
  // instruction to lock everyone out.
  return entries.length > 0 ? entries : null;
}

/**
 * Whether this address may hold a session here.
 *
 * Called in THREE places, and all three are needed:
 *
 *   - `/api/auth/login`, so no link is ever mailed to an address that could
 *     not use it;
 *   - `/api/auth/login/complete`, so a link mailed before the list existed —
 *     or before an address was removed from it — cannot still mint a session;
 *   - `getAuthUser`, so a session cookie ALREADY held stops working. Without
 *     that one, restricting the list would not evict anyone already signed in;
 *     their cookie stays valid for its full lifetime.
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  const list = allowedEmails();
  if (list === null) return true;
  if (typeof email !== "string" || email.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
