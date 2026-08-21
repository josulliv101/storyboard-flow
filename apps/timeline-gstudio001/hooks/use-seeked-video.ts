"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
export function useSeekedVideo(
  time: number,
  enabled = true,
  playing = false,
  scrub: Readonly<{ proxySrc?: string | null; scrubbing?: boolean }> = {},
) {
  const { proxySrc = null, scrubbing = false } = scrub;
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const proxyElementRef = useRef<HTMLVideoElement | null>(null);
  const targetRef = useRef(time);
  const scrubbingRef = useRef(scrubbing);
  const hasProxy = proxySrc !== null;

  /**
   * WHICH ELEMENT IS ON SCREEN.
   *
   * Mostly derived: while a scrub is running the answer is simply "the proxy".
   * The only thing that needs remembering is the tail — after the hand stops,
   * the proxy has to stay up until the real element has actually caught up, or
   * the swap reveals whatever frame it was left on when the drag STARTED.
   *
   * Adjusted during render rather than in an effect. Setting state from an
   * effect for this is a lint error in this repo and deserves to be: it renders
   * the wrong element first and corrects it on a second pass, which for one
   * frame is exactly the stale picture this exists to avoid.
   */
  const [heldAfterScrub, setHeldAfterScrub] = useState(false);
  const [previousScrubbing, setPreviousScrubbing] = useState(scrubbing);
  const [previousProxySrc, setPreviousProxySrc] = useState(proxySrc);
  const heldRef = useRef(false);

  if (previousScrubbing !== scrubbing) {
    setPreviousScrubbing(scrubbing);
    // Entering a scrub needs no flag — `scrubbing` itself answers. LEAVING one
    // does: this is the hand-back, and it is not finished until the real
    // element lands.
    if (!scrubbing) setHeldAfterScrub(true);
  }
  if (previousProxySrc !== proxySrc) {
    setPreviousProxySrc(proxySrc);
    // A proxy for a source that has since changed is a picture of another clip.
    setHeldAfterScrub(false);
  }

  const showProxy = hasProxy && (scrubbing || heldAfterScrub);

  useEffect(() => {
    targetRef.current = time;
  }, [time]);

  useEffect(() => {
    scrubbingRef.current = scrubbing;
  }, [scrubbing]);

  // Mirrored for the settle loop, which must not be rebuilt when this flips —
  // and written in an EFFECT for the same reason `targetRef` above is: a ref
  // assignment during render is a side effect in a function React may call
  // speculatively and discard.
  useEffect(() => {
    heldRef.current = heldAfterScrub;
  }, [heldAfterScrub]);

  const attachVideo = useCallback((media: HTMLMediaElement | null) => {
    mediaRef.current = media;
  }, []);

  const attachProxy = useCallback((element: HTMLVideoElement | null) => {
    proxyElementRef.current = element;
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
          const proxy = proxyElementRef.current;

          if (scrubbingRef.current && proxy !== null) {
            // ONLY THE PROXY MOVES UNDER A DRAG. Seeking both would put two
            // decodes per frame on the same GPU for every panel that is a
            // video — and this view mounts one element PER PANEL, so at nine
            // up that is the difference between a handful of decoders and
            // twenty. The real element is left exactly where it was; it
            // catches up once the hand stops.
            if (
              proxy.readyState >= 1 &&
              !proxy.seeking &&
              Math.abs(proxy.currentTime - targetRef.current) > 0.03
            ) {
              try {
                proxy.currentTime = targetRef.current;
              } catch {
                // metadata raced away; next frame retries
              }
            }
            raf = requestAnimationFrame(tick);
            return;
          }

          if (!media.seeking && Math.abs(media.currentTime - targetRef.current) > 0.03) {
            try {
              media.currentTime = targetRef.current;
            } catch {
              // metadata raced away; next frame retries
            }
          } else if (
            heldRef.current &&
            !media.seeking &&
            media.readyState >= 2 &&
            Math.abs(media.currentTime - targetRef.current) <= 0.03
          ) {
            // THE HANDOVER, and the reason it waits: swapping back the moment
            // the drag ends would reveal whatever frame the real element was
            // left on, which is wherever the scrub STARTED. It stays on the
            // proxy until the real one is genuinely showing the frame that was
            // landed on.
            heldRef.current = false;
            setHeldAfterScrub(false);
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
      proxyElementRef.current?.pause();
    };
  }, [enabled, playing]);

  return { videoRef: attachVideo, proxyRef: attachProxy, showProxy };
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
