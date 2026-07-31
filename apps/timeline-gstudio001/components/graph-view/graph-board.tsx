"use client";

import { useContext, useDeferredValue, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  ClipboardPaste,
  Command,
  EllipsisVertical,
  FolderPlus,
  FolderTree,
  Redo2,
  Ruler,
  Settings,
  Undo2,
  X,
} from "lucide-react";

import {
  CollectionsContainerContext,
  VirtualGrid,
  VirtualStrip,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
} from "@storyboard/ui/dnd-collections";

import { flattenMediaOrder } from "@storyboard/timeline-domain";

import { formatDuration } from "@/lib/format-duration";
import {
  GRAPH_BOARD_MENU_SLOT_ID,
  requestGraphItemAction,
  requestGraphToolInsert,
} from "@/lib/graph-view-events";
import {
  SIDEBAR_GLYPH,
  SIDEBAR_ICON_BASE,
  SIDEBAR_ICON_IDLE,
} from "@/components/timeline/sidebar-icon-styles";
import { cn } from "@/lib/utils";
import { Button } from "@/components/core/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioBadge,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { Slider } from "@/components/core/slider";

import {
  SelectionOverflowItems,
  useClipboardCount,
  useSelectionActionState,
  useSelectionAnchorId,
} from "./graph-selection-actions";
import { GraphSelectionToolbar } from "./graph-selection-toolbar";
import { NativeDropGrid, NativeDropStrip, SidebarToolInsertBridge } from "./graph-native-drop";
import { VideoFrameLookAhead } from "./graph-item-content";
import { BreadcrumbDropZones, DragChromeFade } from "./graph-breadcrumb-drop";
import { OpenKeyBoundary } from "./graph-navigation";
import { SyncPanel, type SyncEntry } from "./graph-persistence";
import {
  GraphGridPlayhead,
  GraphPlayhead,
  GraphRuler,
  GraphSeekRails,
  FlatItemsProvider,
  GraphStripSeekRail,
  PreviewShell,
  collectionCardWidth,
  useFocusedTimelineAggregate,
  useSelectionAggregate,
  type PreviewTimeChannel,
} from "./graph-preview";
import { AddCollectionSlot } from "./graph-add-collection-slot";
import { CollectionHoverProvider } from "./graph-collection-hover";
import { ItemDetailsProvider } from "./graph-item-details-context";
import { GraphSaveStatus } from "./graph-save-status";
import { GraphShortcuts, requestGraphShortcuts } from "./graph-shortcuts";
import { GraphItemDetailsModal } from "./graph-item-details-modal";
import { SubTimelines } from "./graph-sub-timelines";
import {
  GRID_GAP,
  GRID_UNCAPPED_HEIGHT,
  GRAPH_STRIP_OVERSCAN_ITEMS,
  GRAPH_STRIP_TRACK_CLASS,
  ITEM_SIZE_DIMENSIONS,
  ITEM_SIZES,
  MAX_SUBTREE_DEPTH,
  MAX_TIMELINE_PPS,
  MIN_TIMELINE_PPS,
  isItemSize,
  stepDownItemSize,
  type FocusSurface,
  type ItemSize,
} from "./graph-view-config";

export type { FocusSurface, ItemSize };

/**
 * The board's overflow menu. Deliberately a LIST OF LABELLED SECTIONS rather
 * than a size picker that happens to live in a popover: unrelated controls
 * land here next, so the size radio group is one section among future ones
 * and the menu itself knows nothing about sizing.
 */
