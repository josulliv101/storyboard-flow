"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, LogIn, Mail, Send } from "lucide-react";

import { Button } from "@/components/core/button";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth-provider";

const EMAIL_LINK_STORAGE_KEY = "gstudio-email-link-email";

type AuthStep = "request" | "sent" | "complete";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, sendSignInLink, completeSignInLink } = useAuth();
  const [step, setStep] = useState<AuthStep>("request");
  const [email, setEmail] = useState("");
  const [oobCode, setOobCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const didHandleEmailLink = useRef(false);

  useEffect(() => {
    if (didHandleEmailLink.current || user) return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("oobCode") || "";
    const mode = url.searchParams.get("mode");

    if (!code || mode !== "signIn") return;

    didHandleEmailLink.current = true;
    setOobCode(code);

    const storedEmail = window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY);
    if (!storedEmail) {
      setStep("complete");
      return;
    }

    setEmail(storedEmail);
    setIsSubmitting(true);
    void completeSignInLink({ email: storedEmail, oobCode: code })
      .then(() => {
        window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch((authError) => {
        setStep("complete");
        setError(authError instanceof Error ? authError.message : "Unable to complete sign-in.");
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }, [completeSignInLink, user]);

  if (isLoading) {
    return (
      <div className="grid min-h-screen flex-1 place-items-center bg-zinc-950 text-zinc-400">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
          Loading session
        </div>
      </div>
    );
  }

  if (user) return <>{children}</>;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim();

      if (step === "complete") {
        await completeSignInLink({ email: normalizedEmail, oobCode });
        window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
        window.history.replaceState({}, "", window.location.pathname);
      } else {
        await sendSignInLink({ email: normalizedEmail });
        window.localStorage.setItem(EMAIL_LINK_STORAGE_KEY, normalizedEmail);
        setStep("sent");
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-zinc-950 px-6 py-10 text-white">
      <div className="grid w-full max-w-[420px] gap-6">
        <div className="grid gap-3 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-[13px] font-black text-amber-300">
            SW
          </div>
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold text-zinc-50">
              {step === "sent"
                ? "Check your email"
                : step === "complete"
                  ? "Confirm your email"
                  : "Sign in with email"}
            </h1>
            <p className="text-sm text-zinc-500">
              {step === "sent"
                ? "Open the Firebase sign-in link we sent. This page will finish the session when you return."
                : step === "complete"
                  ? "Enter the email address that received this sign-in link."
                  : "Enter your email and Firebase will send a one-time sign-in link."}
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="grid gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 shadow-2xl shadow-black/30"
        >
          <div className="grid gap-2">
            <label htmlFor="auth-email" className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Email
            </label>
            <div className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 focus-within:border-amber-400">
              <Mail className="h-4 w-4 shrink-0 text-zinc-600" />
              <input
                id="auth-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                name="email"
                autoComplete="username"
                enterKeyHint="done"
                required
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-700"
                placeholder="you@example.com"
              />
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-100">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
              <span>{error}</span>
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-10 gap-2 bg-amber-400 text-xs font-bold uppercase tracking-widest text-zinc-950 hover:bg-amber-300"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : step === "complete" ? (
              <LogIn className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {step === "complete" ? "Complete Sign In" : "Send Sign-In Link"}
          </Button>

          <button
            type="button"
            onClick={() => {
              setStep("request");
              setOobCode("");
              setError(null);
            }}
            className={cn(
              "h-9 rounded-md text-xs font-semibold text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
            )}
          >
            Use a different email
          </button>
        </form>
      </div>
    </div>
  );
}
