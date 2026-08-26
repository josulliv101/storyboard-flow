"use client";

import { AudioLines } from "lucide-react";

import { type MediaNode, type VideoMediaNode } from "@storyboard/ui/dnd-collections";

import { useSeekedVideo } from "@/hooks/use-seeked-video";
import { useFrameCrossfade } from "@/hooks/use-frame-crossfade";
import { cloudinaryScrubProxySrc } from "@/lib/cloudinary-scrub-proxy";
import { monitorPosterUrl } from "@/lib/video-frame-url";

/**
 * ONE PLACE THAT PAINTS A CLIP AT A MOMENT (PL16-002).
 *
 * Extracted because it was about to be written a fourth time. Showing a clip at
 * a source time is not one element — it is a seek that has to be debounced
 * against a decode, a low-res twin so a dragged bar does not wait 100ms a
 * frame, a canvas that holds the outgoing frame across a cut so the swap is not
 * a flash of black, and three different elements depending on whether the media
 * has a picture at all. Every surface that has needed it has grown its own
 * copy, and the newest copy — a bare `<video>` in the clip deck — had none of
 * that machinery and looked it.
 *
 * WHAT IT DOES NOT OWN: layout, chrome, controls, or what time it should be
 * showing. Callers position it and tell it the moment; it decides how to get a
 * picture there. That is the line that keeps it reusable — the deck wants it
 * filling a card's picture box, the monitor wants it letterboxed in a panel,
 * and neither of those is this component's business beyond `fit`.
 */
export type MediaPreviewSurfaceProps = Readonly<{
  /** What to show. `null` paints nothing, which is a legitimate resting state
   *  rather than an error — a collection has no media of its own. */
  media: MediaNode | null;
  /**
   * Where to sit, in SOURCE seconds.
   *
   * Source rather than sequence time on purpose: the caller is the only thing
   * that knows how its own timeline maps onto a clip, and a component that
   * guessed would be wrong the moment a trim moved.
   */
  sourceTime: number | null;
  /** Running, rather than parked on a frame. */
  playing?: boolean;
  /** Sound. Off by default — several of these can be on screen at once, and
   *  only one of them can sensibly be heard. */
  audible?: boolean;
  /** A pointer is dragging, so the low-res twin takes over until it stops. */
  scrubbing?: boolean;
  /**
   * COVER for a card's picture, CONTAIN for a panel.
   *
   * A card's picture is a crop of a shot and wants filling; a monitor is the
   * shot and must not be cropped to fit the box it is being judged in.
   */
  fit?: "contain" | "cover";
  className?: string;
}>;

/** The seek is quantised to a frame at 25fps: finer than that asks the element
 *  to re-decode for a difference nobody can see. Matches what the monitor has
 *  always used. */
const SEEK_QUANTUM_FPS = 25;

export function MediaPreviewSurface({
  media,
  sourceTime,
  playing = false,
  audible = false,
  scrubbing = false,
  fit = "cover",
  className,
}: MediaPreviewSurfaceProps) {
  const shownVideo: VideoMediaNode | null =
    media !== null && media.mediaKind === "video" ? (media as VideoMediaNode) : null;
  const shownAudio = media !== null && media.mediaKind === "audio" ? media : null;
  const rawTime = sourceTime ?? 0;

  // THE POSTER IS THE FRAME BEING ASKED FOR, not the clip's first. A fresh
  // element has decoded nothing, so it paints its poster — and the clip's
  // opening frame is almost never where the playhead is. Pointing the poster at
  // the same moment the element is seeking to makes the swap from poster to
  // decoded frame invisible.
  const posterAtRawTime = monitorPosterUrl(shownVideo?.posterSrcs?.[0], sourceTime);
  const videoSrc = shownVideo?.src;
  const scrubProxySrc = videoSrc === undefined ? null : cloudinaryScrubProxySrc(videoSrc);

  const { videoRef, proxyRef, showProxy } = useSeekedVideo(
    Math.round(rawTime * SEEK_QUANTUM_FPS) / SEEK_QUANTUM_FPS,
    shownVideo !== null || shownAudio !== null,
    playing,
    { proxySrc: scrubProxySrc, scrubbing },
  );
  // Keyed on a constant: the fade covers the swap between two different clips,
  // which is the case that would otherwise flash black across a cut.
  const { videoRef: crossfadeVideoRef, canvasRef } = useFrameCrossfade("first");

  const objectFit = fit === "contain" ? "object-contain" : "object-cover";

  return (
    <div className={["relative overflow-hidden bg-black", className ?? ""].join(" ")}>
      {shownVideo ? (
        <video
          // KEYED BY SOURCE. Swapping `src` on one element leaves the outgoing
          // frame up until the incoming file has decoded, so the cut lands
          // late. A key gives each clip its own element, making it a swap.
          key={shownVideo.src}
          ref={(element) => {
            videoRef(element);
            crossfadeVideoRef.current = element;
          }}
          src={shownVideo.src}
          poster={posterAtRawTime}
          muted={!audible}
          playsInline
          preload="auto"
          className={`h-full w-full bg-black ${objectFit}`}
        />
      ) : shownAudio ? (
        // AUDIO HAS NO PICTURE, and pointing an <img> at a .wav paints a
        // broken-image icon. It gets a mark that says what it is, and an
        // element that can actually play it.
        <div className="flex h-full w-full items-center justify-center bg-black text-zinc-400">
          <AudioLines aria-hidden="true" className="h-8 w-8 text-blue-300/80" />
          <audio
            key={shownAudio.src}
            ref={videoRef}
            src={shownAudio.src}
            muted={!audible}
            preload="auto"
            className="sr-only"
          />
        </div>
      ) : media !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.src}
          alt={media.name}
          // NOT DRAGGABLE. An `<img>` is draggable by default and a `<video>`
          // is not, so on a still the browser takes a swipe as a native image
          // drag: it swallows the rest of the sequence and no pointermove ever
          // arrives. `select-none` is the same problem at the other end.
          draggable={false}
          className={`h-full w-full bg-black select-none ${objectFit}`}
        />
      ) : null}

      {/* THE SMALL COPY, up only while a bar is being dragged. A full-res seek
          costs 67-128ms on these sources, which is a picture changing about
          once a second under a hand moving far faster than that.

          ABSOLUTE and AFTER the real element, so it paints over it without
          either one moving: same box, same fit, so the swap is a change of
          sharpness and nothing else. It sits UNDER the canvas below, which
          must stay on top to cover a cut. No `poster` — that would flash the
          clip's first frame at the start of every drag. */}
      {shownVideo && scrubProxySrc !== null && (
        <video
          key={`scrub-proxy:${scrubProxySrc}`}
          ref={proxyRef}
          src={scrubProxySrc}
          aria-hidden="true"
          muted
          playsInline
          preload="auto"
          className={`absolute inset-0 h-full w-full bg-black ${objectFit} transition-opacity duration-75 ${
            showProxy ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
      )}

      {/* The crossfade canvas, holding the outgoing frame across a cut. On top
          of everything, because that is the whole job. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
    </div>
  );
}
