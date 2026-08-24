"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * With child timelines shown, a collection appears TWICE: as a card in the
 * surface and as its own row below. Hovering the ROW's folder calls out the
 * matching card, so the pairing is visible instead of something the user has
 * to infer from two identical names.
 *
 * ONE DIRECTION. The card does not call out the row: the tree is a place you
 * go looking for a card, not the other way round, and lighting both ends made
 * every pass of the pointer across the surface twitch something below.
 *
 * A subscribable channel rather than context state: every collection card on
 * screen consumes this, and putting the hovered id in a context value would
 * re-render all of them (and their subtrees) on every pointer move between
 * rows. Each consumer subscribes with its own id and re-renders only when ITS
 * answer flips, so a hover repaints exactly the card that changed.
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

const NO_HANDLERS = {
  onPointerEnter: undefined,
  onPointerLeave: undefined,
} as const;

/**
 * The SOURCE end, for a child timeline row's folder: the handlers that announce
 * this collection as the hovered one. Undefined when there is no provider (or
 * children are off), so the props simply don't attach.
 */
export function useCollectionHoverSource(collectionId: string): Readonly<{
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}> {
  const channel = useContext(CollectionHoverContext);
  return useMemo(
    () =>
      channel
        ? {
            onPointerEnter: () => channel.set(collectionId),
            // Clear only if we are still the hovered one: pointer events can
            // arrive out of order when moving between adjacent rows, and a
            // late leave would otherwise wipe the enter that already landed.
            onPointerLeave: () => {
              if (channel.get() === collectionId) channel.set(null);
            },
          }
        : NO_HANDLERS,
    [channel, collectionId],
  );
}

/*
 * TWO DURATIONS USED TO LIVE HERE and both are gone with the animation
 * (PL15-009): `COLLECTION_CALLOUT_KEYFRAMES_MS`, which had to stay equal to
 * the keyframes in globals.css, and `COLLECTION_CALLOUT_MS`, which was
 * deliberately LONGER so a hold could outlast them.
 *
 * The second one is worth remembering even though nothing needs it now. A hold
 * equal to the animation's own duration expired a frame or two BEFORE the
 * animation ended — the timer started when the class was applied and the
 * animation only started the frame after — so it dropped the class mid-flight
 * and cancelled precisely the settle it existed to protect, on roughly half of
 * runs. Any future "hold a class for exactly as long as its animation" has the
 * same bug waiting in it.
 */

/**
 * The TARGET end, for a collection card: whether its row is being hovered
 * right now.
 *
 * IT FOLLOWS THE POINTER EXACTLY, and that is a change of kind rather than a
 * simplification (PL15-009). This used to HOLD past the pointer leaving,
 * because the call-out was a one-shot animation: a flick across a folder
 * started the elastic scale and then killed it a frame or two in, leaving a
 * card that twitched and stopped, so once triggered it was made to play out
 * whether or not the pointer stayed.
 *
 * A steady glow wants the opposite. There is no play to protect, and a
 * highlight that outlived the pointer by a third of a second would read as
 * lag — the card staying lit after you have moved on, which is exactly the
 * complaint a hold was invented to cure in the other direction.
 */
export function useCollectionHoverTarget(collectionId: string): boolean {
  const channel = useContext(CollectionHoverContext);
  const hovered = useSyncExternalStore(
    channel ? channel.subscribe : NO_SUBSCRIBE,
    () => (channel ? channel.get() === collectionId : false),
    () => false,
  );

  return hovered;
}
