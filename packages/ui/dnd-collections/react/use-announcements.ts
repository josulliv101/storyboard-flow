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
  const announce = useCallback((message: string) => {
    // Toggle a trailing zero-width space so repeating the same message still
    // re-announces (aria-live only fires on content changes).
    setAnnouncement((prev) => (prev === message ? `${message}​` : message));
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
