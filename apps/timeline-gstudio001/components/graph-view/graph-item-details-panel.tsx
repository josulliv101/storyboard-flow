"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  hasSourceWindow,
  isEditableKeyboardTarget,
  mediaDurationSeconds,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  type MediaNode,
} from "@storyboard/ui/dnd-collections";

import { DETAILS_PANEL_HEIGHT_CLASS } from "./graph-view-config";
import {
  HAIRLINE,
  HAIRLINE_STRONG,
  RADIUS_CARD,
  SURFACE_CARD,
  SURFACE_CARD_FOCUS,
} from "./graph-details-design";
import { DETAILS_CHROME_MS, detailsStepTransition } from "./graph-details-motion";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { formatSeconds } from "@/lib/format-duration";
import { useInlineRename } from "./graph-inline-rename";
import { ItemDetailsMonitor } from "./graph-item-details-monitor";
import { ItemDetailsTrimStrip } from "./graph-item-details-trim-strip";
import { ItemDetailsPanelHeader } from "./graph-item-details-panel-header";
import { useClipDetail } from "./graph-details-context";
import { LayerFramePicker } from "./graph-layer-frame-picker";
import { TagEditor } from "./graph-tag-editor";
import { seamStripProgress } from "./graph-seam-scrub";
import { useScopedHistory } from "./graph-item-details-history";
import { MONITOR_TARGET_PX, MAX_MAGNIFICATION } from "./graph-item-details-shared";

