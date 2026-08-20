"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the primary pointer is a THUMB rather than a mouse.
 *
 * The same `(pointer: coarse)` query the touch sizing all over the graph view
 * keys off (`[@media(pointer:coarse)]:h-11` and friends). Most of those are
 * pure CSS and need no hook; this exists for the one decision that is not a
 * size but a BEHAVIOUR — whether trim handles are drawn on every clip or only
 * on the selected one, which is a prop and cannot be a media query.
 *
 * IT SUBSCRIBES rather than reading once. A tablet with a keyboard case
 * attached and detached changes this answer without reloading, and an
 * iPad that gains a trackpad flips to `fine` mid-session; a value read at
 * mount would leave the strip in the wrong mode until navigation.
 *
 * THE SERVER ANSWER IS `false`, which is a choice and not a fallback. There is
 * no pointer on the server, so the question is which guess costs less when it
 * is wrong: guessing fine on a tablet shows one frame of always-on handles
 * before hydration corrects it, while guessing coarse on a desktop hides an
 * affordance that should have been there. A visible extra beats a missing one.
 */
export function useCoarsePointer(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return () => {};
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.("(pointer: coarse)").matches === true,
    () => false,
  );
}
