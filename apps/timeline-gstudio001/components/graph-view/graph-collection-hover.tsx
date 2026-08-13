"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
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

/**
 * How long the card's call-out keyframes run. MUST stay in sync with
 * `collection-paired-callout` in globals.css.
 */
const COLLECTION_CALLOUT_KEYFRAMES_MS = 320;

/**
 * How long the class is HELD on the card, which is deliberately longer.
 *
 * The hold must OUTLAST the keyframes, not merely match them. This timer
 * starts when the class is set; the animation does not start until the frame
 * AFTER the browser has applied it. So a hold equal to the duration expires a
 * frame or two BEFORE the animation ends, drops the class mid-flight, and
 * cancels precisely what the hold exists to protect — the last frames of the
 * elastic settle. The old value was exactly 320 and did this on roughly half
 * of runs, reporting `cancelled` instead of `finished`.
 *
 * That is also why the e2e asserts on the animation's own outcome rather than
 * on the class still being present: presence is a race, `finished` vs
 * `cancelled` is the actual question.
 *
 * The margin is a few frames at 60Hz — enough to absorb a couple of slow ones,
 * and imperceptible because the class does nothing once the keyframes have
 * ended (no fill mode, so the card is already back at rest).
 */
export const COLLECTION_CALLOUT_MS = COLLECTION_CALLOUT_KEYFRAMES_MS + 80;

/**
 * The TARGET end, for a collection card: whether its row is being hovered
 * right now. Drives a one-shot call-out on the card (see
 * `graph-item-content`), so what matters is the transition into true.
 *
 * It HOLDS past the pointer leaving. The call-out is an animation, and the
 * card only carries it for as long as this returns true — so a flick across a
 * folder used to start the elastic scale and then kill it a frame or two in,
 * leaving a card that twitched and stopped. Once triggered it now plays out,
 * whether or not the pointer stayed.
 *
 * The hold is timed from the FIRST trigger, not extended by later ones: it
 * tracks the animation that is already running, so re-entering the same folder
 * mid-play lets that play finish rather than restarting it (a wiggle over one
 * row shouldn't strobe). Re-entering after it ends drops the class and re-adds
 * it, which is what restarts the animation.
 */
export function useCollectionHoverTarget(collectionId: string): boolean {
  const channel = useContext(CollectionHoverContext);
  const hovered = useSyncExternalStore(
    channel ? channel.subscribe : NO_SUBSCRIBE,
    () => (channel ? channel.get() === collectionId : false),
    () => false,
  );

  const [holding, setHolding] = useState(false);
  const [wasHovered, setWasHovered] = useState(hovered);

  // Latch on the RISING edge, adjusted during render (the repo's
  // cascading-render-safe pattern — a synchronous setState in an effect trips
  // the lint). Edge-triggered, not level-triggered: latching on every render
  // where `hovered` is true would re-arm the timer forever while the pointer
  // rests on a folder.
  if (hovered !== wasHovered) {
    setWasHovered(hovered);
    if (hovered) setHolding(true);
  }

  useEffect(() => {
    if (!holding) return;
    // Deliberately NOT keyed on `hovered`: the whole point is that the pointer
    // leaving must not cancel this timer.
    const timer = window.setTimeout(() => setHolding(false), COLLECTION_CALLOUT_MS);
    return () => window.clearTimeout(timer);
  }, [holding]);

  return hovered || holding;
}
