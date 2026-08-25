"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LOOKS, SECTIONS, SHOTS, clamp } from "./playbar-model";
import { PlaybarFrame } from "./playbar-frame";
import { PLAYBAR_CSS, PLAYBAR_PAGE_CLASS, PLAYBAR_SCOPE } from "./playbar-styles";

/**
 * THE REFERENCE DESIGN'S CLIP DECK, ported to React (PL15-030).
 *
 * Three cards across with the centre one active, swipeable with a fling, each
 * card carrying its own frame, cut and source readouts, trim strip with
 * handles, in/out fields and tags.
 *
 * THE CONTENT-AREA HEADER IS GONE, as asked: no "Takes" chip and no
 * "17 takes · 02:00" count. The deck is the whole component.
 *
 * THE GLIDE IS WRITTEN, NOT RENDERED. `deckPos` is a float that eases toward an
 * integer target, and every card's transform, opacity, brightness and z-index
 * is derived from it — sixty times a second. Routing that through state would
 * re-render seventeen cards per frame to move them; the cards are rendered once
 * and `layout()` writes their styles directly, which is what the reference does
 * and for the same reason.
 *
 * WHAT STATE IS FOR: which card is active, each clip's trim, and which one is
 * playing. Those change when a person does something.
 */

const MODELS = ["H3 4-ref", "ref2va", "minimax-h3", "comfy-cloud H3"] as const;
/** Frames sampled across a clip's source for its trim strip. */
/**
 * Cells in a card's trim strip.
 *
 * WIDER THAN THE REFERENCE'S SIXTEEN, and fewer for the same reason: each cell
 * is now a real frame at its own moment rather than the same picture repeated,
 * so a cell is a Cloudinary frame grab and a request. Sixteen 25px slivers of a
 * 16:9 frame is a column of noses; eight at ~50px are readable pictures AND
 * half the fetches. Exported because the caller builds the frames and the two
 * counts have to be one number.
 */
export const CLIP_DECK_STRIP_CELLS = 8;
const CELLS = CLIP_DECK_STRIP_CELLS;
/** How much of a card's width the next one sits away by, plus the gap. */
const CARD_GAP_PX = 18;

/** The reference's own `clamp(300px, 30vw, 440px)` ends, restated so the fitted
 *  width can never exceed the design's intent or shrink past its floor. Below
 *  the floor the deck stops narrowing and the view scrolls instead — a card is
 *  mostly text, and text has a size past which it is not worth showing. */
const CARD_MIN_WIDTH_PX = 300;
const CARD_MAX_WIDTH_PX = 440;
/** The side cards are scaled to 0.86 and sit at the same centre line, so a card
 *  fitted flush to the deck would have its neighbours' shadows clipped. */
const CARD_BREATHING_PX = 16;
/** Eases `deckPos` toward its target; below this it has arrived. */
const GLIDE_RATE = 0.16;
const GLIDE_SETTLED = 0.002;
/** A press that moves less than this is a tap, not a swipe. */
const TAP_SLOP_PX = 4;
/** How far a fling is projected, in ms of travel at release velocity. */
const FLING_PROJECTION_MS = 160;

/** Deterministic, exactly as the reference builds them — a story fixture must
 *  not wander between runs. */
const REFERENCE_CLIPS: readonly ClipDeckClip[] = SHOTS.map((shot) => {
  const i = shot.index;
  const duration = shot.end - shot.start;
  const head = Number((0.4 + ((i * 37) % 23) / 10).toFixed(2));
  const tail = Number((0.6 + ((i * 53) % 17) / 10).toFixed(2));
  const section = SECTIONS.find((s) => i >= s.first && i <= s.last)?.name ?? "";
  const model = MODELS[i % MODELS.length]!;
  return {
    id: String(i),
    name: `SH ${String(i + 1).padStart(2, "0")} — ${section} take (${model}, seed ${100 + ((i * 97) % 880)})`,
    source: Number((head + duration + tail).toFixed(2)),
    trimIn: head,
    trimOut: Number((head + duration).toFixed(2)),
    frames: shot.frames.map((frame) => LOOKS[frame.look] ?? ""),
    tags: [
      section.toLowerCase().replace(/\s+/g, "-"),
      `SH${String(i + 1).padStart(2, "0")}`,
      model.split(" ")[0]!.toLowerCase(),
    ],
  };
});

