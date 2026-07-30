"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EllipsisVertical } from "lucide-react";

import {
  findNodeElement,
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
import { visibleItemActions } from "@/lib/graph-item-action-specs";
import { requestGraphItemAction } from "@/lib/graph-view-events";
import {
  resolveToolbarPlacement,
  type ToolbarRect,
} from "@/lib/selection-toolbar-position";
import {
  SelectionOverflowItems,
  useSelectionActionState,
} from "./graph-selection-actions";

// The contextual selection toolbar: item actions, anchored to the card the user
// last clicked, instead of 1600px away in the icon rail.
//
// The rail kept these actions until now, and paid three prices for it. Travel,
// obviously. But also a FUNCTIONAL one — the rail's view toggles were replaced
// while a selection existed, so you could not select clips and then switch to
// the strip to look at them — and a layout jump on every selection change, in
// peripheral vision, for a control cluster nobody was looking at yet.
//
// Anchored to the LAST-CLICKED card, deliberately not to the selection's
// bounding box. A grid selection is a SET, not a region: select the top-left
// and bottom-right cards and the box spans the viewport, putting the toolbar
// over cards that are not in it. Last-clicked keeps travel near zero however
// scattered the selection is, and the toolbar always sits on a card the user
// just touched.
//
// PASTE IS NOT HERE. Every verb in this row acts ON the selection; paste needs
// a destination, and a selection is not a destination. It lives in the header
// with the other container-scoped controls, where it unambiguously means "into
// the collection you are looking at".

/** Matches the rail's width, which the toolbar must never slide under. */
const RAIL_WIDTH = 72;

const TOOLBAR_ATTRIBUTE = "data-graph-selection-toolbar";

function rectOf(el: Element | null): ToolbarRect | null {
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function ActionButton({
  label,
  reason,
  disabled,
  onActivate,
  children,
}: Readonly<{
  label: string;
  reason: string | null;
  disabled: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}>) {
  const [showReason, setShowReason] = useState(false);
  const reasonId = `selection-action-reason-${label.replace(/\W+/g, "-")}`;

  return (
    <span className="relative">
      <button
        type="button"
        // `aria-disabled`, never the `disabled` attribute (R5.3/R12.5). A
        // disabled button is unfocusable and silent — it cannot be tabbed to,
        // it shows no tooltip on touch, and it answers nothing when pressed.
        // This one stays reachable and says why instead.
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-describedby={reason === null ? undefined : reasonId}
        data-action-disabled={disabled ? "true" : undefined}
        onClick={() => {
          if (disabled) {
            setShowReason(true);
            return;
          }
          onActivate();
        }}
        onPointerEnter={() => setShowReason(true)}
        onPointerLeave={() => setShowReason(false)}
        onFocus={() => setShowReason(true)}
        onBlur={() => setShowReason(false)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70",
          disabled
            ? "cursor-not-allowed text-zinc-600"
            : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
        )}
      >
        {children}
      </button>
      {/* Rendered whenever a reason EXISTS, so it is in the accessibility tree
          for `aria-describedby` to point at even while visually hidden. A
          tooltip that only exists on hover is unreachable by touch and by
          screen reader alike (R12.9). */}
      {reason === null ? null : (
        <span
          id={reasonId}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap",
            "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 shadow-lg",
            "transition-opacity motion-reduce:transition-none",
            showReason ? "opacity-100" : "opacity-0",
          )}
        >
          {reason}
        </span>
      )}
    </span>
  );
}

/**
 * The toolbar proper, mounted only while there is something to anchor to.
 *
 * Split from the component below so its `visible` state has the right
 * lifetime: it starts false, the tracking loop turns it true once it has
 * measured, and a gesture that takes the toolbar away (a drag, an empty
 * selection) unmounts this instead of leaving stale state to flash at the
 * wrong coordinates on the way back.
 */
