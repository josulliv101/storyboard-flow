"use client";

import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { type NodeId } from "../core/graph";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";

// The aria-live announcement channel: one `announce(message)` used by every
// interaction path (drags, keyboard moves, palette drops, rejections), plus
// the selection-change announcements.
//
// The channel is a ref-backed EMITTER, not provider state, and the live
// region lives in its own leaf component (`LiveAnnouncementRegion`). This is
// load-bearing for the render-efficiency model: the provider renders
// <DndContext>, and any state update there re-renders every useDraggable/
// useDroppable consumer through dnd-kit's internal context — announcement
// state in the provider would re-render EVERY card each time something is
// spoken (including mid-drag "Over …" feedback), breaking the
// no-bystander-re-render guarantee. Speaking must only ever re-render the
// region itself.

export type AnnounceChannel = Readonly<{
  /** Speak a message through the instance's live region. Safe to call from
   *  event handlers and effects; a no-op until the region mounts. */
  announce: (message: string) => void;
  /** The region's subscription seam. One region per channel. */
  subscribe: (listener: (message: string) => void) => () => void;
}>;

/** One stable channel per provider instance. */
export function useAnnounceChannel(): AnnounceChannel {
  const channelRef = useRef<AnnounceChannel | null>(null);
  if (channelRef.current === null) {
    const listeners = new Set<(message: string) => void>();
    channelRef.current = {
      announce: (message) => {
        for (const listener of listeners) listener(message);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }
  return channelRef.current;
}

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * The instance's polite live region — the ONLY component announcement state
 * re-renders. Also owns the selection-change announcements (set identity only
 * changes on real selection changes, so it is quiet during drags/reorders).
 */
export const LiveAnnouncementRegion = memo(function LiveAnnouncementRegion({
  channel,
}: {
  channel: AnnounceChannel;
}): ReactElement {
  const store = useCollectionsStore();
  const [announcement, setAnnouncement] = useState("");
  const announcementRef = useRef("");
  const repeatTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (repeatTimerRef.current !== null) {
        window.clearTimeout(repeatTimerRef.current);
      }
    },
    []
  );

  const speak = useCallback((message: string) => {
    if (repeatTimerRef.current !== null) {
      window.clearTimeout(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }

    if (announcementRef.current !== message) {
      announcementRef.current = message;
      setAnnouncement(message);
      return;
    }

    // A live region does not announce an assignment that leaves its text
    // unchanged. Clear repeated text, then insert the exact message again in
    // a later task so assistive technology observes two real DOM changes.
    // Keeping the delay here (rather than adding an invisible character)
    // preserves the spoken text verbatim.
    announcementRef.current = "";
    setAnnouncement("");
    repeatTimerRef.current = window.setTimeout(() => {
      announcementRef.current = message;
      repeatTimerRef.current = null;
      setAnnouncement(message);
    }, 50);
  }, []);

  useEffect(() => channel.subscribe(speak), [channel, speak]);

  // Selection changes are announced. Set identity only changes on real
  // selection changes (the store no-ops same-set updates), so this effect
  // is quiet during drags and reorders.
  const selectedIds = useCollectionsSelector((s) => s.interaction.selectedIds);
  const previousSelectionRef = useRef<ReadonlySet<NodeId> | null>(null);
  useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = selectedIds;
    if (previous === null || previous === selectedIds) return; // mount / no change
    if (selectedIds.size === 0) {
      speak("Selection cleared.");
    } else if (selectedIds.size === 1) {
      const [onlyId] = selectedIds;
      // `size === 1` guarantees it; `?? "item"` is the same fallback the
      // missing-node case already uses, so the announcement degrades the way
      // the rest of this function does rather than saying "undefined".
      const name =
        onlyId === undefined
          ? "item"
          : (store.getSnapshot().graph.nodesById.get(onlyId)?.name ?? "item");
      speak(`"${name}" selected.`);
    } else {
      speak(`${selectedIds.size} items selected.`);
    }
  }, [selectedIds, speak, store]);

  return createElement(
    "div",
    { "aria-live": "polite", role: "status", style: VISUALLY_HIDDEN },
    announcement
  );
});
