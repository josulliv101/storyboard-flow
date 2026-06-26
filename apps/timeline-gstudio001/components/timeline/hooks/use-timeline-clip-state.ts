import { useCallback, useEffect, useRef, useState } from "react";

import {
  TIMELINE_LEADING_PADDING_SECONDS,
} from "../constants";
import type { TimelineClip, TrimScrubPreview } from "../types";
import { createInitialClips } from "./use-timeline-clips";

type UseTimelineClipStateOptions = {
  initialClips?: TimelineClip[];
  itemCount: number;
  parentRef: React.RefObject<HTMLDivElement | null>;
  pendingScrollLeftRef: React.MutableRefObject<number | null>;
  resetKey: string;
  setScrollLeft: React.Dispatch<React.SetStateAction<number>>;
};

function cloneTimelineClips(clips: TimelineClip[]) {
  return clips.map((clip) =>
    clip.kind === "collection"
      ? {
          ...clip,
          previewItems: clip.previewItems?.map((item) => ({ ...item })),
        }
      : { ...clip },
  );
}

export function useTimelineClipState({
  initialClips,
  itemCount,
  parentRef,
  pendingScrollLeftRef,
  resetKey,
  setScrollLeft,
}: UseTimelineClipStateOptions) {
  const resizeFrameRef = useRef<number | null>(null);
  const pendingClipsRef = useRef<TimelineClip[] | null>(null);
  const isInitialMount = useRef(true);

  const [clips, setClips] = useState<TimelineClip[]>(() =>
    initialClips
      ? cloneTimelineClips(initialClips)
      : createInitialClips(itemCount, 100),
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [scrubPreview, setScrubPreview] = useState<TrimScrubPreview | null>(null);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const nextClips = initialClips
      ? cloneTimelineClips(initialClips)
      : createInitialClips(itemCount, 100);
    const nextScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * 100;
    setClips(nextClips);
    setSelectedIndex(null);
    setScrubPreview(null);
    setScrollLeft(nextScrollLeft);

    if (parentRef.current) {
      parentRef.current.scrollLeft = nextScrollLeft;
    }
  }, [initialClips, itemCount, parentRef, resetKey, setScrollLeft]);

  const scheduleClips = useCallback((nextClips: TimelineClip[]) => {
    pendingClipsRef.current = nextClips;
    if (resizeFrameRef.current !== null) return;

    resizeFrameRef.current = requestAnimationFrame(() => {
      const pendingClips = pendingClipsRef.current;
      pendingClipsRef.current = null;
      resizeFrameRef.current = null;
      if (pendingClips) setClips(pendingClips);
    });
  }, []);

  const applyClipsNow = useCallback((nextClips: TimelineClip[]) => {
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }

    pendingClipsRef.current = null;
    setClips(nextClips);
  }, []);

  useEffect(() => {
    if (pendingScrollLeftRef.current !== null && parentRef.current) {
      parentRef.current.scrollLeft = pendingScrollLeftRef.current;
      pendingScrollLeftRef.current = null;
    }
  }, [clips, parentRef, pendingScrollLeftRef]);

  const cleanupClipFrames = useCallback(() => {
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
    }
  }, []);

  return {
    clips,
    setClips,
    selectedIndex,
    setSelectedIndex,
    scrubPreview,
    setScrubPreview,
    scheduleClips,
    applyClipsNow,
    cleanupClipFrames,
  };
}
