"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Film,
  Folder,
  Image as ImageIcon,
  Layers,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { flushSync } from "react-dom";
import {
  StoryboardMonsterMark,
  STORYBOARD_MONSTER_ACCENT,
} from "./storyboard-monster-mark";
import { TrashDrawer } from "@/components/assets/trash-drawer";
import { useAuth } from "@/components/auth/auth-provider";
import {
  GRAPH_TRASH_ARRIVAL_EVENT,
  GRAPH_TRASH_HOVER_EVENT,
  GRAPH_VIEW_STATE_EVENT,
  isGraphViewRoute,
  requestGraphSurface,
  type GraphSurface,
  type GraphViewStateDetail,
} from "@/lib/graph-view-events";
import {
  RAIL_CLASS,
  RAIL_OPEN_CLASS,
  RAIL_OPEN_WIDTH_PX,
  RAIL_WIDTH_CLASS,
  RAIL_WIDTH_PX,
  SIDEBAR_AVATAR_INSET,
  SIDEBAR_GLYPH,
  SIDEBAR_ICON_BASE,
  SIDEBAR_ICON_IDLE,
} from "./sidebar-icon-styles";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { toast } from "@/components/core/sonner";
import { cn } from "@/lib/utils";
import { withViewTransition } from "@/lib/view-transition";

import { SidebarCollectionShortcuts } from "./sidebar-collection-shortcuts";
import {
  SidebarLabelsInlineContext,
  SidebarTooltipLabel,
} from "./sidebar-tooltip-label";

/** Survives a reload — a rail that collapsed itself on every navigation would
 *  be a preference in name only. */
const RAIL_EXPANDED_STORAGE_KEY = "sw:sidebar-expanded";

/**
 * The same preference, as a COOKIE, because the server has to know it.
 *
 * localStorage is invisible to the server, so every load rendered the rail
 * collapsed and expanded it on hydration — a 187px shove of everything beside
 * it, and 0.135 of a 0.16 CLS on its own (#471). No amount of client-side
 * cleverness fixes that: the first paint has to be right, and only something
 * that travels with the REQUEST can make it right.
 *
 * READ AS THE SOURCE OF TRUTH on both sides, rather than mirrored alongside
 * localStorage. Two stores that can disagree are a hydration mismatch waiting
 * for the first person whose copies drift — cleared site data, an old tab, a
 * private window. One store cannot disagree with itself. localStorage is still
 * WRITTEN, and still read as a fallback, purely so a rail already open before
 * this change stays open on the load that introduces it.
 *
 * SEMANTICS ARE UNCHANGED. A cookie is per-browser and so is localStorage, and
 * this is read at LOAD, never live — so the note below about two windows
 * keeping their own widths still holds. What a cookie adds is only that the
 * server can see it.
 *
 * `SameSite=Lax` and a year: a display preference, sent on top-level
 * navigations, which is exactly when the server needs it.
 */
const RAIL_EXPANDED_COOKIE = "sw_rail_expanded";
const RAIL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Parse the rail cookie out of a `document.cookie` / request header string. */
export function railExpandedFromCookies(header: string | undefined): boolean {
  if (!header) return false;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === RAIL_EXPANDED_COOKIE) return rest.join("=") === "true";
  }
  return false;
}

/**
 * Published to the document so surfaces BESIDE the rail can be offset by it.
 *
 * The trash drawer hardcoded `ml-[72px]`, which is correct exactly while the
 * rail cannot change width — so opening the rail would have slid it
 * underneath. A variable is the seam: one writer here, and any number of
 * readers that keep working when this number moves again.
 */
const RAIL_WIDTH_VAR = "--sw-rail-width";

/** Fires when THIS window toggles the rail — the only notification there is,
 *  see below. Without it the toggle would not re-render the window that
 *  pressed it. */
const RAIL_EXPANDED_EVENT = "sw:sidebar-expanded-changed";

function readRailExpanded(): boolean {
  // The cookie first, because it is what the SERVER rendered from — reading
  // anything else here would be reading a second opinion, and a first client
  // render that disagreed with the markup is the hydration mismatch this whole
  // change exists to remove.
  if (typeof document !== "undefined" && document.cookie.includes(RAIL_EXPANDED_COOKIE)) {
    return railExpandedFromCookies(document.cookie);
  }
  try {
    // MIGRATION ONLY: a rail left open before the cookie existed. One toggle,
    // or the backfill on mount, writes the cookie and this stops being read.
    return window.localStorage.getItem(RAIL_EXPANDED_STORAGE_KEY) === "true";
  } catch {
    // Private mode or a blocked origin: the rail still works, it just forgets.
    return false;
  }
}

