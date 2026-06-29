import "server-only";

import { cookies } from "next/headers";
import { type DecodedIdToken } from "firebase-admin/auth";

import { getFirebaseAuth } from "./firebase-admin";

export const AUTH_COOKIE_NAME = "__Host-gstudio_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type AuthUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

function toAuthUser(token: DecodedIdToken): AuthUser {
  return {
    uid: token.uid,
    email: typeof token.email === "string" ? token.email : null,
    name: typeof token.name === "string" ? token.name : null,
    picture: typeof token.picture === "string" ? token.picture : null,
  };
}

export function getFirebaseWebApiKey() {
  return process.env.FIREBASE_WEB_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
}

export async function createSessionCookie(idToken: string) {
  return getFirebaseAuth().createSessionCookie(idToken, {
    expiresIn: AUTH_SESSION_MAX_AGE_SECONDS * 1000,
  });
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!sessionCookie) return null;

  try {
    const decodedToken = await getFirebaseAuth().verifySessionCookie(sessionCookie, true);
    return toAuthUser(decodedToken);
  } catch {
    return null;
  }
}

export async function requireAuthUser() {
  const user = await getAuthUser();

  if (!user) {
    return {
      user: null,
      response: Response.json({ error: "Authentication is required." }, { status: 401 }),
    };
  }

  return { user, response: null };
}

export function setSessionCookie(response: Response, sessionCookie: string) {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    [
      `${AUTH_COOKIE_NAME}=${sessionCookie}`,
      "Path=/",
      `Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}`,
      "HttpOnly",
      "SameSite=Lax",
      "Secure",
    ].join("; "),
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function clearSessionCookie(response: Response) {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    [
      `${AUTH_COOKIE_NAME}=`,
      "Path=/",
      "Max-Age=0",
      "HttpOnly",
      "SameSite=Lax",
      "Secure",
    ].join("; "),
  );
  headers.set("Clear-Site-Data", "\"cookies\", \"storage\", \"cache\"");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
