"use client";

import { useState } from "react";
import { EllipsisVertical } from "lucide-react";

import {
  focusNodeWhenMounted,
  useCollectionsSelector,
  useCollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSelectionActionState } from "./graph-selection-actions";
import {
  DROPDOWN_MENU_PARTS,
  SELECTION_MENU_CONTENT_CLASS,
  SelectionMenuItems,
} from "./graph-selection-menu";

// The anchor's `⋮`, in the card's existing top-right corner slot.
//
// This replaces a toolbar that lived inside the card's top band and had to
// decide, per card, how many of its buttons fit — a fold ladder driven by the
// card's measured width, because a strip clip is as wide as its clip is long.
// One control has no ladder. It is the size of the chevron it replaces, so on
// a collection card it costs no space at all, and everything it offers is in
// the menu it opens.
//
// It does not position itself. It is a child of the card, so it moves when the
// card moves: no portal, no rAF loop, no scroll listeners.

/**
 * Above this the badge reads `999+`.
 *
 * Three digits because collections here run to a few hundred items at most, so
 * the true count shows in essentially every real session — and the badge is no
 * longer competing with a row of buttons for the card's width. It stays a cap
 * rather than an uncapped number because the exact count is always in the
 * header, in every counted menu label, and in every confirmation (R6.8).
 */
const BADGE_CAP = 999;

/**
 * The narrowest card that can host the control.
 *
 * A strip clip's width is its DURATION (floor 12px), so a short clip is
 * narrower than the control itself and there is nothing sensible to render —
 * the `⋮` would cover the card, or overhang into its neighbour. R5.5 already
 * allows zero `⋮` on screen, and the header's `⋮` is the documented fallback
 * (R8.4), so below this the card simply renders nothing and the header carries
 * the actions. That is the whole of the narrow-card story now; v2 needed a
 * four-tier fold ladder to say it.
 */
const MIN_ANCHOR_CONTROL_WIDTH = 44;

/**
 * The count badge.
 *
 * Absent at exactly one (R6.5) — the `⋮` alone already marks the anchor, and
 * there is no scope ambiguity at one item. At 2+ it does double duty: which
 * card is the anchor, and how much the menu is about to act on.
 */
function AnchorCountBadge({ count }: Readonly<{ count: number }>) {
  if (count < 2) return null;
  return (
    <span
      aria-hidden="true"
      data-anchor-count-badge
      className={cn(
        // Overhangs the button's top-right corner (R6.10) — the card and this
        // control's own wrapper must not clip it, which is why neither carries
        // `overflow-hidden`.
        "pointer-events-none absolute -right-1.5 -top-1.5 z-10",
        "flex h-[15px] min-w-[15px] items-center justify-center px-1",
        // `rounded-full` + `min-width: height` is a circle at one digit and a
        // stadium at two or more, from ONE rule (R6.6). No digit special-casing.
        "rounded-full text-[10px] font-semibold leading-none",
        // SELECTION BLUE with white text — the same step as the ring around a
        // selected card and the checkbox fill. This badge counts exactly those
        // cards, so it should wear their colour; amber-on-near-black was left
        // over from when amber was the selection colour and had become the only
        // thing on the board still saying so.
        //
        // The opaque fill and dark ring stay, and the reason is unchanged
        // (R6.11): the badge sits over card artwork that includes near-white
        // content, verified against the lightest thumbnails in the library
        // rather than a mid-tone, so it cannot rely on the artwork behind it.
        "bg-blue-500 text-white ring-1 ring-zinc-950/60",
        // Proportional digits jitter the width as a shift-drag sweeps through
        // counts (R6.7).
        "tabular-nums",
        // NO transition and NO animation (R6.9): during a shift-click drag the
        // count updates continuously, and any pop or bounce becomes a flicker.
      )}
    >
      {count > BADGE_CAP ? `${BADGE_CAP}+` : count}
    </span>
  );
}

/**
 * The `⋮` button and the menu it opens.
 *
 * Rendered only on the anchor, which is what guarantees exactly one exists on
 * screen (R5.4). Non-anchor selected cards never show it, including on hover.
 */
