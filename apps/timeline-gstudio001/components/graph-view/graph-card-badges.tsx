"use client";

import { useContext } from "react";
import { Check } from "lucide-react";

import {
  mediaDurationSeconds,
  useCollectionsStore,
  useLiveTrim,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { formatSeconds } from "@/lib/format-duration";

import { GraphViewNavContext } from "./graph-navigation";

/**
 * The marks that ride ON a card's artwork — the chips, the label and the
 * checkbox both card kinds share.
 */

/**
 * The card's "this will not play" badge, top-right.
 *
 * Two causes, two words, because the fix differs: a card disabled OUTRIGHT is
 * re-enabled on itself, while one that is off because an ancestor collection
 * is off cannot be re-enabled here at all — you have to go up and turn the
 * collection back on. Muting them identically but labelling them the same
 * would strand someone clicking a toggle that cannot help them.
 */
export function DisabledChip({ inherited }: { inherited: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-disabled-chip={inherited ? "inherited" : "self"}
      title={
        inherited
          ? "Skipped — a collection above this one is disabled"
          : "Skipped during playback"
      }
      className={[
        "pointer-events-none absolute right-2 bottom-2 z-20 rounded px-1 py-0.5 font-mono text-[8px] leading-none font-semibold tracking-[0.08em]",
        inherited
          ? "bg-zinc-950/95 text-zinc-100 ring-1 ring-zinc-400/70"
          : "bg-zinc-950/95 text-blue-300",
      ].join(" ")}
    >
      {inherited ? "PARENT OFF" : "DISABLED"}
    </span>
  );
}

/** Leaf subscription: only the clip being trimmed re-renders per pointer move. */
export function LiveDurationPill({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  const showing = live ? live.effectiveSeconds : mediaDurationSeconds(node);
  return (
    <span className="pointer-events-none absolute right-1 bottom-1 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-100">
      {node.mediaKind === "video"
        ? `${formatSeconds(showing)} / ${formatSeconds(node.fullDurationSeconds)}`
        : formatSeconds(showing)}
    </span>
  );
}

/**
 * Which collection this card's item lives in, drawn along the card's bottom
 * edge — the flat strip's orientation, and what makes the drop rule ("lands in
 * the left neighbour's collection") readable BEFORE you release.
 *
 * A SPAN, not a button, deliberately. This renders inside NodeCard's selection
 * `<button>`, and nesting interactive semantics is invalid HTML and an
 * ambiguous a11y tree — the package makes that an invariant and a story
 * asserts it. So the reveal rides a double-click, which needs no role, and the
 * O key covers the same action from the keyboard (see OpenKeyBoundary).
 *
 * KNOWN GAP: `aria-hidden`, matching the card's other chips, so the collection
 * name is not announced. Fixing that means composing it into the card's
 * accessible name, which lives in the package's NodeCard — a change worth
 * making deliberately rather than smuggling in here.
 */
export function ProvenanceLabel({
  parentId,
  name,
  shifted = false,
}: Readonly<{
  parentId: NodeId;
  name: string;
  /** A LaneChip has taken the corner — move along rather than sit under it.
   *  Whole literal class names below, since Tailwind never generates an
   *  interpolated offset. */
  shifted?: boolean;
}>) {
  const nav = useContext(GraphViewNavContext);
  return (
    <span
      aria-hidden="true"
      data-provenance={parentId as string}
      title={`In "${name}" — double-click to open it (or press O)`}
      // The single click is SWALLOWED, and that is what keeps the double-click
      // reachable. A plain click on a clip card opens its edit overlay now, so
      // without this click 1 of the double-click puts a modal over the board
      // and click 2 lands on the modal — the gesture this label advertises
      // could never complete. Exactly the trap the collection's NAME span
      // already avoids, for exactly the same reason.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        nav?.openTimeline(parentId);
      }}
      // TOP-LEFT: the bottom band is already three-deep (kind tag left,
      // duration pill right, and the label spanning both would sit under
      // them), and the top-right belongs to the disabled chip. Capped width so
      // a long collection name truncates instead of running into that chip.
      className={[
        "pointer-events-auto absolute top-1 z-10 max-w-[70%] cursor-pointer truncate rounded bg-sky-950/85 px-1 py-0.5 text-[8px] leading-none font-semibold text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-900/90 hover:text-sky-100",
        shifted ? "left-8" : "left-1",
      ].join(" ")}
    >
      {name}
    </span>
  );
}

