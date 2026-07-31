"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
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
// IT TRAILS THE BREADCRUMB, and owns nothing but its own width.
//
// It used to sit in the header's CENTRE slot and take it over while it had
// something to say, handing it back to the clip/duration readout afterwards.
// That was a real trade — one slot, whichever fact matters more — but the
// centre stopped being a place with one occupant: it carries the selection
// count and the controls that act on it, and blanking those for the length of
// every debounce hid live controls behind a transient status. A status that
// interrupts the thing you are using is the wrong shape.
//
// So it appends to the breadcrumb, where "where am I / how is it doing" read as
// one line, and it takes no space at all when there is nothing to report.
//
// TEXT ONLY. The icons went with the move: at this size a glyph adds nothing a
// three-word label does not already say, and the trailing position means it now
// sits beside a path rather than centred as a chip.

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

/** One shape for all three states — only the words and the colour differ. */
const STATUS_CLASS = "shrink-0 whitespace-nowrap font-mono text-[11px]";

export function GraphSaveStatus() {
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
  // So this announces exactly one thing: that a save SETTLED. Empty while busy,
  // so the in-progress churn says nothing.
  //
  // FAILURES ARE NOT ANNOUNCED HERE. They already are, by the gateway's error
  // banner in graph-timeline-view — which reads the SAME `errorBanner` string
  // this chip does, is visible, and carries `role="alert"`. A second alert with
  // the same text meant a screen-reader user heard the failure twice from two
  // live regions, which is the noise problem this design exists to avoid. (The
  // e2e caught it as a strict-mode violation: two elements matching one
  // message.) The chip stays as the visual half of that one fact.
  const liveRegion = (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {error === null && justSaved ? "All changes saved." : ""}
    </span>
  );

  if (error !== null) {
    return (
      <>
        {liveRegion}
        <span
          aria-hidden="true"
          data-save-status="error"
          title={error}
          className={cn(STATUS_CLASS, "text-amber-300")}
        >
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
          className={cn(STATUS_CLASS, "text-zinc-500")}
        >
          Saving…
        </span>
      </>
    );
  }

  // The brief confirmation, then it goes quiet. A permanent "Saved" would be
  // chrome that never says anything new — and now that it no longer displaces
  // another readout, "quiet" costs nothing at all.
  if (justSaved) {
    return (
      <>
        {liveRegion}
        <span
          aria-hidden="true"
          data-save-status="saved"
          title="Every change is on the server"
          className={cn(STATUS_CLASS, "text-zinc-500")}
        >
          Saved
        </span>
      </>
    );
  }

  return liveRegion;
}
