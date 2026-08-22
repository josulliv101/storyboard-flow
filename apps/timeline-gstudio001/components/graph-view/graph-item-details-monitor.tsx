"use client";

import { useRef } from "react";
import { AudioLines, Pause, Play } from "lucide-react";

import {
  hasSourceWindow,
  type MediaNode,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import { DETAILS_HERO_FILL_CLASS } from "./graph-view-config";
import { useSeekedVideo } from "@/hooks/use-seeked-video";
import { cloudinaryScrubProxySrc } from "@/lib/cloudinary-scrub-proxy";
import { useFrameCrossfade } from "@/hooks/use-frame-crossfade";
import { monitorPosterUrl } from "@/lib/video-frame-url";
import { formatSeconds } from "@/lib/format-duration";
import { HERO } from "./graph-item-details-shared";
import type { LiveTrim } from "@storyboard/ui/dnd-collections";

/**
 * THE PICTURE, and everything that paints on it.
 *
 * Lifted out of the panel because it is the one part of a panel that is not
 * about a clip's DATA at all: a video element, a low-res twin for scrubbing, a
 * canvas holding the outgoing frame across a cut, and the seek arithmetic that
 * keeps the three agreeing. The panel around it is a header, a strip, two
 * number fields and a tag row — none of which need any of that.
 *
 * It owns its own machinery rather than being handed refs. `useSeekedVideo`
 * and `useFrameCrossfade` exist to serve exactly this element, so hoisting
 * them into the parent would mean threading four refs and a proxy source
 * through a prop list to reach the only thing that uses them.
 */

/** What the seam clock says this panel should be showing, when it is running. */
export type MonitorFrame = Readonly<{ node: MediaNode; seconds: number }>;

/** The moving edge's time in SOURCE seconds, or the in-point at rest. */
function previewTime(node: VideoMediaNode, trimIn: number, trimOut: number, side: string | null) {
  return side === "right"
    ? Math.max(0, node.fullDurationSeconds - trimOut)
    : Math.max(0, trimIn);
}

export function ItemDetailsMonitor({
  node,
  centre,
  dimmed,
  swipe,
  onAdvance,
  monitor,
  playing,
  scrubbing,
  playingHere,
  onPlayFromStart,
  live,
  trimIn,
  trimOut,
}: Readonly<{
  node: MediaNode;
  centre: boolean;
  dimmed: boolean;
  swipe?: React.ComponentProps<"div">;
  onAdvance: (id: string) => void;
  monitor: MonitorFrame | null;
  playing: boolean;
  scrubbing: boolean;
  playingHere: boolean;
  onPlayFromStart: (() => void) | null;
  live: LiveTrim | null;
  trimIn: number;
  trimOut: number;
}>) {
  const video = node.mediaKind === "video" ? node : null;
  // WHAT THIS PANEL IS PAINTING. Normally its own clip; while the seam clock
  // is running, the centre panel paints whatever that clock says is on screen,
  // which may belong to a neighbour.
  const shown = monitor ? monitor.node : node;
  const shownVideo = shown.mediaKind === "video" ? shown : null;
  const shownAudio = shown.mediaKind === "audio" ? shown : null;
  // Sound belongs to the panel that is MONITORING, and only while the clock
  // runs. A resting neighbour is a still frame; a paused monitor is too.
  const audible = playing;
  const rawTime = monitor
    ? // The clock's time is measured inside the clip's SHOWING range, and a
      // video element seeks in SOURCE time — so the trim-in has to be added
      // back or every frame is early by however much was trimmed off the head.
      (hasSourceWindow(shown) ? shown.trimInSeconds : 0) + monitor.seconds
    : video
      ? previewTime(video, trimIn, trimOut, live?.side ?? null)
      : 0;
  // Null for anything not served as a Cloudinary video — a fixture, an upload
  // still in flight — and the hook simply scrubs the real element then, which
  // is what it always did.
  const scrubProxySrc = shownVideo?.src ? cloudinaryScrubProxySrc(shownVideo.src) : null;
  // See the `poster` below: the frame the element is ABOUT to seek to, so the
  // picture it paints before it has decoded anything is already the right one.
  // The builder returns its input unchanged for anything it cannot
  // transform — a fixture, an upload still in flight — so the fallback is the
  // opening frame, which is what this always used.
  const posterAtRawTime = monitorPosterUrl(
    shownVideo?.posterSrcs?.[0],
    monitor ? rawTime : null,
  );
  const { videoRef, proxyRef, showProxy } = useSeekedVideo(
    Math.round(rawTime * 25) / 25,
    shownVideo !== null || shownAudio !== null,
    audible,
    { proxySrc: scrubProxySrc, scrubbing },
  );
  // EVERY PANEL RESTS ON ITS FIRST FRAME, so the crossfade is keyed on a
  // constant. It used to swap ends as a panel crossed the centre — the clip
  // before the cut showed its LAST frame — and the two frames are seconds of
  // story apart, so cutting between them read as a glitch rather than as the
  // same shot from its other end. That behaviour is gone; the fade is kept
  // because the hook also covers the swap between two different clips.
  const { videoRef: crossfadeVideoRef, canvasRef } = useFrameCrossfade("first");

  /* The hero: this is what the card morphs INTO — and, on a neighbour,
        the thing you click to pull the strip along by one.

        THE PICTURE IS THE TARGET, deliberately. Every panel is fully live
        now, so a click anywhere else has a job already: the grips trim, the
        title renames, the tag field types. The picture is the one large
        surface in a neighbour with nothing else to do, which is what makes
        it safe to spend on advancing.

        `HERO` stays on the opened panel only: it is the card's morph
        target, and the slide below is a plain transform rather than a view
        transition, so the two never contend for the same element. */
  return (
    <div
      data-item-details-frame
      {...swipe}
      style={{
        ...(centre ? { viewTransitionName: HERO } : {}),
        // `pan-y`, not `none`: the browser keeps vertical panning (so a
        // page or panel that scrolls still can) while horizontal drags
        // reach us as pointer events instead of being eaten as a scroll.
        // Without this a swipe on a touchscreen is silently the browser's.
        touchAction: "pan-y",
      }}
      onClick={centre ? undefined : () => onAdvance(node.id as string)}
      className={[
        "relative overflow-hidden rounded-md bg-black",
        // `flex-1` only makes sense against a fixed panel height. Once the
        // panel fits its content there is nothing to fill, so the picture
        // states its own shape instead.
        "aspect-video w-full @min-[30rem]:aspect-auto @min-[30rem]:w-auto",
        DETAILS_HERO_FILL_CLASS,
        centre ? "" : "cursor-pointer",
        // FADED, AND THE COLOUR GOES WITH IT. Opacity alone still leaves a
        // recognisable picture competing for the eye; draining the colour
        // as well puts the neighbours firmly in the past tense while the
        // monitor keeps its own. Both transition, so engaging the clock
        // reads as attention moving rather than as two panels blinking.
        "transition-[opacity,filter] duration-300 ease-out motion-reduce:transition-none",
        dimmed ? "opacity-25 grayscale" : "opacity-100 grayscale-0",
      ].join(" ")}
    >
      {shownVideo ? (
        <video
          // KEYED BY SOURCE. Swapping `src` on one element at a cut leaves
          // the outgoing frame on screen until the incoming file has
          // decoded — the cut would land late, and late is the one thing
          // this view exists to measure. A key gives each clip its own
          // element, so the change is a swap rather than a reload.
          key={shownVideo.src}
          ref={(element) => {
            videoRef(element);
            crossfadeVideoRef.current = element;
          }}
          src={shownVideo.src}
          // THE POSTER IS THE FRAME BEING ASKED FOR, not the clip's first.
          //
          // Letting go of the bar gives the landed clip its OWN panel, and a
          // fresh `<video>` has no frame yet — so it paints its poster, and
          // the poster used to be `posterSrcs[0]`. That is the clip's opening
          // frame, which is almost never where the playhead is: you saw the
          // right frame while scrubbing (the old panel's monitor was showing
          // it), then the first frame, then a skip to the right one again as
          // the seek landed. The frame was never lost — it was re-acquired in
          // public.
          //
          // Pointing the poster at the SAME time the element is seeking to
          // makes the two agree, so the swap from poster to decoded frame is
          // invisible. Falls back to the opening frame when there is no clock
          // to ask, which is a resting neighbour and exactly right for one.
          poster={posterAtRawTime}
          // UNMUTED WHILE PLAYING. Judging a cut is not only a picture
          // problem — a line landing across the join, or music that
          // stops dead on it, is the thing being looked for as often as
          // the frame is.
          muted={!audible}
          playsInline
          preload="auto"
          className="h-full w-full bg-black object-contain"
        />
      ) : shownAudio ? (
        // AUDIO HAS NO PICTURE, and pointing an <img> at a .wav paints a
        // broken-image icon — which is what this did, because the flat
        // order contains every media node and a bed is one of them. It
        // gets a card that says what it is, and an element that can
        // actually play it.
        <div className="flex h-full w-full items-center justify-center bg-black text-zinc-400">
          {/* NO LABEL. The panel's title is this clip's name, directly
              above, and the row beneath already says "sound · 8.0s" — a
              third copy in the middle of the card says nothing new and
              makes the name ambiguous to anything looking for it. */}
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
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown.src}
          alt={shown.name}
          // NOT DRAGGABLE, which is what made the swipe work on video
          // panels and not on stills. An `<img>` is draggable by DEFAULT
          // and a `<video>` is not, so on a still the browser took the
          // gesture as a native image drag the moment the pointer moved:
          // it swallowed the rest of the sequence, no pointermove ever
          // arrived, and the strip sat there. The gesture was never
          // reaching the code that decides whether it is a swipe.
          //
          // `select-none` for the same reason at the other end — a drag
          // across a picture that starts selecting whatever is behind it
          // reads as the page misbehaving even when the swipe does work.
          draggable={false}
          className="h-full w-full bg-black object-contain select-none"
        />
      )}
      {/* THE SMALL COPY, shown only while the bar is being dragged.
          A full-res seek costs 67-128ms on these sources and this view
          mounts an element PER PANEL, so a nine-up strip of video was
          asking for nine of them at once — measured at 714ms a seek, which
          is a picture that changes about once a second under a hand moving
          far faster than that.

          ABSOLUTE, AFTER the real element in the DOM, so it paints over it
          without either one moving: same box, same `object-contain`, so
          the swap is a change of sharpness and nothing else. It sits UNDER
          the crossfade canvas below, which must stay on top to cover a cut.

          No `poster`: a poster would flash the clip's first frame at the
          start of every drag, which is precisely the wrong frame. */}
      {shownVideo && scrubProxySrc !== null && (
        <video
          key={`scrub-proxy:${scrubProxySrc}`}
          ref={proxyRef}
          src={scrubProxySrc}
          aria-hidden="true"
          muted
          playsInline
          preload="auto"
          draggable={false}
          className={[
            "pointer-events-none absolute inset-0 h-full w-full bg-black object-contain select-none",
            showProxy ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
      )}
      {/* THE OUTGOING FRAME, held over the picture while the incoming one
          seeks, then faded out. Sized and fitted exactly like the video
          under it so the two are the same picture in the same place —
          anything else and the fade doubles as a nudge. Starts and ends at
          zero opacity: it is only ever visible for the length of a swap. */}
      {shownVideo && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
      )}
      {/* PLAY THIS ONE, from every panel.
          The bar's own play button starts wherever the playhead happens to
          be, which is the right default for judging the cut in front of
          you and useless for "let me see that shot". This is the second
          question, asked at the clip rather than at the clock: it moves the
          playhead to this clip's first frame and runs.

          BOTTOM-LEFT, NOT CENTRED. A centred disc is the film convention
          and it was the first thing tried, but this view exists to compare
          frames ACROSS panels — a circle parked over the middle of nine
          pictures covers exactly the part being compared, and at nine up it
          covers most of the subject. The corner is out of the way of the
          frame while still being on it; bottom-RIGHT is spoken for by the
          time readout on video panels.

          SMALL ENOUGH FOR THE NARROWEST PANEL, and sized in absolute units
          rather than by container query on purpose: at 218px the picture is
          about 122px tall, so 28px is a comfortable target that still
          leaves the frame readable, and one size at every width means the
          control does not move or resize as the count changes. It is
          deliberately NOT behind the 30rem breakpoint that hides the trim
          strip and the tags — those are editing controls you can leave the
          panel to reach, and this is the reason the wide views exist.

          It dims with the picture on a neighbour while the clock runs,
          because it is inside the frame that dims. Accepted rather than
          worked around: undoing a parent's opacity is impossible from a
          child, and hoisting the dim onto the media alone would put the
          grayscale on a different element from the one the view's own
          fade is written against. A 25% button is still legible and still
          clickable, and the state it is in — something else is playing —
          is exactly when reaching for it is the less common move. */}
      {onPlayFromStart !== null && (
        <button
          type="button"
          data-item-details-play={playingHere ? "playing" : "paused"}
          aria-label={playingHere ? `Pause ${node.name}` : `Play ${node.name} from the start`}
          title={playingHere ? "Pause" : "Play from the start of this clip"}
          // BOTH STOPPED, and for two different handlers. The click would
          // otherwise reach the picture's own click, which on a neighbour
          // means "bring this one to the middle" — pressing play would
          // silently advance the strip as well. The pointerdown would arm
          // the swipe, so a press that wobbles a few pixels would fling the
          // film to the next clip instead of starting this one.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onPlayFromStart();
          }}
          className={[
            "absolute bottom-2 left-2 grid h-7 w-7 place-items-center rounded-full",
            "bg-black/70 text-zinc-100 ring-1 ring-white/25 backdrop-blur-sm",
            "transition-colors hover:bg-black/90 hover:text-white",
            "focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none",
          ].join(" ")}
        >
          {playingHere ? (
            <Pause aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <Play aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {live !== null && (
        <span
          data-item-details-edge={live.side === "right" ? "right" : "left"}
          className={[
            "absolute inset-y-0 w-1.5 bg-blue-500",
            live.side === "right" ? "right-0" : "left-0",
          ].join(" ")}
        />
      )}
      {video && (
        <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-blue-300">
          {formatSeconds(rawTime)}
        </span>
      )}
    </div>
  );
}
