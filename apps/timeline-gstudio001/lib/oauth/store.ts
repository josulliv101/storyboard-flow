import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { getFirebaseDb } from "@/lib/firebase-admin";

import {
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  randomToken,
} from "./core";

// Firestore persistence for the OAuth authorization server.
//
// Codes and refresh tokens are stored HASHED and looked up by hash: a leaked
// database read yields nothing replayable. Consumption runs in a transaction
// so a code can only ever be redeemed once even under concurrent requests —
// replaying an intercepted code is the attack this closes, and a
// read-then-delete would leave a window open.

const CODES = "mcpOAuthCodes";
const REFRESH = "mcpOAuthRefreshTokens";

export type AuthCodeGrant = Readonly<{
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  uid: string;
  scope: string;
  resource: string;
}>;

type StoredCode = AuthCodeGrant & { expiresAt: Timestamp };

/** Mint a single-use authorization code. Returns the plaintext code (only
 *  ever held by the client); Firestore keeps its hash. */
export async function issueAuthCode(grant: AuthCodeGrant): Promise<string> {
  const code = randomToken(32);
  await getFirebaseDb()
    .collection(CODES)
    .doc(hashToken(code))
    .set({
      ...grant,
      expiresAt: Timestamp.fromMillis(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
    } satisfies StoredCode);
  return code;
}

/**
 * Atomically redeem a code. Returns the grant and deletes it in the same
 * transaction, so a second redemption of the same code always fails. Expired
 * codes are deleted and refused.
 */
export async function consumeAuthCode(code: string): Promise<AuthCodeGrant | null> {
  const ref = getFirebaseDb().collection(CODES).doc(hashToken(code));
  return getFirebaseDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data() as StoredCode;
    tx.delete(ref); // single-use, whether or not it turns out to be expired
    if (data.expiresAt.toMillis() <= Date.now()) return null;
    const { expiresAt: _expiresAt, ...grant } = data;
    return grant;
  });
}

export type RefreshGrant = Readonly<{
  clientId: string;
  uid: string;
  scope: string;
  resource: string;
}>;

type StoredRefresh = RefreshGrant & { expiresAt: Timestamp };

export async function issueRefreshToken(grant: RefreshGrant): Promise<string> {
  const token = randomToken(32);
  await getFirebaseDb()
    .collection(REFRESH)
    .doc(hashToken(token))
    .set({
      ...grant,
      expiresAt: Timestamp.fromMillis(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    } satisfies StoredRefresh);
  return token;
}

/**
 * Redeem and ROTATE a refresh token: the presented token is consumed and a new
 * one issued in its place. Rotation is what makes theft detectable — a stolen
 * token stops working as soon as the legitimate client refreshes.
 */
export async function rotateRefreshToken(
  token: string,
): Promise<Readonly<{ grant: RefreshGrant; nextToken: string }> | null> {
  const ref = getFirebaseDb().collection(REFRESH).doc(hashToken(token));
  const grant = await getFirebaseDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data() as StoredRefresh;
    tx.delete(ref);
    if (data.expiresAt.toMillis() <= Date.now()) return null;
    const { expiresAt: _expiresAt, ...rest } = data;
    return rest;
  });
  if (!grant) return null;
  return { grant, nextToken: await issueRefreshToken(grant) };
}