export function AnchorMenuButton({
  nodeId,
  className,
}: Readonly<{ nodeId: NodeId; className?: string }>) {
  const store = useCollectionsStore();
  const state = useSelectionActionState();
  const [open, setOpen] = useState(false);

  // E7: the selection changing under an open menu would rewrite every label
  // and every dimmed reason beneath the user's cursor — including which rows
  // are available. Close instead, rather than mutating it in place.
  const selectionCount = state.selectionCount;
  const [countWhenOpened, setCountWhenOpened] = useState(selectionCount);
  if (open && selectionCount !== countWhenOpened) {
    setOpen(false);
    setCountWhenOpened(selectionCount);
  }

  return (
    <DropdownMenu
      // NON-MODAL, and that is load-bearing rather than cosmetic.
      //
      // Radix's modal default sets `pointer-events: none` on the BODY while the
      // menu is open. The next click then retargets to `<html>` — measured, not
      // assumed — and three things follow from that one fact:
      //
      //   1. this button never receives the click, so a second press on the
      //      `⋮` cannot toggle its own menu shut;
      //   2. Radix reads that click as an interaction OUTSIDE the layer, which
      //      races the trigger's own toggle over whether to close or reopen;
      //   3. once the layer unmounts, a click whose target is `<html>` no
      //      longer trips the package's "a menu is open" guard
      //      (`isActionTarget`), so background-clear is free to drop the
      //      selection — the menu closes and takes the selection with it.
      //
      // Non-modal keeps the body interactive, so the click lands on this
      // button, the toggle closes cleanly, and `stopPropagation` below keeps
      // background-clear from ever seeing it. The selection survives.
      //
      // The trade is the focus TRAP (R12.9). Radix still gives roving arrow
      // keys, Escape-to-close and focus return to the trigger; what goes is
      // confinement, which is a dialog's requirement rather than a menu's.
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCountWhenOpened(selectionCount);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Pointer-only in the roving order, like the chevron it replaces:
          // keyboard users reach these actions through the shortcuts and the
          // header, and a second tab stop per card would double the cost of
          // crossing a strip.
          tabIndex={-1}
          data-anchor-menu={nodeId as string}
          // Both facts in one name (R6.12/R12.1). The badge is `aria-hidden`,
          // so this is the only place the count is spoken here.
          //
          // NOT `itemCountPhrase`, which drops the number at one ("item", for
          // labels like "Copy" that only ever count past one). Here the count
          // is the point of the name, so it is always spoken: a screen reader
          // announcing "Actions, item selected" says nothing about scope.
          aria-label={`Actions, ${state.selectionCount} ${
            state.selectionCount === 1 ? "item" : "items"
          } selected`}
          aria-haspopup="menu"
          // Keeps the press off the card's own selection surface and off the
          // strip's pan gesture, exactly as the chevron does.
          data-collections-keyboard-ignore
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          // Escape has to be handled HERE. `data-collections-keyboard-ignore`
          // is what keeps a press on this control off the card's selection
          // surface and off the strip's pan gesture — and it excludes this
          // button from the package's card keyboard handler too, so with focus
          // sitting on the `⋮` (exactly where Radix returns it after the menu
          // closes) nothing else is listening.
          //
          // Radix takes the first Escape to close the menu (R10.6), so by the
          // time one reaches this handler the menu is already shut and the
          // press means "clear the selection" (R4.7) — which also takes this
          // control off screen, so focus goes back to the card rather than
          // being orphaned on an unmounting button.
          onKeyDown={(event) => {
            if (event.key !== "Escape" || open) return;
            event.preventDefault();
            event.stopPropagation();
            store.clearSelection();
            focusNodeWhenMounted(document.body, nodeId);
          }}
          className={cn(
            "relative z-20 flex size-7 shrink-0 items-center justify-center rounded",
            "bg-zinc-950/80 text-zinc-100 shadow-sm shadow-black/40 backdrop-blur-[1px]",
            "cursor-pointer transition-colors hover:bg-zinc-800 hover:text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
            // 44px effective target on a coarse pointer (R6.3), from padding —
            // the visual control stays 28px so it matches the drill control it
            // replaces. Those two CROSS-FADE on the anchor card, so any size
            // difference between them shows up as a jump at the swap: they have
            // to be resized together, and this file hard-codes the look rather
            // than importing CARD_CONTROL_CLASS, so changing that alone is not
            // enough.
            "after:absolute after:left-1/2 after:top-1/2 after:-translate-x-1/2 after:-translate-y-1/2",
            "after:content-[''] [@media(pointer:coarse)]:after:h-11 [@media(pointer:coarse)]:after:w-11",
            className,
          )}
        >
          <EllipsisVertical aria-hidden="true" className="size-5" />
          <AnchorCountBadge count={state.selectionCount} />
        </button>
      </DropdownMenuTrigger>
      {/* Standard edge-flipping (R7.10): Radix opens downward and flips up
          against the viewport bottom, shifting horizontally to stay in bounds.
          Nothing custom — this is the one kind of repositioning v3 keeps. */}
      <DropdownMenuContent
        side="bottom"
        align="end"
        data-graph-anchor-menu={nodeId as string}
        className={SELECTION_MENU_CONTENT_CLASS}
      >
        <SelectionMenuItems parts={DROPDOWN_MENU_PARTS} state={state} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The card's top-right corner slot, holding the `⋮` when this card is the
 * anchor — and nothing at all otherwise.
 *
 * It used to be a two-tenant slot: a collection card carried a drill chevron
 * here, and the `⋮` CROSS-FADED with it (R6.2) so the swap cost no layout. The
 * chevron is gone — a plain click opens a collection now, so a 28px corner
 * button was a second way to do the easy thing, parked over the artwork — and
 * with one tenant left the morph has nothing to morph. What survives from it is
 * the 120ms fade-in, which is what keeps the `⋮` from snapping into peripheral
 * vision on every selection change.
 *
 * Both card kinds are now the same here. That was already true of clips, which
 * never had a chevron (R5.6).
 */
export function CardCornerSlot({
  nodeId,
  className,
}: Readonly<{
  nodeId: NodeId;
  /** Set when the host measured itself too narrow to carry the control. */
  className?: string;
}>) {
  const isAnchor = useCollectionsSelector((s) => s.interaction.anchorId === nodeId);
  // E6: a card mid-drag shows no `⋮`, and the menu cannot be open behind one.
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  const showMenu = isAnchor && !isDragging;

  return (
    <span
      // NOT `overflow-hidden` — the count badge overhangs this box (R6.10).
      //
      // `right-5` (20px) is the shared card-control inset — see
      // CARD_CONTROL_INSET_RIGHT in graph-item-content, which puts the check
      // badge at the matching distance on the opposite corner. It exists for
      // trim handles, which only CLIPS have, but every card kind uses it: at
      // 8px on collections and 20px on clips the controls visibly jumped
      // between card kinds in the same grid.
      className={cn("absolute right-5 top-3 z-20 flex items-center gap-1.5", className)}
    >
      <span className="relative grid size-6 place-items-center">
        {showMenu ? (
          <span className="col-start-1 row-start-1 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-[120ms]">
            <AnchorMenuButton nodeId={nodeId} />
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The clip card's corner slot: the same control, but gated on the card being
 * wide enough to carry it.
 *
 * Collections live in the grid at 132–360px and never fail this, so they use
 * `CardCornerSlot` directly and pay for no measurement.
 */
export function ClipCornerSlot({
  nodeId,
  width,
}: Readonly<{ nodeId: NodeId; width: number }>) {
  // 0 is "not measured yet", not "too narrow" — rendering nothing until the
  // first ResizeObserver callback would flash the control in on every mount.
  if (width > 0 && width < MIN_ANCHOR_CONTROL_WIDTH) return null;
  // NO inset override any more. This used to widen the clip's inset past the
  // collection card's, because only a clip carries the 8px trim-handle hit zone
  // the control has to clear. That was correct per card kind and wrong on
  // screen: the two sat side by side in one grid and the controls jumped
  // between them. `CardCornerSlot` now carries the wider inset for everything,
  // so this differs from a collection's slot only in the width guard above.
  return <CardCornerSlot nodeId={nodeId} />;
}
