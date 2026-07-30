"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { useSeekedVideo } from "@/hooks/use-seeked-video";
import { formatSeconds } from "@/lib/format-duration";

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

export type TrimPreviewFrame = Readonly<{
  nodeId: string;
  src: string;
  poster?: string;
  /** SOURCE seconds — the frame the moving edge is currently on. */
  sourceTime: number;
  /** Which edge is moving, so the overlay can wear the handle's amber bar on
   *  the same side the panel would have. */
  side: "left" | "right";
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

export function TrimPreviewProvider({
  previewOpen,
  children,
}: Readonly<{ previewOpen: boolean; children: React.ReactNode }>) {
  const [store] = useState(createStore);
  // The store is stable; only the open flag changes identity, and it changes
  // rarely (a pane toggle), so this is not a per-frame allocation.
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

/** The pane's picture area, which is what the overlay covers. */
const CANVAS_SELECTOR = '[data-testid="workbench-display-canvas"]';

/**
 * The trim frame, drawn over the preview pane's picture for the length of the
 * gesture.
 *
 * Positioned `fixed` against the canvas's measured rect rather than mounted
 * inside the pane. The pane is a package component with its own layout
 * (WorkbenchSplitPane sizes it, a divider drags it); slipping an absolutely
 * positioned child into it would make this feature a `packages/ui` change and
 * put a graph concern inside a generic surface. Measuring is the same
 * technique the floating panel already uses, and it leaves the package alone.
 */
export function TrimPreviewOverlay() {
  const { store } = useTrimPreview();
  const frame = useSyncExternalStore(store.subscribe, store.get, () => null);
  const videoRef = useSeekedVideo(frame?.sourceTime ?? 0, frame !== null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !frame) return;
    const canvas = document.querySelector(CANVAS_SELECTOR);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }, [frame]);

  if (!frame) return null;

  return createPortal(
    <div
      ref={boxRef}
      data-trim-preview-overlay={frame.side}
      aria-hidden="true"
      // z-[60], the floating panel's level, and it has to be: the pane it
      // covers is `sticky z-40`, so anything below that renders BEHIND the
      // picture it is meant to replace — present, correctly sized, invisible.
      className="pointer-events-none fixed z-[60] overflow-hidden bg-black"
      style={{ left: -9999, top: -9999 }}
    >
      <video
        ref={videoRef}
        src={frame.src}
        poster={frame.poster}
        muted
        playsInline
        preload="auto"
        className="h-full w-full bg-black object-contain"
      />
      {/* Same amber bar the floating panel wears, on the same edge — the two
          presentations should read as one feature in two places. */}
      <span
        className={[
          "absolute inset-y-0 w-1 bg-amber-400",
          frame.side === "right" ? "right-0" : "left-0",
        ].join(" ")}
      />
      <span className="absolute bottom-0 right-0 bg-zinc-950/85 px-1.5 py-0.5 font-mono text-xs leading-tight tabular-nums text-amber-200">
        {formatSeconds(frame.sourceTime)}
      </span>
    </div>,
    document.body,
  );
}