type Trim = Readonly<{ in: number; out: number }>;

/**
 * WHAT THE DECK NEEDS TO DRAW A CLIP (PL15-030).
 *
 * Deliberately small, and deliberately not the app's node type. A card shows a
 * name, a picture, a source length and the window inside it, and reports back
 * when either edge moves — everything else the graph knows is the caller's
 * business.
 *
 * A FRAME IS A CSS BACKGROUND, the same seam the film strip uses: the reference's
 * procedural gradients and our real posters are the same kind of value here.
 */
export type ClipDeckClip = Readonly<{
  id: string;
  name: string;
  /** The whole source, in seconds. */
  source: number;
  /** The window inside it — `out` is an absolute point, not a tail length. */
  trimIn: number;
  trimOut: number;
  /**
   * Backgrounds sampled across the WHOLE SOURCE, one per cell of the trim
   * strip. The strip depicts the source with the window drawn over it, so the
   * cells have to span the source too — a row of identical pictures says the
   * clip does not change, which is a claim about the footage rather than a
   * placeholder.
   */
  frames: readonly string[];
  /**
   * The big picture: the frame at the TRIM-IN point.
   *
   * Separate from `frames[0]`, which is the source's opening frame and stays
   * that whatever the window is set to. A card whose window starts eight
   * seconds in was showing a frame it does not contain. Falls back to the
   * first cell when absent, which is what a caller with no frame grabs gets.
   */
  poster?: string;
  tags: readonly string[];
}>;

export type ClipDeckProps = Readonly<{
  /** The clips to show. Defaults to the reference design's own. */
  clips?: readonly ClipDeckClip[];
  /** The subject. CONTROLLED when given: the deck reports a change through
   *  `onActivate` and never moves the selection behind the caller's back. */
  activeId?: string | null;
  onActivate?: (id: string) => void;
  /** An edge was dragged. Absolute source seconds, both of them. */
  onTrim?: (id: string, next: Readonly<{ in: number; out: number }>) => void;
  /** On its own page, or embedded in one — see `PlaybarFrame`. */
  standalone?: boolean;
  /**
   * FIT THE CARDS TO THE HEIGHT ON OFFER, rather than take the design's own.
   *
   * Off by default, which is the reference's behaviour: a 480px deck holding a
   * card at its natural width, with whatever is below it pushed down. On means
   * the deck fills the space it is given and narrows its cards until they fit —
   * only worth doing when the height is genuinely contested, because the price
   * is a smaller card. The details view turns it on exactly when the preview
   * pane is up.
   */
  fitToHeight?: boolean;
  /**
   * HOW MANY CARDS EACH SIDE OF THE SUBJECT ARE DRAWN.
   *
   * 1 is the reference's deck — the subject and its two neighbours. 2 shows
   * five, and it ADDS rather than rearranges: the three in the middle keep the
   * width, spacing, scale and dimming they already had, and the extra pair sits
   * beyond them at the same pitch. They run off the edges on a narrow view,
   * which is the accepted cost of not shrinking the three anyone is reading.
   */
  neighbours?: number;
  /**
   * A frame from a clip's source, for showing where a trim currently sits.
   *
   * A PROP RATHER THAN A REPORT BACK. The deck could publish the in-point and
   * take a new poster in return, but that is a state round trip through the
   * caller on every pointer move — the film strip's own drag stopped tracking
   * when it did exactly that. Asking a pure function during render costs a
   * render and nothing else.
   *
   * The caller decides how often a distinct frame is worth fetching; every
   * distinct time is a distinct request.
   */
  frameAt?: (clipId: string, sourceSeconds: number) => string | undefined;
  /**
   * A `view-transition-name` for the SUBJECT card's picture.
   *
   * The board card the user clicked wears this name until the details view
   * mounts, and then this picture wears it — so the browser morphs the
   * thumbnail into the card rather than the view simply appearing. The name is
   * the caller's to choose because the card and the board have to agree on it,
   * and neither of them is this component.
   *
   * ONE ELEMENT AT A TIME, which is why it goes on the active card alone: two
   * elements holding one name makes the browser skip the morph entirely.
   */
  heroName?: string;
  className?: string;
}>;

