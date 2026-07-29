"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type AuthUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

type AuthCredentials = {
  email: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  sendSignInLink: (credentials: AuthCredentials) => Promise<void>;
  completeSignInLink: (credentials: AuthCredentials & { oobCode: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readAuthResponse(response: Response) {
  const result = (await response.json().catch(() => ({}))) as {
    user?: AuthUser | null;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "Authentication failed.");
  }

  return result.user ?? null;
}

export function AuthProvider({
  initialUser,
  children,
}: {
  /**
   * The session the SERVER already resolved for this render (root layout).
   *
   * Without it this provider started at `isLoading: true` and AuthGate held
   * the entire tree behind a spinner until `/api/auth/me` answered — one
   * blocking round trip per page load, re-deriving an identity the RSC pass
   * had in hand. It also negated the graph route's own work: the layout
   * streams boot documents so the client boots with zero fetches, and none of
   * it could render until that unrelated request landed.
   *
   * `null` means the server saw no session, which is a real answer, not an
   * absent one — so nothing blocks in that case either. The mount effect below
   * still revalidates.
   */
  initialUser: AuthUser | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  // The server answered, so there is nothing to wait for. Revalidation runs in
  // the background; only a session we have never resolved gates the UI.
  const [isLoading, setIsLoading] = useState(false);

  // Pure request: resolves to the session user (or null) and never touches
  // state — so the mount effect can consume it through promise CALLBACKS
  // (state changes only when the external request answers), and refreshUser
  // wraps it for event-handler callers who want the loading flag re-raised.
  const requestUser = useCallback(async (): Promise<AuthUser | null> => {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    const result = (await response.json().catch(() => ({}))) as {
      user?: AuthUser | null;
    };
    return result.user ?? null;
  }, []);

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    try {
      setUser(await requestUser());
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [requestUser]);

  useEffect(() => {
    // BACKGROUND revalidation, not a gate. The server already resolved the
    // session for this render (see `initialUser`), so this only catches a
    // cookie that expired between the RSC pass and hydration — it must never
    // raise `isLoading`, or it would reintroduce the blocking spinner it
    // replaced. The cancelled flag keeps a slow answer out of an unmounted
    // tree.
    let cancelled = false;
    requestUser()
      .then((next) => {
        if (!cancelled) setUser(next);
      })
      .catch(() => {
        // A failed revalidation is not evidence of signing out — a network
        // blip must not throw the user back to the sign-in form. Keep what the
        // server told us; a genuinely dead session fails the next API call.
      });
    return () => {
      cancelled = true;
    };
  }, [requestUser]);

  const sendSignInLink = useCallback(async ({ email }: AuthCredentials) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      await readAuthResponse(response);
    }
  }, []);

  const completeSignInLink = useCallback(async ({ email, oobCode }: AuthCredentials & { oobCode: string }) => {
    const response = await fetch("/api/auth/login/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, oobCode }),
    });
    setUser(await readAuthResponse(response));
    // The RSC router cache was rendered with the PREVIOUS session (or none):
    // server components must re-run with the new cookie, or stale payloads
    // (another user's bootstrap) linger in the cache.
    router.refresh();
  }, [router]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    // Same reasoning as login: drop RSC output rendered under the old
    // session so nothing authenticated survives in the router cache.
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({ user, isLoading, sendSignInLink, completeSignInLink, logout, refreshUser }),
    [completeSignInLink, isLoading, logout, refreshUser, sendSignInLink, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}
