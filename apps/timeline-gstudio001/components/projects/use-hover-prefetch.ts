"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/** How long the pointer must rest on a card before its board is fetched.
 *
 *  Sweeping a cursor across a grid crosses every card on the way to one of
 *  them, and each crossing would otherwise cost a full server render. The delay
 *  is what separates "moving past" from "looking at", and it is short enough
 *  that a deliberate hover still finishes the fetch before the click lands. */
export const HOVER_PREFETCH_DELAY_MS = 120;

/**
 * Fetch a project's board when the pointer settles on its card.
 *
 * WHY NOT `prefetch` ON THE LINK. `<Link prefetch>` fires on VIEWPORT ENTRY,
 * and a full prefetch of a project is a complete server render: the closure
 * query, the trash, the dangling ids — 149 Firestore reads, measured. Every
 * card on screen would pay that for merely being scrolled past:
 *
 *     4 project cards × 149 reads = ~600 reads to LOOK at the list
 *
 * which is the shape of the incident that started all of this (#437) rebuilt on
 * purpose. The DEFAULT (`auto`) prefetch is safe precisely because it stops at
 * the `loading.tsx` boundary and touches no data — that is what paints the
 * skeleton instantly — but it leaves the board itself to be fetched on click,
 * measured at ~926ms of server work in production.
 *
 * Hover is where those two meet: the full payload, but only once someone aims
 * at a card. Intent usually becomes a click, so the read is rarely wasted, and
 * `staleTimes.dynamic` (30s) keeps the result fresh long enough for the click
 * to land on it.
 *
 * IT SCALES WITH THE LIST, which is the honest limit. Four cards is nothing; a
 * page of fifty invites a user to spend reads while scanning. The delay is what
 * keeps that bounded, and it is the number to revisit if the projects page ever
 * grows.
 */
export function useHoverPrefetch() {
  const router = useRouter();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Prefetched THIS mount, so re-entering a card does not re-ask. Next's own
  // router cache would mostly absorb a repeat, but only within its window and
  // only after the first has landed — a user moving back and forth between two
  // cards can outrun it.
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const onEnter = useCallback(
    (href: string) => {
      if (requested.current.has(href) || timers.current.has(href)) return;
      const timer = setTimeout(() => {
        timers.current.delete(href);
        requested.current.add(href);
        // FULL, not the default. `auto` is what the Link already does; asking
        // for it again here would spend a request to re-fetch the same shell.
        router.prefetch(href, { kind: PrefetchKind.FULL });
      }, HOVER_PREFETCH_DELAY_MS);
      timers.current.set(href, timer);
    },
    [router],
  );

  const onLeave = useCallback((href: string) => {
    const timer = timers.current.get(href);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.current.delete(href);
  }, []);

  return { onEnter, onLeave };
}
