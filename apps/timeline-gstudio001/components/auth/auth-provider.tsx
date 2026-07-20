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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
    // Mount needs no sync loading reset — isLoading INITIALIZES true. The
    // cancelled flag keeps a slow answer from writing into an unmounted tree.
    let cancelled = false;
    requestUser()
      .then((next) => {
        if (!cancelled) setUser(next);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
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
