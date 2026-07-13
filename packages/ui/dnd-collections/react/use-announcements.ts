"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type NodeId } from "../core/graph";
import { useCollectionsSelector, type CollectionsStore } from "./collections-store";

// The aria-live announcement channel: one `announce(message)` used by every
// interaction path (drags, keyboard moves, palette drops, rejections), plus
// the §20 selection-change announcements. The provider renders the actual
// live region from the returned `announcement`.

export function useLiveAnnouncements(store: CollectionsStore): Readonly<{
  announcement: string;
  announce: (message: string) => void;
}> {
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

  const announce = useCallback((message: string) => {
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
      announce("Selection cleared.");
    } else if (selectedIds.size === 1) {
      const [onlyId] = selectedIds;
      const name = store.getSnapshot().graph.nodesById.get(onlyId)?.name ?? "item";
      announce(`"${name}" selected.`);
    } else {
      announce(`${selectedIds.size} items selected.`);
    }
  }, [selectedIds, announce, store]);

  return { announcement, announce };
}
