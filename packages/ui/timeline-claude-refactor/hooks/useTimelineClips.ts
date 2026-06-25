import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineClip, TrimScrubPreview } from "../types";
import { createInitialClips } from "../timeline";

/**
 * Owns the clip list plus the two ways callers are allowed to update it
 * during a drag:
 *
 * - `scheduleClips`: batches updates to one per animation frame. Used while
 *   a pointer is actively moving, so fast pointermove bursts don't trigger a
 *   render per event.
 * - `applyClipsNow`: commits immediately and cancels any pending scheduled
 *   update. Used on pointer up / keyboard edits, where the final value must
 *   land synchronously.
 *
 * Also owns `selectedIndex` and `scrubPreview` since both are mutated by the
 * same drag handlers that mutate clips, and are reset together whenever the
 * clip set is regenerated (e.g. itemCount/pixelsPerSecond changes).
 */
export function useTimelineClips(
  itemCount: number,
  pixelsPerSecond: number,
) {
  const [clips, setClips] = useState<TimelineClip[]>(() =>
    createInitialClips(itemCount, pixelsPerSecond),
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [scrubPreview, setScrubPreview] = useState<TrimScrubPreview | null>(
    null,
  );

  const pendingClipsRef = useRef<TimelineClip[] | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    setClips(createInitialClips(itemCount, pixelsPerSecond));
    setSelectedIndex(null);
    setScrubPreview(null);
  }, [itemCount, pixelsPerSecond]);

  const scheduleClips = useCallback((nextClips: TimelineClip[]) => {
    pendingClipsRef.current = nextClips;

    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      const pendingClips = pendingClipsRef.current;
      pendingClipsRef.current = null;
      frameRef.current = null;

      if (!pendingClips) return;
      setClips(pendingClips);
    });
  }, []);

  const applyClipsNow = useCallback((nextClips: TimelineClip[]) => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    pendingClipsRef.current = null;
    setClips(nextClips);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return {
    clips,
    selectedIndex,
    setSelectedIndex,
    scrubPreview,
    setScrubPreview,
    scheduleClips,
    applyClipsNow,
  };
}
