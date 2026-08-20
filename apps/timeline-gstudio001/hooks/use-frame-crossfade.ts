"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * How long the outgoing frame takes to give way to the incoming one.
 *
 * Short: this is a cut being softened, not an effect. Long enough that the eye
 * reads a change rather than a flinch, short enough that it never becomes a
 * thing you wait for while working.
 */
const CROSSFADE_MS = 220;

/**
 * If the new frame has not arrived by now, show it anyway.
 *
 * A seek that never lands — a source still loading, a decode that stalls,
 * a `seeked` event the browser coalesced away — must not leave the old frame
 * painted over the element permanently. The fallback makes the worst case a
 * late crossfade instead of a stuck picture.
 */
const LANDING_TIMEOUT_MS = 500;

/**
 * Crossfade a `<video>` between two seek targets instead of cutting.
 *
 * WHY A CANVAS AND NOT A SECOND VIDEO. The obvious crossfade is two elements
 * with their opacities swapped, which doubles the video elements on screen —
 * and this view already holds one per panel, decoding independently. A canvas
 * holding a single captured frame costs one bitmap.
 *
 * DRAWING FROM A CROSS-ORIGIN VIDEO IS ALLOWED; only READING the result back
 * is not. `drawImage` taints the canvas, and a tainted canvas refuses
 * `toDataURL`/`getImageData` — but it still PAINTS. So the captured frame is
 * shown by displaying the canvas itself, never by extracting an image from it,
 * and the whole class of CORS failure this would otherwise hit does not arise.
 *
 * CAPTURED IN A LAYOUT EFFECT, which is the timing the whole thing turns on.
 * The seek is issued from a passive effect, and layout effects run first — so
 * this grabs the frame that is still on screen. A frame later and it would
 * capture the destination and crossfade it with itself.
 *
 * THE FADE WAITS FOR THE NEW FRAME rather than starting immediately. Fading
 * out over a video that has not finished seeking reveals the frame being
 * replaced, so the change still lands as a jump — just a later one, after the
 * fade has finished and nobody is looking for it.
 *
 * @param key Change this to trigger a crossfade. Its VALUE is not read; only
 *            the fact that it differs from last render.
 */
export function useFrameCrossfade(key: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previousKey = useRef(key);

  useLayoutEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    // HAVE_CURRENT_DATA or better: below that there is no frame to capture,
    // and a blank canvas faded over the picture is worse than the cut.
    if (!video || !canvas || video.readyState < 2) return;
    const { videoWidth: width, videoHeight: height } = video;
    if (width === 0 || height === 0) return;

    const context = canvas.getContext("2d");
    if (context === null) return;
    canvas.width = width;
    canvas.height = height;
    try {
      context.drawImage(video, 0, 0, width, height);
    } catch {
      // Nothing drawable yet — take the cut rather than a blank overlay.
      return;
    }

    canvas.style.transition = "none";
    canvas.style.opacity = "1";

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    let finished = false;
    const reveal = () => {
      if (finished) return;
      finished = true;
      video.removeEventListener("seeked", onSeeked);
      if (reduced) {
        canvas.style.opacity = "0";
        return;
      }
      // A frame's grace before arming the transition: setting the property and
      // the target value in one go gives the browser nothing to animate from.
      requestAnimationFrame(() => {
        canvas.style.transition = `opacity ${CROSSFADE_MS}ms ease-out`;
        canvas.style.opacity = "0";
      });
    };

    const onSeeked = () => reveal();
    video.addEventListener("seeked", onSeeked);
    const timer = setTimeout(reveal, LANDING_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      // Unmounting mid-fade must not leave the capture painted over whatever
      // this element shows next.
      canvas.style.transition = "none";
      canvas.style.opacity = "0";
    };
  }, [key]);

  return { videoRef, canvasRef };
}