function BoardMenu({
  surface,
  itemSize,
  onItemSizeChange,
  pixelsPerSecond,
  onPixelsPerSecondChange,
}: Readonly<{
  surface: FocusSurface;
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pixelsPerSecond: number) => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Wears the icon RAIL's tile treatment, not the header's ghost
            button: it sits with the trash and account tiles now (PL14-005) and
            has to read as one of them. `side="right"` for the same reason —
            a menu aligned to the end of a 72px rail would open off-screen. */}
        <button
          type="button"
          aria-label="Board options"
          title="Board options"
          className={[SIDEBAR_ICON_BASE, SIDEBAR_ICON_IDLE].join(" ")}
        >
          <Settings aria-hidden="true" className={SIDEBAR_GLYPH} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-60 p-2">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-0.5 pb-2 pt-0.5">Thumbnail size</DropdownMenuLabel>
          {/* BADGES in a wrapping row, not a stack of rows: five sizes as
              full-width items ate most of the menu's height for a choice that
              is five short tokens. Still one radio group — exactly one
              selected, and the menu's roving focus still reaches each badge —
              only the shape changed. `flex-wrap` lets them take a second line
              on a narrow menu rather than squeezing past legibility. */}
          <DropdownMenuRadioGroup
            className="flex flex-wrap gap-1 pt-0.5"
            value={itemSize}
            onValueChange={(value) => {
              if (isItemSize(value)) onItemSizeChange(value);
            }}
          >
            {ITEM_SIZES.map((option) => (
              <DropdownMenuRadioBadge key={option} value={option}>
                {option.toUpperCase()}
              </DropdownMenuRadioBadge>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {/* Zoom is a strip-only axis: grid cells are sized by thumbnail size
            and the grid playhead ignores clip width, so the control is a
            no-op there. Omitted rather than shown disabled — same rule the
            header used when it hosted the slider, and a settings row that
            can never do anything is worse than one that isn't offered. */}
        {surface === "strip" ? (
          <>
            <DropdownMenuSeparator className="-mx-2 my-2.5" />
            <ZoomMenuItem
              pixelsPerSecond={pixelsPerSecond}
              onChange={onPixelsPerSecondChange}
            />
          </>
        ) : null}
        {/* LAST, and fenced off: everything above changes this board, while
            this one leaves it alone and opens a reference sheet. Sections that
            act and sections that explain do not belong in the same run. */}
        <DropdownMenuSeparator className="-mx-2 my-2.5" />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => requestGraphShortcuts()}>
            Keyboard shortcuts
            <Command
              aria-hidden="true"
              className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-500"
            />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Mounts `BoardMenu` into the icon sidebar's slot (PL14-005).
 *
 * The node is looked up ONCE, in a lazy initializer, and that is safe here for
 * a specific reason: the whole graph tree mounts `ssr: false` (see
 * client-graph-view), so the app layout — rail included — is already committed
 * to the DOM before this component first renders. There is no frame in which
 * the slot is missing and we would need to retry.
 *
 * Which is why it is not an effect. Resolving it with `setState` inside one
 * re-renders the board on every mount to change nothing, and the repo's lint
 * rejects synchronous set-state in an effect for exactly that reason. If the
 * graph ever mounts with SSR, this has to become a subscription — not an
 * effect that sets state.
 *
 * Rendering it from HERE, inside the board, is the whole point: the menu keeps
 * the real `itemSize`/`pixelsPerSecond` props and stays inside the graph's
 * providers. Only its DOM address is in the sidebar. `graph-view.spec.ts`
 * asserts it actually lands there, because a null slot would fail silently.
 */
function BoardMenuSlot(props: Readonly<{
  surface: FocusSurface;
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pixelsPerSecond: number) => void;
}>) {
  const [slot] = useState<HTMLElement | null>(() =>
    typeof document === "undefined"
      ? null
      : document.getElementById(GRAPH_BOARD_MENU_SLOT_ID),
  );
  if (!slot) return null;
  return createPortal(<BoardMenu {...props} />, slot);
}

/**
 * The centre readout of the header row: normally the focused timeline's
 * aggregate, and — while anything is selected — what the SELECTION adds up
 * to instead. One slot, two answers: the selection is the more specific fact
 * about the same timeline, so it takes the same pixels rather than opening a
 * second readout the eye has to choose between. Clearing the selection puts
 * the timeline total straight back.
 *
 * The header's two wings (breadcrumb / controls) carry equal `flex-1`, so
 * this piece sits dead-centre and stays there; a long breadcrumb truncates
 * inside its own wing instead of pushing the centre around. Passive DATA on
 * purpose (the per-card badges show the same numbers), so hiding it on small
 * screens costs nothing.
 */
function FocusedAggregate({
  focusedId,
  pixelsPerSecond,
}: Readonly<{ focusedId: string; pixelsPerSecond: number }>) {
  const selection = useSelectionAggregate();
  const { count, seconds } = useFocusedTimelineAggregate(focusedId, pixelsPerSecond);

  if (selection.count > 0) {
    return (
      <span
        data-selection-summary
        className="hidden shrink-0 px-3 text-center font-mono text-[11px] tabular-nums text-amber-300/90 sm:block"
        title="Selected items"
      >
        {selection.count} selected · {formatDuration(selection.seconds)}
      </span>
    );
  }
  if (count === 0) return null;
  return (
    <span
      data-focused-aggregate
      className="hidden shrink-0 px-3 text-center font-mono text-[11px] tabular-nums text-zinc-400 sm:block"
      title="Focused timeline total"
    >
      {count} {count === 1 ? "clip" : "clips"} · {formatDuration(seconds)}
    </span>
  );
}

/** One arrow press. Coarse enough to cross the range in a sensible number of
 *  presses, fine enough to land where you meant. */
const ZOOM_KEY_STEP = 4;

/**
 * Horizontal zoom, as a labelled row of the board menu.
 *
 * It used to sit bare in the header, and the comment here argued it had to: an
 * exploration tool reached WHILE reading the strip, where a menu would cost a
 * click per adjustment. That was the old call; the menu is where it lives now.
 * The trade is real and worth naming rather than pretending away — a zoom
 * sweep is open-menu-then-drag — but the header buys back the width, and the
 * control gains a visible name, a readable value, and units.
 *
 * WHY THE ROW IS THE CONTROL, and not a `<Slider>` a keyboard user focuses.
 *
 * A `role="menu"` navigates between menu ITEMS. Radix implements exactly that:
 * its roving focus walks `menuitem`/`menuitemradio` and nothing else. A slider
 * dropped in as a child is therefore unreachable by arrow keys — measured, not
 * assumed: focus went straight from the last size badge to "Keyboard
 * shortcuts", skipping the thumb. It was also invalid composition, since a
 * `slider` is not something a menu may contain.
 *
 * So the MENU ITEM owns the value: Left/Right adjust it, and its accessible
 * name carries the current reading. The `<Slider>` beneath is the pointer
 * affordance and the visual — `aria-hidden`, with its thumb out of the tab
 * order so nothing focusable hides inside a hidden subtree.
 *
 * Up/Down are deliberately NOT claimed: they keep moving through the menu, so
 * the horizontal keys drive the horizontal control and the vertical keys drive
 * the vertical list. Nothing to learn.
 */
function ZoomMenuItem({
  pixelsPerSecond,
  onChange,
}: Readonly<{
  pixelsPerSecond: number;
  onChange: (pixelsPerSecond: number) => void;
}>) {
  const value = Math.round(pixelsPerSecond);
  const stepBy = (delta: number) =>
    onChange(Math.min(MAX_TIMELINE_PPS, Math.max(MIN_TIMELINE_PPS, value + delta)));

  return (
    <DropdownMenuItem
      data-board-menu-zoom
      // Selecting must not close the menu: this row is a control you stay on,
      // not a command you fire.
      onSelect={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") stepBy(ZOOM_KEY_STEP);
        else if (event.key === "ArrowLeft") stepBy(-ZOOM_KEY_STEP);
        else if (event.key === "Home") onChange(MIN_TIMELINE_PPS);
        else if (event.key === "End") onChange(MAX_TIMELINE_PPS);
        else return;
        // Claimed — the menu must not also act on it.
        event.preventDefault();
        event.stopPropagation();
      }}
      // The whole reading, in the name: what it is, where it stands, and how
      // to move it. A menu item announcing only "Timeline zoom" would leave a
      // screen-reader user with no idea the arrows do anything here.
      aria-label={`Timeline zoom, ${value} pixels per second. Left and right arrow keys adjust.`}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      className="flex-col items-stretch gap-1.5 py-2 focus:bg-zinc-900"
    >
      <span aria-hidden="true" className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Timeline zoom
        </span>
        <span
          data-board-menu-zoom-value
          className="font-mono text-[11px] tabular-nums text-zinc-400"
        >
          {value} px/s
        </span>
      </span>
      <span aria-hidden="true" className="block py-0.5">
        <Slider
          thumbTabIndex={-1}
          min={MIN_TIMELINE_PPS}
          max={MAX_TIMELINE_PPS}
          step={1}
          value={[value]}
          onValueChange={([next]) => {
            if (typeof next === "number") onChange(next);
          }}
        />
      </span>
      <span aria-hidden="true" className="text-[11px] leading-snug text-zinc-500">
        Stretch or squeeze the strip&apos;s time scale.
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The ACTIVE styling shared by every toggle in this row: an ACCENT TINT — a
 * low-opacity sky wash under a sky glyph.
 *
 * The contrast comes from the GLYPH, not from a slab behind it. These are
 * toolbar toggles sitting inches from the board's own content, so an active
 * one has to be obvious without becoming the brightest object on the screen —
 * which is exactly what the previous treatment (a near-white fill, near-black
 * glyph) did: with three toggles lit, the toolbar out-shouted the timeline it
 * was there to control.
 *
 * The tint is deliberately weak. It exists to bound the accent, not to be seen
 * on its own; the colour is doing the work.
 *
 * SKY, and specifically `sky-300` on the glyph, because that is the colour of
 * PLAYED time on the seek rail (`data-rail-fill` is `bg-sky-300/80`). The rail
 * is where this app already says "this is live, this is what is on", so an
 * active toggle borrowing it inherits a meaning the user has been reading all
 * along instead of introducing a hue that means nothing yet.
 *
 * Not amber: amber means SELECTION here — selected cards, trim handles, the
 * focus ring. A toggle being on is a different fact from a card being chosen,
 * and the two are on screen together during a drag.
 *
 * The rail uses the same accent as an indicator BAR rather than a tint (see
 * SIDEBAR_ICON_PRESSED / SIDEBAR_ICON_TOGGLE_ON) — nav reads as position, a
 * toggle reads as on/off. One hue, two treatments; keep them in step.
 *
 * The idle half keeps the plain ghost treatment it shares with the undo, redo
 * and menu buttons beside it, so an inactive toggle still reads as one of that
 * cluster rather than a control in a scheme of its own.
 */
const HEADER_TOGGLE_ACTIVE =
  "bg-sky-400/15 text-sky-300 hover:bg-sky-400/25 hover:text-sky-200";
const HEADER_TOGGLE_IDLE = "text-zinc-400 hover:text-zinc-100";

/**
 * A view toggle in the breadcrumb row: time ruler, preview pane, children
 * timelines — all moved here from the icon sidebar.
 *
 * ONE component because the three are the same control with a different glyph,
 * and because their active styling has to stay identical. It was three
 * near-copies before this, which is exactly how the styling drifts.
 */
function HeaderToggle({
  active,
  onToggle,
  icon: Icon,
  label,
  title,
}: Readonly<{
  active: boolean;
  onToggle: () => void;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /**
   * Reflects STATE, not just the control — "Hide …" once on, "Show …" once
   * off. These are the exact names the sidebar buttons carried, so assistive
   * tech (and the e2e that drives them) sees controls that MOVED rather than
   * ones that vanished and were replaced by new ones.
   */
  label: string;
  title: string;
}>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      title={title}
      onClick={onToggle}
      className={cn("h-8 w-8", active ? HEADER_TOGGLE_ACTIVE : HEADER_TOGGLE_IDLE)}
    >
      <Icon aria-hidden className="h-4 w-4" />
    </Button>
  );
}

/**
 * Paste, and the two selection controls beside it.
 *
 * PASTE IS PERMANENT here, in both the idle and the selection state, and that
 * is the point of moving it out of the item actions. Every verb in the floating
 * toolbar acts ON the selection; paste needs a DESTINATION, and a selection is
 * not a destination. Grouped with the other container-scoped controls (new
 * folder, view toggles, undo/redo) it says one unambiguous thing: into the
 * collection you are looking at.
 *
 * Its label carries payload AND destination (R9.4), because "Paste" alone
 * cannot distinguish appending three clips at the end from dropping them after
 * the card you last touched — and the difference is invisible until it has
 * already happened.
 *
 * The `✕` and `⋮` appear only with a selection. The `⋮` is the reason the
 * floating toolbar is allowed to hide itself when its anchor scrolls away
 * (R6.6/R8.3): the actions are still one click from here.
 */
/**
 * Touch sizing for the header's selection controls (R11.2).
 *
 * These are the FALLBACK surface for the same actions the floating toolbar
 * offers — the one that takes over when the anchor card scrolls away — so they
 * need the same 44px minimum on a finger. The rest of the header row keeps its
 * 32px: those are chrome you reach for deliberately, not the controls a touch
 * user is steered to mid-gesture.
 */
const HEADER_SELECTION_SIZE =
  "h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

function HeaderSelectionCluster({
  anchorName,
}: Readonly<{ anchorName: string | null }>) {
  const store = useCollectionsStore();
  const state = useSelectionActionState();
  const clipboardCount = useClipboardCount();

  const payload = clipboardCount === 1 ? "1 item" : `${clipboardCount} items`;
  const pasteLabel =
    clipboardCount === 0
      ? "Paste"
      : anchorName === null
        ? `Paste ${payload} at end`
        : `Paste ${payload} after “${anchorName}”`;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={pasteLabel}
        title={pasteLabel}
        // Dimmed in place with an empty clipboard (R9.5), never hidden — a
        // control that comes and goes as you copy things moves the ones beside
        // it, and this row is where the eye returns for undo.
        aria-disabled={clipboardCount === 0 || state.busy || undefined}
        onClick={() => {
          if (clipboardCount === 0 || state.busy) return;
          requestGraphItemAction("paste");
        }}
        className={cn(
          HEADER_SELECTION_SIZE,
          clipboardCount === 0 || state.busy
            ? "cursor-not-allowed text-zinc-600 hover:text-zinc-600"
            : HEADER_TOGGLE_IDLE,
        )}
      >
        <ClipboardPaste aria-hidden className="h-4 w-4" />
      </Button>
      {state.hasSelection ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            data-clear-selection
            onClick={() => store.clearSelection()}
            className={cn(HEADER_SELECTION_SIZE, HEADER_TOGGLE_IDLE)}
          >
            <X aria-hidden className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="More selection actions"
                data-header-selection-overflow
                className={cn(HEADER_SELECTION_SIZE, HEADER_TOGGLE_IDLE)}
              >
                <EllipsisVertical aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <SelectionOverflowItems state={state} />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </>
  );
}

/**
 * Undo/redo as ICON buttons, matching the toolbar's other ghost icon controls
 * rather than the package's generic text-label `UndoRedoControls`. App-local
 * on purpose: the icon styling is this toolbar's design, so it stays out of
 * the framework-agnostic package — but the store wiring (and best-effort
 * announce) is exactly the package control's.
 */
function GraphUndoRedo() {
  const store = useCollectionsStore();
  const canUndo = useCollectionsSelector((s) => s.canUndo);
  const canRedo = useCollectionsSelector((s) => s.canRedo);
  const announce = useContext(CollectionsContainerContext)?.announce;

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo"
        onClick={() => {
          if (store.undo()) announce?.("Change undone.");
        }}
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
      >
        <Undo2 aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo"
        onClick={() => {
          if (store.redo()) announce?.("Change redone.");
        }}
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
      >
        <Redo2 aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * The Collection tool, relocated from the icon sidebar into the board header
 * (right cluster). Same two affordances it always had: CLICK (or keyboard)
 * appends a nested timeline to the open collection through the insert bridge,
 * and native DRAG carries it onto a strip to pick a POSITION. The default
 * browser drag image is suppressed (1×1 transparent gif) so only the strip's
 * own drop indicator shows where it will land.
 */
function GraphAddCollectionButton() {
  const handleDragStart = (event: React.DragEvent) => {
    // Same MIME the sidebar tool used, which NativeDropStrip/Grid accept.
    event.dataTransfer.setData("application/x-gstudio-type", "collection");
    event.dataTransfer.effectAllowed = "copy";
    const img = new window.Image();
    img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    event.dataTransfer.setDragImage(img, 0, 0);

    // The browser shows a "no-drop" cursor wherever a dragover handler doesn't
    // preventDefault — i.e. everywhere except directly over a strip/grid — so
    // the cursor flickers to no-drop as the pointer crosses the gaps between
    // them (and at the very start, up in the header). Claim EVERY dragover at
    // the document level for the drag's lifetime so the cursor stays a valid
    // "copy" throughout; the strips/grids still own the drop position and the
    // actual add. A matching document drop swallows a stray drop that misses
    // every strip so the browser takes no default action.
    const onDocDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDocDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    const cleanup = () => {
      document.removeEventListener("dragover", onDocDragOver, true);
      document.removeEventListener("drop", onDocDrop, true);
      document.removeEventListener("dragend", cleanup);
    };
    // Capture before nested surfaces. Chromium can briefly expose an empty
    // `types` list while crossing DOM boundaries, so the drag-lifetime guard
    // must not depend on reading our MIME type back from each event.
    document.addEventListener("dragover", onDocDragOver, true);
    document.addEventListener("drop", onDocDrop, true);
    document.addEventListener("dragend", cleanup, { once: true });
  };

  return (
    <button
      type="button"
      draggable
      aria-label="Add Collection to the open timeline"
      title="New collection — click to append, drag onto a strip to place"
      onDragStart={handleDragStart}
      onClick={() => requestGraphToolInsert("collection")}
      className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition-colors hover:border-sky-500 hover:bg-sky-950/20 hover:text-sky-400 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <FolderPlus aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

export function GraphBoard({
  projectId,
  focusedId,
  breadcrumb,
  surface,
  itemSize,
  onItemSizeChange,
  pixelsPerSecond,
  onPixelsPerSecondChange,
  previewOn,
  rulerOn,
  onRulerToggle,
  flatOn,
  childrenShown,
  onChildrenToggle,
  timeChannel,
  trashRootId,
  syncEntries,
}: Readonly<{
  projectId: string;
  focusedId: string;
  /** Slot, not routing props: the board renders where you are without
   *  knowing how a route is shaped. */
  breadcrumb: React.ReactNode;
  /** Chosen in the SIDEBAR now (its grid/strip icons), not in this header. */
  surface: FocusSurface;
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pixelsPerSecond: number) => void;
  /** The preview pane above the board. The board RENDERS it; the toggle
   *  lives in the icon rail (timeline-sidebar) and reaches this state through
   *  the window-event bus, which the pane's own close button and the WebMCP
   *  `set_preview` tool already share. */
  previewOn: boolean;
  /** The strip's time ruler. Its toggle lives in this header now (see
   *  `GraphRulerToggle`) and only mounts in flat mode, so the board both
   *  renders the state and asks for the change. */
  rulerOn: boolean;
  onRulerToggle: () => void;
  /** Strip's flat mode: render the whole closure in order, not this
   *  collection's direct children. */
  flatOn: boolean;
  /** Whether the nested-timeline tree renders below the focused surface. The
   *  toggle for it lives in this header now (see `GraphChildrenToggle`), so
   *  unlike the sidebar-driven flags around it the board both renders the
   *  state and asks for the change. */
  childrenShown: boolean;
  onChildrenToggle: () => void;
  timeChannel: PreviewTimeChannel;
  trashRootId: string | null;
  syncEntries: readonly SyncEntry[];
}>) {
  const dims = ITEM_SIZE_DIMENSIONS[itemSize];
  // Developer telemetry (the SyncPanel below) is opt-in via a truthy `dev`
  // query param — `?dev=1`, `?dev=true`, … — so regular use never shows it
  // (R7 #1). Read here, not threaded from the page: the graph tree mounts
  // client-only (`ssr: false` in client-graph-view), so useSearchParams has
  // no prerender/Suspense implications.
  const devParam = useSearchParams().get("dev");
  const devPanelsOn = devParam !== null && !["", "0", "false"].includes(devParam);
  // Zoom splits urgency (round-4 polish item 8): the slider thumb must track
  // the pointer, so its value stays URGENT — while the expensive work a zoom
  // step triggers (strip relayout, ruler rebuild, per-card resize fan-out)
  // renders at this DEFERRED value, interruptible by the next slider step.
  // (Not startTransition on the onChange: that would defer the controlled
  // thumb itself, making the handle lag the pointer.) Every time→x consumer
  // below — strip, ruler, playheads, scrub bands, sub-rows — shares this ONE
  // deferred value, so their geometry can never disagree mid-drag.
  const deferredPixelsPerSecond = useDeferredValue(pixelsPerSecond);
  // FLAT mode's item source: every media node in the focused closure, in
  // playback order. Memoized on the committed graph's IDENTITY — the store
  // notifies for interaction too, and VirtualStrip keys its measurements off
  // this array, so a fresh one per notification would re-measure the whole
  // strip mid-drag. `undefined` when flat is off, which is what makes the
  // strip fall back to the focused collection's own children.
  const graph = useCollectionsSelector((s) => s.graph);
  // The ITEMS, not just their ids: the strip needs the ids, and every time
  // overlay needs each item's parent chain to look up its manifest span.
  const flatItems = useMemo(
    () =>
      flatOn ? flattenMediaOrder(graph, parseNodeId(focusedId), MAX_SUBTREE_DEPTH) : null,
    [flatOn, graph, focusedId],
  );
  const flatItemIds = useMemo(
    () => flatItems?.map((item) => item.nodeId),
    [flatItems],
  );

  // Resolved ONCE, here, and handed to both consumers. The floating toolbar
  // anchors to this card and the header's paste label names it, so two
  // independent resolutions could disagree — the toolbar pointing at one card
  // while the label promised another.
  const anchorId = useSelectionAnchorId();
  const anchorName = useCollectionsSelector((s) =>
    anchorId === null ? null : (s.graph.nodesById.get(anchorId)?.name ?? null),
  );

  return (
    <OpenKeyBoundary trashId={trashRootId}>
      {/* Spans the header AND the surfaces: the toolbar toggle sets the mode,
          the selected card's panel reads it. */}
      <ItemDetailsProvider>
      {/* Spans the surfaces AND the child rows below them, because the pairing
          it carries joins the two: a collection's card up here and its row
          down there light each other up on hover. Inert unless the children
          tree is actually shown — with it off there is no row to pair with. */}
      <CollectionHoverProvider enabled={childrenShown}>
      {/* Published ABOVE the preview shell so the header aggregate and every
          time overlay inside it measure the run actually on screen. */}
      <FlatItemsProvider items={flatItems}>
      <PreviewShell enabled={previewOn} focusedId={focusedId} channel={timeChannel}>
        {/* Outside the surface branch on purpose: the sidebar's tool buttons
            must insert in grid mode too, where no NativeDropStrip exists. */}
        <SidebarToolInsertBridge collectionId={focusedId} />
        {/* Also outside it (PL10-012): details are not a strip idea. A grid
            card has no trim handles, but it has a name, a duration, and
            whatever an item grows next — so it opens the same view. The modal
            portals to the body, so where it mounts only decides which
            providers it can see. */}
        <GraphItemDetailsModal />
        {/* The "?" sheet. Every gesture in this view is invisible otherwise —
            hold-to-drag, O, F2, the whole Alt layer (PL11-007). */}
        <GraphShortcuts />
        {/* Item actions, anchored to the card they act on rather than parked
            in the icon rail 1600px away. Portals to the body, so mounting it
            here only decides which providers it can see — it needs the store
            and the details context, both of which are above this point. */}
        <GraphSelectionToolbar anchorId={anchorId} />
        <div className="flex flex-col gap-2">
          {/* Pinned so the controls stay reachable while scrolling the
              surfaces. It sticks just BELOW the sticky preview via the offset
              the split pane publishes (0 when the preview is closed). The
              opaque background is load-bearing twice over: it reads as a
              toolbar, and it OCCLUDES the strip/grid scrolling underneath —
              which is what stops a playhead marker from bleeding up into the
              breadcrumb row. z-40 to sit ABOVE the strip's z-30 playhead
              overlay (z-20 was below it, so the marker bled through the
              header); it matches the sticky preview's z-40. The negative
              margins let that background span the card's full width past its
              p-4 padding. */}
          <div
            data-graph-board-header=""
            className="sticky z-40 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 border-b border-zinc-800/70 bg-zinc-950/95 py-3 backdrop-blur-sm"
            style={{ top: "var(--workbench-preview-offset, 0px)" }}
          >
            {/* Seek thumbs are centered on the timeline edge and intentionally
                extend six pixels beyond it. Mask that overhang only while it
                passes behind this sticky row; clipping the board would also
                truncate the thumb once it is normally visible below. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-full w-2 bg-zinc-950"
              data-board-header-edge-occluder="start"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-full w-2 bg-zinc-950"
              data-board-header-edge-occluder="end"
            />
            {/* Equal-flex wings keep the aggregate at the row's true centre
                (under the transport's play cluster). min-w-0 lets a long
                breadcrumb truncate inside its wing. */}
            <div className="flex min-w-0 flex-1 items-center">{breadcrumb}</div>
            {/* Middle summary and the right-hand controls fade out under the
                drag readout that overlays this row, and fade back on drop. The
                breadcrumb stays — it IS the drop target. */}
            <DragChromeFade className="flex items-center">
              {/* One centre slot, two possible occupants. The save state takes
                  it while it has something to say and hands it back after —
                  the clip/duration total is a fact you can re-read at any
                  time, "not saved yet" is not. */}
              <GraphSaveStatus>
                <FocusedAggregate
                  focusedId={focusedId}
                  pixelsPerSecond={deferredPixelsPerSecond}
                />
              </GraphSaveStatus>
            </DragChromeFade>
            {/* flex-wrap + wrap-capable controls so a narrow viewport folds the
                toolbar onto a second line instead of pushing controls
                off-screen. No effect when it fits. */}
            <DragChromeFade className="flex min-w-0 items-center justify-end gap-2">
              {/* The Collection tool (moved here from the icon sidebar): the
                  view's one "add structure" action leads the cluster, fenced
                  off from the surface/history controls to its right. */}
              <GraphAddCollectionButton />
              <div aria-hidden="true" className="h-5 w-px shrink-0 bg-zinc-700" />
              {/* The VIEW group: what the board shows. Fenced on both sides so
                  the cluster reads as create | view | history | settings, and
                  the fences stay put as its contents come and go — the ruler
                  exists only in flat mode.

                  PREVIEW is deliberately not here. It lives in the icon rail
                  (see timeline-sidebar) because it is one of the two controls
                  worth promoting to rail scale; this row keeps the ones that
                  only qualify the board in front of you. */}
              {flatOn ? (
                <HeaderToggle
                  active={rulerOn}
                  onToggle={onRulerToggle}
                  icon={Ruler}
                  label={rulerOn ? "Hide time ruler" : "Show time ruler"}
                  title="Time ruler — tick marks over every strip"
                />
              ) : null}
              <HeaderToggle
                active={childrenShown}
                onToggle={onChildrenToggle}
                icon={FolderTree}
                label={childrenShown ? "Hide children timelines" : "Show children timelines"}
                title="Children timelines — show the nested timeline tree"
              />
              <div aria-hidden="true" className="h-5 w-px shrink-0 bg-zinc-700" />
              {/* Container-scoped, so it sits with history rather than with the
                  view group: paste changes what is IN the collection, undo and
                  redo change what is in it too. */}
              <HeaderSelectionCluster anchorName={anchorName} />
              <div aria-hidden="true" className="h-5 w-px shrink-0 bg-zinc-700" />
              <GraphUndoRedo />
              {/* Board options are no longer here — they render in the icon
                  sidebar below the trash (PL14-005). Still mounted from this
                  component so they keep these props; only the DOM address
                  changed. */}
              <BoardMenuSlot
                surface={surface}
                itemSize={itemSize}
                onItemSizeChange={onItemSizeChange}
                pixelsPerSecond={pixelsPerSecond}
                onPixelsPerSecondChange={onPixelsPerSecondChange}
              />
            </DragChromeFade>

            {/* The trash drop target (right side), shown only while a card is
                being dragged. The "move up a level" targets are the ancestor
                breadcrumb crumbs themselves (see GraphBreadcrumb). Inside the
                header so its absolute layer positions against it; inside the
                provider so its droppable joins the DndContext. */}
            <BreadcrumbDropZones trashId={trashRootId} />
          </div>

          {surface === "strip" ? (
            // The focused surface spans the card's FULL width (-mx-4 cancels
            // the card's p-4), so its edges line up with the full-bleed
            // breadcrumb bar above instead of sitting inset like a panel
            // nested under it. The focused surface is intentionally
            // edge-to-edge; padding here adds dead space around every side.
            <div
              data-focused-surface-shell="strip"
              className=""
            >
              <VideoFrameLookAhead>
                <NativeDropStrip collectionId={focusedId} projectId={projectId}>
              <VirtualStrip
                collectionId={parseNodeId(focusedId)}
                itemIds={flatItemIds}
                pixelsPerSecond={deferredPixelsPerSecond}
                overscan={GRAPH_STRIP_OVERSCAN_ITEMS}
                itemWidth={collectionCardWidth(deferredPixelsPerSecond, dims.strip)}
                itemHeight={dims.strip}
                // "One more, at the end of THIS timeline" — the sidebar tool
                // lands next to the selection, which is a different intent.
                // Flat mode has no single parent to append to, so no slot.
                trailingSlot={flatOn ? undefined : <AddCollectionSlot collectionId={focusedId} />}
                itemDragActivation="hold"
                // The package's floating overview draws the source at TIMELINE
                // scale, so its width grows with source duration — an 80s clip
                // ran three screens wide. This view shows a FITTED source map
                // inside the trim panel instead (PL10-004), composed with the
                // frame preview it used to only coincidentally line up with.
                trimOverview="off"
                overlay={
                  previewOn || rulerOn ? (
                    <>
                      {rulerOn ? (
                        <GraphRuler
                          focusedId={focusedId}
                          pixelsPerSecond={deferredPixelsPerSecond}
                          cardHeight={dims.strip}
                        />
                      ) : null}
                      {previewOn ? (
                        <GraphPlayhead
                          focusedId={focusedId}
                          channel={timeChannel}
                          pixelsPerSecond={deferredPixelsPerSecond}
                          cardHeight={dims.strip}
                        />
                      ) : null}
                    </>
                  ) : undefined
                }
                // pt-4: the 16px top band the seek rail centres in — same
                // clearance system as the grid's GRID_GAP row bands.
                //
                // The background was `bg-transparent`, which is what made a
                // short strip read as cards floating on the page. It is the
                // TRACK now (PL13-010) — on the scroll viewport, so it spans
                // the visible width whatever the content does.
                className={[
                  "rounded-none border-0 p-0",
                  GRAPH_STRIP_TRACK_CLASS,
                  previewOn || rulerOn ? "pt-4" : "",
                ].join(" ")}
              />
              {/* The strip's scrub control — the same rail treatment as the
                  grid's, riding the strip's top padding band and scrolling
                  with the content; a drag held at the scroller's edge
                  auto-pans to reveal more items mid-scrub. Replaces the old
                  invisible PlayheadScrubBand. */}
              {previewOn && (
                <GraphStripSeekRail
                  focusedId={focusedId}
                  channel={timeChannel}
                  pixelsPerSecond={deferredPixelsPerSecond}
                  cardHeight={dims.strip}
                />
              )}
                </NativeDropStrip>
              </VideoFrameLookAhead>
            </div>
          ) : (
            // Grid scrubbing is the per-row SEEK RAILS layer — one slim
            // slider in the gap above each row (the video-player idiom, in
            // lockstep with the playhead line on every row), so cards keep
            // every pointerdown (the old full-cover surface ate them all —
            // R7 #5/#6/#7) and the in-grid playhead line stays a passive
            // indicator. The layer overlays the grid as a SIBLING (outside
            // NativeDropGrid, whose drop math measures its own wrapper, and
            // outside the aria-hidden overlay — rails are focusable). Same
            // gray panel as the strip branch, with no extra shell padding.
            <div
              data-focused-surface-shell="grid"
              className="relative"
            >
              <NativeDropGrid collectionId={focusedId} projectId={projectId}>
                <VirtualGrid
                  collectionId={parseNodeId(focusedId)}
                  cellWidth={dims.gridWidth}
                  cellHeight={dims.gridHeight}
                  gap={GRID_GAP}
                  height={GRID_UNCAPPED_HEIGHT}
                  // Mirror the strip: a quick tap is a CLICK (so the in-card
                  // drill button works) and a press-and-hold starts the reorder
                  // drag. "body" (the default) drags instantly, which ate the
                  // drill click and made drags ambiguous.
                  itemDragActivation="hold"
                  trailingSlot={<AddCollectionSlot collectionId={focusedId} />}
                  overlay={
                    previewOn ? (
                      <GraphGridPlayhead
                        focusedId={focusedId}
                        channel={timeChannel}
                        cellHeight={dims.gridHeight}
                        pixelsPerSecond={deferredPixelsPerSecond}
                      />
                    ) : undefined
                  }
                  // pt-4 = GRID_GAP: row 0's rail band matches the row gaps.
                  className={[
                    "rounded-none border-0 bg-transparent p-0",
                    previewOn ? "pt-4" : "",
                  ].join(" ")}
                />
              </NativeDropGrid>
              {previewOn && (
                <GraphSeekRails
                  focusedId={focusedId}
                  channel={timeChannel}
                  cellHeight={dims.gridHeight}
                  pixelsPerSecond={deferredPixelsPerSecond}
                />
              )}
            </div>
          )}

          {/* Children render one size step below the focused timeline (flat —
              every descendant is this one size, see stepDownItemSize). The
              FolderTree toggle unmounts them entirely rather than hiding with
              CSS, so their strips/grids and sub-row playheads leave the DOM.
              Flat mode belongs only to the FOCUSED surface above: child rows
              remain structured and must map their own cards onto the shared
              preview clock. Reset the outer flat run here so its item list
              cannot leak into every nested rail/playhead. */}
          {childrenShown && (
            <FlatItemsProvider items={null}>
              <SubTimelines
                projectId={projectId}
                focusedId={focusedId}
                surface={surface}
                itemSize={stepDownItemSize(itemSize)}
                pixelsPerSecond={deferredPixelsPerSecond}
                previewOn={previewOn}
                rulerOn={rulerOn}
                timeChannel={timeChannel}
              />
            </FlatItemsProvider>
          )}

          {/* Card-drag drop targets (trash + move-to-parent) live in the
              breadcrumb row now (see BreadcrumbDropZones in the header above),
              not a portal into the sidebar. */}
          {devPanelsOn && <SyncPanel entries={syncEntries} />}
        </div>
      </PreviewShell>
      </FlatItemsProvider>
      </CollectionHoverProvider>
      </ItemDetailsProvider>
    </OpenKeyBoundary>
  );
}
