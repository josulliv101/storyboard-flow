import { useCallback, useEffect, useRef, useState } from "react";
import { type TimelineItemId } from "./core/media-strip.types";

const REJECTION_FLASH_MS = 600;

/**
 * Tracks which item, if any, should show a brief visual "that didn't work"
 * cue after a rejected drop (e.g. an invalid nesting cycle). The rejection
 * announcement (aria-live) already exists and covers screen-reader users;
 * this covers sighted pointer users, who otherwise see a rejected drag
 * silently snap back with no indication anything happened.
 *
 * Deliberately separate from useBoardDragState: the flash needs to outlive
 * the drag itself (endDrag() has already cleared activeDragId by the time
 * a rejection is known), so it can't just be another field on that reducer.
 */
export function useMediaStripRejectionFlash() {
  const [rejectedItemId, setRejectedItemId] = useState<TimelineItemId | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const flashRejection = useCallback((itemId: TimelineItemId) => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    setRejectedItemId(itemId);
    timeoutRef.current = window.setTimeout(() => {
      setRejectedItemId(null);
      timeoutRef.current = null;
    }, REJECTION_FLASH_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { rejectedItemId, flashRejection };
}
