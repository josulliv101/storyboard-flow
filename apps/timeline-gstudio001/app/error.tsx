"use client";

import Link from "next/link";
import { useEffect } from "react";

// The app had NO error boundary anywhere. Any throw React could not handle
// reached Next's built-in fallback, which renders the bare string
// "Application error: a client-side exception has occurred (see the browser
// console for more information)" — no clue what failed, nothing to click, and
// on a production build no stack either. That is what the owner hit when the
// project ran out of Firestore read quota.
//
// This does not stop things throwing; it makes a throw legible and
// recoverable. `reset()` re-renders the segment without a full reload, which
// is the right first move for a transient backend failure — the quota case
// literally fixes itself, and so does a dropped connection.
//
// Scope: this covers every route under `app/`, but NOT a throw inside the root
// layout itself — React needs the boundary above the thing that failed, and
// nothing in this file is mounted until the root layout has rendered. That
// case belongs to `global-error.tsx` beside this file.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The console is where the built-in fallback told people to look, so keep
    // putting something useful there. `digest` is the only handle on a
    // production stack (the message is minified away), which makes it the one
    // thing worth quoting in a bug report.
    console.error("Unhandled error rendering this page:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-6">
      <div
        role="alert"
        className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300"
      >
        <p className="font-semibold text-zinc-100">Something went wrong loading this page</p>
        <p className="mt-1">
          This is usually temporary — the app could not reach its data. Trying again is
          often enough; if it keeps happening, the storage backend may be unavailable or
          out of quota for the day.
        </p>
        {error.digest !== undefined && (
          <p className="mt-2 text-xs text-zinc-500">
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
          >
            Try again
          </button>
          <Link href="/projects" className="text-xs text-sky-400 underline underline-offset-4">
            Back to Projects
          </Link>
        </div>
      </div>
    </div>
  );
}
