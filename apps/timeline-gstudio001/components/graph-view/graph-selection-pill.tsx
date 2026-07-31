"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, EllipsisVertical } from "lucide-react";

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
import { ITEM_ACTION_SPECS, type ItemActionState } from "@/lib/graph-item-action-specs";
import { requestGraphItemAction } from "@/lib/graph-view-events";
import { resolvePillLayout } from "@/lib/selection-pill-layout";
import { SelectionOverflowItems, useSelectionActionState } from "./graph-selection-actions";
import { useElementSize } from "./graph-item-content";

// The selection toolbar, rendered INSIDE the anchor card.
//
// It replaces a floating toolbar that portalled to the body and re-positioned
// itself every frame: a rAF loop measuring four rects, flip-and-clamp math
// against the header and the rail, and a visibility fallback for when the card
// it pointed at scrolled away. All of that existed to answer one question —
// where is the card? — which a child of the card does not have to ask. It moves
// because it IS in the thing that moved.
//
// The cost is width. A card is as wide as it is, and this app's are not one
// size: grid cells run 132px to 360px, and a strip clip's width is its
// duration. `resolvePillLayout` decides what fits; below a floor the pill does
// not render at all and the header's overflow is the way in.
//
// PASTE IS NOT HERE. Every verb in this row acts ON the selection; paste needs
// a destination, and a selection is not a destination. It lives in the header.

/** Control size. 28px visually, with the hit area padded out to 44px on a
 *  coarse pointer (R12.2) — the pill itself is only 32px tall, so the target
 *  has to come from padding rather than from the button's own box. */
const PILL_CONTROL =
  "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors " +
  "after:absolute after:left-1/2 after:top-1/2 after:-translate-x-1/2 after:-translate-y-1/2 " +
  "after:content-[''] [@media(pointer:coarse)]:after:h-11 [@media(pointer:coarse)]:after:w-11";

/** Above this the badge reads `99+`. The exact number is always in the header,
 *  so the badge is a glance indicator — and two digits is the widest slot the
 *  narrow cards can spare. */
const BADGE_CAP = 99;

