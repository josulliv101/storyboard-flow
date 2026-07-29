"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { CircleAlert, Cloud, CloudUpload } from "lucide-react";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

// The save indicator (PL11-003).
//
// The app autosaves on a 900ms debounce and, until now, said nothing about it
// at all — the only readout was a dev-gated panel behind `?dev`. That is a
// gap with teeth: undo history lives in memory, so a reload ends it, and an
// autosaved mistake the user never saw commit has no path back. "Is my work
// safe" deserves an answer on screen.
//
// Three states, and no more: something is on its way, everything landed, or
// something failed. The failure case is the only one that shouts.
//
// It lives in the header's CENTRE slot and TAKES IT OVER while it has
// something to say, handing it back to the clip/duration readout when it does
// not. One slot, and whichever fact matters more at that moment: a total you
// can re-read any time loses to "your last edit is not on the server yet".

/** How long "Saved" stays up after a batch lands, before it settles into the
 *  quiet resting state. Long enough to be noticed, short enough that it isn't
 *  claiming freshness it no longer has. */
const SAVED_FLASH_MS = 2600;

function useSaveState() {
  return useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.saveState,
    // Server render: nothing has been written yet.
    () => ({ pending: 0, inFlight: 0, lastSavedAt: null, error: null }),
  );
}

export function GraphSaveStatus({ children }: Readonly<{ children?: ReactNode }>) {
  const { pending, inFlight, lastSavedAt, error } = useSaveState();
  const busy = pending > 0 || inFlight > 0;

  // "Saved" is time-based, so it needs a tick of its own: the gateway has
  // nothing further to notify about once the batch has landed, and without
  // this the flash would hang around until the next unrelated notification.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (busy || lastSavedAt === null) return;
    const timer = setTimeout(() => setNow(Date.now()), SAVED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [busy, lastSavedAt]);

  const justSaved = !busy && lastSavedAt !== null && now - lastSavedAt < SAVED_FLASH_MS;

  // WHAT GETS ANNOUNCED, and what deliberately does not.
  //
  // All three states used to be plain text with a `title`, so a screen-reader
  // user got no warning at all that edits were failing or conflicting — with
  // undo history not surviving a reload, that is the one state with
  // consequences. But wrapping the whole slot in a live region would announce
  // "Saving… Saved… Saving… Saved…" on every debounce tick, which is worse
  // than silence: it buries the failure it exists to surface.
  //
  // So: a persistent polite node carrying only SETTLED results (empty while
  // busy, so the in-progress churn says nothing), and one assertive alert for
  // failures. The visible chip is unchanged and stays aria-hidden — it is the
  // same fact, and announcing it twice is its own noise.
  const announcement = error !== null ? "" : justSaved ? "All changes saved." : "";

  const liveRegion = (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {error !== null ? (
        <span className="sr-only" role="alert">
          Your changes are not being saved. {error}
        </span>
      ) : null}
    </>
  );

  if (error !== null) {
    return (
      <>
        {liveRegion}
        <span
          aria-hidden="true"
          data-save-status="error"
          title={error}
          className="flex shrink-0 items-center gap-1.5 px-3 font-mono text-[11px] text-amber-300"
        >
          <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
          Not saved
        </span>
      </>
    );
  }

  if (busy) {
    return (
      <>
        {liveRegion}
        <span
          aria-hidden="true"
          data-save-status="saving"
          title="Writing your changes"
          className="flex shrink-0 items-center gap-1.5 px-3 font-mono text-[11px] text-zinc-400"
        >
          <CloudUpload aria-hidden="true" className="h-3.5 w-3.5" />
          Saving…
        </span>
      </>
    );
  }

  // The brief confirmation, then the slot goes back to its usual occupant.
  // A permanent "Saved" would be chrome that never says anything new.
  if (justSaved) {
    return (
      <>
        {liveRegion}
        <span
          aria-hidden="true"
          data-save-status="saved"
          title="Every change is on the server"
          className="flex shrink-0 items-center gap-1.5 px-3 font-mono text-[11px] text-zinc-300"
        >
          <Cloud aria-hidden="true" className="h-3.5 w-3.5" />
          Saved
        </span>
      </>
    );
  }

  return (
    <>
      {liveRegion}
      {children}
    </>
  );
}
