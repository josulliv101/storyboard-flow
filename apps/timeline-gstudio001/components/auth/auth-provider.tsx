"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as {
        user?: AuthUser | null;
      };
      setUser(result.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

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
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

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