function PillButton({
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
  const reasonId = `pill-reason-${label.replace(/\W+/g, "-")}`;

  return (
    <span className="relative">
      <button
        type="button"
        // `aria-disabled`, never the `disabled` attribute (R7.13). A disabled
        // button is unfocusable and silent — it cannot be tabbed to, shows no
        // tooltip on touch, and answers nothing when pressed. This one stays
        // reachable and says why instead.
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-describedby={reason === null ? undefined : reasonId}
        data-pill-action={label}
        // Keeps a press off the card's own selection surface and off the
        // strip's pan gesture, exactly as the drill chevron does.
        data-collections-keyboard-ignore
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
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
          PILL_CONTROL,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70",
          disabled
            ? "cursor-not-allowed text-zinc-500"
            : "text-zinc-200 hover:bg-zinc-100/15 hover:text-white",
        )}
      >
        {children}
      </button>
      {/* Rendered whenever a reason EXISTS so `aria-describedby` has something
          to point at even while it is visually hidden. A tooltip that only
          exists on hover is unreachable by touch and by screen reader alike
          (R7.14). */}
      {reason === null ? null : (
        <span
          id={reasonId}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap",
            "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 shadow-lg",
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
 * The leading scope readout: a check, and a count once the selection is plural.
 *
 * NOT interactive (R7.9) — muted, no hover, no cursor, and fenced from the
 * actions by a separator. A checkmark is a poor icon for "clear selection", so
 * if this ever earns a job it should become an ✕ rather than quietly gaining a
 * click handler.
 *
 * ONE accessible name for the group (R7.10). Exposed as its parts it would read
 * "check, 3", which is not what it says.
 */
function CountGroup({ count }: Readonly<{ count: number }>) {
  return (
    <span
      data-pill-count
      role="img"
      aria-label={count === 1 ? "1 item selected" : `${count} items selected`}
      // A FIXED width, sized for the widest badge that can render (R7.6).
      // Without it the pill resizes and re-centres as the selection grows,
      // shifting every icon under the pointer mid-gesture.
      className="relative flex h-7 w-[34px] shrink-0 items-center justify-center text-zinc-400"
    >
      <Check aria-hidden="true" className="size-[17px]" strokeWidth={2.5} />
      {count > 1 ? (
        <span
          aria-hidden="true"
          data-pill-count-badge
          // `rounded-full` + `min-width: height` gives a circle at one digit
          // and a stadium at two or more from a single rule (R7.3) — no
          // special-casing by digit count. `tabular-nums` because proportional
          // digits jitter the width as a shift-drag sweeps through counts.
          className={cn(
            "absolute -right-0.5 top-0 flex h-[15px] min-w-[15px] items-center justify-center",
            "rounded-full bg-amber-300 px-1 text-[10px] font-semibold leading-none text-zinc-950",
            "tabular-nums",
          )}
        >
          {count > BADGE_CAP ? `${BADGE_CAP}+` : count}
        </span>
      ) : null}
    </span>
  );
}

function PillSeparator() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-zinc-100/20" />;
}

/**
 * The pill for one card. Renders nothing unless this card is the anchor, which
 * is what guarantees exactly one exists on screen (R5.6).
 */
export function GraphSelectionPill({ nodeId }: Readonly<{ nodeId: NodeId }>) {
  const store = useCollectionsStore();
  // Narrowed to a boolean about THIS node, so an uninvolved card never
  // re-renders when the anchor moves between two others.
  const isAnchor = useCollectionsSelector((s) => s.interaction.anchorId === nodeId);
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);

  if (!isAnchor || isDragging) return null;
  return <PillBody nodeId={nodeId} store={store} />;
}

function PillBody({
  nodeId,
  store,
}: Readonly<{
  nodeId: NodeId;
  store: ReturnType<typeof useCollectionsStore>;
}>) {
  const state: ItemActionState = useSelectionActionState();
  const frameRef = useRef<HTMLDivElement | null>(null);
  // Measures its OWN positioning context rather than taking a width prop: the
  // two card kinds expose different elements (the collection surface takes no
  // ref at all), and the pill already knows the box it is absolutely
  // positioned against. The probe is `absolute inset-0`, so it is exactly the
  // card's box and contributes no layout of its own.
  //
  // It is also rendered UNCONDITIONALLY, which matters: gating it on
  // `layout.visible` would deadlock — no probe, no width, so never visible.
  const [probeRef, hostSize] = useElementSize();
  const layout = resolvePillLayout(hostSize.width);

  const returnFocusToCard = useCallback(() => {
    focusNodeWhenMounted(document.body, nodeId);
  }, [nodeId]);

  // Roving tabindex (R13.2): the pill is ONE tab stop and arrows move between
  // its controls once focus is inside — the pattern `role="toolbar"` implies,
  // and the reason a row of six buttons does not cost six tabs.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        store.clearSelection();
        returnFocusToCard();
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const el = frameRef.current;
      if (el === null) return;
      const controls = [...el.querySelectorAll<HTMLElement>("button")];
      const at = controls.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowRight" ? 1 : -1;
      // Wraps: a toolbar is a ring, not a list with dead ends.
      controls[(at + step + controls.length) % controls.length]?.focus();
    },
    [store, returnFocusToCard],
  );

  // F10 puts focus in the pill without a mouse (R13.3) — the toolbar
  // convention, and free of the modifier collisions the Alt layer and the trim
  // chords have already claimed in this view.
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

  const probe = (
    <span ref={probeRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
  );
  if (!layout.visible) return probe;

  const inline = ITEM_ACTION_SPECS.filter(
    (spec) => spec.group === "primary" && layout.inline.includes(spec.action),
  );

  return (
    <>
      {probe}
    <div
      ref={frameRef}
      data-graph-selection-pill={nodeId as string}
      role="toolbar"
      aria-label="Selection actions"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        // Absolutely positioned in the card's TOP BAND, centred, 8px inset —
        // the same axis the corner controls occupy on every other card, which
        // is why the anchor giving those up leaves no visual gap.
        "absolute left-1/2 top-2 z-30 flex h-8 -translate-x-1/2 items-center gap-1 rounded-lg px-1",
        // Semi-opaque fill PLUS a blur, not a gradient scrim: thumbnails in
        // this library include near-white content, and only a real fill keeps
        // the icons legible over it (R6.6).
        "bg-zinc-950/80 shadow-lg shadow-black/40 ring-1 ring-white/10 backdrop-blur-[8px]",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-[120ms]",
      )}
    >
      {layout.showCount ? (
        <>
          <CountGroup count={state.selectionCount} />
          <PillSeparator />
        </>
      ) : null}
      {inline.map((spec) => {
        const Icon = spec.icon(state);
        return (
          <PillButton
            key={spec.action}
            label={spec.label(state)}
            reason={spec.unavailableReason(state)}
            disabled={spec.disabled(state)}
            onActivate={() => requestGraphItemAction(spec.action)}
          >
            <Icon aria-hidden="true" className="size-[17px]" />
          </PillButton>
        );
      })}
      {layout.showDelete ? (
        <>
          {/* Delete is fenced off from the non-destructive actions (R7.12) so
              it is harder to hit on the way to something else. */}
          <PillSeparator />
          {(() => {
            const spec = ITEM_ACTION_SPECS.find((candidate) => candidate.action === "delete")!;
            const Icon = spec.icon(state);
            return (
              <PillButton
                label={spec.label(state)}
                reason={spec.unavailableReason(state)}
                disabled={spec.disabled(state)}
                onActivate={() => requestGraphItemAction("delete")}
              >
                <Icon aria-hidden="true" className="size-[17px]" />
              </PillButton>
            );
          })()}
        </>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            data-pill-overflow
            data-collections-keyboard-ignore
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              PILL_CONTROL,
              "text-zinc-200 hover:bg-zinc-100/15 hover:text-white",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70",
            )}
          >
            <EllipsisVertical aria-hidden="true" className="size-[17px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          {/* Whatever did not fit in the row goes here, which is what makes
              collapsing lossless rather than a quiet removal. */}
          <SelectionOverflowItems
            state={state}
            includePrimary={ITEM_ACTION_SPECS.filter(
              (spec) =>
                spec.group === "primary" &&
                !layout.inline.includes(spec.action) &&
                (spec.action !== "delete" || !layout.showDelete),
            ).map((spec) => spec.action)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    </>
  );
}