/**
 * How far a card's corner controls sit in from its edge. ONE value, every card
 * kind.
 *
 * It is 20px because of TRIM HANDLES: a handle's hit zone is 8px (`w-2`, pinned
 * to `left-0`/`right-0` in the package's TrimHandles), and at the old 8px inset
 * the `⋮` landed flush against the handles, reading as one crowded cluster.
 * 20px clears a handle by its own width again.
 *
 * APPLIED EVERYWHERE, INCLUDING COLLECTIONS, which have no handles. That looks
 * like padding a card for a constraint it does not have — and it was, until the
 * two kinds were seen side by side. Collections sat at 8px and clips at 20px, so
 * the controls visibly JUMPED as the eye moved between card kinds in the same
 * grid. A shared inset with one card kind's reason behind it beats two
 * correct-in-isolation values that disagree on screen.
 *
 * THIS TRACKS THE CONTROL SIZE. It was 16px while the controls were 24px; they
 * grew to 28px and the measured gap fell from 8px to 4px, which the e2e
 * clearance test caught. Anything that changes the corner control's size has to
 * move this with it — the two numbers are not independent, and nothing but that
 * test connects them.
 *
 * NOTE, carried through the #281 split rather than acted on: NOTHING IMPORTS
 * THESE. `CardCornerSlot` in graph-anchor-menu carries the literal twin (it
 * cannot import from here without a cycle), so these two are the documentation
 * of a contract the other file actually implements. Left in place because
 * deleting them is a separate decision from moving them.
 *
 * Written as WHOLE literal class names. Tailwind's JIT scans source text, so an
 * interpolated `left-${n}` is a class that never gets generated — the control
 * would silently fall back to `left: auto` and sit in the wrong place.
 */
export const CARD_CONTROL_INSET_RIGHT = "right-5";
/** Top inset, `top-3` (12px) rather than the `top-2` these started at: at
 *  8px the controls sat tight under the card's edge once they grew to 28px. */
export const CARD_CONTROL_INSET_TOP = "top-3";

// Hover-reveal, per card kind. Whole literal class names: Tailwind's JIT scans
// source text, so a computed `group-hover/${kind}` is a class that never gets
// generated and the checkbox would silently never appear.
//
// `pointer-events-none` travels WITH the opacity and is not decoration: the
// checkbox is a click target now, and an invisible one would be a trap. On
// touch the `@media (hover: hover)` gate never opens, so without this a tap in
// the card's bottom-right corner would toggle a selection through a control the
// user cannot see. Hidden means unclickable, in the same rule, so the two can
// never drift apart.
export const SELECT_HOVER_REVEAL_MEDIA = [
  "pointer-events-none opacity-0 motion-safe:transition-opacity motion-safe:duration-150",
  "[@media(hover:hover)]:group-hover/media-item:pointer-events-auto",
  "[@media(hover:hover)]:group-hover/media-item:opacity-100",
].join(" ");

/** The same, for a COLLECTION card's group. */
export const SELECT_HOVER_REVEAL_COLLECTION = [
  "pointer-events-none opacity-0 motion-safe:transition-opacity motion-safe:duration-150",
  "[@media(hover:hover)]:group-hover/collection-item:pointer-events-auto",
  "[@media(hover:hover)]:group-hover/collection-item:opacity-100",
].join(" ");

/**
 * The selection checkbox, bottom-right, while select mode is armed.
 *
 * DECORATIVE as far as the a11y tree is concerned, and that is forced, not a
 * shortcut. This renders inside NodeCard's real `<button>`, and a button may
 * not contain interactive content: browsers auto-close the outer one at the
 * first nested button, which ejects the rest of the card out of its own box.
 *
 * Nothing is lost in select mode, because the whole card is already the toggle
 * there. OUTSIDE the mode it appears on HOVER, and CLICKING IT TOGGLES *and
 * ARMS the mode*. That matters most on a collection: the rest of that card
 * drills in, so this circle is the only pointer route to picking one at all.
 *
 * DESKTOP ONLY, via `@media (hover: hover)`. A touch device has no hover state
 * to reveal it with, and without the query a tap would leave the checkbox
 * stuck on the last-tapped card — the sticky-hover bug — where it would read as
 * a selection that is not there.
 *
 * Two details worth keeping if this is ever restyled. The check is ALWAYS
 * rendered and only its opacity changes, so the circle never resizes as it
 * fills. And the ring is `border-2` on a translucent, blurred fill rather than
 * a flat chip, because it sits on arbitrary artwork — a light frame and a dark
 * one both have to keep it legible.
 */