export function ClipDeck({
  clips: clipsProp,
  activeId,
  onActivate,
  onTrim,
  standalone = true,
  fitToHeight = false,
  neighbours = 1,
  frameAt,
  heroName,
  className,
}: ClipDeckProps) {
  const CLIPS = useMemo(() => clipsProp ?? REFERENCE_CLIPS, [clipsProp]);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const posRef = useRef(6); // boots on the shot the reference selects
  const targetRef = useRef(6);
  const rafRef = useRef(0);
  const dragRef = useRef<{
    startX: number;
    /** Only ever compared against `startX`, to tell a swipe from a scroll. */
    startY: number;
    startPos: number;
    lastX: number;
    lastAt: number;
    velocity: number;
    moved: boolean;
    /** Given up as a vertical scroll: no pan, and no tap on release either. */
    abandoned: boolean;
    cardIndex: number | null;
  } | null>(null);
  const spacingRef = useRef(480);
  /** Whether the deck has been put on a subject yet — the first one is a jump,
   *  not a glide. */
  const placedRef = useRef(false);

  const [ownActive, setOwnActive] = useState(6);
  const active =
    activeId === undefined || activeId === null
      ? ownActive
      : Math.max(0, CLIPS.findIndex((clip) => clip.id === activeId));
  const setActive = (index: number) => {
    if (activeId === undefined) setOwnActive(index);
  };
  // THE CLIPS' OWN TRIMS, mirrored so a drag can move an edge every frame
  // without a round trip. Re-seeded when the clips change, because a store that
  // has committed the drag is the authority and this copy is not.
  const [trims, setTrims] = useState<readonly Trim[]>(() =>
    CLIPS.map((clip) => ({ in: clip.trimIn, out: clip.trimOut })),
  );
  // MIRRORED IN A REF so the release handler can read the edge the drag landed
  // on WITHOUT reaching for it through a state updater. Doing that ran the
  // commit inside React's render pass — the dispatch notified the store, the
  // store re-rendered SelectionSummary, and React reported the obvious: a
  // component updated while a different one was rendering. The subtler half is
  // that StrictMode invokes an updater twice, so one trim drag could commit
  // TWICE and leave two entries on the undo stack for one edit nobody made
  // twice. The ref is written wherever the state is, and read by the commit.
  const trimsRef = useRef<readonly Trim[]>(trims);
  // MIRRORED FROM AN EFFECT, not from render. `applyTrims` writes the ref
  // directly because it is only ever called from a pointer handler, where that
  // is allowed; the re-seed below runs DURING render, where writing a ref is
  // not — React Compiler rejects it outright ("Cannot access refs during
  // render"), and it is the same class of mistake as the trim commit that was
  // dispatching mid-render. So the re-seed sets state alone and this carries it
  // across.
  useEffect(() => {
    trimsRef.current = trims;
  }, [trims]);
  const applyTrims = (next: readonly Trim[]) => {
    trimsRef.current = next;
    setTrims(next);
  };
  const [clipsSeen, setClipsSeen] = useState(CLIPS);
  if (clipsSeen !== CLIPS) {
    setClipsSeen(CLIPS);
    setTrims(CLIPS.map((clip) => ({ in: clip.trimIn, out: clip.trimOut })));
  }

  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  /* ── the glide ──────────────────────────────────────────────────────── */

  const layout = useCallback(() => {
    const cards = cardRefs.current;
    const first = cards[0];
    if (first == null) return;
    const width = first.offsetWidth || 480;
    spacingRef.current = width * 0.93 + CARD_GAP_PX;
    const pos = posRef.current;
    const near = Math.round(clamp(pos, 0, CLIPS.length - 1));

    cards.forEach((card, i) => {
      if (card == null) return;
      const offset = i - pos;
      const distance = Math.abs(offset);
      // CAPPED AT ONE, so a card further out is dimmed and scaled exactly like
      // the immediate neighbour rather than fading away by rank. That is what
      // makes five an ADDITION: the three in the middle are untouched by the
      // setting, and the extra pair joins them at the same size.
      const k = Math.min(distance, 1);
      card.style.transform = `translate(calc(-50% + ${offset * spacingRef.current}px), -50%) scale(${1 - k * 0.14})`;
      // `shown` is how far out a card is still fully drawn; one further out is
      // the fade, and past that nothing. At `neighbours = 1` this is the
      // reference's own `2 - distance`, unchanged.
      const shown = neighbours + 1;
      card.style.opacity = String(
        distance > shown ? 0 : (1 - k * 0.16) * clamp(shown - distance, 0, 1),
      );
      card.style.filter = `brightness(${1 - k * 0.22}) saturate(${1 - k * 0.08})`;
      card.style.zIndex = String(30 - Math.round(distance * 6));
      // A card you can see is a card you can hit. The 0.6 is the reference's
      // own margin past the last fully-drawn card.
      card.style.pointerEvents = distance > neighbours + 0.6 ? "none" : "";
      card.classList.toggle("active", i === near);
    });
    return near;
  }, [neighbours]);

  const animate = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const step = () => {
      const delta = targetRef.current - posRef.current;
      if (Math.abs(delta) < GLIDE_SETTLED) {
        posRef.current = targetRef.current;
        const near = layout();
        if (near !== undefined) setActive(near);
        return;
      }
      posRef.current += delta * (reduced ? 1 : GLIDE_RATE);
      const near = layout();
      if (near !== undefined) setActive(near);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [layout, reduced]);

  const goTo = useCallback(
    (index: number, report = true) => {
      const next = clamp(Math.round(index), 0, CLIPS.length - 1);
      targetRef.current = next;
      // REPORTED ONLY WHEN A PERSON ASKED. The deck also glides to follow a
      // selection made elsewhere — the film strip, a keyboard step — and
      // reporting that back would be answering a question with its own echo.
      if (report) {
        const clip = CLIPS[next];
        if (clip !== undefined) onActivate?.(clip.id);
      }
      if (dragRef.current === null) animate();
    },
    [CLIPS, animate, onActivate],
  );

  // THE DECK FOLLOWS THE SUBJECT when the caller owns it. Without this the
  // cards keep whatever clip they booted on while the rest of the view has
  // moved — the header said "clip 11 of 13" over a deck centred on clip 7.
  useEffect(() => {
    if (activeId === undefined || activeId === null) return;
    const index = CLIPS.findIndex((clip) => clip.id === activeId);
    if (index < 0) return;
    // COMPARED AGAINST WHERE THE CARDS ACTUALLY ARE, not just against the
    // target. Bailing on the target alone loses the glide entirely under
    // StrictMode's double-invoke: this effect sets the target and starts the
    // animation, the layout effect below cancels the frame in its cleanup, and
    // then this runs again and returns early because the target it set is
    // already correct. The deck sat on whatever clip it booted with while the
    // header had moved on — measured, subject at card 10 and the deck centred
    // on 6.
    if (index === targetRef.current && Math.abs(posRef.current - index) < 0.01) return;

    // THE FIRST PLACEMENT IS NOT A JOURNEY.
    //
    // The deck boots on the reference's own card and then glides to whatever
    // the caller's subject is, so opening the view showed the cards sliding
    // into position — an animation about nothing, since there was no previous
    // subject to have come from. Worse for the flight that is supposed to be
    // happening: the shared-element transition names `.clip.active`, and while
    // the deck is still travelling that class is on the card it booted with,
    // so the picture flew to the wrong card or, with no card yet marked, did
    // not fly at all.
    //
    // So the first subject is simply where the deck already is, and every
    // change AFTER it is followed by eye.
    if (!placedRef.current) {
      placedRef.current = true;
      posRef.current = index;
      targetRef.current = index;
      layout();
      return;
    }
    goTo(index, false);
  }, [CLIPS, activeId, goTo, layout]);

  /**
   * THE CARD IS FITTED TO THE DECK'S HEIGHT, BY NARROWING IT.
   *
   * A card is a fixed stack of rows plus a picture that is half its width, so
   * its height is `fixed + width / aspect`. Solving that for the height on
   * offer gives the widest card that fits — and because the picture gives back
   * twice what the width loses, a modest narrowing buys a lot of height.
   *
   * MEASURED RATHER THAN ASSUMED. `fixed` is read off a real card as
   * "everything that is not the picture", so a row added or removed later
   * cannot leave a stale constant behind — which is the failure this file has
   * already had once, in the divider guard that outlived its own reason.
   *
   * Driven by a ResizeObserver rather than from `layout()`: the answer only
   * changes when the deck's height does, and `layout()` runs every frame of a
   * glide.
   */
  useEffect(() => {
    const deck = deckRef.current;
    if (deck === null || standalone) return;

    const fit = () => {
      const card = cardRefs.current.find((candidate) => candidate !== null);
      const picture = card?.querySelector<HTMLElement>(".c-view");
      if (card == null || picture == null) return;
      const pictureHeight = picture.offsetHeight;
      const pictureWidth = picture.offsetWidth;
      if (pictureHeight <= 0 || pictureWidth <= 0) return;

      // A card is a fixed stack of rows plus a picture that is a fixed shape,
      // so `fixed`, `aspect` and `sideways` are constants of the design and
      // hold whatever width the card happens to be at right now.
      const fixed = card.offsetHeight - pictureHeight;
      const aspect = pictureWidth / pictureHeight;
      const sideways = card.offsetWidth - pictureWidth;

      // WHAT THE DECK NEEDS TO SHOW A CARD AT THE DESIGN'S OWN WIDTH,
      // published for the view to read.
      //
      // The view has to decide whether fitting can succeed BEFORE it starts
      // conceding, and it cannot work this out for itself: the cards are
      // absolutely positioned with the deck's overflow visible, so a deck
      // squeezed under its card does not clip it — the card sprawls, and
      // overflow that escapes a visible box is not scrollable content. Every
      // measurement the view could take is blind to it. So the deck says.
      //
      // A custom property rather than a callback: no React state, so no render
      // and no chance of the two components driving each other round a loop.
      const need = Math.round(fixed + (CARD_MAX_WIDTH_PX - sideways) / aspect + CARD_BREATHING_PX);
      if (deck.style.getPropertyValue("--deck-need") !== `${need}px`) {
        deck.style.setProperty("--deck-need", `${need}px`);
      }

      if (!fitToHeight) {
        // Hand the cards back to the reference's own `clamp(300px, 30vw,
        // 440px)`, so turning fitting off restores the design rather than
        // freezing whatever width the last fit landed on.
        if (deck.style.getPropertyValue("--clip-w") !== "") deck.style.removeProperty("--clip-w");
        if (deck.style.minHeight !== "") deck.style.removeProperty("min-height");
        return;
      }

      const available = deck.clientHeight;
      if (available <= 0) return;
      const widest = (available - CARD_BREATHING_PX - fixed) * aspect + sideways;
      const next = Math.round(clamp(widest, CARD_MIN_WIDTH_PX, CARD_MAX_WIDTH_PX));
      if (deck.style.getPropertyValue("--clip-w") === `${next}px`) return;
      deck.style.setProperty("--clip-w", `${next}px`);
      layout();
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(deck);
    return () => observer.disconnect();
  }, [layout, standalone, fitToHeight, CLIPS]);

  /**
   * RE-PLACE THE CARDS WHENEVER THERE ARE DIFFERENT ONES.
   *
   * `layout()` writes every card's transform, opacity and z-index directly, and
   * it only ever ran on mount. A card that mounted LATER — which is every card
   * past the first handful, because the clip list arrives in pieces — was never
   * touched, so it kept its default styles: no transform, so stacked dead
   * centre, and opacity 1, so fully painted. Measured, 43 of 56 cards piled on
   * the middle of the deck, invisible only because the laid-out card sits above
   * them on z-index.
   *
   * Keyed on the clips rather than folded into the mount effect below, which
   * must NOT re-run: its cleanup cancels the glide.
   */
  useEffect(() => {
    layout();
  }, [CLIPS, layout]);

  useEffect(() => {
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [layout]);

  /* ── swipe ──────────────────────────────────────────────────────────── */

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Controls inside a card are not a swipe surface.
    if (target.closest("input, button, .c-win, .c-tags") !== null) return;
    const card = target.closest<HTMLElement>(".clip");
    cancelAnimationFrame(rafRef.current);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startPos: posRef.current,
      lastX: event.clientX,
      lastAt: performance.now(),
      velocity: 0,
      moved: false,
      abandoned: false,
      cardIndex: card === null ? null : Number(card.dataset.i),
    };
    // Capture is an ENHANCEMENT, not a requirement: it keeps the drag alive when
    // the pointer leaves the element. A browser that refuses it (or a
    // synthesised pointer, which has no capture to take) must still pan, so a
    // failure here cannot be allowed to abort the gesture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture; the window-level listeners still see the drag through.
    }
    deckRef.current?.classList.add("dragging");
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.abandoned) return;
    // A DRAG DOWN THE SCREEN IS NOT A SWIPE.
    //
    // The reference deck reads X and nothing else, which is safe on a surface
    // that fills the window and scrolls nowhere. Here the view is a page —
    // when the preview is down the cards sit in normal flow with a scrollbar —
    // so a hand that means "scroll" was travelling far enough sideways to pan
    // the deck as well, and the clip you were reading slid out from under it.
    //
    // Decided ONCE, at the moment the gesture first commits to a direction,
    // and never revisited: a swipe that curls downward at the end is still a
    // swipe, and re-testing every move would abandon it halfway. The same rule
    // in reverse is what lets a slightly untidy horizontal drag through.
    if (!drag.moved) {
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (Math.max(dx, dy) > TAP_SLOP_PX && dy > dx) {
        drag.abandoned = true;
        deckRef.current?.classList.remove("dragging");
        animate();
        return;
      }
    }
    const now = performance.now();
    const dt = now - drag.lastAt;
    if (dt > 0) drag.velocity = drag.velocity * 0.7 + ((event.clientX - drag.lastX) / dt) * 0.3;
    drag.lastX = event.clientX;
    drag.lastAt = now;
    posRef.current = clamp(
      drag.startPos - (event.clientX - drag.startX) / spacingRef.current,
      -0.5,
      CLIPS.length - 0.5,
    );
    if (!drag.moved && Math.abs(event.clientX - drag.startX) > TAP_SLOP_PX) drag.moved = true;
    const near = layout();
    if (near !== undefined) setActive(near);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    // Abandoned as a scroll: it never moved the deck, and it is not a tap
    // either — the hand travelled, it just travelled the other way.
    if (drag.abandoned) return;
    deckRef.current?.classList.remove("dragging");
    if (!drag.moved) {
      // A tap on a side card brings it to the centre; on the centre it does
      // nothing, which is what makes tapping safe while reading one.
      if (drag.cardIndex !== null) goTo(drag.cardIndex);
      else animate();
      return;
    }
    // Project the throw: velocity is px/ms and a card is `spacing` px wide.
    goTo(posRef.current + (-drag.velocity * FLING_PROJECTION_MS) / spacingRef.current);
    animate();
  };

  /* ── trim ───────────────────────────────────────────────────────────── */

  /**
   * THE WINDOW SLIDES, IT DOES NOT ONLY RESIZE.
   *
   * The reference reads its mode off the target — `c-h` left, `c-h` right, and
   * otherwise `"m"`, the window body sliding both edges at once. This port had
   * only the two handles, so the largest surface on a card did nothing at all
   * while advertising `cursor: grab` and even `:active{cursor:grabbing}`.
   * Measured across a card, the window band was the one place a press moved
   * nothing — which is most of what "grab does not work reliably" was.
   */
  const dragTrim =
    (index: number, mode: "in" | "out" | "move") => (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const strip = (event.currentTarget as HTMLElement).closest<HTMLElement>(".c-strip");
    const clip = CLIPS[index];
    if (strip == null || clip === undefined) return;
    const box = strip.getBoundingClientRect();
    // WHERE IN THE WINDOW IT WAS GRABBED, and how long the window is, both read
    // once at press. A slide has to keep its length and stay under the pointer;
    // recomputing either mid-drag makes the window creep away from the hand.
    const startTrim = trimsRef.current[index] ?? { in: clip.trimIn, out: clip.trimOut };
    const grabbedAt = ((event.clientX - box.left) / box.width) * clip.source;
    const grabOffset = grabbedAt - startTrim.in;
    const windowLength = startTrim.out - startTrim.in;

    const move = (moveEvent: PointerEvent) => {
      const ratio = clamp((moveEvent.clientX - box.left) / box.width, 0, 1);
      const at = Number((ratio * clip.source).toFixed(2));
      applyTrims(
        trimsRef.current.map((trim, i) => {
          if (i !== index) return trim;
          // A window cannot cross itself; a tenth of a second is the floor.
          if (mode === "in") return { ...trim, in: Math.min(at, trim.out - 0.1) };
          if (mode === "out") return { ...trim, out: Math.max(at, trim.in + 0.1) };
          // Sliding clamps the WHOLE window inside the source, so it stops at
          // either end with its length intact rather than being squashed.
          const nextIn = clamp(at - grabOffset, 0, Math.max(0, clip.source - windowLength));
          return { ...trim, in: nextIn, out: nextIn + windowLength };
        }),
      );
    };
    // A CANCELLED POINTER ABANDONS THE TRIM, and until now nothing listened for
    // one at all: the drag simply stayed live with its listeners attached and
    // the card's mirrored window stuck at wherever the pointer was when the
    // browser took it away — a scroll it decided to own, a touch leaving the
    // digitiser, the window losing focus. Measured: after a cancel the card's
    // big picture kept showing the dragged frame instead of the committed one.
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      // Back to what the store holds — the gesture did not happen.
      applyTrims(CLIPS.map((entry) => ({ in: entry.trimIn, out: entry.trimOut })));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      // COMMITTED ON RELEASE, not per frame. A trim is one edit however long
      // the drag was, and dispatching every pointer move would fill the undo
      // stack with a hundred steps nobody made.
      const trim = trimsRef.current[index];
      if (trim !== undefined) onTrim?.(clip.id, trim);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <div
      className={[PLAYBAR_SCOPE, standalone ? PLAYBAR_PAGE_CLASS : "", className ?? ""]
        .join(" ")
        .trim()}
    >
      <style>{PLAYBAR_CSS}</style>
      <PlaybarFrame standalone={standalone}>
          <section
            className="deck"
            ref={deckRef}
            // NO MARGIN OF ITS OWN WHEN EMBEDDED. The reference's deck carries
            // `margin: 20px 0 4px` because it sits under a preview panel on its
            // own page; here the view's own `gap-6` is the spacing, and the two
            // together read as a gap nobody chose.
            style={
              standalone
                ? undefined
                : // NO MARGIN IN EITHER DIRECTION when embedded: the view's own
                  // gap is the spacing, and the two together read as a gap
                  // nobody chose. The HEIGHT is only taken when fitting —
                  // `height: 100%` on a deck that is not a bounded flex item
                  // resolves against a parent with no height of its own, and
                  // the deck collapses under its own cards.
                  fitToHeight
                  ? // `minHeight` is deliberately absent: `fit()` owns it, and a
                    // value here would be rewritten over its answer on every
                    // render. React only touches the properties it is given.
                    { marginTop: 0, marginBottom: 0, height: "100%" }
                  : { marginTop: 0, marginBottom: 0 }
            }
            aria-label="Clip takes"
            // THE ROW, under the name the row it replaced went by — see the
            // note on `data-item-details-frame` below.
            data-details-strip=""
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="deck-track">
              {CLIPS.map((clip, index) => {
                // FALLING BACK TO THE CLIP'S OWN WINDOW, which is not
                // defensive padding. Re-seeding `trims` during render makes
                // React run this component again — but the render already in
                // flight carries on with the OLD array, so on the pass where
                // the clip list changes length there is no entry here yet.
                // The clip knows its own trim; the mirror only exists so a
                // drag can move an edge without a round trip.
                const trim = trims[index] ?? { in: clip.trimIn, out: clip.trimOut };
                const cut = Number((trim.out - trim.in).toFixed(2));
                // A mirrored trim that differs from the committed one means a
                // drag on THIS card is in flight — which is exactly when the
                // big picture should be following it. The out handle never
                // moves the in point, so it never asks for a frame.
                const liveUrl =
                  Math.abs(trim.in - clip.trimIn) > 0.001
                    ? frameAt?.(clip.id, trim.in)
                    : undefined;
                const livePoster =
                  liveUrl === undefined
                    ? undefined
                    : `center/cover no-repeat url("${liveUrl}")`;
                const left = (trim.in / clip.source) * 100;
                const width = ((trim.out - trim.in) / clip.source) * 100;
                return (
                  <div
                    key={clip.id}
                    className={`clip${index === active ? " active" : ""}`}
                    // THE ROLE THIS CARD PLAYS, named the way the panel row it
                    // replaced named it. A card here IS the centre panel or a
                    // neighbour — the deck changed how they are drawn, not what
                    // they are — and everything that reasons about the view in
                    // those terms should keep working rather than learn a
                    // second vocabulary for the same three things.
                    //
                    // ONLY THE CARDS ACTUALLY DRAWN. The deck holds every clip
                    // in the collection and shows `neighbours` either side, so
                    // marking them all would report sixty panels for a view
                    // with three.
                    data-item-details-panel={
                      Math.abs(index - active) <= neighbours
                        ? index === active
                          ? "centre"
                          : "neighbour"
                        : undefined
                    }
                    data-i={index}
                    // THE NAME GOES ON THE CARD, NOT ON THE PICTURE INSIDE IT.
                    //
                    // Every card carries a transform and a filter, written by
                    // `layout()` on every frame. A `view-transition-name` on a
                    // DESCENDANT of a transformed, filtered subtree is captured
                    // relative to that subtree — measured, the browser had both
                    // boxes (a 320x220 board card and a 410x205 picture) and
                    // still held the group at the destination for the whole
                    // flight, cross-fading in place instead of travelling.
                    //
                    // The card is the transformed element itself rather than
                    // something inside one, so its own transform is part of the
                    // geometry the browser captures.
                    style={
                      heroName !== undefined && index === active
                        ? { viewTransitionName: heroName }
                        : undefined
                    }
                    ref={(node) => {
                      cardRefs.current[index] = node;
                    }}
                  >
                    <header className="c-head">
                      <span className="c-id">clip {index + 1}</span>
                      <span className="c-dur">
                        <b className="c-trim">{cut.toFixed(2)}s</b>
                        <i>/</i>
                        <span className="c-srcd">{clip.source.toFixed(2)}s</span>
                      </span>
                      <button className="c-menu" title="Clip options" type="button">
                        ⋯
                      </button>
                    </header>

                    <h3 className="c-title" title={clip.name}>
                      {clip.name}
                    </h3>

                    <div className="c-view">
                      <div
                        className="c-frame cine"
                        // THE NAMES THE VIEW IS READ BY, kept across the redraw.
                        //
                        // The deck changed how a card is painted, not what its
                        // parts are: this is still "the picture", and the strip
                        // below is still "the trim strip". Everything that
                        // reasons about the view — stories, e2e, the details
                        // bar — addresses them by these names, and renaming
                        // them along with the CSS would have been a second
                        // vocabulary for the same two things.
                        data-item-details-frame=""
                        style={{
                          // THE PICTURE FOLLOWS THE TRIM WHILE IT IS MOVING.
                          //
                          // A card's big image is the frame its clip starts on,
                          // so dragging the in point or sliding the whole
                          // window changes which frame that is — and watching
                          // it change is most of how you choose one. Asked for
                          // only while this card's mirrored trim differs from
                          // the committed one, which is exactly the span of a
                          // drag on THIS card: the out handle never moves the
                          // in point, so it never asks.
                          background: livePoster ?? clip.poster ?? clip.frames[0] ?? "#0d0d10",
                        }}
                      />
                    </div>

                    <div className="c-bar">
                      <button className="c-play" title="Play trimmed range" type="button">
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M3 1.5v9l7.5-4.5z" />
                        </svg>
                      </button>
                      <span className="c-cut">
                        cut <b>0.00s</b>
                      </span>
                      <span className="c-srct">
                        src <b>{trim.in.toFixed(2)}s</b>
                      </span>
                    </div>

                    <div className="c-strip" data-trim-strip-slot="">
                      {Array.from({ length: CELLS }, (_, cell) => (
                        <div
                          key={cell}
                          className="c-cell"
                          style={{
                            background:
                              clip.frames[
                                Math.floor((cell / CELLS) * clip.frames.length)
                              ] ?? "#0d0d10",
                          }}
                        />
                      ))}
                      <div className="c-shade l" style={{ width: `${left}%` }} />
                      <div
                        className="c-shade r"
                        style={{ left: `${left + width}%`, right: 0, width: "auto" }}
                      />
                      <div
                        className="c-win"
                        style={{ left: `${left}%`, width: `${width}%` }}
                        onPointerDown={dragTrim(index, "move")}
                      >
                        <i className="c-h l" onPointerDown={dragTrim(index, "in")} />
                        <i className="c-h r" onPointerDown={dragTrim(index, "out")} />
                      </div>
                    </div>

                    <div className="c-io">
                      <label>in</label>
                      <input className="c-in" spellCheck={false} readOnly value={trim.in.toFixed(2)} />
                      <span className="arr">→</span>
                      <label>out</label>
                      <input
                        className="c-out"
                        spellCheck={false}
                        readOnly
                        value={trim.out.toFixed(2)}
                      />
                      <span className="c-total">{cut.toFixed(2)}s</span>
                    </div>

                    <div className="c-tags">
                      {clip.tags.map((tag) => (
                        <span key={tag} className="c-tag">
                          {tag}
                          <b>×</b>
                        </span>
                      ))}
                      <button className="c-add" title="Add tag" type="button">
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
      </PlaybarFrame>
    </div>
  );
}
