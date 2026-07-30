"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

// Where a trim drag's live frame is SHOWN (PL14-006).
//
// The floating panel above the card (graph-trim-panel) exists because there was
// nowhere else to put it. When the preview pane is open there IS somewhere
// else — a large picture already pointed at by the user's attention — and a
// second, smaller copy of the same frame floating over the board is one picture
// too many.
//
// So: pane open → the frame takes the pane. Pane closed → the floating panel,
// exactly as before. This module is the seam between the two, and it is a
// React CONTEXT rather than a window event because both ends live inside the
// graph's own tree (the board renders as the preview component's children).
// The window-event bridge is for the sidebar, which does not.
//
// THE PLAYHEAD IS NOT TOUCHED. That was the constraint carried over from round
// 5, when this half was deferred, and it is why nothing here goes near
// `PreviewTimeChannel.set`: the clock keeps its time, the pane's own canvas
// keeps rendering that time underneath, and this draws OVER it for the length
// of the gesture. Release the handle and the overlay unmounts onto a pane that
// never moved.

/**
 * Exactly what the pane needs to draw the frame, and nothing else.
 *
 * It carried `src`, `poster` and `side` while this was an overlay, because an
 * overlay had to build its own `<video>`. The pane already has the clip — it is
 * rendering that timeline — so an id and a source time is the whole request.
 * Matches `WorkbenchDisplaySurface.frameOverride` field for field on purpose:
 * this is that prop, in flight.
 */
export type TrimPreviewFrame = Readonly<{
  /** The media SOURCE. Not a clip id: the pane plays either the focused
   *  level's projection (ids are node ids) or the compiled manifest (ids are
   *  path-qualified), so an id matches in one model and misses in the other.
   *  A src is the same string in both. */
  src: string;
  poster?: string;
  /** SOURCE seconds — the frame the moving edge is currently on. */
  sourceTime: number;
}>;

type TrimPreviewStore = Readonly<{
  get: () => TrimPreviewFrame | null;
  set: (frame: TrimPreviewFrame | null) => void;
  subscribe: (listener: () => void) => () => void;
}>;

type TrimPreviewValue = Readonly<{
  /** Whether the pane is open — the whole condition of this feature. */
  previewOpen: boolean;
  store: TrimPreviewStore;
}>;

function createStore(): TrimPreviewStore {
  let frame: TrimPreviewFrame | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => frame,
    set: (next) => {
      frame = next;
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

/** Closed and inert by default, so a card rendered outside the provider (a
 *  story, a test harness) keeps the floating-panel behaviour rather than
 *  publishing into nothing. */
const INERT: TrimPreviewValue = {
  previewOpen: false,
  store: { get: () => null, set: () => {}, subscribe: () => () => {} },
};

const TrimPreviewContext = createContext<TrimPreviewValue>(INERT);

/**
 * Own the store from the component that renders BOTH ends.
 *
 * It cannot live inside the provider: the pane is passed to the split pane as a
 * `surface` PROP and needs the frame as a prop too, so the owner has to read
 * the store and provide it in the same render. A provider that created it
 * internally would be reachable from the cards and invisible to the pane.
 */
export function useTrimPreviewStore(): TrimPreviewStore {
  const [store] = useState(createStore);
  return store;
}

/** Subscribe to the live frame. For the owner, to hand to the pane. */
export function useTrimPreviewFrame(store: TrimPreviewStore): TrimPreviewFrame | null {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

export function TrimPreviewProvider({
  previewOpen,
  store,
  children,
}: Readonly<{
  previewOpen: boolean;
  store: TrimPreviewStore;
  children: React.ReactNode;
}>) {
  const value = useMemo<TrimPreviewValue>(
    () => ({ previewOpen, store }),
    [previewOpen, store],
  );
  // Closing the pane mid-drag must not leave a frame parked in the store for
  // the next drag to inherit.
  useEffect(() => {
    if (!previewOpen) store.set(null);
  }, [previewOpen, store]);
  return (
    <TrimPreviewContext.Provider value={value}>{children}</TrimPreviewContext.Provider>
  );
}

export function useTrimPreview(): TrimPreviewValue {
  return useContext(TrimPreviewContext);
}

/**
 * Publishes the live edge frame while a trim drag is running AND the pane is
 * open. Returns whether it took the frame — the caller renders its floating
 * panel only when this says no, so exactly one of the two is ever showing.
 */
export function usePublishTrimPreview(frame: TrimPreviewFrame | null): boolean {
  const { previewOpen, store } = useTrimPreview();
  const taken = previewOpen && frame !== null;

  // TWO effects, deliberately. Publishing and clearing are keyed differently:
  // the frame changes on every pointer move, while "is a drag running" changes
  // twice. Folding them into one effect with a cleanup would set null between
  // every pair of frames, and the overlay would unmount and remount its
  // <video> — a black flash per pointer move instead of a seek.
  useEffect(() => {
    if (taken) store.set(frame);
  }, [taken, frame, store]);

  useEffect(() => {
    if (!taken) return;
    // Clearing on the way out is what ends the overlay — the gesture ending
    // unmounts the panel, which is the only signal there is.
    return () => store.set(null);
  }, [taken, store]);

  return taken;
}

/**
 * WHY THIS IS A FRAME REQUEST AND NOT AN OVERLAY.
 *
 * The first version portalled a second `<video>` over the pane's rect. It
 * looked right and was not: it decoded the file a second time instead of
 * reusing the pane's cache, it left the pane's transport readout describing a
 * different moment than its own picture, its CSS `object-contain` only
 * approximated the canvas's draw math, and a playing pane went on playing
 * invisibly underneath it. It also shipped a full version behind the pane's
 * `z-40` — invisible — because covering something is a stacking problem that
 * driving it does not have.
 *
 * Covering a component is not the same as driving it. The frame now goes to
 * `WorkbenchDisplaySurface.frameOverride`, so the pane's OWN canvas draws it,
 * from the element it already had cached.
 */
