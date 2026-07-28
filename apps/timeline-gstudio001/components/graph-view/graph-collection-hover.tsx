"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

/**
 * With child timelines shown, a collection appears TWICE: as a card in the
 * surface and as its own row below. Hovering either one highlights the other,
 * so the pairing is visible instead of something the user has to infer from
 * two identical names.
 *
 * A subscribable channel rather than context state: every collection card on
 * screen consumes this, and putting the hovered id in a context value would
 * re-render all of them (and their subtrees) on every pointer move between
 * cards. Each consumer subscribes with its own id and re-renders only when ITS
 * answer flips, so a hover repaints exactly the two elements that changed.
 */
type HoverListener = () => void;

type CollectionHoverChannel = Readonly<{
  get: () => string | null;
  set: (next: string | null) => void;
  subscribe: (listener: HoverListener) => () => void;
}>;

function createCollectionHoverChannel(): CollectionHoverChannel {
  let hovered: string | null = null;
  const listeners = new Set<HoverListener>();
  return {
    get: () => hovered,
    set: (next) => {
      if (hovered === next) return;
      hovered = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const CollectionHoverContext = createContext<CollectionHoverChannel | null>(null);

/** Stable no-op subscribe for the provider-less case — `useSyncExternalStore`
 *  resubscribes whenever this argument's identity changes. */
const NO_SUBSCRIBE = () => () => {};

/**
 * `enabled` is the children toggle. With it off there is no row for a card to
 * pair WITH, so the provider hands down nothing and the hook degrades to a
 * no-op — a card that highlighted itself with no counterpart would just be an
 * unexplained flicker.
 */
export function CollectionHoverProvider({
  enabled,
  children,
}: Readonly<{ enabled: boolean; children: ReactNode }>) {
  const channel = useMemo(() => createCollectionHoverChannel(), []);
  return (
    <CollectionHoverContext.Provider value={enabled ? channel : null}>
      {children}
    </CollectionHoverContext.Provider>
  );
}

const NO_PAIR = {
  paired: false,
  onPointerEnter: undefined,
  onPointerLeave: undefined,
} as const;

/**
 * Whether `collectionId`'s twin is currently hovered, plus the handlers that
 * announce this element as the hovered one. Undefined handlers when there is
 * no provider (or children are off) so the props simply don't attach.
 */
export function useCollectionHoverPair(collectionId: string): Readonly<{
  paired: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}> {
  const channel = useContext(CollectionHoverContext);
  const paired = useSyncExternalStore(
    channel ? channel.subscribe : NO_SUBSCRIBE,
    () => (channel ? channel.get() === collectionId : false),
    () => false,
  );
  return useMemo(
    () =>
      channel
        ? {
            paired,
            onPointerEnter: () => channel.set(collectionId),
            // Clear only if we are still the hovered one: pointer events can
            // arrive out of order when moving directly between the card and
            // its row, and a late leave would otherwise wipe the enter that
            // already landed.
            onPointerLeave: () => {
              if (channel.get() === collectionId) channel.set(null);
            },
          }
        : NO_PAIR,
    [channel, collectionId, paired],
  );
}
