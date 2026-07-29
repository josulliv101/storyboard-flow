"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a preview `<video>` seeked to `time`, one in-flight seek at a time.
 *
 * A per-frame settle loop issues a seek only while none is in flight and the
 * element isn't already on target, so a fast drag lands on the newest frame
 * without queueing dozens of decodes. A rAF loop rather than `seeked`
 * bookkeeping on purpose — it is self-healing: a missed event, or a seek the
 * browser coalesced, cannot strand a stale frame because the next frame
 * catches up. (`currentTime` reads back as the seek TARGET mid-seek, so the
 * on-target check doesn't re-issue while decoding either.)
 *
 * `enabled` is what stops the loop from running when there is nothing to seek.
 * This hook was duplicated verbatim in the trim panel and the item details
 * modal; the trim panel's copy was correctly scoped (its component only mounts
 * during a trim gesture), but the modal called it unconditionally — including
 * for IMAGE nodes, where the target is a constant 0 and there is no video
 * element at all — so opening the details view spun a 60fps loop checking a
 * null ref for as long as it stayed open.
 */
export function useSeekedVideo(time: number, enabled = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const targetRef = useRef(time);

  useEffect(() => {
    targetRef.current = time;
  }, [time]);

  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (
        video &&
        video.readyState >= 1 &&
        !video.seeking &&
        Math.abs(video.currentTime - targetRef.current) > 0.03
      ) {
        try {
          video.currentTime = targetRef.current;
        } catch {
          // metadata raced away; next frame retries
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  return attachVideo;
}