export function SelectionIndicator({
  id,
  selected,
  armed,
  revealOnHover,
}: Readonly<{
  selected: boolean;
  /** Select mode is on, so the checkbox is permanent rather than hover-only. */
  armed: boolean;
  /** Literal hover-reveal classes for THIS card kind's group. */
  revealOnHover: string;
  /** The card this toggles. */
  id: NodeId;
}>) {
  const store = useCollectionsStore();
  return (
    <span
      aria-hidden="true"
      data-selection-indicator={selected ? "on" : "off"}
      // Distinguishes "permanently shown because the mode is armed" from
      // "revealed by the pointer", which a geometry-only assertion cannot see.
      data-selection-indicator-reveal={armed ? "armed" : "hover"}
      // A SPAN with its own click, not a <button>. This renders inside the
      // card's selection surface, which IS a button, and nesting interactive
      // semantics is invalid HTML — the composed-card tests pin that. The
      // precedent is the collection's NAME span, which swallows its own click
      // the same way so the card body's drill-in does not fire under it.
      // `stopPropagation` is what makes that work; React's synthetic bubbling
      // never reaches the surface's handler.
      //
      // The cost is that this is not keyboard-reachable, which is why it stays
      // `aria-hidden`. Keyboard users are not stranded: select mode plus Space
      // on the focused card is the same toggle, and it is the path a screen
      // reader is already told about through the card's own name and state.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        store.toggleSelected(id);
        // PICKING IS ENTERING THE MODE. The header row is driven by
        // `multiSelectMode` alone (see GraphBoard's `selectModeRow`), so
        // toggling the selection without arming left the checkbox filling in
        // while the breadcrumb trail sat there unchanged — a selection with no
        // way to act on it and no visible way out. Since a plain click OPENS
        // and never selects, this checkbox IS the pointer gesture that means
        // "I am selecting now", and that is the same statement the Select
        // button makes.
        //
        // Only on the way IN. Un-checking the last item leaves the mode armed
        // at "0 selected · Done", which is exactly where pressing Select and
        // picking nothing lands you — whereas disarming on empty would yank
        // the row away mid-correction, the moment a mis-pick is undone.
        if (!selected) store.setMultiSelectMode(true);
      }}
      className={[
        "absolute right-2 bottom-2 z-20 grid size-[26px] cursor-pointer place-items-center",
        "rounded-full border-2 backdrop-blur-sm motion-safe:transition-colors",
        selected ? "border-blue-500 bg-blue-500" : "border-white/90 bg-black/35",
        armed ? "" : revealOnHover,
      ].join(" ")}
    >
      <Check
        className={["size-4 text-white", selected ? "opacity-100" : "opacity-0"].join(" ")}
        strokeWidth={3}
      />
    </span>
  );
}

/**
 * Which LANE a card is on, when it is not the picture.
 *
 * Absent on lane 0, which is almost every card — a badge that appeared on
 * everything would say nothing. It shows up exactly when a clip has been put
 * somewhere surprising, and "surprising" is the whole message: this does not
 * play after the clip beside it, it plays UNDER the shots.
 *
 * Sky, matching the provenance label rather than the amber disabled chip: a
 * lane is a placement, not a warning.
 *
 * TOP-LEFT, and it shares that corner with the provenance label — which they
 * CAN both want at once. A flat run draws cards from nested collections
 * inline, and one of those can perfectly well be on lane 1, so "they never
 * appear together" is not true. The lane takes the corner and provenance
 * shifts along, because a lane changes what you HEAR while provenance only
 * says where a card is filed.
 */
export function LaneChip({ lane }: Readonly<{ lane: number }>) {
  return (
    <span
      aria-hidden="true"
      data-lane-chip={lane}
      title={`Lane ${lane} — plays under the picture, not after it`}
      className="pointer-events-none absolute left-1 top-1 z-20 rounded bg-sky-950/85 px-1 py-0.5 font-mono text-[8px] leading-none font-semibold tracking-[0.08em] text-sky-200 ring-1 ring-sky-400/30"
    >
      L{lane}
    </span>
  );
}