/** Write the preference where the server can see it. */
function writeRailCookie(next: boolean): void {
  try {
    document.cookie =
      `${RAIL_EXPANDED_COOKIE}=${next}; path=/; max-age=${RAIL_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  } catch {
    // Cookies blocked: the rail still works for this session, and the next
    // load simply renders the server default again.
  }
}

/**
 * THIS WINDOW ONLY. Deliberately NOT subscribed to `storage`.
 *
 * It was, on the reasoning that two tabs should agree about the rail. That is
 * wrong, and the way it was wrong is worth keeping: `storage` fires in every
 * OTHER tab on the origin, so opening the rail in one window silently
 * collapsed it in every other one. With the width animated, the far window
 * did not read as "something else changed this" — it read as a toggle that
 * stuttered and fell back, because the layout started moving and then went the
 * other way.
 *
 * The rail's width is a property of a WINDOW, not of the account. Two windows
 * side by side are the case where you most want one wide and one narrow.
 * localStorage still carries the preference across a RELOAD, which is the part
 * that was actually wanted; a live window is simply never yanked by another.
 */
function subscribeRailExpanded(onChange: () => void): () => void {
  window.addEventListener(RAIL_EXPANDED_EVENT, onChange);
  return () => {
    window.removeEventListener(RAIL_EXPANDED_EVENT, onChange);
  };
}

function commitRailExpanded(next: boolean): void {
  // The cookie is what the next load renders from; localStorage is kept in
  // step so a downgrade does not lose the preference.
  writeRailCookie(next);
  try {
    window.localStorage.setItem(RAIL_EXPANDED_STORAGE_KEY, String(next));
  } catch {
    // A quota or private-mode failure costs the preference, not the toggle —
    // the event still fires, so the rail still moves for this session.
  }
  window.dispatchEvent(new Event(RAIL_EXPANDED_EVENT));
}

/**
 * Toggle the rail INSIDE a view transition, so the monster can jump between its
 * two homes rather than teleport.
 *
 * The creature's two positions are genuinely different DOM layouts — inline in
 * "m…nster" when open, alone and larger when closed — so nothing about the
 * change is animatable by ordinary means: the element does not move, it is
 * re-laid-out. A view transition snapshots both states and gives the browser
 * something to interpolate between, and `globals.css` styles that interpolation
 * as a hop (see the `sw-monster-*` keyframes).
 *
 * `flushSync` is not optional. `startViewTransition` captures the "after" state
 * when its callback returns, and the callback here only dispatches an event —
 * React's re-render would land after the capture, so the transition would
 * animate from a state to itself.
 *
 * Falls back to a plain commit where the API is missing or the reader asked for
 * less motion; the rail still moves, it just cuts.
 */
/**
 * THE TWO DIRECTIONS ARE TWO DIFFERENT JUMPS, and each is three settings.
 *
 * They were one for a while. Unifying them was tempting — the arithmetic worked
 * out, one launch constant explained both — but it meant every correction to
 * one silently rewrote the other, and the closing jump had already been signed
 * off. The opening one needed a change of SHAPE rather than of parameter, so
 * there was nothing left to share.
 *
 * Each direction therefore names its own keyframes, its own clock between them,
 * and its own travel curve. All three have to move together: the arcs are
 * authored against their own clocks and neither survives being given the
 * other's.
 */
type JumpArc = {
  /** The keyframe set that draws the arc. */
  hop: string;
  /** The clock BETWEEN its keyframes — part of the shape, not a finish on it. */
  hopEase: string;
  /** How the ground goes by underneath: the group's own position curve. */
  travel: string;
  /** How long that travel takes. Ends with the hop, or short of it. */
  travelMs: string;
  /** The group's hole-filler: an opaque rect that travels with it, so it helps
   *  only while the creature is on top of it. See the note in globals.css. */
  fill: string;
};

/**
 * CLOSING: shaped, and signed off as-is. Do not retune without being asked.
 *
 * The travel is a `linear()` because three things have to be true at once and
 * no cubic-bezier holds all three — anything slow enough to keep the crouch in
 * place decelerates through the middle and parks the apex over open ground:
 *
 *   17%    3% across   the crouch happens IN PLACE, not while sliding sideways
 *   32%   13% across   paired with the rise, a ~37deg climb out of the ground
 *   58%   82% across   the apex sits near the landing
 *
 * Generated as a monotone cubic through those points and sampled at 19 stops:
 * monotone so the interpolation can never send the creature briefly backwards,
 * 19 so the segments sit below the eye's resolution. Regenerate it rather than
 * hand-editing a stop.
 */
const CLOSING: JumpArc = {
  hop: "sw-monster-hop",
  hopEase: "cubic-bezier(0.34, 0.8, 0.28, 1)",
  travel:
    "linear(0 0%, 0.008508 6%, 0.01694 11%, 0.02907 17%, 0.0522 22%," +
    " 0.09105 28%, 0.1467 33%, 0.2732 39%, 0.4545 44%, 0.6412 50%," +
    " 0.7839 56%, 0.8508 61%, 0.8965 67%, 0.9309 72%, 0.9543 78%," +
    " 0.9693 83%, 0.9804 89%, 0.9898 94%, 1 100%)",
  travelMs: "620ms",
  fill: "rgb(9 9 11) linear-gradient(oklab(0.21 0.00164225 -0.00577088 / 0.5) 0 100%)",
};

/**
 * OPENING: ballistic.
 *
 * A jump has no horizontal force, so its horizontal velocity is CONSTANT and
 * only the vertical accelerates. Both settings here follow from that one fact:
 * a near-linear travel whose peak speed is 1.22x its mean, and `linear` between
 * keyframes so the arc is the keyframe VALUES rather than something a clock
 * manufactures out of them.
 *
 * Both were wrong before, in opposite ways. The travel was front-loaded — 42%
 * of the way across while still crouching. And `animation-timing-function`
 * applies between EVERY pair of keyframes, so the eased hop re-eased each leg:
 * 77% of the way to a stop a third into the segment, 92% half way through.
 * Every leg landed early and held, which is what "reaches the apex too early"
 * was describing.
 *
 * The result is an apex ~18px up at 57% of the travel, against 11.2px at ~20%.
 */
const OPENING: JumpArc = {
  // THE CLOSING ARC, FORESHORTENED. Every setting here except the keyframe name
  // is the closing one's, because the two directions want the same SHAPE and
  // differ only in how big that shape reads.
  //
  // It was derived from scratch for several rounds — ballistic travel, `linear`
  // between stops, gravity sampled from a parabola — and each version fixed the
  // complaint it was aimed at and read wrong overall. Tracing both body centres
  // is what settled it: the closing arc peaks at 80% of its travel and DROPS
  // onto the spot at 38deg, while every from-scratch opening arc peaked near
  // the middle and glided in at around 12deg. That is not a landing, it is an
  // approach, and no amount of retuning a symmetric parabola makes it one.
  //
  // Depth belongs in the SIZE of the arc, which is why only the lift is scaled
  // (see `sw-monster-hop-open`), and it is scaled DOWN because this direction
  // ends about 1.45x further from the reader.
  hop: "sw-monster-hop-open",
  hopEase: CLOSING.hopEase,
  travel: CLOSING.travel,
  travelMs: CLOSING.travelMs,
  // NO FILLER. It is an opaque rectangle that travels with the group, and this
  // direction crosses the wordmark as the letters are revealing, so instead of
  // hiding a hole it blanks them. Verified by eye that nothing dark appears in
  // its absence here.
  fill: "transparent",
};

function writeRailExpanded(next: boolean): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  const reduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  if (typeof doc.startViewTransition !== "function" || reduced) {
    commitRailExpanded(next);
    return;
  }
  // WHICH WAY IT IS GOING, for the lean. Opening, the creature travels RIGHT —
  // out of the collapsed rail's centre and into the middle of the word.
  // Closing, it travels left. The keyframes multiply their rotation and drift
  // by this, so the body leans into the direction of the jump instead of
  // always tipping the same way. A creature that leans the wrong way reads as
  // being blown sideways rather than as choosing to go.
  document.documentElement.style.setProperty("--sw-hop-dir", next ? "1" : "-1");

  // WHICH JUMP THIS IS. Three properties, set together, because the arc is all
  // three: see `CLOSING` and `OPENING`.
  const arc = next ? OPENING : CLOSING;
  const root = document.documentElement.style;
  root.setProperty("--sw-hop-name", arc.hop);
  root.setProperty("--sw-hop-ease", arc.hopEase);
  root.setProperty("--sw-group-ease", arc.travel);
  root.setProperty("--sw-group-ms", arc.travelMs);
  root.setProperty("--sw-group-fill", arc.fill);

  // AIM THE EYE BEFORE THE BODY GOES. Both snapshots are captured with this
  // attribute set — the pose it leaves from and the pose it lands in — so the
  // pupil points along the arc for the WHOLE flight rather than only reacting
  // once it is over. That ordering is the whole effect: an eye that moves first
  // reads as a creature deciding to jump, and an eye that only moves on landing
  // reads as one that was thrown.
  //
  // It has to be an attribute set here rather than a keyframe in the hop,
  // because mid-flight the creature is a rasterised image and nothing inside it
  // can move. A pose can still be captured INTO that image; motion cannot.
  const mark = document.querySelector("[data-storyboard-monster]");
  mark?.setAttribute("data-aiming", "");

  // OPT INTO THE TRANSITION, and only this one. The `view-transition-name` that
  // makes the creature a snapshot lives in `globals.css` behind these two
  // attributes rather than inline on the element, because a name is not scoped
  // to the transition you meant — it applies to every one the document runs,
  // and this app runs others (the details modal, the trash drawer). Named for
  // its whole life, the creature played its entire jump whenever a modal
  // opened, under an opaque hole-filler, and then vanished when that unrelated
  // transition finished.
  //
  // Set BEFORE `startViewTransition`, because the old state is captured the
  // moment it is called, and held until `finished`, which covers the new
  // capture too. Cleared on every exit below, next to the aim.
  mark?.setAttribute("data-hopping", "");
  document.documentElement.dataset.swHop = "";

  const transition = doc.startViewTransition(() => {
    flushSync(() => commitRailExpanded(next));
    // THE SECOND POSE, and the reason there is one at all. The browser captures
    // the OLD state before this callback runs and the NEW state after it
    // returns, so anything set here lands in the arrival snapshot and not the
    // departure one. That is the only lever that makes a part of the creature
    // LOOK like it moved during a transition that freezes it: photograph the
    // same element twice, in two poses, and hand over between the images.
    //
    // Today it is the feet — they leave angled off the toe and arrive flat, so
    // the toe-off reads as a launch gesture rather than a permanent point. See
    // `sw-monster-depart` / `sw-monster-arrive` for the handover itself.
    mark?.setAttribute("data-landing", "");
  }) as { finished?: Promise<unknown> };

  // THE SETTLE, once the flight is over. The eye and the feet cannot move
  // during the transition — the creature is a rasterised snapshot then, not
  // elements — so the parts that should still be moving when the body stops are
  // handed back to the live element here. See `sw-pupil-settle` and
  // `sw-foot-settle`.
  //
  // Attribute rather than React state on purpose: this is a 500ms flourish, and
  // routing it through the store would re-render the sidebar twice more for it.
  // LEAVING THE TRANSITION, on every path out. Dropping these late is not a
  // cosmetic slip: while `data-hopping` is on, the creature is still a named
  // participant, so the NEXT transition anyone starts — a modal, the trash
  // drawer — snapshots it and replays the jump. That is the bug this pair
  // exists to prevent, so it must not survive the flight that set it.
  const leaveTransition = () => {
    mark?.removeAttribute("data-hopping");
    delete document.documentElement.dataset.swHop;
  };

  const finished = transition.finished;
  if (!finished) {
    // Nothing to hang the settle off. Drop the aim on a timer regardless — a
    // pupil left staring sideways is worse than no flourish at all.
    window.setTimeout(() => {
      mark?.removeAttribute("data-aiming");
      mark?.removeAttribute("data-landing");
      leaveTransition();
    }, 620);
    return;
  }
  void finished
    .then(() => {
      if (!mark) return;
      // Swapped in ONE frame, and the settle's first pose is the aim, so the
      // pupil is never briefly re-centred between the two — the handover from
      // captured image to live element is invisible.
      mark.removeAttribute("data-aiming");
      mark.removeAttribute("data-landing");
      leaveTransition();
      mark.setAttribute("data-settling", "");
      // Outlasts the longest part, which is the PUPIL: it now waits for the eye
      // to finish moving (460ms) and then constricts over 800ms, so it is still
      // going 620ms after the hat has stopped. Pulling the attribute early does
      // not shorten the flourish, it truncates it — at 620ms the hat's final
      // bounce was cut mid-air, and anything under 1260 snaps the last of the
      // dilation off in one frame.
      window.setTimeout(() => mark.removeAttribute("data-settling"), 1360);
    })
    .catch(() => {
      // A transition skipped or superseded by a faster second click. The rail
      // still moved; only the flourish is lost — but the aim must come off, or
      // the eye is left pointing at a jump that never happened.
      mark?.removeAttribute("data-aiming");
      mark?.removeAttribute("data-landing");
      leaveTransition();
    });
}

/**
 * After a POINTER press on a rail tile, keep that tile's tooltip shut until
 * the pointer LEAVES AND COMES BACK.
 *
 * Clicking a tile leaves the pointer sitting on it, so its tooltip faded up the
 * moment the thing you pressed finished happening — captioning a control you
 * are still touching and have just used.
 *
 * CLEARED ON RE-ENTRY, not on leaving, and the difference is the whole fix.
 * Pressing the collapse toggle by its LABEL puts the pointer ~150px out, and
 * the rail then shrinks to 72px — so the tile is pulled out from under a
 * pointer that never moved. That fires `pointerleave`, which cleared the flag,
 * while `:hover` stayed stale-true (browsers recompute hover on pointer
 * movement, not on layout). Flag off plus hover still on is exactly the flash:
 * a tooltip for a control that had just slid away. Waiting for `pointerenter`
 * cannot be tricked by geometry moving, because nothing enters an element the
 * pointer never left.
 *
 * Delegated on the rail rather than added to seven call sites, and the flag is
 * a DOM attribute rather than React state: it must not re-render the rail, and
 * nothing else needs to know.
 *
 * `detail > 0` keeps this to real pointer presses. A keyboard Enter also fires
 * click with no pointer anywhere near the tile, so no `pointerenter` would ever
 * arrive to clear the flag and that tile would go quiet for good.
 */
function suppressTipUntilPointerReturns(
  event: React.MouseEvent<HTMLElement>,
): void {
  if (event.detail === 0) return;
  const tile = (event.target as HTMLElement | null)?.closest("button, a");
  if (!(tile instanceof HTMLElement)) return;
  tile.dataset.tipSuppressed = "";
  tile.addEventListener(
    "pointerenter",
    () => {
      delete tile.dataset.tipSuppressed;
    },
    { once: true },
  );
}

/**
 * Letters that grow from nothing to their natural width, and back.
 *
 * A GRID, not a `max-width`, and the difference is the whole reason this looks
 * right. Text has no width you can name in advance, so a max-width transition
 * has to guess a number bigger than the word — and then the visible growth
 * finishes early, at the word's real width, while the property keeps
 * animating. The letters appear to arrive and then wait. `0fr` to `1fr`
 * animates to exactly the content's own size, so the S and the W part at the
 * speed the word actually needs.
 *
 * `overflow-hidden` on the inner span is what does the hiding; the outer grid
 * only owns the width.
 *
 * LIGHTER THAN THE INITIALS, in weight AND in ink. The link is `font-bold`
 * (700) and the S and W keep it — they are the mark, and they are all that
 * survives the collapse. The letters that grow out of them are the word, so
 * they step down to `semibold` (600) at 90% opacity.
 *
 * The opacity is carrying most of the distinction now. It used to be weight
 * alone, against a `font-black` (900) mark — a 300-point gap that read on its
 * own. The mark came down to 700 because 900 was too heavy, which left the
 * word one step below it, and one step of weight is not a difference anyone
 * sees. Dropping the ink instead keeps "SW" reading as an abbreviation OF the
 * name rather than as its first and ninth characters.
 *
 * Neither is animated, so a collapsing group stays light the whole way in.
 */
function RevealedLetters({
  show,
  children,
}: Readonly<{ show: boolean; children: React.ReactNode }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // THE TWO DIRECTIONS DO DIFFERENT THINGS, so the pacing lives on the
        // branch rather than above it.
        //
        // OPENING, THE WORD CARRIES THE CREATURE. It used to trail the launch by
        // a beat and finish in 420ms against a jump that lands at 680, so the
        // gap the creature is aiming for arrived first and sat waiting while the
        // creature caught up. Matching the group's own travel — same curve, same
        // 680ms, no delay — makes the creature sit IN the "o" slot the whole way
        // across instead of merely ending up there.
        //
        // It works out exactly, which is worth writing down because it looks
        // like a coincidence. The creature's group interpolates its box from
        // x=22 (alone in the rail) to x=153 (inside the word), so its position
        // is 22 + 131p. The slot's left edge is 22 plus the revealed width of
        // "storyboard " and "m", and that width is 131 when fully revealed — so
        // the slot is 22 + 131q. Same form: give p and q the same curve and the
        // two are the same number at every instant.
        //
        // CLOSING IS STILL OVERLAPPING ACTION, and deliberately unchanged: the
        // word goes FIRST and quickly, clearing the space before the creature
        // jumps back into it. Loose parts lag the thing driving them, and which
        // part is loose depends on which way the motion runs.
        "grid transition-[grid-template-columns] motion-reduce:transition-none",
        show
          ? "delay-0 duration-[680ms] ease-[cubic-bezier(0.42,0.3,0.58,0.58)]"
          : "delay-0 duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        show ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
      )}
    >
      {/* NO WEIGHT of its own, still — but for a different reason than it had
          under Caprasimo. That face shipped one 400, so any weight class here
          was a synthesised bold over something already heavy. Grandstander has
          real weights, and the lockup's is picked once where the font is
          loaded (700). A utility here would override that for the letters
          only, and the wordmark would stop matching its own mark. */}
      <span className="overflow-hidden opacity-90">{children}</span>
    </span>
  );
}

/** The avatar letter. Written once because the same nested ternary appeared in
 *  two places, and an empty name string made `name[0]` undefined in both. */
function initialOf(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string {
  return (user?.name?.[0] ?? user?.email?.[0] ?? "U").toUpperCase();
}

type UtilityItem = {
  id: "assets" | "trash";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

/** A folder establishes this as an AREA, while the prominent inset trash
 * glyph keeps it distinct from both an ordinary folder and the delete action. */
function TrashAreaIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden="true"
      // The sidebar hands its drop-hover / arrival classes to this wrapper,
      // which is also what the e2e watches.
      data-sidebar-icon="trash"
      className={cn(
        "relative inline-flex shrink-0 overflow-visible",
        className,
      )}
    >
      <Folder className="h-full w-full" strokeWidth={1.5} />
      <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-zinc-950 ring-1 ring-zinc-600">
        <Trash2 className="size-4" strokeWidth={1.9} />
      </span>
    </span>
  );
}

/** Media lives in a folder, but its image badge prevents the destination from
 * reading like the collection/tree controls elsewhere in the rail. */
function MediaFolderIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 overflow-visible",
        className,
      )}
    >
      <Folder className="h-full w-full" strokeWidth={1.5} />
      <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-zinc-950 ring-1 ring-zinc-600">
        <ImageIcon className="size-4" strokeWidth={1.9} />
      </span>
    </span>
  );
}

// Full-width SQUARES: the rail has no horizontal padding, so `w-full` is the
// rail's width and `aspect-square` makes the height follow it. Sized this way
// rather than with a fixed `size-*` so the two can never drift — change the
// rail's width and every tile (and the logo) resizes with it.
/**
 * A tile's BOX, which is not the same thing as the shape you see.
 *
 * The box stays `w-full aspect-square` — that is what keeps the rail's rhythm
 * even and the tiles on one grid. What you actually see is the `::before`
 * layer, inset from that box, so every fill (idle, hover, pressed, disabled)
 * paints as a rounded pill floating inside its square rather than a band
 * running edge to edge. They used to be the same rectangle, so an active tile
 * read as a full-width stripe across the rail.
 *
 * The fills therefore live on `before:*` in each state constant below, never
 * on the button. The focus ring moved with them for the same reason: a
 * square inset ring around a pill highlight would have described a shape that
 * is no longer there.
 */
// SIDEBAR_ICON_BASE / SIDEBAR_GLYPH / SIDEBAR_ICON_IDLE now live in
// ./sidebar-icon-styles, so the graph's portalled board-options trigger can
// wear the rail's treatment without importing this module (PL14-005).
/**
 * The active tile: an INDICATOR BAR at the rail's edge, over a quietly lifted
 * pill.
 *
 * This is the nav treatment. The rail answers "where am I", and a bar riding
 * the edge reads as a POSITION in a list — the same signal a browser tab or an
 * IDE gutter uses — where a filled tile only reads as a button someone pressed.
 *
 * It replaces a full inversion (near-white pill, near-black glyph). That was
 * legible, but it made the active tile the brightest object on the screen,
 * competing with the board it was only labelling; with several toggles lit at
 * once the rail became the loudest thing in the app. The bar is louder in the
 * only way that matters — position — while the tile itself stays quiet.
 *
 * The bar is anchored to the TILE edge, not the pill: it belongs to the rail's
 * left boundary, so it stays put while the pill floats inset from it.
 *
 * No `translate-y-px`: a pressed tile nudging down by a pixel opened a hairline
 * seam above it and read as misalignment rather than as a press.
 *
 * `h-9` (36px) against the 56px pill: long enough to read as a bar rather than
 * a tick, short enough that it still marks a position instead of drawing a
 * second edge down the rail.
 */
const SIDEBAR_ICON_PRESSED = [
  "text-zinc-50 before:bg-zinc-800",
  "after:absolute after:left-0 after:top-1/2 after:h-9 after:w-[3px]",
  "after:-translate-y-1/2 after:rounded-r-full after:bg-sky-300 after:content-['']",
].join(" ");

/**
 * The active state for a rail tile that is a TOGGLE rather than a place.
 *
 * Identical to `HEADER_TOGGLE_ACTIVE` in graph-board.tsx — an accent tint,
 * carried on the pill instead of the button because that is where this rail
 * paints its fills. Keep the two in step.
 *
 * The distinction the rail draws is location vs. state, not sidebar vs.
 * toolbar. Grid and Strip say WHERE you are, so they get the indicator bar
 * above. Flat mode, preview, and the two drawers change what is ON without
 * moving you — the same kind of fact as the ruler toggle in the breadcrumb
 * row, and they should read like it rather than like more destinations.
 *
 * `sky-300` is the seek rail's PLAYED-time colour (`bg-sky-300/80`), which is
 * where this app already says "this is live". Both treatments share it — bar
 * and tint differ in SHAPE, not hue, so the rail reads as one system.
 */
const SIDEBAR_ICON_TOGGLE_ON =
  "text-sky-300 before:bg-sky-400/15 hover:text-sky-200 hover:before:bg-sky-400/25";
// The tile-group separator went with the tool group it divided (see the note
// in the rail below). Nothing draws a rule between groups now: the layout
// switch at the top and the utility stack at the bottom are already held apart
// by the `mt-auto` that pins the latter to the floor.

/**
 * The strip layout's glyph: lucide's `Film`, turned on its side.
 *
 * The icon is drawn with its sprocket holes down the left and right edges — a
 * reel standing upright. The surface it names runs HORIZONTALLY, so a quarter
 * turn puts the perforations along the top and bottom and the frame divisions
 * across it, which is what a strip of film actually looks like laid out flat.
 *
 * A wrapper rather than an `iconClassName` prop on the control: the rotation
 * belongs to this glyph, not to the control that happens to render it, and
 * `SurfaceIconControl` already takes any `ComponentType<{ className?: string }>`.
 */
function FilmStripGlyph({ className }: { className?: string }) {
  return <Film className={cn(className, "rotate-90")} />;
}

/** Where the grid glyph's cells start on each axis, in viewBox units: three
 *  4-unit cells with a 2-unit gutter, inset 4 from the 24-unit box. */
const GRID_GLYPH_TRACKS = [4, 10, 16];

/**
 * The grid layout's glyph: nine filled cells, replacing lucide's `Table`.
 *
 * `Table` drew a bordered frame divided by rules — a spreadsheet, which is the
 * wrong noun for a wall of cards. Nine separate cells say the thing the surface
 * actually is.
 *
 * Filled rather than stroked, so it is the one glyph in the rail that does not
 * take `[stroke-width:1.5]` from `SIDEBAR_GLYPH`; `fill="currentColor"` is what
 * keeps it in step with the rail's idle / hover / active colours instead, and
 * Tailwind's `transition-colors` covers `fill` as well as `color`.
 */
function GridLayoutGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {GRID_GLYPH_TRACKS.map((y) =>
        GRID_GLYPH_TRACKS.map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" />
        )),
      )}
    </svg>
  );
}

type SurfaceIconControlProps = {
  surface: GraphSurface;
  /** On a graph route the control is a BUTTON that switches the live view's
   *  layout through the event bridge; elsewhere it is a LINK that lands on
   *  the graph route already in that layout. */
  onGraphRoute: boolean;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  label: string;
  description: string;
};

function SurfaceIconControl({
  surface,
  onGraphRoute,
  href,
  icon: Icon,
  isActive,
  label,
  description,
}: SurfaceIconControlProps) {
  const tooltipId = `sidebar-tooltip-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const className = cn(
    SIDEBAR_ICON_BASE,
    isActive ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE,
  );
  const content = (
    <>
      <Icon className={SIDEBAR_GLYPH} />
      <SidebarTooltipLabel
        id={tooltipId}
        label={label}
        description={description}
      />
    </>
  );

  return onGraphRoute ? (
    <button
      type="button"
      aria-label={label}
      aria-describedby={tooltipId}
      aria-pressed={isActive}
      onClick={() => requestGraphSurface(surface)}
      className={className}
    >
      {content}
    </button>
  ) : (
    <Link
      href={href}
      aria-label={label}
      aria-describedby={tooltipId}
      className={className}
    >
      {content}
    </Link>
  );
}

const UTILITY_ITEMS: UtilityItem[] = [
  {
    id: "trash",
    label: "Trash",
    description: "Deleted timeline items",
    icon: TrashAreaIcon,
  },
];

export function TimelineSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isProfileOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isProfileOpen]);
  const pathSegments = pathname.split("/").filter(Boolean);
  const activeProjectId =
    pathSegments[0] === "timeline" && pathSegments[1]?.startsWith("project-")
      ? pathSegments[1]
      : undefined;

  const graphHref = activeProjectId
    ? `/timeline/${encodeURIComponent(activeProjectId)}/graph`
    : "/";

  // The graph view broadcasts its surface + ruler state (on mount and every
  // change); the sidebar's layout icons and ruler toggle reflect it. Grid is
  // the graph's load default, so it is the resting state here too.
  const [graphView, setGraphView] = useState<GraphViewStateDetail>({
    surface: "grid",
    rulerOn: false,
    childrenShown: false,
    previewOn: false,
    flatOn: false,
    flatLoading: false,
  });
  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<GraphViewStateDetail>).detail;
      if (detail) setGraphView(detail);
    };
    window.addEventListener(GRAPH_VIEW_STATE_EVENT, onState);
    return () => window.removeEventListener(GRAPH_VIEW_STATE_EVENT, onState);
  }, []);

  // A drag just dropped items into the graph's sidebar trash target — play
  // the arrival pop on the trash drawer button below. Keyed per arrival so a
  // second drop mid-animation restarts it (the key remount re-triggers the
  // one-shot CSS animation); cleared when the animation ends.
  const [trashArrival, setTrashArrival] = useState(0);
  useEffect(() => {
    const handleArrival = () => setTrashArrival((n) => n + 1);
    window.addEventListener(GRAPH_TRASH_ARRIVAL_EVENT, handleArrival);
    return () =>
      window.removeEventListener(GRAPH_TRASH_ARRIVAL_EVENT, handleArrival);
  }, []);

  // A dragged card is (or is not) currently over the breadcrumb's trash drop
  // zone — the icon does an attention wiggle while it is, pointing the user at
  // where the drop lands.
  const [trashDropHover, setTrashDropHover] = useState(false);
  useEffect(() => {
    const handleHover = (event: Event) =>
      setTrashDropHover((event as CustomEvent<boolean>).detail === true);
    window.addEventListener(GRAPH_TRASH_HOVER_EVENT, handleHover);
    return () =>
      window.removeEventListener(GRAPH_TRASH_HOVER_EVENT, handleHover);
  }, []);

  // The rail is a VIEW rail, and stays one. It used to swap these controls for
  // the selected item's actions the moment anything was selected, which cost
  // three things: a full-width mouse trip to reach an action, a layout jump in
  // peripheral vision on every selection change, and — the real one — access to
  // view switching itself, so you could not select clips and then look at them
  // in the strip. Item actions live in the floating selection toolbar now
  // (`graph-selection-toolbar.tsx`), anchored to the card they act on.
  //
  // Nothing here reads the selection any more. The focus-restore effect that
  // used to accompany the swap went with it: it existed only to catch focus
  // orphaned by unmounting the control the user had just pressed.
  const onGraphRoute = isGraphViewRoute(pathname);
  const railRef = useRef<HTMLElement>(null);
  // Read through an EXTERNAL STORE rather than an effect. The naive shape — a
  // `useState(false)` corrected by a mount effect — is a synchronous setState
  // inside an effect, which lints as a cascading render and is a real one: the
  // rail paints collapsed and then jumps. `useSyncExternalStore` reads the
  // stored value during the first client render instead, and its SERVER
  // snapshot is the collapsed default, which is what keeps SSR and hydration
  // agreeing about a value the server cannot see.
  //
  // Subscribing to `storage` is what an effect could not have done at all: two
  // tabs open on this app now agree about the rail.
  const railExpanded = useSyncExternalStore(
    subscribeRailExpanded,
    readRailExpanded,
    () => false,
  );
  useEffect(() => {
    // The offset every surface beside the rail reads. Written on the document
    // rather than the aside because those surfaces are its SIBLINGS, not its
    // descendants — a variable set here would not inherit to them.
    document.documentElement.style.setProperty(
      RAIL_WIDTH_VAR,
      `${railExpanded ? RAIL_OPEN_WIDTH_PX : RAIL_WIDTH_PX}px`,
    );
  }, [railExpanded]);

  const handleLogout = async () => {
    try {
      await logout();
      toast("Signed out.", { id: "auth-signed-out" });
    } catch {
      toast("Unable to sign out.", { id: "auth-signed-out" });
    }
  };

  // z-50, not z-40: the aside is sticky, so it IS a stacking context and
  // every child z-index (the fly-out tooltips' z-50 included) is trapped
  // inside it. The preview region + graph header sit at z-40 later in the
  // DOM, which painted over the tooltips at equal z — the whole column must
  // outrank them (R7 #8). Nothing overlaps the 72px rail itself, so raising
  // it hides nothing.
  return (
    // The provider is what turns each tile's tooltip into a permanent label.
    // Geometry is done with descendant variants off `RAIL_CLASS` so the seven
    // tile call sites stay untouched; this carries the ONE thing CSS cannot —
    // that an always-visible label is not a `role="tooltip"`.
    <SidebarLabelsInlineContext.Provider value={railExpanded}>
      <aside
        ref={railRef}
        data-sidebar-expanded={railExpanded}
        onClickCapture={suppressTipUntilPointerReturns}
        // No horizontal padding and `items-stretch`: the tiles ARE the rail's
        // width, which is what makes them full-width squares. Vertical padding
        // stays — it separates the rail's contents from the screen edges, which
        // the side padding was not doing for the tiles.
        //
        // OPEN, only the WIDTH changes. Every tile keeps its 72px height and its
        // glyph keeps its x — see RAIL_CLASS — so this reads as labels arriving
        // rather than as a different rail redrawing itself.
        className={cn(
          // Unconditional: it carries the tile geometry, which must NOT change
          // when the width does. See the note on RAIL_CLASS.
          RAIL_CLASS,
          "sticky top-0 z-50 flex h-screen shrink-0 flex-col items-stretch gap-0 overflow-visible border-r border-zinc-800 bg-zinc-900/50 pt-1.5 pb-5 backdrop-blur-md",
          // Width alone is animated. `transition-all` here would also catch the
          // backdrop filter, which is expensive to interpolate over a sticky
          // full-height surface.
          "transition-[width] motion-reduce:transition-none",
          // OPENING AND CLOSING ARE NOT THE SAME MOVE, so the pacing lives on
          // the state rather than here. A transition reads its duration and
          // easing from the AFTER-change style, so whichever branch below is
          // being switched TO is the one that times the move — which is what
          // makes this direction-aware without a single line of JavaScript.
          //
          // From RAIL_WIDTH_CLASS, which holds the literals Tailwind's scanner
          // needs — see the note there on why these cannot be built by template.
          railExpanded
            ? // OPENING: the rail arrives exactly as the creature lands, because
              // it travels on the creature's own profile.
              //
              // It used to be 440ms of easeOutQuint, which is 99% done by 287ms
              // against a jump that does not touch down until 680 — the rail
              // was parked and waiting for most of the flight.
              //
              // MATCHING THE DURATION ALONE WOULD NOT HAVE FIXED IT. Stretched
              // to 680ms that curve still LOOKS finished at 443ms; an ease-out
              // spends its last 1% over a third of its time. So it takes the
              // same near-linear travel the hop's group uses (see `OPENING`),
              // which is 99% done at 670ms — the rail and the creature come to
              // rest together rather than merely stopping at the same instant.
              `${RAIL_WIDTH_CLASS.open} ${RAIL_OPEN_CLASS} duration-[680ms] ease-[cubic-bezier(0.42,0.3,0.58,0.72)]`
            : // CLOSING: an early creep, then commit.
              //
              // It used to close on the opening curve, and that curve is
              // easeOutQuint — 62px of the 168px travel gone in the FIRST 40ms
              // and 79% shut by 120ms. The rail was always going to beat the
              // creature to a standstill, because it did most of its move
              // before the creature had finished crouching.
              //
              // Measured against the hop's own beats, this one is 2% closed at
              // the crouch (116ms), 9% at the push-off (218ms), 71% at the apex
              // (394ms) and 100% at contact (680ms). The rail closes WITH the
              // jump instead of ahead of it, and the slow start is what buys
              // that: the creature gets the first fifth of a second to itself.
              //
              // 680ms rather than 440ms for the same reason. A slow ramp inside
              // 440ms has to make the time up somewhere, and it did — 145px in
              // the 200ms through the middle, which read as a lurch rather than
              // as a drawer.
              //
              // It matches the opening rail exactly, and both match the jump:
              // 680ms is the hop's own length, so neither direction of the
              // toggle is a different length of event. The two still FEEL
              // different, and that is the easing rather than the clock — this
              // one ramps and commits, so it is visually done around 600ms
              // while the opening one is still arriving at 670.
              //
              // THE FIRST VERSION OF THIS RAMP WAS TOO DEAD. At (0.8, 0, 0.3, 1)
              // the rail was 0% closed at 60ms and 7% at 200ms — a hold, not a
              // ramp, and a control that visibly does nothing for a fifth of a
              // second reads as one that missed the click. This one creeps: 1%
              // at 60ms, 5% at 120ms, 16% at 200ms. Still nothing like the
              // opening curve, which was 37% and 84% at those marks.
              `${RAIL_WIDTH_CLASS.collapsed} duration-[680ms] ease-[cubic-bezier(0.6,0.04,0.3,1)]`,
        )}
      >
        <Link
          href="/"
          aria-label="Storyboard Workbench home"
          // LEADING, at the glyph column's inset, in both states. Centring "SW"
          // in the 72px rail already put it within a pixel of 22px, so pinning
          // it there costs nothing closed and is what lets the name grow to the
          // right rather than the whole mark sliding.
          // 22px, not `text-lg`. The wordmark used 186px of the rail's 239px
          // at 18px, so there was room, and at 18px "storyboard monster" was
          // hard to read against everything else in the rail. Measured after:
          // see the note on the creature's scale for the other half of the fit.
          // CAPRASIMO, the face the logo document is set in, and no
          // `font-bold`: it ships a single 400 weight, so asking for 700 buys a
          // synthesised bold on top of a face that is already heavy.
          className="flex h-[72px] w-full items-center justify-start overflow-hidden whitespace-nowrap pl-[22px] font-[family-name:var(--font-grandstander)] font-bold text-[21px] text-white transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
        >
          {/* THE INITIALS NEVER LEAVE. The rest of each word collapses to
              nothing, so closing slides the S and the W together into "SW"
              rather than swapping one piece of text for another. The letters
              you keep are the same letters throughout — same size, same font,
              same position — which is the whole reason this reads as the mark
              contracting instead of a label being replaced by an abbreviation.

              The accessible name comes from `aria-label` on the link, so the
              split spans are never read out letter by letter.

              HIDDEN FROM ASSISTIVE TECH, for the same reason. Collapsed, the
              mark reads "SW", which is not contained in "Storyboard Workbench
              home" — Lighthouse flags that as `label-content-name-mismatch`
              (WCAG 2.5.3 "Label in Name"): someone driving by voice says what
              they see and matches nothing. The mark is branding, not a label,
              so the label carries the name and the letters carry none.

              `display: contents` so hiding them costs no layout — the letters
              keep participating in the link's own flex box. */}
          <span aria-hidden="true" className="contents">
            <RevealedLetters show={railExpanded}>
              storyboard&nbsp;
            </RevealedLetters>
            {/* The creature takes the monogram's place: it is what survives the
                collapse, exactly as "SW" did. The word rebuilds around it —
                "m" before, "nster" after — so opening the rail grows the name
                out of the mark rather than swapping one thing for another. */}
            {/* `contents`, so "m", the creature and "nster" stay FLEX ITEMS of
                the link rather than becoming one narrow item that wraps inside
                itself — the same reason the wrapper above uses it. Colour still
                inherits through a `display: contents` box. */}
            <span
              className="contents"
              style={{ color: STORYBOARD_MONSTER_ACCENT }}
            >
              <RevealedLetters show={railExpanded}>m</RevealedLetters>
              {/* SMALL IN THE WORD, BIG ALONE. Expanded it is the source's own
                  proportion (0.72em), which is what makes it read as the "o" of
                  "monster" rather than a creature parked beside it. Collapsed
                  there is no word left to belong to, so it grows into the mark
                  the rail needs — and past the 19px floor the design document
                  measured, below which "the fur spikes and the glint start to
                  merge".

                  1.1 -> 0.97 IN THE WORD, and the number comes from the letters
                  rather than from taste. Measured against Grandstander at 21px,
                  the x-height is 13px and at 1.1 the creature's body drew
                  16.3 — 1.254x the letter it is standing in for, which is why
                  it read as parked beside the word rather than set into it.
                  0.97 puts the body at about 1.1x the x-height: still the
                  largest thing in the lockup, because it is a face and it has
                  to hold the eye, but close enough to the "o" to belong to the
                  same alphabet. The antennae above and the feet below stay
                  outside that band on purpose — an ascender and a descender are
                  what a letter is allowed to have. */}
              <StoryboardMonsterMark
                scale={railExpanded ? 0.97 : 1.6}
                gaze={railExpanded ? "ahead" : "breadcrumb"}
              />
              <RevealedLetters show={railExpanded}>nster</RevealedLetters>
            </span>
          </span>
        </Link>

        {activeProjectId && (
          <div className="flex w-full flex-col items-stretch gap-0">
            {/* The graph's layout switch (was the breadcrumb row's strip/grid
              toggle). Grid first: it is the initial-load default. */}
            <SurfaceIconControl
              surface="grid"
              onGraphRoute={onGraphRoute}
              href={graphHref}
              icon={GridLayoutGlyph}
              isActive={onGraphRoute && graphView.surface === "grid"}
              label="Grid layout"
              description="Graph timelines as grids"
            />
            <SurfaceIconControl
              surface="strip"
              onGraphRoute={onGraphRoute}
              href={`${graphHref}?surface=strip`}
              icon={FilmStripGlyph}
              isActive={onGraphRoute && graphView.surface === "strip"}
              label="Strip layout"
              description="Graph timelines as strips"
            />
          </div>
        )}

        {/* SHORTCUTS into this project's top-level collections.
            
            The tool group that used to sit here is gone — preview moved to the
            board's breadcrumb row and flat mode to the controls row under it,
            both being view toggles that belong beside the board they change.
            What took its place answers the rail's own question, "where", one
            level further in than the layout switch above.

            It draws its OWN separator, or nothing at all. A new project has no
            top-level collections, and a rule with nothing under it reads as
            something that failed to load — so the group and its rule arrive
            and leave together, which is only reliable while one component
            owns both. */}
        {activeProjectId && onGraphRoute && (
          <SidebarCollectionShortcuts projectId={activeProjectId} />
        )}

        <div className="relative mt-auto flex w-full flex-col items-stretch gap-0">
          {UTILITY_ITEMS.map((item) => {
            if (item.id === "trash" && pathname === "/") return null;

            const Icon = item.icon;
            const tooltipId = `sidebar-tooltip-utility-${item.id}`;
            const isPressed = isTrashOpen;
            // Through a view transition, so the drawer RISES instead of
            // appearing. Same helper the trim modal uses — including the root
            // flag the e2e waits on.
            const handleClick = () =>
              void withViewTransition(() => setIsTrashOpen(!isTrashOpen));

            // WARM THE BIN ON INTENT, so the drawer opens at its final height
            // rather than growing when the fetch lands.
            //
            // On a board this does nothing — the graph's boot already ensures
            // the document. It is for everywhere else, where the drawer would
            // otherwise open short, spin, and grow.
            //
            // On HOVER and FOCUS rather than on mount: a speculative read for
            // every visitor who never opens the bin is a Firestore read spent
            // on nothing, and this project has already run its daily quota out
            // once. Approaching the control is the cheapest honest signal of
            // intent, and the gateway dedupes, so leaning on the tile costs one
            // request at most.
            const warmTrash = () => {
              if (item.id !== "trash" || !user) return;
              void graphDocumentsGateway.ensure(`trash-${user.uid}`);
            };

            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-describedby={tooltipId}
                aria-pressed={isPressed}
                onClick={handleClick}
                onPointerEnter={warmTrash}
                onFocus={warmTrash}
                className={cn(
                  SIDEBAR_ICON_BASE,
                  // Trash opens a DRAWER over the board; it does not take you
                  // anywhere, and the board behind it is still the page you are
                  // on. That makes it state, not location — the tint, like flat
                  // mode above (see SIDEBAR_ICON_TOGGLE_ON).
                  isPressed ? SIDEBAR_ICON_TOGGLE_ON : SIDEBAR_ICON_IDLE,
                )}
              >
                <Icon
                  // Remount per arrival so the one-shot pop animation replays
                  // even when drops land back-to-back.
                  key={item.id === "trash" ? trashArrival : undefined}
                  className={cn(
                    SIDEBAR_GLYPH,
                    // Continuous wiggle while a card hovers the trash drop zone;
                    // the one-shot arrival pop takes over on the actual drop.
                    item.id === "trash" &&
                      trashDropHover &&
                      "animate-trash-hover-attention",
                    item.id === "trash" &&
                      trashArrival > 0 &&
                      "animate-trash-arrival",
                  )}
                />
                <SidebarTooltipLabel
                  id={tooltipId}
                  label={item.label}
                  description={item.description}
                />
              </button>
            );
          })}

          {/* THE RAIL'S OWN WIDTH CONTROL.

            Under the trash and above the account tile. Bottom of the rail
            because it is the one control here about the RAIL rather than about
            the work — the same place an IDE puts it — and above the account,
            which stays pinned last.

            It wears the plain idle treatment in BOTH states, alone among the
            toggles. `SIDEBAR_ICON_TOGGLE_ON` means "this changes what the
            board shows"; the rail's own width changes nothing about the work,
            and lighting it up would leave a permanent accent in the rail for a
            preference you can already see in the rail's width. The glyph
            flipping direction is the state readout. */}
          <button
            type="button"
            aria-expanded={railExpanded}
            aria-label={railExpanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-describedby="sidebar-tooltip-rail-width"
            data-sidebar-rail-toggle={railExpanded ? "expanded" : "collapsed"}
            onClick={() => writeRailExpanded(!railExpanded)}
            className={cn(SIDEBAR_ICON_BASE, SIDEBAR_ICON_IDLE)}
          >
            {railExpanded ? (
              <PanelLeftClose className={SIDEBAR_GLYPH} />
            ) : (
              <PanelLeftOpen className={SIDEBAR_GLYPH} />
            )}
            <SidebarTooltipLabel
              id="sidebar-tooltip-rail-width"
              label={railExpanded ? "Collapse" : "Expand"}
              description="Show the name beside each icon"
            />
          </button>

          {/* The board-options slot used to sit here, below the trash
            (PL14-005): an address the rail published for the graph to portal
            its settings menu into. That menu is back in the board's own
            controls row, under the divider, so the slot had nothing left to
            receive — an empty publishing div is worse than no seam at all,
            because the next reader has to prove nothing fills it. */}

          <button
            ref={buttonRef}
            type="button"
            aria-label="Account"
            aria-describedby="sidebar-tooltip-utility-account"
            aria-pressed={isProfileOpen}
            onClick={() => setIsProfileOpen((open) => !open)}
            className={cn(
              SIDEBAR_ICON_BASE,
              isProfileOpen ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE,
            )}
          >
            {user?.picture ? (
              <img
                src={user.picture}
                alt={user.name || user.email || "Profile"}
                className={cn(
                  // `relative` for the same reason the glyphs carry it: the tile's pill is
                  // an absolute ::before and would otherwise paint a 40% black veil over
                  // this face. Same bug the collection thumbnails had.
                  "relative h-8 w-8 shrink-0 rounded-full object-cover border border-zinc-700 group-hover/sidebar-item:border-zinc-500 transition-colors",
                  SIDEBAR_AVATAR_INSET,
                )}
              />
            ) : (
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/60 text-xs font-bold text-zinc-400 transition-colors select-none group-hover/sidebar-item:border-zinc-600 group-hover/sidebar-item:bg-zinc-800 group-hover/sidebar-item:text-zinc-100",
                  SIDEBAR_AVATAR_INSET,
                )}
              >
                {initialOf(user)}
              </div>
            )}
            <SidebarTooltipLabel
              id="sidebar-tooltip-utility-account"
              label="Account"
              description={
                user?.email ? `Signed in as ${user.email}` : "Signed in"
              }
            />
          </button>

          {isProfileOpen && (
            <div
              ref={profileMenuRef}
              className="absolute bottom-0 left-full z-50 ml-2 w-64 rounded-xl border border-zinc-800/80 bg-zinc-950/90 p-4 shadow-[0_10px_40px_rgba(0,0,0,0.7)] backdrop-blur-md profile-popover-animate"
            >
              <div className="flex items-center gap-3 border-b border-zinc-800/60 pb-3">
                {user?.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name || user.email || "Profile"}
                    className="h-10 w-10 rounded-full object-cover border border-zinc-800"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/60 text-sm font-bold text-zinc-300">
                    {initialOf(user)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-zinc-100">
                    {user?.name || "User"}
                  </p>
                  <p className="truncate text-[10px] font-medium text-zinc-500">
                    {user?.email}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileOpen(false);
                    void handleLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-zinc-400 hover:bg-red-500/10 hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/30 cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>

        <TrashDrawer
          isOpen={isTrashOpen}
          // Closing animates too — the drawer's own X, Escape, and the scrim
          // all arrive here, so all three get the same exit as the tile.
          onClose={() => void withViewTransition(() => setIsTrashOpen(false))}
        />

        <style>{`
        @keyframes slideInLeft {
          from {
            transform: translateX(-8px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .profile-popover-animate {
          animation: slideInLeft 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
      </aside>
    </SidebarLabelsInlineContext.Provider>
  );
}
