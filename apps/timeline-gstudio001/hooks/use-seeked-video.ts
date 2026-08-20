"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a preview media element seeked to `time`, one in-flight seek at a time
 * — or, while `playing`, lets it run and only corrects it when it drifts.
 *
 * TWO MODES BECAUSE A SEEK MAKES NO SOUND. Stepping `currentTime` is exactly
 * right for showing a frame under a scrub, and it is silent by construction, so
 * a view that only ever stepped could never play audio however loud it was
 * turned up. Playing hands the element back its own clock.
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
export function useSeekedVideo(time: number, enabled = true, playing = false) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const targetRef = useRef(time);

  useEffect(() => {
    targetRef.current = time;
  }, [time]);

  const attachVideo = useCallback((media: HTMLMediaElement | null) => {
    mediaRef.current = media;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let blocked = false;

    const tick = () => {
      const media = mediaRef.current;
      if (media && media.readyState >= 1) {
        if (playing) {
          // LET IT RUN. Stepping `currentTime` frame by frame is how this shows
          // a still, and it is also why a stepped element is SILENT: a seek is
          // not playback, and there is no sound to come out of one. So while
          // the transport is running the element plays itself, and the clock
          // only corrects it when it has genuinely drifted — a seek per frame
          // would keep chopping the audio back to nothing.
          if (media.paused) {
            void media.play().catch(() => {
              // Sound refused (no user activation yet). Muted playback is
              // still allowed, and a silent picture beats a frozen one — the
              // next press, which IS a gesture, gets the audio back.
              if (!blocked) {
                blocked = true;
                media.muted = true;
                void media.play().catch(() => {});
              }
            });
          }
          if (!media.seeking && Math.abs(media.currentTime - targetRef.current) > DRIFT_SECONDS) {
            try {
              media.currentTime = targetRef.current;
            } catch {
              // metadata raced away; next frame retries
            }
          }
        } else {
          if (!media.paused) media.pause();
          if (!media.seeking && Math.abs(media.currentTime - targetRef.current) > 0.03) {
            try {
              media.currentTime = targetRef.current;
            } catch {
              // metadata raced away; next frame retries
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Leaving the loop must not leave a source audible: the modal can close
      // mid-play, and an element nobody can see is still an element making
      // noise.
      mediaRef.current?.pause();
    };
  }, [enabled, playing]);

  return attachVideo;
}

/**
 * How far the element may drift from the clock before it is pulled back.
 *
 * Generous on purpose. The clock and a playing element both advance in real
 * time, so drift is small and slow; correcting it tightly would mean seeking
 * during playback, and every seek is a hole in the audio. A quarter-second is
 * under the threshold where a cut reads as mistimed and far above the jitter
 * of a frame or two.
 */
const DRIFT_SECONDS = 0.25;
