import "server-only";

import { getFirebaseWebApiKey } from "./firebase-auth-session";

type FirebaseAuthResponse = {
  idToken?: string;
  email?: string;
  localId?: string;
  kind?: string;
  error?: {
    message?: string;
  };
};

function getReadableAuthError(message?: string) {
  switch (message) {
    case "EMAIL_NOT_FOUND":
    case "INVALID_LOGIN_CREDENTIALS":
      return "No Firebase account exists for that email.";
    case "INVALID_OOB_CODE":
    case "EXPIRED_OOB_CODE":
      return "That sign-in link is expired or has already been used.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    default:
      return message ? message.replace(/_/g, " ").toLowerCase() : "Authentication failed.";
  }
}

function getIdentityToolkitUrl(endpoint: string) {
  const apiKey = getFirebaseWebApiKey();

  if (!apiKey) {
    throw new Error(
      "Firebase Auth is not configured. Add FIREBASE_WEB_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY.",
    );
  }

  return `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`;
}

export async function sendFirebaseEmailSignInLink(email: string, continueUrl: string) {
  const response = await fetch(
    getIdentityToolkitUrl("accounts:sendOobCode"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "EMAIL_SIGNIN",
        email,
        continueUrl,
        canHandleCodeInApp: true,
      }),
      cache: "no-store",
    },
  );

  const result = (await response.json().catch(() => ({}))) as FirebaseAuthResponse;

  if (!response.ok) {
    throw new Error(getReadableAuthError(result.error?.message));
  }

  return { email: result.email || email };
}

export async function completeFirebaseEmailSignInLink(email: string, oobCode: string) {
  const response = await fetch(
    getIdentityToolkitUrl("accounts:signInWithEmailLink"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, oobCode }),
      cache: "no-store",
    },
  );

  const result = (await response.json().catch(() => ({}))) as FirebaseAuthResponse;

  if (!response.ok || !result.idToken) {
    throw new Error(getReadableAuthError(result.error?.message));
  }

  return {
    idToken: result.idToken,
    email: result.email || email,
    uid: result.localId || "",
  };
}
