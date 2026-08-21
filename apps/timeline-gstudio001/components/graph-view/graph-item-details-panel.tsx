"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Pause, Play, Redo2, Undo2, X } from "lucide-react";

import {
  TrimOverviewStrip,
  hasSourceWindow,
  isEditableKeyboardTarget,
  mediaDurationSeconds,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  type MediaNode,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import { DETAILS_HERO_FILL_CLASS, DETAILS_PANEL_HEIGHT_CLASS } from "./graph-view-config";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { useSeekedVideo } from "@/hooks/use-seeked-video";
import { cloudinaryScrubProxySrc } from "@/lib/cloudinary-scrub-proxy";
import { useFrameCrossfade } from "@/hooks/use-frame-crossfade";
import { formatSeconds } from "@/lib/format-duration";
import { useInlineRename } from "./graph-inline-rename";
import { ItemDetailsPanelHeader } from "./graph-item-details-panel-header";
import { useClipDetail } from "./graph-details-context";
import { LayerFramePicker } from "./graph-layer-frame-picker";
import { TagEditor } from "./graph-tag-editor";
import { seamStripProgress } from "./graph-seam-scrub";
import { useScopedHistory } from "./graph-item-details-history";
import { TrimNumbers } from "./graph-item-details-trim-fields";
import { HERO, MONITOR_TARGET_PX, MAX_MAGNIFICATION } from "./graph-item-details-shared";

// ONE panel of the details view. Split out of the modal so that file is the
// carousel and this is the clip: everything per-clip — the monitor, the trim
// strip, the typed edges, the tags, the scoped history pair — lives here.

/** The moving edge's time in SOURCE seconds, or the in-point at rest. */
function previewTime(node: VideoMediaNode, trimIn: number, trimOut: number, side: string | null) {
  return side === "right"
    ? Math.max(0, node.fullDurationSeconds - trimOut)
    : Math.max(0, trimIn);
}

/**
 * ONE panel — the whole details view for one clip.
 *
 * Rendered three times side by side (see `ModalBody`): the clip you opened in
 * the middle and its playback neighbours either side, each a complete copy of
 * this rather than a thumbnail of it. Everything per-clip lives here, which is
 * what lets the flanking copies be the same component instead of a second,
 * drifting rendition of the same chrome.
 */
export function DetailsPanel({
  node,
  centre,
  monitor,
  playhead,
  playing = false,
  playingHere = false,
  onPlayFromStart = null,
  live: onScreen = false,
  magnified = false,
  scrubbing = false,
  swipe,
  seamLabel = null,
  width,
  dimmed = false,
  clipLabel,
  restingFrame,
  onClose,
  onAdvance,
}: Readonly<{
  node: MediaNode;
  /**
   * Whether this is the panel the modal was OPENED on.
   *
   * It does NOT mean "the working one" — all three panels work, which is the
   * point of them being copies rather than previews. It marks the two things
   * that are singular no matter how many panels there are: the focus wiring,
   * and the `view-transition-name` the card morphs into. A neighbour carrying
   * either would steal the keyboard, or land the open animation on the wrong
   * picture.
   */
  centre: boolean;
  /**
   * What the CENTRE panel's picture should be showing, when the seam clock is
   * driving it: a clip and a time inside it. Null means "show your own clip",
   * which is every panel that is not the centre and the centre itself before
   * anything has been scrubbed.
   *
   * THE CENTRE IS A MONITOR, not a window onto its own clip. Playing across a
   * cut means the frame changes clip halfway through, and it has to change in
   * ONE place or there is nothing to watch — an eye that has to move from panel
   * to panel at the moment of the cut is an eye that misses the cut.
   */
  monitor: Readonly<{ node: MediaNode; seconds: number }> | null;
  /**
   * How far through this clip's own trimmed range the playhead is, 0-1, or null
   * when the playhead is not inside this clip at all. Drawn as a line on the
   * trim strip below.
   */
  playhead: number | null;
  /**
   * Whether the transport is running. Only the monitoring panel is ever told
   * yes: two elements playing the same seconds is two soundtracks, and the
   * neighbours are showing stills of a moment, not playing one.
   */
  playing?: boolean;
  /**
   * Whether the transport is running AND this clip is the one on screen — so
   * the panel's own play button should be offering PAUSE.
   *
   * A third playing-ish flag, and the three are genuinely different questions:
   * `playing` is "are you the one making the sound" (the monitor, always the
   * centre), `live` is "are your frames up" (any panel the playhead is inside),
   * and this is the two together. Collapsing them would put a pause icon on
   * nine panels at once, or on the centre panel while a neighbour's frames are
   * the ones actually running.
   */
  playingHere?: boolean;
  /**
   * Play this clip FROM ITS FIRST FRAME on the monitor, or pause when it is
   * already the one running. Null when this clip has no stretch of bar at all,
   * which is every panel mounted past the visible edge — offering to play a
   * clip the clock cannot reach would be a button that does nothing.
   *
   * The panel does not play IN PLACE, and that is the point rather than a
   * limitation: the monitor is where a cut is judged, and nine panels each able
   * to run their own clip would be nine clocks with no shared "now". Pressing
   * play here moves the ONE clock to this clip's head; the picture appears in
   * the middle, where it always does.
   */
  onPlayFromStart?: (() => void) | null;
  /**
   * Whether THIS clip is the one currently on screen — the clip the playhead
   * is inside, which during a run-up or a run-out is a neighbour rather than
   * the centre. Distinct from `playing`, which says who is making the sound.
   */
  live?: boolean;
  /**
   * Grow, because someone is scrubbing and this panel is the monitor.
   *
   * At three panels the middle one is already most of the screen and this does
   * nothing. At five and nine it is a few hundred pixels wide — fine as a
   * frame beside its neighbours, useless as the thing you are watching while
   * you drag a playhead through a cut. Scrubbing is exactly when the monitor
   * stops being one of three pictures and becomes the only one that matters.
   */
  magnified?: boolean;
  /** True while this panel is the one the seam clock is driving AND the bar is
   *  being dragged — the only moment a panel seeks fast enough to need the
   *  small copy. A resting neighbour holds one still frame and never seeks. */
  scrubbing?: boolean;
  /**
   * Pointer handlers for dragging the whole strip, spread onto the PICTURE.
   *
   * The picture and nothing else: every other large surface in a panel is
   * already a gesture. The filmstrip drags the source window, the grips trim,
   * the bar scrubs, the title is a text field — a swipe layered over any of
   * them would be two meanings competing for one drag, and the loser would be
   * whichever the user actually meant. The picture is the one big area with
   * only a tap on it, which is why the tap is already "bring this one to the
   * middle"; the swipe is the same instruction, held.
   */
  swipe?: React.ComponentProps<"div">;
  /**
   * Which end of this clip is on show, labelled above the panel — set only on
   * the two flanking it.
   *
   * The centre gets none: it is not resting on an end, it is the clip being
   * worked on, and a label there would be answering a question nobody asked
   * about it. The neighbours are exactly one frame each, and WHICH frame is
   * the entire reason they are on screen.
   */
  seamLabel?: { text: string; side: "left" | "right" } | null;
  /** Set by the strip, which owns how many panels are on screen. */
  width: string;
  /**
   * Pull this panel's picture back, because the clock is running and it is not
   * the one being watched.
   *
   * Only ever set on the NEIGHBOURS. Once playback is engaged the middle
   * picture is the monitor — it is showing whatever is on screen at that
   * instant, including a neighbour's frames — so two bright pictures either
   * side of it are competing with the one thing the view is for. Dimming them
   * is not decoration: it is the difference between watching a cut and reading
   * three stills at once.
   */
  dimmed?: boolean;
  /**
   * Which end of this clip its picture rests on when nothing is playing.
   *
   * THE CLIP BEFORE THE CUT SHOWS ITS LAST FRAME, not its first. Those two
   * frames — the last of the outgoing clip and the first of the incoming one —
   * are the cut. A panel resting on its own first frame shows the moment its
   * shot BEGAN, which for the clip on the left is several seconds before
   * anything being judged here, and puts a picture next to the seam that has
   * nothing to do with it.
   *
   * The clip after the cut keeps its first frame for the same reason: that IS
   * its edge of the seam. So the two frames either side of the centre panel are
   * the two frames either side of a cut, which is the comparison the whole
   * layout exists to make.
   */
  /** `clip 4` — its place in playback order, supplied by the carousel
   *  because only the row knows the order this panel is part of. */
  clipLabel?: string;
  restingFrame: "first" | "last";
  onClose: () => void;
  /** Pull the strip one position, so this clip becomes the centre. */
  onAdvance: (id: string) => void;
}>) {
  const live = useLiveTrim(node.id);
  // For the inset picker: the clip's shape decides the inset's height, and
  // therefore which preset a stored rectangle came from.
  const detail = useClipDetail(node.id as string);
  const history = useScopedHistory(node.id);
  const rename = useInlineRename(node.id, node.name, "item-details");
  // A still has no source window to map, so the trim half of this view belongs
  // to WINDOWED media — video and audio both. `video` stays a separate,
  // narrower question because the filmstrip and the frame readout need actual
  // frames; the numbers do not.
  const windowed = hasSourceWindow(node) ? node : null;
  const video = node.mediaKind === "video" ? node : null;
  const trimIn = live ? live.trimInSeconds : (windowed?.trimInSeconds ?? 0);
  const trimOut = live ? live.trimOutSeconds : (windowed?.trimOutSeconds ?? 0);
  const fullDuration = windowed ? windowed.fullDurationSeconds : mediaDurationSeconds(node);
  const showing = Math.max(0, fullDuration - trimIn - trimOut);
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
      ? restingFrame === "last"
        ? // ONE FRAME BACK from the trim-out, not the trim-out itself: a video
          // element seeked exactly to its end has no frame to show and paints
          // black, which would read as a missing clip rather than as the last
          // thing before the cut.
          Math.max(trimIn, trimIn + showing - 1 / 25)
        : previewTime(video, trimIn, trimOut, live?.side ?? null)
      : 0;
  // Gated on `video`: an image has no source window and no element to seek, so
  // the settle loop had nothing to do but spin for as long as the modal stayed
  // open.
  // Null for anything not served as a Cloudinary video — a fixture, an upload
  // still in flight — and the hook simply scrubs the real element then, which
  // is what it always did.
  const scrubProxySrc = shownVideo?.src ? cloudinaryScrubProxySrc(shownVideo.src) : null;
  const { videoRef, proxyRef, showProxy } = useSeekedVideo(
    Math.round(rawTime * 25) / 25,
    shownVideo !== null || shownAudio !== null,
    audible,
    { proxySrc: scrubProxySrc, scrubbing },
  );
  // A panel crossing the centre swaps which end of its clip it rests on, and
  // the two frames are seconds of story apart — cut between them and the eye
  // takes it as a glitch rather than as the same shot from its other end.
  // Keyed on the resting end alone: every other seek here is a scrub or a
  // playhead, where a cut IS the answer and a fade would be a smear.
  const { videoRef: crossfadeVideoRef, canvasRef } = useFrameCrossfade(restingFrame);

  // HOW BIG THIS PANEL ACTUALLY IS, so magnifying it can aim at a size rather
  // than multiply by a guess. A fixed factor is wrong at both ends: 1.5x is
  // nothing at nine panels on a laptop and far too much at three on a
  // monitor.
  const [panelWidthPx, setPanelWidthPx] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = panelRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setPanelWidthPx(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Capped, because a panel blown up more than this is soft rather than big —
  // everything in it is scaled type and scaled borders.
  const magnification =
    magnified && panelWidthPx > 0
      ? Math.min(MAX_MAGNIFICATION, Math.max(1, MONITOR_TARGET_PX / panelWidthPx))
      : 1;

  const [stripWidth, setStripWidth] = useState(0);
  const stripSlot = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    setStripWidth(element.getBoundingClientRect().width);
  }, []);

  // `aria-modal="true"` above is a promise about the rest of the page; this is
  // what keeps it. Focus moves in, Tab cycles here, the board goes inert, and
  // the card this was opened from gets focus back on close.
  const { dialogProps } = useDialogFocus<HTMLDivElement>();

  // Escape closes and F2 renames. Both listen in CAPTURE, which is what makes
  // the editable guard load-bearing rather than defensive: a capture listener
  // on the document runs BEFORE the rename input's own keydown, so without it
  // Escape would close the whole modal instead of cancelling the edit — the
  // input's stopPropagation never gets the chance to speak.
  const beginRename = rename.begin;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        event.stopPropagation();
        beginRename();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, beginRename]);

  // THE CONTAINER IS A WRAPPER, not the panel itself, because an element
  // cannot query its own width — and the panel needs to change its own HEIGHT
  // when it gets narrow, not merely what it puts inside itself. The wrapper
  // carries the width and nothing else.
  return (
      <div ref={panelRef} className="@container shrink-0" style={{ width }}>
      <div
        // FOCUS WIRING ON THE CENTRE ONLY. Every panel is fully live — the
        // grips trim, the title renames, the video seeks — but "which dialog
        // has the keyboard" is singular by definition, so the roving focus,
        // the Escape handling and the initial focus target stay with the clip
        // that was opened. The neighbours are working panels, not focus traps.
        {...(centre ? dialogProps : {})}
        data-item-details-panel={centre ? "centre" : "neighbour"}
        data-item-details-magnified={magnification > 1 ? "" : undefined}
        style={{
          // A TRANSFORM, not a width. The strip's slide is computed from a
          // uniform panel width, so a centre panel that actually got wider
          // would move every landing off by the difference. Scaling paints
          // bigger and leaves the geometry alone — the row still knows exactly
          // where everything is.
          transform: magnification > 1 ? `scale(${magnification})` : undefined,
          zIndex: magnification > 1 ? 20 : undefined,
        }}
        data-item-details-live={onScreen ? "" : undefined}
        // WHICH CLIP IS ON SCREEN, marked on the whole panel. The monitor is
        // always the middle picture, so during a run-up the frames on show
        // belong to a clip whose own panel is off to one side — and nothing
        // said which. A ring in the playhead's own red ties the two together:
        // the line moving through a strip and the ring around that strip are
        // one statement about where playback is.
        //
        // Only ever drawn while the clock is engaged. A ring sitting on the
        // centre panel of a modal nobody has touched would read as a selection
        // rather than as a position.
        className={[
          // gap-2, not gap-3: with the prose and the headings gone the rows
          // below the strip are short and closely related, and twelve pixels
          // between each of them was reading as four separate regions rather
          // than one foot to the panel.
          //
          // `@container`, so what the panel shows depends on how wide the panel
          // actually IS rather than on how many there are. Five panels on a
          // large monitor have more room each than three on an iPad, and a
          // rule counting panels gets that backwards.
          "relative flex w-full flex-col gap-2 rounded-lg bg-zinc-950 p-4 focus-visible:outline-none",
          "transition-[box-shadow,border-color,transform] duration-200 ease-out motion-reduce:transition-none",
          // EVERY PANEL WEARS THE SAME BORDER, including the one you opened.
          //
          // It carried a heavier white one for a while, on the reasoning that
          // the opened clip should be marked. Two things were wrong with that.
          // It was loud — a thick white edge is the strongest mark on a dark
          // screen and it was spent on the least useful fact, since the centre
          // panel is already identifiable by being IN THE CENTRE, and by being
          // the one with a rename field and a close button. And it cost
          // layout: 2px against the neighbours' 1px pushed its picture down a
          // pixel and shortened it by two, which matters precisely because
          // comparing frames across panels is what this view is for.
          //
          // The one mark that survives is the red one, and it earns its place
          // by saying something that changes: whose frames are on screen right
          // now. It is a box-shadow, so it costs no layout either.
          "border border-zinc-700",
          // ONE shadow utility per state, both spelled out. Layering a glow on
          // top of `shadow-2xl` would mean two classes setting `box-shadow`,
          // and which one wins is a question about stylesheet order rather
          // than about the order they appear in this string — so the drop
          // shadow is written into both branches and the glow is simply a
          // second layer of the live one.
          // SKY, AND THINNER. It was red and 3px, which tied it to the
          // playhead — a nice idea that read as an alarm: red is the loudest
          // thing on a dark screen and a heavy red edge around the panel you
          // are watching says something has gone wrong rather than something
          // is playing. Two pixels of the accent already used for selection
          // and trim, with a soft halo behind it, says "this one" without
          // shouting. The playhead stays red; it is a hairline, and being the
          // one urgent-coloured thing on screen is what makes it findable.
          onScreen
            ? "shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6),0_0_0_2px_rgba(56,189,248,0.8),0_0_36px_8px_rgba(56,189,248,0.3)]"
            : "shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)]",
          // A FIXED 68vh WHILE THE PANEL IS FULL, and fitted to its picture
          // once it is not. Stripped of its controls a panel is a frame and a
          // name, and holding it at two thirds of the screen leaves most of it
          // black — tall empty columns either side of the one you are looking
          // at, which is the "weird" in a five-up view rather than the
          // controls being gone. Every panel is the same width and the same
          // aspect, so fitting them keeps them identical to each other, which
          // is the property that matters.
          "@min-[30rem]:h-[68vh] @min-[30rem]:max-h-full h-auto",
        ].join(" ")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {seamLabel === null ? null : (
          <span
            data-item-details-seam-label
            aria-hidden="true"
            // HUGGING THE SEAM. The clip before the cut carries its label on
            // its RIGHT and the clip after carries its on the LEFT, so both
            // sit against the join they describe rather than at the far
            // outside edges of the strip — where they would read as titles for
            // the panels instead of as facts about the cut between them.
            //
            // Above the card, not inside it: the panel's own top row is the
            // clip's name and its controls, and this is neither. Decorative
            // for AT — the centre panel's dialog label already says what is
            // open, and a neighbour resting on a frame is a visual aid.
            className={[
              "pointer-events-none absolute -top-6 font-mono text-[10px] tracking-wide text-zinc-500 uppercase",
              seamLabel.side === "right" ? "right-1" : "left-1",
            ].join(" ")}
          >
            {seamLabel.text}
          </span>
        )}
        <ItemDetailsPanelHeader
          name={node.name}
          clipLabel={clipLabel ?? null}
          trimReadout={
            video
              ? `${formatSeconds(showing)} / ${formatSeconds(fullDuration)}`
              : formatSeconds(showing)
          }
          nodeId={node.id as string}
          rename={rename}
        />

        {/* The hero: this is what the card morphs INTO — and, on a neighbour,
            the thing you click to pull the strip along by one.

            THE PICTURE IS THE TARGET, deliberately. Every panel is fully live
            now, so a click anywhere else has a job already: the grips trim, the
            title renames, the tag field types. The picture is the one large
            surface in a neighbour with nothing else to do, which is what makes
            it safe to spend on advancing.

            `HERO` stays on the opened panel only: it is the card's morph
            target, and the slide below is a plain transform rather than a view
            transition, so the two never contend for the same element. */}
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
              poster={shownVideo.posterSrcs?.[0]}
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

        {/* The whole source, with the showing window and its grips — the trim
            handles, at a width the board could never give them.

            THE FIRST THING TO GO WHEN THE PANEL NARROWS, and by some distance
            the biggest: a filmstrip, a draggable window, two grips and a pair
            of number fields. Below about 26rem they stop being controls and
            become texture — the grips are a few pixels apart, the fields
            collide — and at that width the panel is there to show you a frame
            beside its neighbours, which is the thing you came for. Trimming
            stays available on the board and in a wider view. */}
        <div className="flex flex-col gap-2">
        {windowed ? (
          <>
            {/* FRAMES, so video only — an audio clip has a source window but
                nothing to paint in it. Its numbers below are the same. */}
            {/* THE FILMSTRIP IS WHAT GOES, NOT TRIMMING ITSELF.
                A source map with two grips and forty poster frames needs the
                width; below 30rem the grips are a few pixels apart and it is
                texture rather than a control. But dropping the whole block
                took the ability to trim with it, and a panel you cannot trim
                from is a panel you have to leave to do the work — the numbers
                below stay at every width for exactly that reason. They are two
                fields and an arrow, they fit, and typing an exact in and out
                was always the more precise of the two routes anyway. */}
            {video && (
              <div ref={stripSlot} className="hidden w-full @min-[30rem]:block">
                {stripWidth > 0 ? (
                  <div className="relative">
                    <TrimOverviewStrip
                      node={video}
                      width={stripWidth}
                      trimInSeconds={trimIn}
                      trimOutSeconds={trimOut}
                    />
                    {/* WHERE PLAY IS, in this clip. Absent — not parked at an
                        edge — when the playhead is in another clip: a line at
                        0% reads as "playing here, from the very start", which
                        is a different and wrong claim from "not playing here".
                        Its position is measured against the whole trimmed
                        clip, so the run-up into the previous clip puts the
                        line near this strip's right-hand END. */}
                    {playhead !== null && (
                      <span
                        data-seam-playhead-line
                        aria-hidden="true"
                        style={{ left: `${playhead * 100}%` }}
                        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500"
                      />
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {/* TYPED in/out (PL11-006). Dragging resolves to whatever a pixel
                is worth — ~0.11s here, and coarser on the board — so an exact
                edge was simply unreachable by pointer. These are the same
                `update-media` command the grips dispatch, so undo, the live
                channel and the write path all behave identically. */}
            <TrimNumbers
              node={windowed}
              trimIn={trimIn}
              trimOut={trimOut}
              disabled={live !== null}
              durationLabel={formatSeconds(showing)}
            />
            {/* THE INSTRUCTIONS ARE GONE, and they were the single biggest
                thing making this end of the panel unreadable: a full sentence
                of prose — "drag the amber edges to trim, the film to move the
                window" — sitting under every panel. At three that is three
                copies of it on screen; at nine it is nine, and none of them is
                telling you anything the visible grips and the resize cursor
                are not. A hint you have read once is furniture from then on.

                What it also carried is kept: a voiceover has to say it is one,
                since a waveformless black card and a still look alike. That is
                two words now, on the row that was already there. */}
            {!video && (
              <span className="font-mono text-[11px] text-blue-300/90">
                sound · {formatSeconds(showing)} long
              </span>
            )}
          </>
        ) : (
          // This branch is everything that is NOT video, which is images AND
          // audio — so it cannot say "still" for both. A voiceover is not a
          // still, and calling it one is the kind of wrong label nobody
          // reports and everybody notices.
          <span className="font-mono text-[11px] text-blue-300/90">
            {node.mediaKind === "audio"
              ? `sound · ${formatSeconds(showing)} long`
              : `still · ${formatSeconds(showing)} on screen`}
          </span>
        )}
        </div>

        {/* WHERE IT DRAWS, for a clip that is under the picture. Only shown
            when it is actually on a lane and actually has a picture: the
            control describes a rectangle inside the frame, and neither the
            picture itself nor a voiceover has one.

            The first FORM control for a placement field — lane and placed
            start are drag-only. It exists because the write path stamps a
            default corner when a clip lands on a lane, and a default nobody
            can move is worse than no default at all. Dispatches
            `set-node-placement`, so unlike the tag editor below it IS
            undoable. */}
        {(node.trackIndex ?? 0) > 0 && node.mediaKind !== "audio" && (
          <div className="hidden @min-[30rem]:block">
            <LayerFramePicker node={node} aspect={detail?.aspect} disabled={live !== null} />
          </div>
        )}

        {/* Tags. Here rather than on the card because the card's content
            renders inside a <button>, where these remove buttons and the text
            field would be invalid HTML — the card shows them, this edits them.

            No undo: a tag change writes the detail side-table directly and
            emits no patch, so `useScopedHistory` above never sees it. See
            graph-tag-editor.tsx for why that is the deliberate trade. */}
        {/* NO "TAGS" HEADING. It cost a whole line to label a row of tag
            chips and a field that says "add a tag" in its own placeholder —
            the control describes itself, and at nine panels the heading was
            nine lines of the word. One hairline stays, because the panel still
            needs a foot to sit on. */}
        <div className="hidden border-t border-white/10 pt-2 @min-[30rem]:block">
          <TagEditor nodeId={node.id} />
        </div>
      </div>
      </div>
  );
}