// ONE panel of the details view. Split out of the modal so that file is the
// carousel and this is the clip: everything per-clip — the monitor, the trim
// strip, the typed edges, the tags, the scoped history pair — lives here.

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
  swapping = false,
  playhead,
  playing = false,
  playingHere = false,
  onPlayFromStart = null,
  live: onScreen = false,
  magnified = false,
  scrubbing = false,
  swipe,
  width,
  spare = false,
  dimmed = false,
  scrubFocus = false,
  clipLabel,
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
   * Fade in rather than appear, because the row cut to a new place instead of
   * travelling to it.
   *
   * Only ever set on a NEIGHBOUR. The centre card is the reason the row cut at
   * all — it has been the monitor for the whole scrub, so it is already
   * showing the clip that was landed on, and fading it would flicker the one
   * picture on screen that did not change.
   */
  swapping?: boolean;
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
  /** Set by the strip, which owns how many panels are on screen. */
  width: string;
  /**
   * Built and held ready, but outside the window the count promises.
   *
   * `visibility: hidden` rather than unmounting: the whole point of these is
   * that the panel already exists when it becomes the one arriving, so it has
   * to keep its element, its video and its decoded frame. It keeps its width
   * too — the row's centring is arithmetic over uniform neighbour widths, and
   * a collapsed spare would move everything between it and the middle.
   */
  spare?: boolean;
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
   * Mid-scrub, and this is the panel being watched: put this panel's own
   * chrome out and leave the picture at full strength.
   *
   * Done by dimming the parts rather than by covering the view with a scrim.
   * A scrim cannot work here: the row carries a `transform`, which makes it a
   * stacking context, so nothing inside a panel can be raised above an
   * overlay that is a sibling of the row — the preview went dark along with
   * everything else, which is the opposite of the point.
   */
  scrubFocus?: boolean;
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
    // THE CENTRE PANEL ONLY, which the paragraph above says about the focus
    // wiring and this effect had not been told.
    //
    // Every mounted panel ran this, so a single F2 called `begin()` on all
    // five and `stopPropagation` did not stop it: these listeners are all on
    // `document`, and stopping propagation stops an event reaching another
    // NODE, not the other listeners on this one. Which panel you ended up
    // renaming was listener order — measured, it was a neighbour, so pressing
    // F2 in a view opened on one clip put the cursor in a different clip's
    // name.
    //
    // Escape hid it, because closing five times closes once.
    if (!centre) return;
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
  }, [centre, onClose, beginRename]);

  // HOW FAR TO PAINT IT UP while the clock is being dragged. Aimed at a SIZE
  // rather than multiplied by a guess: a fixed factor is nothing at five
  // panels on a monitor and far too much at three.
  const magnification =
    magnified && panelWidthPx > 0
      ? Math.min(MAX_MAGNIFICATION, Math.max(1, MONITOR_TARGET_PX / panelWidthPx))
      : 1;

  // THE CONTAINER IS A WRAPPER, not the panel itself, because an element
  // cannot query its own width — and the panel needs to change its own HEIGHT
  // when it gets narrow, not merely what it puts inside itself. The wrapper
  // carries the width and nothing else.
  // THE WIDTH ANIMATES, and it is the one thing here that animates layout
  // rather than paint.
  //
  // Stepping makes a different clip the subject, so the outgoing centre has to
  // narrow and the incoming one has to widen — that size change IS the motion,
  // and faking it with a transform would scale the type along with the frame.
  // It is two elements for 300ms, in step with the row's own slide so a panel
  // arrives at its new size exactly as it arrives at its new place.
  // `motion-reduce` drops it to a cut.
  return (
      <div
        ref={panelRef}
        data-item-details-spare={spare ? "" : undefined}
        className={[
          "@container shrink-0",
          // A STEP ANIMATES ITS WIDTH; A LANDING DOES NOT.
          //
          // Stepping makes a different clip the subject, so the outgoing
          // centre narrows and the incoming one widens — that size change IS
          // the motion, in step with the row's own slide.
          //
          // A landing is the opposite case and has been since the row learned
          // to cut: the middle card has been the monitor for the whole scrub,
          // so it is already showing the clip you landed on and it must not
          // move. Animating its width would put the one thing that did not
          // change back into motion, and would leave its edges drifting for
          // 300ms after a gesture whose whole claim is that it arrives
          // instantly.
          swapping ? "transition-none" : "motion-reduce:transition-none",
        ].join(" ")}
        style={{
          width,
          // THE STEP'S OWN TIMING, shared with the row and the film strip
          // above — see `graph-details-motion`. Written as a style rather than
          // a `duration-*`/`ease-*` pair so the curve is the one value all
          // three read, instead of a cubic-bezier copied into three class
          // strings and drifting from two of them.
          ...(swapping ? {} : { transition: detailsStepTransition("width") }),
          ...(spare ? { visibility: "hidden" as const } : {}),
        }}
      >
      <div
        // FOCUS WIRING ON THE CENTRE ONLY. Every panel is fully live — the
        // grips trim, the title renames, the video seeks — but "which dialog
        // has the keyboard" is singular by definition, so the roving focus,
        // the Escape handling and the initial focus target stay with the clip
        // that was opened. The neighbours are working panels, not focus traps.
        {...(centre ? dialogProps : {})}
        data-item-details-panel={centre ? "centre" : "neighbour"}
        data-item-details-swapping={swapping && !centre ? "" : undefined}
        // WHAT FRAME THIS PANEL IS SHOWING, when the clock is what put it
        // there. Absent on a panel resting on its own first frame, which is a
        // different state from "at zero seconds" and the one an untouched view
        // is in. Exposed because it is the one fact about a landing that
        // cannot be read any other way: the bar is a window, so its own
        // seconds mean different things on different bars, while this is the
        // clip's own time and travels.
        data-item-details-at={monitor === null ? undefined : monitor.seconds.toFixed(3)}
        data-item-details-scrub-focus={scrubFocus ? "" : undefined}
        data-item-details-magnified={magnification > 1 ? "" : undefined}
        style={{
          // A TRANSFORM, not a width. The strip's slide is computed from a
          // uniform panel width, so a centre panel that actually got wider
          // would move every landing off by the difference. Scaling paints
          // bigger and leaves the geometry alone — the row still knows exactly
          // where everything is.
          transform: magnification > 1 ? `scale(${magnification})` : undefined,
          // See the class above: the curve is a utility, the clock is here.
          transitionDuration: `${DETAILS_CHROME_MS}ms`,
          zIndex: magnification > 1 ? 20 : undefined,
        }}
        data-item-details-live={onScreen ? "" : undefined}
        // THE HIGHLIGHT IS ON THE MIDDLE PANEL, ALWAYS, AND SAYS NOTHING ABOUT
        // PLAYBACK.
        //
        // It used to follow the playhead: whichever clip's frames were up wore
        // the ring, so during a run-up it sat on a neighbour. The idea was to
        // tie the line moving through the bar to the panel it belonged to —
        // and in use it read as flicker, a halo hopping between panels as the
        // clock crossed a seam, competing with the picture it surrounded.
        //
        // The bar already says where playback is; it has a playhead and a
        // marked box for the purpose. So the ring goes back to answering the
        // simpler question it is well shaped for — which panel is the subject
        // — and answers it constantly, which means it never moves and never
        // pulls the eye.
        className={[
          // FADE IN, because the row cut here rather than travelling. See
          // `swapping` — never on the centre, which did not change.
          swapping && !centre ? "animate-seam-panel-swap" : "",
          // AND NOTHING ELSE ANIMATES WHILE IT DOES.
          //
          // A landing leaves the clock engaged, so every neighbour is newly
          // `dimmed` and starts its own 300ms `transition-[opacity,filter]` in
          // the same frame this fade begins. Two nested opacity animations is
          // already one too many; the second of them also animates a GRAYSCALE
          // FILTER, and a filter over a `<video>` that is still fetching and
          // decoding its first frame is repainted from the decoder every tick.
          // That is why this was smooth on stills and not on video — an `<img>`
          // is a static bitmap and costs nothing to re-filter.
          //
          // So the incoming panel arrives already dimmed and already drained,
          // and the only thing that moves is the fade. Higher specificity than
          // the utility it overrides (a descendant selector against a single
          // class), so it needs no important modifier.
          swapping && !centre
            ? "[&_[data-item-details-frame]]:transition-none"
            : "",
          // MID-SCRUB, EVERYTHING BUT THE PICTURE GOES OUT. The frame excludes
          // itself by name, so the one thing being judged keeps full strength
          // while the header, the strip, the numbers and the tags recede. A
          // child-selector rather than a wrapper because these are siblings
          // and wrapping them would change the panel's own layout to say
          // something about its lighting.
          "[&>*:not([data-item-details-frame])]:transition-opacity [&>*:not([data-item-details-frame])]:duration-200",
          scrubFocus ? "[&>*:not([data-item-details-frame])]:opacity-15" : "",
          // gap-2, not gap-3: with the prose and the headings gone the rows
          // below the strip are short and closely related, and twelve pixels
          // between each of them was reading as four separate regions rather
          // than one foot to the panel.
          //
          // `@container`, so what the panel shows depends on how wide the panel
          // actually IS rather than on how many there are. Five panels on a
          // large monitor have more room each than three on an iPad, and a
          // rule counting panels gets that backwards.
          "relative flex w-full flex-col gap-2 p-4 focus-visible:outline-none",
          RADIUS_CARD,
          // FOCUS FALLOFF, carried by the surface and the border moving
          // together. Either alone is too quiet to survive a screen full of
          // pictures; both together are still quieter than the white ring
          // this replaces, which was the loudest mark in the view and was
          // spent on the one fact the layout already tells you.
          centre ? SURFACE_CARD_FOCUS : SURFACE_CARD,
          // THE CHROME, on the step's curve but half its clock. A ring and a
          // shadow do not travel, so matching the step's duration would leave
          // a border still resolving after the panel it borders had arrived —
          // it lands INSIDE the motion rather than alongside it. The duration
          // is set in the style below, because Tailwind's default is 150ms and
          // a bare `ease-*` would silently take it.
          "transition-[box-shadow,border-color,transform] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
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
          // ONE PIXEL ON EVERY PANEL, always. A 2px border on the centre pushed
          // its picture down a pixel and shortened it by two, which matters
          // precisely because comparing frames ACROSS panels is what this
          // view is for. Only the colour changes with focus, and colour
          // costs no layout.
          "border",
          centre ? HAIRLINE_STRONG : HAIRLINE,
          // ONE shadow utility per state, both spelled out. Layering a glow on
          // top of `shadow-2xl` would mean two classes setting `box-shadow`,
          // and which one wins is a question about stylesheet order rather
          // than about the order they appear in this string — so the drop
          // shadow is written into both branches and the glow is simply a
          // second layer of the live one.
          // QUIETER THAN THE ONE IT REPLACES. The playhead-following version
          // was two pixels of sky plus a 36px halo, which had to shout because
          // it was competing to be noticed as it moved. A stationary mark does
          // not: one hairline of white at low opacity is enough to say which
          // panel is the subject, and it leaves the pictures to be the bright
          // things on screen.
          // THE DROP SHADOW IS THE SAME ON EVERY PANEL now that the border
          // carries focus. It lifts the row off the board; it does not say
          // which panel you are working in.
          "shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)]",
          // ── HEIGHT: THE SUBJECT TAKES THE SCREEN, THE REST FIT THEIR
          //    PICTURE ────────────────────────────────────────────────────
          //
          // A FIXED 68vh WHILE THE PANEL IS FULL, and fitted to its picture
          // once it is not. Stripped of its controls a panel is a frame and a
          // name, and holding it at two thirds of the screen leaves most of it
          // black — tall empty columns either side of the one you are looking
          // at, which is the "weird" in a five-up view rather than the
          // controls being gone.
          //
          // THE CENTRE ALONE TAKES THE FIXED HEIGHT, and that is the fix for a
          // large viewport. The rule was a container query on WIDTH — over
          // 30rem a panel took the 68vh — which is a proxy for "is this panel
          // full", and the proxy breaks on a big screen: at 2560x1440 a
          // NEIGHBOUR is 544px wide, clears the query, and takes the same
          // 979px the centre does. Measured there: all three panels 979 tall,
          // all three frames 728, and the 1.75 width ratio producing no height
          // difference at all.
          //
          // Below that size it worked by accident — the neighbours were under
          // 30rem, fitted their pictures, and came out shorter. Asking the
          // question directly ("are you the subject?") rather than inferring
          // it from width gives the same answer at every size.
          //
          // A SMALLER FIXED HEIGHT FOR THE NEIGHBOURS, not a fitted one.
          // Letting them fit was the first attempt and it broke the property
          // that matters for them: they must match EACH OTHER, and fitting
          // makes each one as tall as its own picture — measured at five-up,
          // four neighbours at four different heights, which reads as a broken
          // row rather than as emphasis.
          //
          // 38.9vh is 68 divided by the 1.75 the widths already use, so a
          // neighbour is the centre scaled down by the same factor in both
          // axes rather than by one in width and another in height. Verified
          // at 2560x1440: 979 against 546, a height ratio of 1.79 beside a
          // width ratio of 1.76.
          //
          // Both keep the container query, so a genuinely NARROW panel still
          // fits its picture — that is the five-up case the original rule was
          // written for, and it is a different question from this one.
          // `min-h-0` IS WHAT MAKES `max-h-full` MEAN ANYTHING. A flex item's
          // default `min-height: auto` refuses to shrink below its content, so
          // the cap was quietly losing to a panel whose header, frame and
          // controls added up to more — the height was honoured and the LIMIT
          // was not. Measured before: a 619px panel in a 484px band, ending
          // 16px past the bottom of the window and 75px into the view-count
          // control.
          //
          // The same fix `DETAILS_HERO_FILL_CLASS` already applies one level
          // down, for the same reason and with the same failure mode.
          "min-h-0",
          // AND THE CAP IS AGAINST THE VIEWPORT, not against `100%`.
          //
          // `max-h-full` was inert here and the reason is worth keeping: a
          // percentage max-height resolves against the PARENT, and this
          // panel's parent is auto-sized to the panel — both measured 619px,
          // so the cap was 100% of the thing it was meant to be capping.
          // Circular, and silently so.
          //
          // The scrim reserves two bands, `pt-[21.75rem]` for the bar above
          // and `pb-[4.875rem]` to clear the view-count control below. Their
          // sum is what a panel may not exceed, and it is written here as one
          // number because the alternative — threading `min-h-0 max-h-full`
          // through the two auto-sized ancestors — puts a height constraint on
          // the row that carries the strip's pan transform.
          //
          // KEEP IN STEP WITH THE SCRIM. 21.75 + 4.875 = 26.625rem. The
          // failure if they drift is the panel running into the control again,
          // which is what this fixed.
          "max-h-[calc(100vh-26.625rem)]",
          centre
            ? "@min-[30rem]:h-[68vh] h-auto"
            : "@min-[30rem]:h-[38.9vh] h-auto",
        ].join(" ")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ItemDetailsPanelHeader
          name={node.name}
          clipLabel={clipLabel ?? null}
          // TWO HALVES, NOT ONE STRING. How much of the clip is in play
          // and how long the source runs are a bright fact and a dim one,
          // and joining them here would have forced the header to draw
          // them in one weight.
          showingLabel={formatSeconds(showing)}
          sourceLabel={video ? formatSeconds(fullDuration) : null}
          focused={centre}
          nodeId={node.id as string}
          rename={rename}
        />

        <ItemDetailsMonitor
          node={node}
          centre={centre}
          dimmed={dimmed}
          swipe={swipe}
          onAdvance={onAdvance}
          monitor={monitor}
          playing={playing}
          scrubbing={scrubbing}
          playingHere={playingHere}
          onPlayFromStart={onPlayFromStart}
          live={live}
          trimIn={trimIn}
          trimOut={trimOut}
        />

        {/* ABOVE THE TRIM BLOCK, and that placement is load-bearing.

            Everything below the filmstrip has to be the SAME HEIGHT in every
            panel, because the cards hang from a common bottom and that is
            what puts the three strips on one line. This control appears only
            for a clip on a lane with a picture — so it is present on some
            cards and not others, and underneath the strip it would push one
            card's strip up by its own height and break the line it sits on.
            Above the strip it lands in the part of the card that is already
            allowed to differ. */}
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

        <ItemDetailsTrimStrip
          node={node}
          windowed={windowed}
          video={video}
          trimIn={trimIn}
          trimOut={trimOut}
          showing={showing}
          live={live}
          playhead={playhead}
        />


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
        {/* ALWAYS, AND ALWAYS ONE LINE HIGH.

            This was gated at 30rem, which made it the last thing standing
            between the three filmstrips and a shared line: at a 1280 canvas
            the 560px centre kept its tags and the 320px neighbours dropped
            theirs, so the neighbours' strips sat 37px lower — the tag row and
            its gap, exactly. A row that is present on one card and absent on
            another cannot sit under something that has to align.

            Un-gating it is not enough on its own: tags wrap, and a clip may
            carry up to MAX_TAGS_PER_CLIP of them, so a wrapping row is a
            variable-height row and breaks the line just as thoroughly. The
            chips scroll sideways instead — see graph-tag-editor.tsx.

            Both changes ADD capability rather than removing it: a narrow
            panel could not be tagged at all before. */}
        <div className="border-t border-white/10 pt-2">
          <TagEditor nodeId={node.id} />
        </div>
      </div>
      </div>
  );
}