function SelectionToolbarFrame({ anchorId }: Readonly<{ anchorId: NodeId }>) {
  const store = useCollectionsStore();
  const state = useSelectionActionState();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    const el = frameRef.current;
    // Animate the MOVE between cards (R13.2), but only when the toolbar is
    // already on screen somewhere — a first appearance would otherwise slide in
    // from wherever the previous anchor was. Applied to the element rather than
    // held in state, because a re-render mid-flight would restart it.
    //
    // It is removed again after one transition. During the tracking loop a
    // position transition would make the toolbar lag its card by the
    // transition's own duration, which is precisely the visible drift R6.5
    // forbids while scrolling.
    let settle = 0;
    if (el !== null && el.dataset.placed === "true") {
      el.style.transitionProperty = "left, top, opacity";
      settle = window.setTimeout(() => {
        el.style.transitionProperty = "opacity";
      }, 160);
    }

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const node = frameRef.current;
      if (node === null) return;
      // Re-queried EVERY frame rather than cached. A strip unmounts its
      // off-screen cards, and the grid re-creates a card's element when a move
      // re-parents it across rows — an element reference held from mount goes
      // stale without warning, while an id does not.
      const anchorEl = findNodeElement(document, anchorId);
      const placement = resolveToolbarPlacement({
        anchorRect: rectOf(anchorEl),
        toolbarSize: { width: node.offsetWidth, height: node.offsetHeight },
        headerRect: rectOf(document.querySelector("[data-graph-board-header]")),
        railWidth: RAIL_WIDTH,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      if (!placement.visible) {
        // Setting the same value every frame is free — React bails out of an
        // identical update — so the flips can be checked here rather than
        // tracked separately.
        setVisible(false);
        return;
      }
      // Written straight to style, never through state, and BEFORE the flip to
      // visible so the first painted frame is already in the right place.
      // Re-rendering to move an overlay would re-render the board sixty times a
      // second; this is the technique the trim edge frame already uses.
      node.style.left = `${placement.left}px`;
      node.style.top = `${placement.top}px`;
      node.dataset.placed = "true";
      setVisible(true);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (settle) window.clearTimeout(settle);
    };
  }, [anchorId]);

  const returnFocusToAnchor = useCallback(() => {
    focusNodeWhenMounted(document.body, anchorId);
  }, [anchorId]);

  // Roving tabindex (R12.2): the toolbar is ONE tab stop, and arrows move
  // between its controls once focus is inside — the pattern the ARIA toolbar
  // role implies, and the reason a row of six buttons does not cost six tabs.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        store.clearSelection();
        returnFocusToAnchor();
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const el = frameRef.current;
      if (el === null) return;
      const controls = [...el.querySelectorAll<HTMLElement>("button")];
      const at = controls.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      // Wraps, so the ends are not dead: a toolbar is a ring, not a list.
      const next = (at + step + controls.length) % controls.length;
      controls[next]?.focus();
    },
    [store, returnFocusToAnchor],
  );

  // F10 puts focus in the toolbar without a mouse (R12.3). The convention menus
  // and toolbars already use, and free of the modifier collisions the Alt layer
  // and the trim chords have claimed across this app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F10" || event.shiftKey || event.ctrlKey || event.metaKey) return;
      const first = frameRef.current?.querySelector<HTMLElement>("button");
      if (!first) return;
      event.preventDefault();
      first.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const primary = visibleItemActions(state, "primary");

  return createPortal(
    <div
      ref={frameRef}
      {...{ [TOOLBAR_ATTRIBUTE]: "" }}
      role="toolbar"
      aria-label="Selection actions"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      // z-[35] sits above the grid's overlay layer (z-30) and below the board
      // header (z-40) and the icon rail (z-50), both of which are opaque and
      // pinned. The clamps in `resolveToolbarPlacement` are what actually keep
      // it clear of those two; this is the backstop if a clamp is ever wrong.
      className={cn(
        "fixed z-[35] flex items-center gap-1 rounded-xl border border-zinc-700/80 bg-zinc-900/95 px-1.5 py-1 shadow-xl backdrop-blur-sm",
        // Fade + a 4px rise on appear (R13.1). `prefers-reduced-motion` drops
        // both the transition and the offset, so the toolbar simply is where it
        // is — which is also why the translate lives on the hidden state rather
        // than as a keyframe.
        "transition-opacity duration-[120ms] ease-out motion-reduce:transition-none",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none invisible translate-y-1 opacity-0 motion-reduce:translate-y-0",
      )}
      // No left/top here on purpose. They are written imperatively by the
      // tracking loop, and a JSX style prop would reset them to their initial
      // values on every re-render — the count label alone changes often enough
      // to make that a visible twitch. Until the first measurement lands the
      // toolbar is `invisible`, so it never paints at the wrong coordinates.
      style={{ transitionProperty: "opacity" }}
    >
      {/* The count leads the row so the actions read as selection-scoped rather
          than card-scoped (R5.4) — "Delete" beside a "3" is unambiguous in a
          way that "Delete" alone is not. */}
      {state.selectionCount > 1 ? (
        <span
          data-selection-toolbar-count
          className="px-1.5 font-mono text-[11px] tabular-nums text-amber-300/90"
        >
          {state.selectionCount}
        </span>
      ) : null}
      {primary.map((spec, index) => {
        const Icon = spec.icon(state);
        return (
          <span key={spec.action} className="flex items-center">
            {/* Delete is fenced off from the non-destructive actions (R5.2) so
                it is harder to hit on the way to something else. */}
            {spec.action === "delete" && index > 0 ? (
              <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-zinc-700" />
            ) : null}
            <ActionButton
              label={spec.label(state)}
              reason={spec.unavailableReason(state)}
              disabled={spec.disabled(state)}
              onActivate={() => requestGraphItemAction(spec.action)}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
            </ActionButton>
          </span>
        );
      })}
      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-zinc-700" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors",
              "hover:bg-zinc-800 hover:text-zinc-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70",
            )}
          >
            <EllipsisVertical aria-hidden="true" className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <SelectionOverflowItems state={state} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>,
    document.body,
  );
}

export function GraphSelectionToolbar({
  anchorId,
}: Readonly<{ anchorId: NodeId | null }>) {
  // Hidden for the whole of a drag (E6). A card being dragged is not a card
  // being acted on, and a toolbar anchored to it would chase it across the
  // board — competing with the drop indicator for the same attention.
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  if (anchorId === null || isDragging) return null;
  return <SelectionToolbarFrame anchorId={anchorId} />;
}
