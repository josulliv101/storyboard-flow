"use client";

import {
  createElement,
  Fragment,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  AudioLines,
  CircleCheck,
  ClipboardPaste,
  Command,
  EllipsisVertical,
  FolderTree,
  Image as ImageIcon,
  Layers,
  Redo2,
  Ruler,
  Settings,
  TvMinimal,
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

import { flattenMediaOrder, type DetailsById } from "@storyboard/timeline-domain";
import { usePreviewSettled } from "@storyboard/ui/timeline/viewport/workbench-display-surface";

import { formatDuration } from "@/lib/format-duration";
import { graphClipboard } from "@/lib/graph-clipboard";
import {
  itemActionShortLabel,
  itemActionSpec,
  type ItemActionState,
} from "@/lib/graph-item-action-specs";
import {
  requestGraphItemAction,
  requestGraphAddItem,
  type GraphItemAction,
  type GraphSurface,
} from "@/lib/graph-view-events";
import { hydrationSkeletonCount } from "@/lib/hydration-skeletons";
import {
  SIDEBAR_GLYPH,
  SIDEBAR_ICON_BASE,
  SIDEBAR_ICON_IDLE,
} from "@/components/timeline/sidebar-icon-styles";
import { cn } from "@/lib/utils";
import { ClipNamesProvider } from "./graph-clip-names";
import { Button } from "@/components/core/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
  useClipboardCount,
  useIsPickingDestination,
  useHasPendingCut,
  usePendingCutCount,
  useSelectionActionState,
  useSelectionAnchorId,
} from "./graph-selection-actions";
import {
  DROPDOWN_MENU_PARTS,
  SELECTION_MENU_CONTENT_CLASS,
  SelectionMenuItems,
  SelectionMenuOverflowItems,
} from "./graph-selection-menu";
import { NativeDropGrid } from "./graph-native-drop-grid";
import { NativeDropStrip } from "./graph-native-drop-strip";
import { MEDIA_TOOL_PAYLOAD, ToolButton } from "./graph-tool-buttons";
import { VideoFrameLookAhead } from "./graph-card-frame-loading";
import { BreadcrumbDropZones, DragChromeFade } from "./graph-breadcrumb-drop";
import { OpenKeyBoundary } from "./graph-navigation";
import { SyncPanel, type SyncEntry } from "./graph-persistence";
import {
  GraphGridPlayhead,
  GraphPlayhead,
  GraphRuler,
  GraphSeekRails,
  GraphWaveformBand,
  FlatItemsProvider,
  GraphStripSeekRail,
  PreviewShell,
  collectionCardWidth,
  useFocusedTimelineAggregate,
  useSelectionCount,
  type PreviewTimeChannel,
} from "./graph-preview";
import { useCollectionSubtreeHydrated } from "./graph-card-derivations";
import { splitLaneRows } from "./graph-lane-rows";
import { AddCollectionSlot } from "./graph-add-collection-slot";
import { GridPlayStarts, gridPlayButtonFor } from "./graph-grid-play-button";
import { CollectionHoverProvider } from "./graph-collection-hover";
import { TagFilterProvider } from "./graph-tag-filter";
import { ActiveTagFilters, TagFilterControl } from "./graph-tag-filter-control";
import { ItemDetailsProvider } from "./graph-item-details-context";
import { useGraphDetailsSnapshot } from "./graph-details-context";
import { GraphSaveStatus } from "./graph-save-status";
import { GraphRenderFormat } from "./graph-render-format";
import { GraphRenderStatus } from "./graph-render-status";
import { GraphProjectMenu } from "./graph-project-menu";
import { GraphShortcuts, requestGraphShortcuts } from "./graph-shortcuts";
import { GraphItemDetailsModal } from "./graph-item-details-modal";
import {
  PLAYBAR_THUMBNAIL_STYLES,
  PlaybarThumbnailsProvider,
  isPlaybarThumbnailStyle,
  type PlaybarThumbnailStyle,
} from "./graph-playbar-thumbnails";
import { SubTimelines } from "./graph-sub-timelines";
import {
  GRID_GAP,
  GRID_UNCAPPED_HEIGHT,
  GRAPH_STRIP_OVERSCAN_ITEMS,
  GRAPH_STRIP_TRACK_CLASS,
  ITEM_SIZE_DIMENSIONS,
  ITEM_SIZES,
  MAX_SUBTREE_DEPTH,
  DEFAULT_TIMELINE_PPS,
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
  itemSize,
  onItemSizeChange,
  clipNamesShown,
  onClipNamesChange,
  playbarThumbnails,
  onPlaybarThumbnailsChange,
  playbarThumbnailStyle,
  onPlaybarThumbnailStyleChange,
  projectId,
}: Readonly<{
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
  /** Whether clip cards stamp their name over the artwork. Off by default —
   *  see `graph-clip-names.tsx`. */
  clipNamesShown: boolean;
  onClipNamesChange: (shown: boolean) => void;
  /** Whether the details view's play bar draws each clip's first frame rather
   *  than a grey box. Off by default — see `graph-playbar-thumbnails.tsx`. */
  playbarThumbnails: boolean;
  onPlaybarThumbnailsChange: (shown: boolean) => void;
  /** One frame filling each box, or a row of frames sampled across the clip.
   *  Kept whether or not frames are shown — see `graph-playbar-thumbnails.tsx`. */
  playbarThumbnailStyle: PlaybarThumbnailStyle;
  onPlaybarThumbnailStyleChange: (style: PlaybarThumbnailStyle) => void;
  /** Whose render format this menu edits. The section reads and writes the
   *  document itself, so the menu only has to say WHICH one. */
  projectId: string;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Back to the header ghost-button treatment. It wore the icon RAIL's
            tile styling while it lived down there with the trash and account
            tiles (PL14-005); it is the last control in the board's own
            controls row now, so it has to read as one of THOSE — same 32px
            ghost square as the toggles beside it, via HeaderToggle's classes.

            `side="bottom" align="end"` follows it back. `side="right"` existed
            only because a menu aligned to the end of a 72px rail would have
            opened off-screen; anchored to the row's right edge, dropping down
            and end-aligned is what keeps it on screen. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Board options"
          title="Board options"
          className={cn("h-8 w-8", HEADER_TOGGLE_IDLE)}
        >
          <Settings aria-hidden className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-60 p-2">
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
          {/* WHAT A CARD SHOWS, under HOW BIG IT IS — the two questions the
              eye asks about the same object, in that order. Off by default:
              the board is for reading frames, and a name stamped on the
              artwork covers the frame it names. On a strip that cost is not
              even: a clip's width is its duration, so the shortest clips —
              the ones with the least picture to spare — lose the most of it. */}
          <DropdownMenuCheckboxItem
            className="mt-2"
            checked={clipNamesShown}
            onCheckedChange={(next) => onClipNamesChange(next === true)}
            // The menu stays open: this is a setting you judge by looking at
            // the board behind it, and closing on select would make comparing
            // the two states a matter of reopening the menu each time.
            onSelect={(event) => event.preventDefault()}
          >
            Show name over item
          </DropdownMenuCheckboxItem>
          {/* THE PLAY BAR, not the board — which is why it names its surface
              where the item above does not. It sits with the other "what does
              this draw" answers rather than in the details view itself: that
              view is a place you go to work, and a setting you reach for once
              does not belong among the controls you use while you are there. */}
          <DropdownMenuCheckboxItem
            checked={playbarThumbnails}
            onCheckedChange={(next) => onPlaybarThumbnailsChange(next === true)}
            onSelect={(event) => event.preventDefault()}
          >
            Show playbar thumbnails
          </DropdownMenuCheckboxItem>
          {/* AND WHICH KIND — only once there are frames to have a kind. Two
              settings rather than three states in one control, because "show
              frames" and "which frames" are separate questions: the style
              survives being switched off and on, which is what makes toggling
              frames a comparison you can make twice rather than a choice you
              re-enter every time.

              Hidden rather than disabled when off. A disabled radio pair is a
              row of dead controls explaining a setting that is not in effect;
              absent, the menu simply gets shorter. */}
          {playbarThumbnails ? (
            <DropdownMenuRadioGroup
              className="flex flex-wrap gap-1 pl-8 pt-1.5"
              value={playbarThumbnailStyle}
              onValueChange={(value) => {
                if (isPlaybarThumbnailStyle(value)) onPlaybarThumbnailStyleChange(value);
              }}
            >
              {PLAYBAR_THUMBNAIL_STYLES.map((option) => (
                <DropdownMenuRadioBadge key={option} value={option}>
                  {option === "cover" ? "COVER" : "STRIP"}
                </DropdownMenuRadioBadge>
              ))}
            </DropdownMenuRadioGroup>
          ) : null}
        </DropdownMenuGroup>
        {/* RENDER FORMAT, moved in from the header row.
            It read "16:9 · 720p" beside the breadcrumbs — a standing fact
            about the project, permanently on screen, competing with the
            controls you use while working. It belongs with the settings you
            set once, which is what this menu is for. Below thumbnail size
            because that is the one you reach for oftener. */}
        <DropdownMenuSeparator className="-mx-2 my-2.5" />
        <GraphRenderFormat timelineId={projectId} />
        {/* Zoom used to be a row here. It is a real slider in the header's
            view group now (see HeaderZoomControl) — this menu keeps the
            settings you set once, not the axis you ride while reading. */}
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

/*
 * `BoardMenuSlot` is gone with the trip to the icon rail.
 *
 * It portalled `BoardMenu` into a slot the rail published
 * (`GRAPH_BOARD_MENU_SLOT_ID`), so the menu could keep its real
 * `itemSize`/`onItemSizeChange` props and stay inside the graph's providers
 * while its trigger sat with the trash and account tiles (PL14-005). The
 * trigger is back in the board's own controls row, which is inside those
 * providers already — so the portal, the slot lookup, and the rail's empty
 * publishing div all had nothing left to do and are deleted rather than left
 * behind pointing at each other.
 */

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
/**
 * The placeholder row shown while a focused collection hydrates.
 *
 * Shaped like the cards it stands in for — same width, height and gap as the
 * real surface — because the point is that nothing MOVES when the clips land.
 * A generic spinner would say "wait" without saying what for, and would let
 * the surface jump to a different height on arrival.
 *
 * `aria-hidden` with a live-region label beside it rather than on it: a screen
 * reader should hear "loading 4 clips" once, not read out four empty boxes.
 * `role="status"` announces politely, which is right for something that
 * resolves on its own.
 */
function SurfaceSkeleton({
  count,
  surface,
  dims,
  pixelsPerSecond,
}: Readonly<{
  count: number;
  surface: GraphSurface;
  dims: (typeof ITEM_SIZE_DIMENSIONS)[ItemSize];
  pixelsPerSecond: number;
}>) {
  const isStrip = surface === "strip";
  // The strip's card width is a function of DURATION, which is exactly what is
  // not known yet — so the placeholder uses the width a zero-duration card
  // would get, which is the same floor a real short clip lands on.
  const width = isStrip ? collectionCardWidth(pixelsPerSecond, dims.strip) : dims.gridWidth;
  const height = isStrip ? dims.strip : dims.gridHeight;

  return (
    <div
      data-surface-skeleton={surface}
      data-surface-skeleton-count={count}
      role="status"
      aria-label={`Loading ${count === 1 ? "1 clip" : `${count} clips`}`}
      className={[
        "flex",
        // The strip is one scrolling line; the grid wraps. Matching each
        // surface's own flow is what keeps the placeholder honest about the
        // shape that is coming.
        isStrip ? "flex-nowrap overflow-hidden" : "flex-wrap",
      ].join(" ")}
      style={{ gap: GRID_GAP }}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="shrink-0 animate-pulse rounded-md bg-zinc-800/60 ring-1 ring-white/5"
          style={{
            width,
            height,
            // Staggered, so the row reads as a sequence filling in rather than
            // one block flashing. Capped so a full row's last card is not a
            // second behind its first.
            animationDelay: `${Math.min(index, 6) * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * How many items are selected — the subject the controls beside it act on.
 *
 * Lives in the HEADER, next to those controls: a group of verbs whose count has
 * been moved away reads as chrome with no object. Visible at every breakpoint
 * for the same reason.
 *
 * This and `FocusedAggregate` below were ONE component sharing one slot, which
 * is why they were mutually exclusive — two numbers competing for the centre of
 * the breadcrumb row, so the selection won whenever there was one. They are in
 * different rows now, so the competition is gone and with it the reason to
 * suppress either: the header says what you have picked, the controls row says
 * what is in front of you, and both are true at once.
 */
function SelectionSummary() {
  const selectedCount = useSelectionCount();
  if (selectedCount === 0) return null;
  return (
    <span
      data-selection-summary
      className="block shrink-0 pl-3 text-center font-mono text-[11px] tabular-nums text-blue-400/90"
      title="Selected items"
    >
      {/* COUNT ONLY. The selection's total duration was here and is not a
          fact anyone acts on — nothing in the row does anything with it, and
          it competed for the eye with the number that actually scopes the
          verbs beside it. The timeline's own total still shows below, which is
          where a duration means something. */}
      {selectedCount} selected
    </span>
  );
}

/**
 * What is in the focused timeline: "12 clips · 1:04".
 *
 * It describes the board rather than the selection, so it sits in the controls
 * row under the divider rather than in the breadcrumb trail above.
 *
 * In the MIDDLE of that row, in a column of its own. The row opened with it
 * once and ended with it once; both put a statement in a run of controls. The
 * row is three columns now — controls left, controls right, this between them —
 * so the one thing here that is not pressable is also the one thing not in a
 * cluster.
 *
 * No longer hidden below `sm`. It was competing for the breadcrumb row's centre
 * slot with the selection count and with the clipboard verbs, and on a narrow
 * viewport the total was the one worth dropping. In a row of its own there is
 * nothing to lose it to.
 */
function FocusedAggregate({
  focusedId,
  pixelsPerSecond,
}: Readonly<{ focusedId: string; pixelsPerSecond: number }>) {
  const { count, seconds } = useFocusedTimelineAggregate(focusedId, pixelsPerSecond);
  // The total sums this board's cards, so it inherits their uncertainty: a
  // collection card whose branch is not loaded contributes a STORED summary,
  // and those drift. The count is safe — it is this board's own children — so
  // an unvouched board says "3 clips" and earns the time when its branches
  // load. Measured before this: the root board claimed 23:21 against a true
  // 21:55.
  const vouched = useCollectionSubtreeHydrated(focusedId);
  // WHILE SELECTING, THIS SLOT SAYS WHAT TO DO INSTEAD OF WHAT IS THERE.
  //
  // The centre of this row is the one place in it that is not a control, which
  // is what makes it the right place for a sentence — and the total is the
  // least useful thing on screen at the moment someone has just armed a mode
  // and is deciding what to click. The mode's other two signals are ambient
  // (the panel tint) and per-item (the cards' faint rings); this is the one
  // that can use words, so it does.
  //
  // "item(s)" rather than a count-aware plural: nothing has been picked yet,
  // so there is no number to agree with, and "Select items below" quietly
  // suggests you need more than one.
  const selecting = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  if (selecting) {
    return (
      <span
        data-focused-aggregate="selecting"
        className="shrink-0 font-mono text-[11px] text-sky-300/90"
      >
        Select item(s) below
      </span>
    );
  }
  if (count === 0) return null;
  return (
    <span
      data-focused-aggregate
      className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-400"
      title="Focused timeline total"
    >
      {count} {count === 1 ? "clip" : "clips"}
      {vouched ? <> · {formatDuration(seconds)}</> : null}
    </span>
  );
}

/**
 * The zoom slider's reading, as a PERCENTAGE of the default.
 *
 * The stored value is pixels-per-second, which is the right unit for the layout
 * maths and the wrong one to show a person: it is an implementation detail of
 * how a strip is drawn, and "50" means nothing without knowing what the other
 * numbers are. A percentage answers the only question the readout is asked —
 * how far from normal is this — and needs no scale to interpret.
 *
 * `DEFAULT_TIMELINE_PPS` is the 100% mark, so the control opens reading 100%.
 * The bounds (6..200 px/s) land at 12%..400%.
 *
 * DISPLAY ONLY. The slider's own value, its min/max and everything downstream
 * stay in px/s — including the `aria-valuenow` an e2e test reads.
 */
function zoomPercent(pixelsPerSecond: number): number {
  return Math.round((pixelsPerSecond / DEFAULT_TIMELINE_PPS) * 100);
}

/**
 * Horizontal zoom, as a real slider in the header's view group.
 *
 * It spent a while as a MENU ROW, and the comment there argued the shape was
 * forced: a `role="menu"` moves its roving focus between `menuitem`s and
 * nothing else, so a `<Slider>` dropped inside one is unreachable by keyboard —
 * measured at the time, not assumed. That constraint belonged to the menu, and
 * it leaves with it. Out here the slider is an ordinary focusable control: Tab
 * reaches the thumb, arrows move it, and Radix supplies Home/End. None of the
 * key handling this needed as a menu row survives, because none of it was about
 * zoom.
 *
 * What the move buys back is the thing the menu cost: an exploration tool read
 * WHILE watching the strip, where open-menu-then-drag charged a click per
 * adjustment. It is a drag on a visible slider again.
 *
 * STRIP ONLY. Grid cells are sized by thumbnail size and the grid playhead
 * ignores clip width, so the control is a no-op there — omitted rather than
 * disabled, the same call the menu made.
 */
function HeaderZoomControl({
  pixelsPerSecond,
  onChange,
}: Readonly<{
  pixelsPerSecond: number;
  onChange: (pixelsPerSecond: number) => void;
}>) {
  const value = Math.round(pixelsPerSecond);
  return (
    <span
      data-header-zoom
      // Marks the whole control as non-background for the package's
      // click-to-clear: the slider's role lives on its thumb, but the surface
      // you click to jump the value is the track beside it, which would
      // otherwise read as empty board and drop the selection.
      data-collections-control
      // `pl-1.5` on top of the row's `gap-2`, and only on the LEFT. Every
      // neighbour is a button whose glyph sits inside its own padding, so the
      // row's gap lands between two cushioned edges; the slider's track starts
      // hard at its box edge, which put it visibly nearer the fence than any
      // two other controls are to each other. This buys back the padding the
      // buttons have and it does not.
      className="flex shrink-0 items-center gap-2 pl-1.5"
    >
      <Slider
        // A hook on the SLIDER, distinct from `data-header-zoom` on the wrapper
        // around it. A pointer test aiming at "the left end of the track" has to
        // measure the track — measuring the wrapper worked only while the two
        // shared an edge, and a later `pl-1.5` on the wrapper silently moved the
        // click into the padding, where it did nothing and the zoom never
        // changed.
        data-header-zoom-slider
        // The name and the READING both go to the thumb, which is where Radix
        // puts `role="slider"` (see components/core/slider). A bare number on
        // an axis like pixels-per-second announces nothing on its own.
        aria-label="Timeline zoom"
        // Announced as the PERCENTAGE shown, not the raw pixels-per-second the
        // slider stores. A bare number on an axis like px/s announces nothing
        // on its own, and "100%" carries the one fact that matters — how far
        // from the default you are.
        aria-valuetext={`${zoomPercent(value)}%`}
        min={MIN_TIMELINE_PPS}
        max={MAX_TIMELINE_PPS}
        step={1}
        value={[value]}
        onValueChange={([next]) => {
          if (typeof next === "number") onChange(next);
        }}
        className="w-24"
      />
      {/* Fixed width and tabular figures: the readout sits in a toolbar whose
          controls must not shuffle as the number crosses 10 or 100. */}
      <span
        data-header-zoom-value
        aria-hidden="true"
        // Narrower than the `52px` "200 px/s" needed: the widest reading is
        // now "400%".
        className="w-[38px] shrink-0 font-mono text-[11px] tabular-nums text-zinc-500"
      >
        {zoomPercent(value)}%
      </span>
    </span>
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
 * The hairline between two groups of controls.
 *
 * A component rather than the literal div it replaces, because the board now
 * draws these in two different rows and a fence that is a pixel taller in one
 * of them is exactly the kind of drift nobody reports and everybody sees. The
 * measurements are the breadcrumb row's, which had them first.
 *
 * `shrink-0` is load-bearing: it sits in a row whose groups carry `min-w-0` so
 * they may compress, and a 1px flex child with no floor is the first thing a
 * tight row rounds away to nothing — leaving the groups it separates touching.
 */
function ControlFence({ className }: Readonly<{ className?: string }> = {}) {
  return <div aria-hidden="true" className={cn("h-5 w-px shrink-0 bg-zinc-700", className)} />;
}

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
  busy = false,
  text,
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
  /** Work is in flight and the state shown is not settled yet. Only flat mode
   *  needs it — loading a deep closure takes a moment, and a half-built run
   *  would otherwise look like the real answer. */
  busy?: boolean;
  /**
   * A visible word beside the glyph. Absent for almost every toggle here — the
   * row's language is bare glyphs — and present where a control has earned the
   * width by being something other than one more view switch.
   *
   * It does NOT replace `label`: that stays the accessible name, and the two
   * differ on purpose ("Preview" on screen, "Show preview"/"Hide preview" to a
   * screen reader, which needs the STATE the pressed look conveys visually).
   */
  text?: string;
}>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      // PUBLISHED IN BOTH STATES, for the toggles that have a busy concept at
      // all. `busy || undefined` dropped the attribute when idle, so there was
      // no way to tell "finished loading" from "never loads" — anything
      // waiting for the closure to settle waited forever. It moved here from
      // the sidebar, which passed the boolean straight through and so rendered
      // aria-busy="false"; losing that on the way was silent.
      //
      // Still absent for toggles that never pass `busy`: a permanent
      // aria-busy="false" on a control with nothing to load is noise a screen
      // reader has to step over.
      aria-busy={busy === undefined ? undefined : busy}
      title={title}
      onClick={onToggle}
      // `shrink-0` because `h-8 w-8` is a REQUEST, not a floor: a flex item
      // shrinks below its width by default. It also makes the cluster's
      // `min-content` the real width of its controls, which is what the
      // header row's right column now sizes itself against — a squeezable
      // icon would report a smaller minimum and let the column collapse again.
      className={cn(
        "h-8 shrink-0",
        // Square when it is a glyph alone; grown to fit when it carries a word.
        // `size="icon"` sets a fixed square, so a labelled one has to opt out of
        // the width and take its own padding — and `whitespace-nowrap` so the
        // word cannot wrap and drag the row's pinned height with it.
        text === undefined ? "w-8" : "w-auto gap-1.5 px-2 text-[11px] font-medium whitespace-nowrap",
        active ? HEADER_TOGGLE_ACTIVE : HEADER_TOGGLE_IDLE,
      )}
    >
      <Icon aria-hidden className={cn("h-4 w-4", busy && "motion-safe:animate-pulse")} />
      {text}
    </Button>
  );
}

/**
 * Touch sizing for the header's selection controls (R11.4).
 *
 * These are the FALLBACK surface for the actions the anchor card's `⋮` offers —
 * the one that takes over when the anchor scrolls away, or sits on a card too
 * narrow to carry a control at all — so they need the same 44px minimum on a
 * finger. The rest of the header row keeps its 32px: those are chrome you reach
 * for deliberately, not the controls a touch user is steered to mid-gesture.
 */
const HEADER_SELECTION_SIZE =
  "h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

/**
 * The `✕` and `⋮`, in the CENTRE beside the selection readout.
 *
 * They used to sit in the right-hand cluster, mixed in with the container
 * controls, which put them a full header-width away from the count they act on
 * and grouped them with things they have nothing to do with. Everything here is
 * SELECTION-scoped: the readout says what is selected, the `✕` drops it, the
 * `⋮` acts on it. One group, one subject, separated from the readout by a fence
 * so the text stays readable as text.
 *
 * A SIBLING of `GraphSaveStatus` rather than a child. That component takes the
 * centre slot over whenever it has something to say, and it replaces its
 * children to do it — nesting these would make the fallback surface disappear
 * for the length of every save, which is precisely when a user is most likely
 * to be mid-gesture.
 *
 * Visible at every breakpoint, unlike the idle aggregate it sits beside. That
 * readout is passive data and hides below `sm`; these are the only route to the
 * selection's actions when the anchor is off-screen, and a phone is where an
 * anchor is most often off-screen.
 */
/**
 * A verb promoted OUT of the menu and onto the header as an icon button.
 *
 * Rendered from `ITEM_ACTION_SPECS`, so its icon, its label, when it dims and
 * why are the same data the menu row uses — a promoted button that disagreed
 * with its own menu entry about whether an action applies is the failure this
 * prevents, and it is exactly the failure the v2 pill kept producing.
 *
 * `aria-disabled`, never `disabled`, for the same reason the menu rows use it
 * (R7.7/R12.4): a disabled button is unfocusable and silent, so it can never
 * deliver the reason it is unavailable. Here the reason rides the accessible
 * name and the tooltip, since an icon button has no room for an inline slot.
 */
function HeaderActionButton({
  action,
  state,
}: Readonly<{ action: GraphItemAction; state: ItemActionState }>) {
  const spec = itemActionSpec(action);
  const label = spec.label(state);
  const reason = spec.unavailableReason(state);
  const disabled = spec.disabled(state);
  const icon = createElement(spec.icon(state), {
    "aria-hidden": true,
    className: "h-4 w-4",
  });
  const name = reason === null ? label : `${label}, ${reason}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={name}
      title={name}
      aria-disabled={disabled || undefined}
      data-header-action={action}
      onClick={() => {
        if (disabled) return;
        requestGraphItemAction(action);
      }}
      className={cn(
        HEADER_SELECTION_SIZE,
        disabled ? "cursor-not-allowed text-zinc-600 hover:text-zinc-600" : HEADER_TOGGLE_IDLE,
      )}
    >
      {icon}
    </Button>
  );
}

/**
 * The verbs promoted out of the menu, in the order they sit in the header.
 *
 * §15's phase-two path (R15.2), and ADDITIVE — every one of these is still in
 * the menu too, so nothing built on the menu breaks.
 *
 * Ordered identity → clipboard → destructive, the same grouping the menu uses,
 * so the row and the menu do not teach two different mental models. Delete
 * stays last of the verbs for the reason it is last in the menu: a destructive
 * action at the end is harder to hit on the way to something else.
 *
 * PASTE IS NOT IN THIS LIST even though it renders among them — see
 * `SelectionCentreControls`. It is the one control here that does not act on
 * the selection, so it cannot be driven by the selection's action specs.
 */
const PROMOTED_HEADER_ACTIONS: readonly GraphItemAction[] = ["details", "delete"];

/**
 * Where in the promoted row paste is spliced in.
 *
 * After Edit, which is simply "second" now that Copy and Cut have gone back to
 * the menu. It sat with those two while they were here, on the reasoning that
 * copy/cut/paste is the grouping every application teaches — but the group no
 * longer exists on this row, and Delete stays last for the usual reason.
 *
 * Copy and Cut came out because they have keyboard shortcuts that carry almost
 * all of their real traffic, and a promoted icon earns its place by being
 * reached with a pointer. Both are still in the menu, unchanged (R15.2 makes
 * promotion additive, so demotion costs nothing but the icon).
 */
const PASTE_AFTER_ACTION: GraphItemAction = "details";

function SelectionCentreControls({
  anchorName,
}: Readonly<{ anchorName: string | null }>) {
  const store = useCollectionsStore();
  const state = useSelectionActionState();
  const hasPendingCut = useHasPendingCut();

  // NOT simply `if (!hasSelection) return null`. Paste has to outlive the
  // selection — "Paste 3 clips at end" (R9.4) is BY DEFINITION the
  // no-selection label, and copy → click empty space → paste is the ordinary
  // way to append. So the row survives an empty selection whenever the
  // clipboard is armed, and only disappears when it would be empty.
  if (!state.hasSelection && !state.canPaste) return null;

  // A PENDING CUT is a half-finished gesture, and the row narrows to its two
  // endings: land it, or abandon it.
  //
  // The other verbs are hidden rather than dimmed — the one case in this
  // feature where the "dim in place, never remove" rule (R7.5) is deliberately
  // not followed. That rule protects positions from shifting *within a state*
  // as the selection count changes. This is a different state entirely, entered
  // and left by an explicit act, and its whole point is that there are only two
  // moves; six dimmed icons would say "not now" six times instead of saying
  // "finish this" once.
  //
  // Why hide them at all rather than let them work: a cut's sources are still
  // on the board, dimmed, waiting to move. Copying one, cutting it again, or
  // deleting it mid-flight all mean something ambiguous, and the ambiguity is
  // invisible until it has already resolved the wrong way.
  //
  // Note this is CUT-only. A copy leaves its sources untouched, so the board
  // stays fully usable while one is on the clipboard.
  const selectionVerbs =
    state.hasSelection && !hasPendingCut ? PROMOTED_HEADER_ACTIONS : [];

  return (
    <span data-selection-centre-controls className="flex shrink-0 items-center gap-1">
      {/* Asymmetric on purpose: the readout needs room to breathe before the
          fence, while the controls after it sit in their own tight group. */}
      <span aria-hidden="true" className="ml-5 mr-2 h-5 w-px shrink-0 bg-zinc-700" />
      {selectionVerbs.length === 0 ? (
        <HeaderPasteButton anchorName={anchorName} />
      ) : (
        selectionVerbs.map((action) => (
          <Fragment key={action}>
            <HeaderActionButton action={action} state={state} />
            {action === PASTE_AFTER_ACTION ? (
              <HeaderPasteButton anchorName={anchorName} />
            ) : null}
          </Fragment>
        ))
      )}
      {selectionVerbs.length === 0 ? null : (
      // Non-modal for the same reason the anchor's `⋮` is — see the note
      // there. Radix's modal default makes the body pointer-events:none, which
      // stops this button from receiving the click that should toggle its own
      // menu shut, and lets background-clear drop the selection once the layer
      // unmounts.
      <DropdownMenu modal={false}>
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
        <DropdownMenuContent
          side="bottom"
          align="center"
          className={SELECTION_MENU_CONTENT_CLASS}
        >
          {/* The SAME menu the anchor's `⋮` opens. This is the fallback for an
              anchor scrolled out of view, or one on a card too narrow to carry
              a control at all (R5.5/R8.4) — so it must offer everything, and it
              does so by rendering the identical definition rather than a
              superset assembled by hand. */}
          <SelectionMenuItems parts={DROPDOWN_MENU_PARTS} state={state} />
        </DropdownMenuContent>
      </DropdownMenu>
      )}
      {/* Fenced off from the verbs. Everything left of this line ACTS on
          something; `✕` dismisses it. Without the fence, "clear" reads as one
          more verb in the same row and sits a slot from Delete — two adjacent
          icons that both make things go away, only one of which is reversible
          by doing it again.

          WHAT it dismisses depends on what is there, and the cases are NOT
          collapsed into one "cancel everything".

          A PENDING CUT wins outright, even with a selection standing — during
          a cut the selection is the user CHOOSING a destination, so clearing
          it would undo the wrong half of what they are doing. Cancelling the
          cut is what restores the full row (the sources un-dim and stay put),
          which is the way out of the narrowed state.

          Otherwise the selection goes first, and only once there is none does
          `✕` turn on the clipboard. Clearing the selection must leave a COPY
          alone: copy → deselect → navigate → paste is the ordinary way to move
          something between collections, and a `✕` that took the payload with
          it would break exactly that. */}
      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-zinc-700" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        // The label names the actual target. One glyph doing three jobs is
        // fine; one glyph SAYING it does one job while doing another is not.
        aria-label={
          hasPendingCut ? "Cancel cut" : state.hasSelection ? "Clear selection" : "Clear clipboard"
        }
        title={
          hasPendingCut
            ? "Cancel cut — leave the items where they are"
            : state.hasSelection
              ? "Clear selection (Esc)"
              : "Clear clipboard"
        }
        data-cancel-cut={hasPendingCut ? "" : undefined}
        data-clear-selection={!hasPendingCut && state.hasSelection ? "" : undefined}
        data-clear-clipboard={!hasPendingCut && !state.hasSelection ? "" : undefined}
        onClick={() => {
          // Un-dims the sources of a pending cut and leaves them where they
          // are, which is the visible half of what cancelling one means.
          if (hasPendingCut || !state.hasSelection) {
            graphClipboard.clear();
            return;
          }
          store.clearSelection();
        }}
        className={cn(HEADER_SELECTION_SIZE, HEADER_TOGGLE_IDLE)}
      >
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </span>
  );
}

/**
 * Paste — present only when there is something to paste.
 *
 * A deliberate departure from R9.4, which asked for it dimmed in place and
 * never hidden. That rule exists so a control does not move the ones beside it
 * as you copy things, and it was written for a paste sitting permanently among
 * the container controls. Here it sits inside the selection cluster, which
 * already comes and goes with the selection — so an always-present paste buys
 * no stability, and an icon that can never do anything is just noise in a row
 * that is otherwise entirely live.
 *
 * Its label carries payload AND destination (R9.4's other half, kept), because
 * "Paste" alone cannot distinguish appending three clips at the end from
 * dropping them after the card you last touched — and the difference is
 * invisible until it has already happened.
 */
function HeaderPasteButton({
  anchorName,
  /** Rendered into the verb run's measuring ruler — same box, nothing that
   *  identifies it. `[data-header-paste]` is located globally by tests, and the
   *  ruler is a second copy of this markup inside the same row: copy in browse
   *  mode, then arm select mode, and the page would hold two of it. */
  measuring = false,
}: Readonly<{ anchorName: string | null; measuring?: boolean }>) {
  const state = useSelectionActionState();
  const clipboardCount = useClipboardCount();

  if (clipboardCount === 0) return null;

  const payload = clipboardCount === 1 ? "1 item" : `${clipboardCount} items`;
  const pasteLabel =
    anchorName === null
      ? `Paste ${payload} at end`
      : `Paste ${payload} after “${anchorName}”`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={measuring ? undefined : pasteLabel}
      title={pasteLabel}
      data-header-paste={measuring ? undefined : ""}
      // Still dims while an action is in flight, so a paste cannot double-fire
      // behind a slow one.
      aria-disabled={state.busy || undefined}
      onClick={() => {
        if (measuring || state.busy) return;
        requestGraphItemAction("paste");
      }}
      className={cn(
        HEADER_SELECTION_SIZE,
        state.busy
          ? "cursor-not-allowed text-zinc-600 hover:text-zinc-600"
          : HEADER_TOGGLE_IDLE,
      )}
    >
      <ClipboardPaste aria-hidden className="h-4 w-4" />
    </Button>
  );
}

/**
 * Enter select mode — the pointer route to picking things deliberately.
 *
 * It earns its place because a plain click DRILLS IN now. Before that, clicking
 * a collection selected it and this control would have been a convenience; now
 * it is the only pointer gesture that picks a collection at all. Touch has the
 * same problem for every kind of card, having no Ctrl to hold.
 *
 * The SAME store flag the anchor menu's "Add to selection by tapping" row
 * toggles — one piece of state behind two controls, so arming it from either
 * place behaves identically and neither can disagree about whether it is on.
 * The menu row keeps its bare `Check`, which is a checkmark doing tick-box duty
 * beside a label; this is the design's `CircleCheck`, which reads as a control
 * rather than a state. The word beside it is what makes it a mode and not a verb.
 *
 * ALWAYS RENDERED, in both faces of the header. It used to disappear the moment
 * a selection existed, because the whole row became `SelectModeHeader` — so the
 * control the user had just pressed vanished from under the cursor, and its
 * pressed state was only ever visible in the window before the first card was
 * picked. It stays in place and stays pressed for as long as the mode is on,
 * which is what a toggle is supposed to do; pressing it again is now one of two
 * ways out, alongside Done.
 */
function SelectModeButton() {
  const store = useCollectionsStore();
  const armed = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-select-mode-toggle={armed ? "on" : "off"}
      aria-pressed={armed}
      title={
        armed
          ? "Stop selecting — clicks go back to opening and trimming"
          : "Select several items to act on them at once"
      }
      onClick={() => store.setMultiSelectMode(!armed)}
      className={cn(
        "h-8 shrink-0 gap-1.5 px-2 text-[11px] font-medium",
        "[@media(pointer:coarse)]:h-11",
        armed ? HEADER_TOGGLE_ACTIVE : HEADER_TOGGLE_IDLE,
      )}
    >
      <CircleCheck aria-hidden className="h-4 w-4" strokeWidth={1.7} />
      Select
    </Button>
  );
}

/**
 * The LEFT of the header row while a selection is being assembled — the
 * breadcrumb's place, taken over by the thing the user is actually doing.
 *
 * It replaces the breadcrumb rather than joining it, because the two say
 * different things about where you are: the trail answers "which collection am
 * I in", and in this mode the answer that matters is "what have I got". The
 * trail comes back the moment the selection empties, which is also the moment
 * it becomes useful again.
 *
 * It replaces only THAT. The row's right-hand cluster (`BoardViewControls`)
 * renders either way — this used to take the whole row, Preview and Select and
 * the project menu with it.
 *
 * NOT shown merely because the mode is armed. With nothing picked this would be
 * a row of dimmed verbs and a count of zero — it says nothing, and it would
 * take the trail away at the exact moment the user is still navigating to find
 * what they want. The mode's armed state lives on `SelectModeButton` until
 * there is something to show.
 *
 * The verbs are LABELLED here, unlike the icon-only cluster in the centre slot.
 * This row has the width for it and a different job: the centre cluster is
 * chrome you glance at beside a count, while this row IS the mode, and a mode
 * that has taken the breadcrumb's place should say what it can do in words.
 * They are still driven by the same action specs, so labels, icons, and when
 * each dims cannot drift from the anchor card's menu.
 *
 * No `✕` here. In the centre slot it does three jobs (cancel a cut, clear the
 * selection, clear the clipboard); in this mode Done covers the one that
 * matters, and the other two stay in the `⋮`. Two adjacent controls that both
 * end the gesture is how a mis-click becomes a surprise.
 */
/**
 * The verbs this row will show, IN THE ORDER THEY ARE DRAWN.
 *
 * Everything here is also in the `⋮`, which renders the full action list from
 * one definition — so promoting a verb is only ever a shortcut, never the only
 * way to reach it, and a verb pushed out by a narrow window is still one click
 * away rather than gone.
 */
const SELECT_MODE_VERBS: readonly GraphItemAction[] = [
  // EDIT IS NOT HERE. It acts on exactly one item, so in the one mode built for
  // picking several it is dimmed more often than not — a permanent slot in the
  // row spent on a verb that mostly cannot run, saying "one only" beside a
  // count that says otherwise. It stays in the full menu, where a single
  // selection reaches it in one click.
  "copy",
  "cut",
  "duplicate",
  "toggle-disabled",
  "delete",
];

/**
 * The order they SURVIVE in as the row narrows — first is kept longest.
 *
 * DELIBERATELY NOT the draw order. Dropping from the right would take Delete
 * first — the verb most worth keeping — while Cut stayed, which would be a
 * regression dressed up as responsiveness. Draw order is what reads well left
 * to right; this is what matters when there is not room for all of it.
 *
 * Must hold exactly the same members as SELECT_MODE_VERBS: the fit maths looks
 * each of these up by `indexOf` in that list, so a verb here and not there
 * measures as zero width and one there and not here is never drawn at all.
 */
const SELECT_MODE_VERB_PRIORITY: readonly GraphItemAction[] = [
  "delete",
  "duplicate",
  "copy",
  "cut",
  "toggle-disabled",
];

/** `gap-x-5`, as a number — the fit maths has to add the gaps back. */
const SELECT_MODE_VERB_GAP_PX = 20;

/**
 * How many verbs fit, measured rather than guessed.
 *
 * A RULER copy of the full run is rendered alongside the real one, invisible
 * and out of flow, and its children are what get measured. Measuring the real
 * run instead would be circular — hiding a verb changes the width you are
 * measuring, so the answer would depend on the previous answer and could
 * oscillate. The ruler always holds all of them, so its widths are stable.
 *
 * The budget is the container's own width, and the container is `flex-1
 * min-w-0`: its width comes from the row, never from its contents. That is what
 * keeps this a one-way calculation — nothing the hook decides can feed back
 * into the number it measured against.
 *
 * Re-measured on resize AND whenever the action state changes, because labels
 * are state-dependent: "Disable" becomes "Enable", and the counted labels grow
 * a number past one selected item.
 */
function useFittedVerbCount(
  state: ItemActionState,
): Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  rulerRef: RefObject<HTMLDivElement | null>;
  visible: ReadonlySet<GraphItemAction>;
}> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(SELECT_MODE_VERBS.length);

  useEffect(() => {
    const container = containerRef.current;
    const ruler = rulerRef.current;
    if (!container || !ruler) return;

    const measure = () => {
      const fullBudget = container.clientWidth;
      // 0 while the row is display:none (the browse header is showing) — keep
      // the last answer rather than collapsing to zero verbs and flashing them
      // all back in on the next frame.
      if (fullBudget === 0) return;
      const widths = Array.from(ruler.children).map((child) =>
        Math.ceil((child as HTMLElement).getBoundingClientRect().width),
      );
      // The ruler's last two children sit past every verb index — see the note
      // on them in SelectModeVerbRun.
      const overflowWidth = widths[SELECT_MODE_VERBS.length] ?? 0;
      // DONE IS ALWAYS DRAWN, so its width comes off the budget unconditionally
      // — before pass 1, unlike the `⋮`, whose cost depends on whether pass 1
      // needed it. It lives INSIDE this container (that is what puts it beside
      // Delete rather than an inch away at the end of the row), and the
      // container clips what does not fit, so a width nobody reserved is a way
      // out of select mode that disappears on a narrow window.
      const trailingWidth = widths[SELECT_MODE_VERBS.length + 1] ?? 0;
      // Plus the gutter BETWEEN the run and it, which the ruler's own wrapper
      // cannot show: the ruler measures the tail's controls and the gaps among
      // them, while the gap that separates the whole tail from the last verb is
      // the run's, and is only spent once the tail is drawn beside it.
      const budget = fullBudget - (trailingWidth > 0 ? trailingWidth + SELECT_MODE_VERB_GAP_PX : 0);

      // PASS 1 — does the whole run fit with NO `⋮` at all? Asked first, and
      // against the full budget, because when everything fits there is no
      // overflow control to make room for. Reserving its width unconditionally
      // is what used to push the last verb into a menu that then existed only
      // to hold the verb its own width had displaced.
      const wholeRun = SELECT_MODE_VERBS.reduce(
        (total, _action, index) =>
          total + (widths[index] ?? 0) + (index > 0 ? SELECT_MODE_VERB_GAP_PX : 0),
        0,
      );
      if (wholeRun <= budget) {
        setCount(SELECT_MODE_VERBS.length);
        return;
      }

      // PASS 2 — it does not fit, so the `⋮` IS going to be drawn, and it costs
      // width like anything else beside it. Two passes rather than one is what
      // keeps this one-way: the reserve depends on pass 1's answer and never on
      // its own, so it cannot oscillate between "fits" and "does not".
      const reduced = budget - overflowWidth - SELECT_MODE_VERB_GAP_PX;
      let used = 0;
      let fitted = 0;
      for (const action of SELECT_MODE_VERB_PRIORITY) {
        const index = SELECT_MODE_VERBS.indexOf(action);
        const width = widths[index] ?? 0;
        const next = used + width + (fitted > 0 ? SELECT_MODE_VERB_GAP_PX : 0);
        if (next > reduced) break;
        used = next;
        fitted += 1;
      }
      // At least one, even in a window too narrow for it: a row with a count
      // and no verbs at all reads as broken, and the `⋮` beside it still holds
      // everything it dropped.
      setCount(Math.max(1, fitted));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [state]);

  const visible = useMemo(
    () => new Set(SELECT_MODE_VERB_PRIORITY.slice(0, count)),
    [count],
  );
  return { containerRef, rulerRef, visible };
}

/** One labelled verb. Same spec data as the icon buttons, more room to say it. */
function SelectModeVerb({
  action,
  state,
}: Readonly<{ action: GraphItemAction; state: ItemActionState }>) {
  const spec = itemActionSpec(action);
  // VISIBLE text is uncounted; the ACCESSIBLE name keeps the count.
  //
  // The row already opens with "3 selected", so drawing "Cut 3 items · Copy 3
  // items · Delete 3 items" beside it said the same number four times. But a
  // screen-reader user arriving on the button by tab has not necessarily just
  // heard the count, and "Delete" alone does not say what it is about to
  // delete — so the name that is ANNOUNCED still carries it. Short label for
  // the eye, full label for the ear.
  const label = itemActionShortLabel(spec, state);
  const spokenLabel = spec.label(state);
  const reason = spec.unavailableReason(state);
  const disabled = spec.disabled(state);
  const icon = createElement(spec.icon(state), { "aria-hidden": true, className: "h-4 w-4" });
  const name = reason === null ? spokenLabel : `${spokenLabel}, ${reason}`;

  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      // `aria-disabled`, never `disabled` (R7.7/R12.4): a disabled button is
      // unfocusable and silent, so it can never deliver the reason it is off.
      aria-disabled={disabled || undefined}
      data-header-action={action}
      onClick={() => {
        if (disabled) return;
        requestGraphItemAction(action);
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded px-1 py-1.5 text-[13px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
        "[@media(pointer:coarse)]:py-3",
        disabled
          ? "cursor-not-allowed text-zinc-600"
          : action === "delete"
            ? // The one destructive verb reddens on approach rather than
              // sitting red — permanently red reads as already-dangerous and
              // stops being a warning.
              "text-zinc-400 hover:text-red-400"
            : "text-zinc-400 hover:text-zinc-100",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The fitted run of verbs, and the `⋮` holding whatever did not fit.
 *
 * ITS OWN COMPONENT so the row can leave it out entirely while a cut is
 * pending, where the breadcrumb takes the space instead. Branching around
 * `useFittedVerbCount` inside the header would be a conditional hook; lifting
 * the whole run out is what makes the swap legal, and it also stops the
 * measuring ResizeObserver from running for a row that is not drawn.
 */
function SelectModeVerbRun({
  state,
  /** Drawn at the END of the run and never dropped — Done. Passed in rather
   *  than rendered here so the run stays a run of verbs, and so the ARMED
   *  branch (which has no verb run at all) can place the same control itself. */
  trailing,
  /** The same markup as `trailing`, stripped of anything that identifies it,
   *  for the ruler to measure — see SelectModeTail's `measuring`. */
  trailingRuler,
}: Readonly<{
  state: ItemActionState;
  trailing?: React.ReactNode;
  trailingRuler?: React.ReactNode;
}>) {
  const { containerRef, rulerRef, visible } = useFittedVerbCount(state);
  // What the row could not draw — exactly the overflow menu's contents, taken
  // in DRAW order so the two halves of one list stay in one order.
  const hidden = useMemo(
    () => new Set(SELECT_MODE_VERBS.filter((action) => !visible.has(action))),
    [visible],
  );

  return (
    /* The verb run, and the ruler it is measured against. `flex-1 min-w-0`
       so the budget comes from the ROW rather than from the verbs — see
       useFittedVerbCount for why that direction matters. */
    <div
      ref={containerRef}
      data-select-mode-verbs={visible.size}
      className="relative flex min-w-0 flex-1 items-center gap-x-5 overflow-hidden"
    >
      <div
        ref={rulerRef}
        aria-hidden="true"
        inert
        data-select-mode-verb-ruler=""
        // Out of flow and invisible, but LAID OUT — `visibility: hidden`
        // keeps the boxes measurable where `display: none` would report
        // zero. Absolute so it cannot widen the container it is measured
        // against, and `inert` so a hidden run of buttons is not a set of
        // tab stops.
        className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-x-5"
      >
        {SELECT_MODE_VERBS.map((action) => (
          <SelectModeVerb key={action} action={action} state={state} />
        ))}
        {/* The `⋮`'s own width, MEASURED rather than assumed: it is 32px
            under a mouse and 44px under a finger (HEADER_SELECTION_SIZE), so
            a constant would reserve the wrong number on one of them and drop
            a verb early. Kept LAST, past every verb index, so the per-verb
            lookup by `indexOf` above is unaffected by its presence. */}
        <span data-select-mode-overflow-ruler="" className={cn(HEADER_SELECTION_SIZE, "shrink-0")} />
        {/* The TRAILING control's width, measured the same way and for the same
            reason — it is inside this container, so a width nobody reserved is
            a control the container clips. Kept last, past the `⋮`, so neither
            the per-verb lookup by `indexOf` nor the overflow index moves. */}
        <span data-select-mode-trailing-ruler="" className="flex shrink-0 items-center gap-x-5">
          {trailingRuler}
        </span>
      </div>
      {SELECT_MODE_VERBS.filter((action) => visible.has(action)).map((action) => (
        <SelectModeVerb key={action} action={action} state={state} />
      ))}
      {/* ONLY what did not fit, and only WHEN something did not fit.

          Inside the run, so it lands immediately after the last verb drawn
          rather than at the far end of the row's leftover space — the run is
          `flex-1`, so out here it floated an inch away from the verbs it
          belongs to. And absent entirely when all six fit: a `⋮` that is
          always there says the row is a summary of some longer list, which
          is what made the row's own verbs look decorative. Appearing only on
          overflow says the row IS the list and this is its remainder. */}
      {hidden.size > 0 ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${hidden.size} more selection ${hidden.size === 1 ? "action" : "actions"}`}
              data-header-selection-overflow
              data-select-mode-overflow-count={hidden.size}
              className={cn(HEADER_SELECTION_SIZE, HEADER_TOGGLE_IDLE, "shrink-0")}
            >
              <EllipsisVertical aria-hidden className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="center" className={SELECTION_MENU_CONTENT_CLASS}>
            <SelectionMenuOverflowItems
              parts={DROPDOWN_MENU_PARTS}
              state={state}
              actions={hidden}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {trailing}
      {/* THE SLACK GOES HERE, past everything, which is the whole reason the
          tail is inside this container at all.

          The run is `flex-1` because the fit maths needs its budget to come
          from the ROW rather than from its own contents (see
          useFittedVerbCount). That makes it the element that absorbs the row's
          leftover width — so a Done rendered OUTSIDE it lands at the far end of
          that leftover, an inch of empty space away from the Delete it is meant
          to sit beside. Measured at 280px on a 1280 viewport. Inside, with the
          slack explicitly BEHIND it, it stays put. Same fix, and the same
          reason, as the `⋮` above. */}
      <span aria-hidden="true" className="min-w-0 flex-1" />
    </div>
  );
}

/**
 * The row's right-hand cluster: what you are looking at, and the board-wide
 * controls that qualify it.
 *
 * RENDERED IN BOTH FACES OF THE HEADER. Select mode used to replace the whole
 * row, which took Preview, Select and the project `⋮` off screen for as long as
 * the mode was armed — so the control you had just pressed vanished from under
 * your cursor, and the way back out was a different button in a different
 * place. They stay put now, and `SelectModeButton` shows its pressed state for
 * the whole time the mode is on rather than only until the first card is
 * picked.
 */
function BoardViewControls({
  previewOn,
  onPreviewToggle,
  projectId,
  className,
}: Readonly<{
  previewOn: boolean;
  onPreviewToggle: () => void;
  projectId: string;
  className?: string;
}>) {
  return (
    <DragChromeFade className={cn("flex min-w-0 shrink-0 items-center justify-end gap-2", className)}>
              {/* SELECT leads what is left of this cluster. It used to lead as
                  a PAIR with the tag filter — the two controls that change how
                  you WORK with the board rather than what it contains — and
                  that pairing is gone deliberately: the filter moved down to
                  the controls row under the divider, with the rest of the
                  controls that qualify what the board shows. Select stays here
                  because it is the one that arms an ACTION, and the verbs it
                  arms (the centre cluster) are in this row.

                  The Collection tool, the children-timelines toggle and the
                  zoom slider all went down with the filter. What remains up
                  here is the row's original job: where you are, what you have
                  picked, and what you can do to it. */}
              {/* PREVIEW LEADS, Select follows. It was a tile in the icon
                  rail, which gave it prominence but put it a long way from the
                  board it opens over — and it is a VIEW toggle, which is what
                  this end of the row is for. Ungated by surface deliberately:
                  the pane plays the focused timeline in grid as well as strip,
                  so hiding it in grid would remove a working control.

                  Preview and Select are the two controls in this row that are
                  ALWAYS here — nothing about them is gated on surface or on
                  flat mode, which is exactly why the ruler pair went down to
                  the controls row and these did not.

                  Preview first because it is the icon in a pair whose other
                  half carries a WORD: leading with the labelled control pushed
                  the icon out to the fence, away from the icon toggles beyond
                  it, so the row read as a button with an ornament rather than
                  as one run of controls. */}
              <HeaderToggle
                active={previewOn}
                onToggle={onPreviewToggle}
                icon={TvMinimal}
                text="Preview"
                label={previewOn ? "Hide preview" : "Show preview"}
                title="Preview — play the focused timeline"
              />
              <SelectModeButton />
              {/* PROJECT `⋮`, immediately right of Select. Export and Load act
                  on the whole project and produce (or consume) a file, which is
                  a different question from the gear's set-once settings at the
                  end of the controls row — so it is a second menu rather than
                  two more items in that one. */}
              <GraphProjectMenu projectId={projectId} />
              <ControlFence />
              {/* Ruler and waveform used to sit here, behind a fence of their
                  own. They are down in the board's controls row now, beside
                  the zoom: all three qualify the strip's TIME AXIS, and this
                  row is where you are and what you can do to the selection.
                  They also came and went with flat mode, so this row's width
                  changed as you toggled it — the one place that cannot afford
                  it, since the breadcrumb trail measures its budget against
                  what is left. */}
              {/* Paste used to sit here, fenced between the view group and
                  history. It is in the CENTRE now, with copy and cut — the
                  three clipboard verbs read as one group, which is worth more
                  than the container-scoped grouping it had here. This cluster
                  keeps only what qualifies the board itself. */}
              <GraphUndoRedo />
              {/* The ACCOUNT is not here. It was briefly, after history — and
                  it went back to the bottom of the icon rail, where it can be
                  reached from the projects page too. This rail is in the root
                  layout; this header is not. */}
              {/* Board options are not here — they are the last control in the
                  board's own controls row under the divider, with the rest of
                  the chrome that qualifies the board rather than navigates
                  it. */}
            </DragChromeFade>
  );
}

function SelectModeHeader({
  anchorName,
  breadcrumb,
}: Readonly<{ anchorName: string | null; breadcrumb: React.ReactNode }>) {
  const store = useCollectionsStore();
  const state = useSelectionActionState();
  const { selectionCount } = state;

  // ARMED = the clipboard holds something, by Copy or by Cut. One state, one
  // job: choose where it lands.
  //
  // Keyed on the clipboard rather than on the pending cut, because a copy needs
  // the destination just as much — and on the COUNT rather than the selection,
  // because a cut clears the selection outright and a copy loses it as soon as
  // the user clicks into a collection to navigate. The clipboard is the only
  // thing that still knows how many items are in flight.
  const armedCount = useClipboardCount();
  const armed = useIsPickingDestination() && armedCount > 0;
  // Kept only to distinguish a cut from a copy for the tests and for anyone
  // reading the DOM: the row itself treats the two identically, because from
  // here on they want exactly the same things.
  const cutPending = usePendingCutCount() > 0;

  // Clear THEN disarm. The store keeps the mode armed through an empty
  // selection for this view (keepMultiSelectModeWhenEmpty), so the clear cannot
  // disarm it out from under this; the order is only about ending in one notify
  // rather than leaving the row briefly showing "0 selected" on its way out.
  //
  // Done also ABANDONS a pending cut. Leaving without pasting is the user
  // saying the move is not happening, and the alternative is worse than untidy:
  // the sources would stay dimmed on a board with no select row and — since the
  // `✕` that cancels a cut lives only in the BROWSE header — no obvious way
  // back to them. `clear()` drops the entries and the pending set in one
  // notify, which un-dims the sources in place; they never moved, so there is
  // nothing to put back.
  const leave = () => {
    graphClipboard.clear();
    store.clearSelection();
    store.setMultiSelectMode(false);
  };

  // PLACED BY EACH FACE, not by the row. It leads the verb run, where it is the
  // subject the verbs act on; while armed it FOLLOWS the breadcrumb, where the
  // trail is the subject and the count is what is in flight over it.
  const count = (
    <span
      data-select-mode-count={armed ? armedCount : selectionCount}
      // Mono and tabular so the row does not twitch sideways as the count
      // crosses 9 — this number changes on every tap, which is precisely the
      // moment a reflowing toolbar is most annoying.
      //
      // blue-500, the SAME step as the ring around a selected card
      // (`ring-2 ring-blue-500` in graph-item-content). This text is the count
      // of exactly those ringed cards, so matching the ring is what ties the
      // number to the thing it counts; blue-400 was a near-miss that read as a
      // third accent rather than the selection colour. `text-sm` (14px),
      // matching the breadcrumb trail it now sits beside — a count a pixel
      // smaller than the trail is exactly the kind of drift that makes the two
      // read as different toolbars.
      className="shrink-0 font-mono text-sm tabular-nums text-blue-500"
    >
      {armed ? armedCount : selectionCount} selected
    </span>
  );

  return (
    <div
      data-select-mode-header=""
      data-select-mode-armed={armed ? "" : undefined}
      data-select-mode-cut-pending={cutPending ? "" : undefined}
      // NOT `flex-wrap` any more. Wrapping was how this row coped with running
      // out of width, and it coped by growing taller — which is exactly what
      // the header must never do, now that both faces of it are pinned to the
      // same height. Verbs move into the `⋮` instead.
      className="flex min-w-0 flex-1 items-center gap-x-5"
    >
      {/* THE SWAP. Dimmed verbs are worse than absent ones here: after a cut
          all five are unavailable for the same reason, and the row still has
          to get the user somewhere. The breadcrumb takes the identical wing —
          `flex-1 min-w-0` either way — so nothing on either side of it moves.

          Its crumbs are also the up-a-level DROP targets, which is the other
          half of "where am I pasting this": the same row now answers it by
          click and by drag. */}
      {armed ? (
        <>
          <div
            data-select-mode-breadcrumb=""
            data-crumb-wing
            className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
          >
            {breadcrumb}
            {/* NO RULE between the trail, the count and Paste. All three are
                one statement — where you are, what you are holding, where it
                goes — and a rule inside a sentence reads as a full stop. The
                one rule left in this row is the one before Cancel, which is a
                real boundary: everything left of it continues the gesture.

                INSIDE THE WING, all of it, which is the same move Done makes
                into the verb run and for the same reason. The wing is `flex-1`
                because `useFittedAncestorCount` takes its budget from the
                wing's width — so it is the box that absorbs the row's leftover,
                and anything rendered outside it lands at the far end of that
                leftover rather than beside the breadcrumb it belongs to.

                No width reservation needed here, unlike Done's: that hook
                already computes its budget as the wing's width MINUS every
                child of the wing that is not the trail, so these take their
                room out of the crumbs' before the trail decides how many
                ancestors it can show. The slack falls after them on its own —
                a `justify-start` flex box leaves its leftover at the end. */}
            {count}
            <SelectModeTail
              anchorName={anchorName}
              armed={armed}
              cutPending={cutPending}
              onDone={leave}
            />
          </div>
        </>
      ) : (
        <>
        {count}
        <SelectModeVerbRun
          state={state}
          trailing={
            <SelectModeTail
              anchorName={anchorName}
              armed={armed}
              cutPending={cutPending}
              onDone={leave}
            />
          }
          trailingRuler={
            <SelectModeTail
              anchorName={anchorName}
              armed={armed}
              cutPending={cutPending}
              onDone={leave}
              measuring
            />
          }
        />
        </>
      )}
      {/* NO right-hand cluster here any more. Preview, Select, the project `⋮`
          and undo/redo render OUTSIDE this component, from the header row
          itself, in both of its faces — so they keep their positions when the
          mode is armed instead of being taken away and put back. */}
    </div>
  );
}

/**
 * What ends the gesture: Paste when there is something to paste, then Done.
 *
 * DONE SITS BESIDE DELETE NOW, one fence away, which is a deliberate reversal.
 * It used to take `ml-auto` to the far end of the row on the argument that two
 * controls which both end the gesture — one of them destructive — should not be
 * shoulder to shoulder. The fence is what replaces that distance: it still
 * reads as a separate group, and the way out is now where the rest of the
 * selection controls are rather than adrift at the end of a row whose other end
 * is a full cluster of unrelated buttons.
 *
 * `measuring` renders the same boxes for the ruler to size and NOTHING that
 * identifies them — no `data-select-mode-done`, no `data-header-paste`, no
 * handlers. The ruler is a second copy of this markup living inside the same
 * row, and a second element answering to either locator is a strict-mode
 * failure in every test that reaches for one.
 */
function SelectModeTail({
  anchorName,
  armed,
  cutPending,
  onDone,
  measuring = false,
}: Readonly<{
  anchorName: string | null;
  armed: boolean;
  cutPending: boolean;
  onDone: () => void;
  measuring?: boolean;
}>) {
  return (
    <>
      <HeaderPasteButton anchorName={anchorName} measuring={measuring} />
      <ControlFence />
      <button
        type="button"
        data-select-mode-done={measuring ? undefined : ""}
        title={
          armed
            ? cutPending
              ? "Cancel the cut and leave the items where they are"
              : "Cancel — discard what was copied"
            : "Finish selecting"
        }
        onClick={measuring ? undefined : onDone}
        // The verb run's own box, class for class — so it shares their
        // baseline, their hit area and their coarse-pointer growth rather than
        // setting a second standard next to them. It was a `text-sm
        // font-medium` pill in an `h-8` zinc-700 outline, which was right while
        // it lived alone at the far end of the row and had nothing to agree
        // with; beside Delete it read as a dialog's confirm button that had
        // wandered into a toolbar. Shorter than that `h-8`, which cannot cost
        // the row height: Preview, Select and the `⋮` opposite are all still
        // `h-8` and the two faces of the header stay pinned to one height.
        //
        // What separates it now is the rule to its left and its INK: the verbs
        // idle at zinc-400 and brighten on hover, this one idles at zinc-100.
        // Same shape, same type, more weight of colour — the quiet version of
        // the distinction the outline was making loudly.
        //
        // No `ml-auto`: the slack is absorbed inside the verb run, PAST this,
        // which is what keeps it beside Delete.
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded px-1 py-1.5 text-[13px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
          "[@media(pointer:coarse)]:py-3",
          "text-zinc-100 hover:text-white",
        )}
      >
        {/* NO ICON, unlike every verb beside it. A tick was tried and taken
            back out: the verbs' glyphs each name an ACTION, and a tick beside
            the way out reads as confirming something. The word alone is what
            distinguishes leaving from acting, now that the two share a box. */}
        {/* CANCEL while armed. The button does the same thing either way —
            clear the clipboard, drop the selection, leave the mode — but the
            word has to match what the user is walking away from. "Done" over a
            half-finished paste reads as "commit it", which is the opposite. */}
        {armed ? "Cancel" : "Done"}
      </button>
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
 * The controls row's two ADD tools.
 *
 * They replace a single "Add item" button that asked which kind in a menu, and
 * before that a Collection-only tool with no media route at all — media could
 * only be added at the very end of a surface (the trailing slot) or by dragging
 * in from the OS. The menu was a step that existed because one control had to
 * serve two jobs; two controls answer the question by being two controls.
 *
 * CLICK appends to the end. DRAG places at the spot you let go. Both tools, the
 * same two gestures — which is the whole reason for the pair.
 *
 * Appending is itself a change from the ORIGINAL collection tool, which landed
 * next to the SELECTION via `resolveInsertPlacement`: a rule that reads well
 * from a sidebar palette and poorly from a control sitting directly above the
 * board, where "add one" plainly means "at the end of this". That rule is alive
 * and still tested — PASTE uses it, which is where landing beside what you
 * picked is unambiguously right.
 *
 * The work happens in `useNativeDrop`, inside the drop surface BELOW this row:
 * that is where the mint-and-insert and the upload pipeline live, and context
 * does not flow upward, so the click path crosses down by ADDRESSED event. See
 * GRAPH_ADD_ITEM_EVENT for why addressed and not broadcast.
 */
function BoardAddTools({
  collectionId,
  flatOn,
  onLeaveFlat,
}: Readonly<{ collectionId: string; flatOn: boolean; onLeaveFlat: () => void }>) {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <ToolButton
        testId="collection"
        label="Collection"
        payload="collection"
        icon={Layers}
        title="Collection — click to add one at the end, or drag onto the board to place it"
        onActivate={() => {
          requestGraphAddItem({ collectionId, kind: "collection" });
          // LEAVE FLAT MODE, because otherwise this looks like it did nothing.
          //
          // A flat run is every MEDIA item in the closure, in order. A new
          // collection is empty, so it contributes none and the board does not
          // change by a pixel — the item really is there, and the only sign of
          // it is a row in the children tree, which is off by default.
          // Measured: board cards 11 to 11, sub-timeline rows 6 to 7.
          //
          // Which makes a real add indistinguishable from a dead button.
          // Switching the view is the smaller surprise: they asked for a
          // collection, so put them where collections exist.
          //
          // Only for COLLECTIONS — media appears in a flat run immediately, so
          // there is nothing to explain and no reason to move anybody's view.
          if (flatOn) onLeaveFlat();
        }}
      />
      <ToolButton
        testId="media"
        label="Media"
        payload={MEDIA_TOOL_PAYLOAD}
        icon={ImageIcon}
        title="Media — click to browse and add at the end, or drag onto the board to place what you pick"
        onActivate={() => mediaInputRef.current?.click()}
      />
      {/* The CLICK path's picker. It lives here, in the button's own tree, so
          the picker opens inside the click that asked for it and user
          activation is never in question. The DRAG path cannot borrow this one:
          its files have to land at a PARKED position that only the surface
          knows, so it carries a picker of its own (see MediaDropTarget). */}
      <input
        ref={mediaInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        tabIndex={-1}
        aria-hidden="true"
        data-add-media-end-input
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Reset BEFORE handing off, so picking the same file twice running
          // fires `change` again — the input compares against its own value.
          event.target.value = "";
          if (files.length > 0) requestGraphAddItem({ collectionId, kind: "media", files });
        }}
      />
    </>
  );
}

/**
 * Renders its children only once the preview has finished opening.
 *
 * WHY THE RAILS WAIT. They are the last thing to appear when the preview comes
 * up, and they were appearing DURING the slide — a fresh paint over the board
 * while the board is still travelling, which is the flicker in the grey area
 * under a pane that has not landed yet. A height animation runs on the main
 * thread, so this is not two things happening at once so much as one thing
 * interrupting the other.
 *
 * It has to be its own component because the signal is a context published
 * INSIDE the split pane, and the board's rails are rendered from a scope above
 * that provider. Reading it here puts the question where the answer is.
 *
 * Nothing is lost by waiting: these are controls for a pane you cannot use
 * until it has opened anyway.
 */
function AfterPreviewOpens({ children }: Readonly<{ children: React.ReactNode }>) {
  return usePreviewSettled() ? <>{children}</> : null;
}

export function GraphBoard({
  projectId,
  focusedId,
  breadcrumb,
  surface,
  itemSize,
  onItemSizeChange,
  clipNamesShown,
  onClipNamesChange,
  playbarThumbnails,
  onPlaybarThumbnailsChange,
  playbarThumbnailStyle,
  onPlaybarThumbnailStyleChange,
  pixelsPerSecond,
  onPixelsPerSecondChange,
  previewOn,
  onPreviewToggle,
  rulerOn,
  onRulerToggle,
  waveformOn,
  onWaveformToggle,
  flatOn,
  flatLoading,
  onFlatToggle,
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
  /** Whether clip cards stamp their name over the artwork — the board menu's
   *  toggle, off by default. Published to the cards as a context rather than
   *  threaded down; see `graph-clip-names.tsx`. */
  clipNamesShown: boolean;
  onClipNamesChange: (shown: boolean) => void;
  /** Whether the play bar in the details view draws each clip's first frame
   *  rather than a grey box. Published as a context; see
   *  `graph-playbar-thumbnails.tsx`. */
  playbarThumbnails: boolean;
  onPlaybarThumbnailsChange: (shown: boolean) => void;
  playbarThumbnailStyle: PlaybarThumbnailStyle;
  onPlaybarThumbnailStyleChange: (style: PlaybarThumbnailStyle) => void;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pixelsPerSecond: number) => void;
  /** The preview pane above the board. The board renders it AND carries its
   *  toggle now, in the header beside Select. The window-event bus still
   *  reaches the same state (the
   *  pane's own close button and the WebMCP `set_preview` tool arrive that
   *  way), so this prop is a second caller rather than a replacement. */
  previewOn: boolean;
  onPreviewToggle: () => void;
  /** The strip's time ruler. Its toggle lives in the board's CONTROLS row now
   *  — under the divider, beside the zoom — and only mounts in flat mode, so
   *  the board both renders the state and asks for the change. */
  rulerOn: boolean;
  onRulerToggle: () => void;
  /** The waveform lane, on the same gate and in the same group as the ruler. */
  waveformOn: boolean;
  onWaveformToggle: () => void;
  /** Strip's flat mode: render the whole closure in order, not this
   *  collection's direct children. */
  flatOn: boolean;
  /** The closure is still loading. Strip-only, like `flatOn` itself. */
  flatLoading: boolean;
  onFlatToggle: () => void;
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
  // MEMOISED: a fresh function each render would be a new prop on every
  // VirtualGrid render, for a value that only depends on the channel.
  const playButtonCell = useMemo(
    () => (previewOn ? gridPlayButtonFor(timeChannel) : undefined),
    [previewOn, timeChannel],
  );
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

  // LANE ROWS. The picture (lane 0) keeps the virtualizer; everything on a
  // higher lane draws as its own time-aligned row under it, so a bed visibly
  // spans the shots it plays beneath instead of sitting in the queue after
  // them.
  //
  // Null unless there is actually something on a lane, and the strip's lane
  // paths are gated on the props being present — so an ordinary board renders
  // exactly as it did before lanes existed, down to the DOM.
  //
  // Off in FLAT mode: a flat run spans many parents, so a card's lane would
  // have to come from the manifest's lane-from-root rather than the local
  // detail entry — a second lane source, and one this does not need.
  const detailsSnapshot = useGraphDetailsSnapshot();
  const laneRows = useMemo(() => {
    if (flatOn) return null;
    // The snapshot's type widens `DetailsById`'s values to `| undefined`;
    // every read below already treats a missing entry as absent.
    const model = splitLaneRows(graph, detailsSnapshot as DetailsById, focusedId);
    // NOT gated on there being a layer. Supplying the clock is what turns
    // placement on, and a board with nothing layered still needs somewhere to
    // make the FIRST lane — otherwise the only route is a tool call. With an
    // empty `layers` the strip draws no rows and its DOM is unchanged; it just
    // offers a target while a drag is live.
    return {
      itemIds: model.pictureIds.map(parseNodeId),
      itemTimes: model.pictureTimes,
      layers: model.layers.map((layer) => ({
        items: layer.items.map((item) => ({
          id: parseNodeId(item.id),
          startSeconds: item.startSeconds,
          durationSeconds: item.durationSeconds,
        })),
      })),
    };
  }, [flatOn, graph, detailsSnapshot, focusedId]);

  // PLACEHOLDERS FOR THE HYDRATION GAP. Drilling into a collection navigates
  // at once, but its clips arrive on a fetch — so the surface is empty for a
  // beat and the user is looking at nothing, with no signal that anything is
  // on its way. The stored summary already knows how many are coming, so the
  // placeholder row can be the right LENGTH and the surface does not jump when
  // they land. All the edge cases (a stored zero, a corrupt count, a
  // re-hydration with cards still mounted) live in the pure rule.
  //
  // Subscribed narrowly: only the child COUNT, so the ordinary case — a
  // hydrated collection whose children change — re-renders this on a number,
  // not on the children array's identity.
  const focusedChildCount = useCollectionsSelector(
    (s) => s.graph.childrenById.get(parseNodeId(focusedId))?.length ?? 0,
  );
  const focusedDetail = detailsSnapshot[focusedId];
  const skeletonCount = hydrationSkeletonCount({
    hydrated: focusedDetail?.hydrated,
    itemCount: focusedDetail?.itemCount,
    renderedChildren: focusedChildCount,
  });

  // The pill renders itself, inside whichever card is the anchor. What the
  // board still needs the anchor for is the header's paste label, which names
  // the destination.
  const anchorId = useSelectionAnchorId();
  const anchorName = useCollectionsSelector((s) =>
    anchorId === null ? null : (s.graph.nodesById.get(anchorId)?.name ?? null),
  );

  // Which face the header row wears. Two conditions now:
  //
  //   the mode is armed  — this row belongs to select mode, nothing else.
  //   nothing is dragging — the ancestor crumbs ARE the "move up a level" drop
  //                        targets (see GraphBreadcrumb), and a multi-drag out
  //                        of a selection is precisely when someone reaches for
  //                        them. Hiding the trail mid-drag would delete the
  //                        drop target the user is already aiming at. The
  //                        selection bar has nothing to offer during a drag
  //                        anyway — DragChromeFade fades the rest of the chrome
  //                        for the same reason.
  //
  // There used to be a third — `selectionSize > 0` — on the reasoning that an
  // empty selection has nothing to report, so taking the trail away while the
  // user is still navigating to find their items was backwards. It is dropped
  // deliberately: pressing Select is the user SAYING they are about to pick
  // things, and a mode that shows no sign of itself until the first item lands
  // reads as a button that did nothing. The row at zero is not empty either —
  // it says "0 selected" and offers Done, which is the way back out.
  // A THIRD condition now: an armed clipboard keeps the row up on its own.
  //
  // Copy and Cut both leave multi-select, so the board can be navigated to a
  // destination — checkboxes off, a click opens a collection again. That would
  // have taken this row down with it, and the row is exactly what the user
  // still needs: the count, the breadcrumb, Paste, and the way to cancel. So
  // the row outlives the flag, and the two halves of the gesture are split —
  // the flag governs the CARDS, the clipboard governs the HEADER.
  const multiSelectMode = useCollectionsSelector((s) => s.interaction.multiSelectMode);
  const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
  const pickingDestination = useIsPickingDestination();
  const selectModeRow = (multiSelectMode || pickingDestination) && !isDragging;

  return (
    <OpenKeyBoundary trashId={trashRootId}>
      {/* Spans the header AND the surfaces: the toolbar toggle sets the mode,
          the selected card's panel reads it. */}
      <ItemDetailsProvider>
      {/* Spans the header AND the surfaces for the same reason: the toggle
          that sets it lives in the header's menu, and every card that reads it
          is below. */}
      <PlaybarThumbnailsProvider shown={playbarThumbnails} style={playbarThumbnailStyle}>
      <ClipNamesProvider shown={clipNamesShown}>
      {/* Spans the surfaces AND the child rows below them, because the pairing
          it carries joins the two: a collection's card up here and its row
          down there light each other up on hover. Inert unless the children
          tree is actually shown — with it off there is no row to pair with. */}
      <CollectionHoverProvider enabled={childrenShown}>
      {/* Published ABOVE the preview shell so the header aggregate and every
          time overlay inside it measure the run actually on screen. */}
      <TagFilterProvider>
      <FlatItemsProvider items={flatItems}>
      <PreviewShell
        enabled={previewOn}
        focusedId={focusedId}
        channel={timeChannel}
        /*
         * TOP of the sticky stack, above the preview rather than below it.
         *
         * It used to render with the surfaces and pin itself beneath the
         * preview via `--workbench-preview-offset`. It cannot reach above the
         * preview from there — a sticky element will not rise past the top of
         * its containing block — so it moved into the pane's own `header`
         * slot, which renders before the surface. The pane measures it and
         * pins the surface underneath; nothing here sets `top` any more.
         *
         * The opaque background stays load-bearing twice over: it reads as a
         * toolbar, and it OCCLUDES the strip/grid scrolling underneath, which
         * is what stops a playhead marker from bleeding up into the breadcrumb
         * row. The z-index moved to the pane wrapper (z-50, above the
         * surface's z-40, above the strip's z-30 overlay).
         */
        header={
          <div
            data-graph-board-header=""
            data-header-mode={selectModeRow ? "select" : "browse"}
            className={cn(
              // No `sticky`/`z`/`top` here any more — the pane's header
              // wrapper owns all three. Leaving a second sticky context
              // nested inside that one pinned this row against ITSELF and it
              // stopped tracking the wrapper.
              //
              // No margin below it either: the row meets the preview directly,
              // and the divider owns the clearance on both of ITS sides. An
              // 8px gap here (restoring what the board column's `gap-2` used
              // to give this row) was tried and removed — it bought nothing
              // visually and only existed to keep one trim-frame assertion off
              // its clamp.
              "min-w-0 items-center gap-x-3 border-b border-zinc-800/70 bg-zinc-950/95 py-3 backdrop-blur-sm",
              // The browse row is a three-column grid so the aggregate sits at
              // the row's TRUE centre whatever the wings contain. The select row
              // has no centre to hold — it is one group that reads left to right
              // and ends with Done — so it is a plain flex row rather than a
              // grid with two empty tracks.
              selectModeRow
                ? "flex"
                // The RIGHT column may not shrink below its content.
                //
                // Equal `1fr` sides are what centre the middle cluster, and
                // `minmax(0,1fr)` lets both collapse to nothing to keep them
                // equal. The right column holds real controls, so collapsing
                // it does not shrink them — with `justify-end` its content
                // overflows LEFTWARD, out of the column and underneath the
                // breadcrumb, which then takes the pointer. At 420px the
                // cluster's leading control sat under "Rename E2E Project":
                // visible, enabled, and unclickable.
                //
                // `min-content` as the floor buys symmetry where there is room
                // for it — both columns are 1fr at any ordinary width — and
                // gives it up only when the alternative is a control nobody
                // can press. The breadcrumb absorbs the difference, which is
                // what its `min-w-0` and `truncate` are for.
                //
                // Long latent, and only ever fatal to whichever control leads
                // the cluster, so it surfaced when the preview toggle moved to
                // the front of it.
                : "grid grid-cols-[minmax(0,1fr)_auto_minmax(min-content,1fr)]",
            )}
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
            {/* The save state TRAILS the trail: "where am I" and "how is it
                doing" are one line, and it costs nothing when there is nothing
                to report. It used to take over the centre slot, which meant
                every debounce blanked the selection count and the controls
                beside it — a status that hides live controls is the wrong
                shape. It stays outside DragChromeFade with the breadcrumb,
                because a save landing mid-drag is still worth seeing. */}
            {selectModeRow ? (
              <>
                <SelectModeHeader anchorName={anchorName} breadcrumb={breadcrumb} />
                {/* The SAME cluster the browse row ends with, in the same place.
                    Select mode changes what the LEFT of the row is doing; it
                    has never had a reason to change what the right of it
                    offers. */}
                <BoardViewControls
                  previewOn={previewOn}
                  onPreviewToggle={onPreviewToggle}
                  projectId={projectId}
                />
              </>
            ) : (
              <>
            {/* `data-crumb-wing`: the box whose width the trail measures
                itself against. The trail is content-width on purpose, so it
                cannot read its own budget — see useFittedAncestorCount. */}
            <div data-crumb-wing className="flex min-w-0 flex-1 items-center gap-3">
              {breadcrumb}
              <GraphSaveStatus />
              {/* Beside the save status, and for the same reason it sits here:
                  "where am I / how is it doing" reads as one line, and both
                  take no space when they have nothing to say. Renders are
                  started from the MCP tools rather than from this board, so
                  without this the only sign one had finished was a card
                  appearing in Renders. */}
              <GraphRenderStatus timelineId={projectId} />
              {/* The render FORMAT used to sit here too, reading "16:9 · 720p".
                  It moved into the board's settings menu: its neighbours above
                  are transient — they appear when there is something to say and
                  take no room otherwise — while the format is a standing fact,
                  so it was the one thing in this row permanently occupying
                  space for a setting you change once a project. */}
            </div>
            {/* Middle summary and the right-hand controls fade out under the
                drag readout that overlays this row, and fade back on drop. The
                breadcrumb stays — it IS the drop target. */}
            <DragChromeFade className="flex items-center">
              <SelectionSummary />
              <SelectionCentreControls anchorName={anchorName} />
            </DragChromeFade>
            {/* NO `flex-wrap`, despite what this comment used to claim: the
                header's two faces are pinned to one height, so a cluster that
                folded onto a second line would take the whole row — and the
                board pinned beneath it — with it. Narrow viewports are
                answered by moving controls OUT (the row under the divider now
                carries four of them) rather than by wrapping. */}
            <BoardViewControls
              previewOn={previewOn}
              onPreviewToggle={onPreviewToggle}
              projectId={projectId}
            />
              </>
            )}

            {/* The trash drop target (right side), shown only while a card is
                being dragged. The "move up a level" targets are the ancestor
                breadcrumb crumbs themselves (see GraphBreadcrumb). Inside the
                header so its absolute layer positions against it; inside the
                provider so its droppable joins the DndContext. */}
            <BreadcrumbDropZones trashId={trashRootId} />
          </div>
        }
      >
        {/* Also outside it (PL10-012): details are not a strip idea. A grid
            card has no trim handles, but it has a name, a duration, and
            whatever an item grows next — so it opens the same view. The modal
            portals to the body, so where it mounts only decides which
            providers it can see. */}
        <GraphItemDetailsModal />
        {/* The "?" sheet. Every gesture in this view is invisible otherwise —
            hold-to-drag, O, F2, the whole Alt layer (PL11-007). */}
        <GraphShortcuts />
        {/* NO top padding here, deliberately. This column sits directly under
            the divider, so anything added at its top is read as space below
            the divider band — which broke the band's symmetry: 10px above it
            (inside the divider box) against 10 + 8 below.
            The divider owns the clearance on BOTH of its sides now, which is
            the only way the two can be equal by construction. */}
        <div className="flex flex-col gap-2">
          {/* THE BOARD CONTROLS ROW: what is in front of you, and the controls
              that qualify it. Under the divider, directly above the surface it
              describes.

              Everything here came down out of the breadcrumb row, which was
              carrying two unrelated jobs at once — WHERE AM I (the trail, the
              save state, the selection and its verbs) and WHAT AM I LOOKING AT
              (the totals, the filter, the tree toggle, the zoom). The second
              job belongs next to the board, not in the navigation bar above
              it, and splitting them is also what buys the trail the room to
              grow: the breadcrumb row had run out of width for anything to be
              bigger than 11px.

              Deliberately NOT sticky, unlike the header. These qualify the
              surface you are scrolled to, and the header already owns the
              sticky budget the preview pane measures itself against.

              `DragChromeFade` for the same reason the header's clusters have
              it: while a card is in the air this is chrome in the way, and the
              surface below is the thing that matters. It is a plain opacity
              wrapper keyed on `isDragging`, so it carries no positioning of
              its own and works as well here as in the header. */}
          {/* ONE PANEL: the qualifying row and the surface it qualifies.
              They were two boxes eight pixels apart — the row in a rounded,
              ringed box of its own, the surface with no edge at all — so the
              controls read as a floating strip and the board as loose cards
              behind it, when the row describes exactly the thing below it.

              The row keeps its padding but loses its own ring and fill; the
              hairline under it is FULL-BLEED to the panel's edges, which is
              what makes it read as a division WITHIN one surface rather than
              as the top of a second one. Nothing here is sticky: the row is
              part of the panel and scrolls with it (it was already not sticky
              — the sticky budget belongs to the breadcrumb header above, which
              the preview pane measures itself against).

              HUGS ITS CONTENT rather than filling the viewport, so the bottom
              edge closes under the last row of cards.

              Child timeline rows stay OUTSIDE it. They are other timelines,
              each already framed as its own section; pulling them in would
              make one panel that claims to be the focused board and is not. */}
          {/* LIGHTER than the page, not darker. `bg-black/20` was the first
              try and it went the wrong way: the page is already zinc-950
              (rgb 9,9,11), so darkening it further reads as a hole rather than
              as a surface, and the ring ends up doing all the work. A raised
              panel is how every other grouped surface in this app is drawn —
              the rail, the menus — and it is what the mockup shows. */}
          <div
            data-board-panel
            // TINTED WHILE SELECTING, panel and all — the toolbar row with the
            // counts and the tools, and the surface under it, are one thing and
            // the mode applies to both.
            //
            // Barely there on purpose: this is the ambient half of the signal,
            // saying "you are in a different mode" from the corner of the eye
            // while the cards' faint rings say which things the mode acts on.
            // A tint you actually notice competes with the artwork, which is
            // what the board is for, and a board that changes colour to tell
            // you something about the pointer has its priorities backwards.
            //
            // Transitioned, so arming the mode reads as the surface shifting
            // rather than repainting.
            className={[
              "overflow-hidden rounded-xl ring-1 transition-colors duration-200",
              multiSelectMode
                ? "bg-sky-950/25 ring-sky-400/20"
                : "bg-zinc-900/60 ring-white/10",
            ].join(" ")}
          >
          <DragChromeFade>
            {/* The marker sits here rather than on DragChromeFade, which takes
                only `className` and `children` — it is a behaviour wrapper, not
                a div with extra steps, and widening it to pass arbitrary props
                through would invite exactly that. */}
            {/* THE PANEL'S HEADER, not a box of its own.
                It used to carry `rounded-md bg-black/40 ring-1 ring-white/5`
                — a rounded, filled, ringed band, inset by its own padding,
                sitting eight pixels above a surface with no edge. That treated
                it as an object, which is precisely why it read as detached
                from the thing it describes.

                Inside the panel it needs none of that: the panel supplies the
                edge and the fill, so all this row owns is a FULL-BLEED
                hairline beneath it. Full-bleed matters — a rule inset from the
                panel's sides would draw a smaller box inside a bigger one and
                put the seam back. */}
            {/* THREE COLUMNS, not a flex run: the totals sit in the MIDDLE of
                the row, and "middle" has to mean the row's centre rather than
                whatever falls out of the two clusters' widths. A flex row with
                `mx-auto` on the readout centres it in the LEFTOVER space, so
                it would drift every time a control came or went — and half the
                controls here are gated on surface or flat mode, so it would
                drift constantly.

                `minmax(min-content,1fr)` on both sides, NOT `minmax(0,1fr)`.
                Equal 1fr columns are what put the auto middle dead centre; the
                `min-content` floor is what stops a column being handed less
                than its controls need and clipping them. This exact swap has
                already been made once in the breadcrumb header above, after a
                `minmax(0,1fr)` column started before its own content did. When
                the sides genuinely cannot fit, centring yields first — that is
                the intended order. */}
            <div
              data-board-controls-row
              // WRAPS when it cannot fit, three columns when it can.
              //
              // The row needs ~648px of content. Below roughly an 800px
              // viewport the three columns overflow the panel, and every way of
              // absorbing that inside one line is worse than a second line:
              // clipping the sides would cut off the Add item and filter menus,
              // which are absolutely positioned INSIDE those columns; letting
              // the columns shrink puts their `shrink-0` contents on top of
              // each other again; and `overflow-x-auto` on the row would
              // establish a scroll container that clips those same menus
              // vertically.
              //
              // Wrapping is available here in a way it is not one row up: the
              // breadcrumb header is pinned to a single height that the preview
              // pane measures itself against, and this row is deliberately not
              // sticky and measured by nothing.
              className="flex min-h-7 flex-wrap items-center gap-3 border-b border-white/10 px-3 py-2 lg:grid lg:grid-cols-[minmax(min-content,1fr)_auto_minmax(min-content,1fr)]"
            >
              {/* LEFT COLUMN — WHAT THE BOARD IS MADE OF. Two fenced groups:
                  the one control that ADDS to it, then the toggles that change
                  its shape.

                  ADD LEADS. It is the only control in the row that writes, and
                  the only one that is a verb rather than a view — so it opens
                  the row rather than trailing the switches. It also carries the
                  row's only label, and a labelled control reads as the start of
                  a run far better than as something wedged after two glyphs.

                  `min-w-0` on the flex box inside the column, so its own
                  children may compress. The column's `min-content` floor
                  governs how far that can go. */}
              <div className="flex min-w-0 items-center gap-2">
                <BoardAddTools
                  collectionId={focusedId}
                  flatOn={flatOn}
                  onLeaveFlat={onFlatToggle}
                />
                {/* Extra room on the LEFT only. The row's `gap-2` is measured
                    between boxes, and the two tool buttons carry a drag grip
                    inside theirs — so the gap that reads as generous between
                    two glyph toggles reads as cramped where a labelled button
                    with a grip meets a rule. The asymmetry is the point: this
                    fence separates a written verb from a run of view toggles,
                    and the space belongs on the side with more in it. */}
                <ControlFence className="ml-1" />
                {/* HOW THE BOARD IS STRUCTURED. Two toggles that change the
                    shape of what is drawn, not its contents: whether this run
                    is grouped into its collections, and whether the nested
                    timelines draw below it. */}
                {/* INVERTED against the state it drives. The strip opens flat
                    (see `flatOn`'s default), so the thing left to offer is the
                    nesting, and `active` is `!flatOn` — pressed means you have
                    left the flat run for the collections. Writing it the other
                    way round would give the strip a control that is lit on
                    arrival and whose job is to turn itself off.

                    Strip only: grid keeps its nesting, so there is nothing to
                    flatten there. */}
                {surface === "strip" ? (
                  <HeaderToggle
                    active={!flatOn}
                    onToggle={onFlatToggle}
                    // `Layers` — the SAME glyph the collection mark uses in
                    // the middle of every collection thumbnail (see
                    // `data-collection-mark` in graph-collection-card). The
                    // control that gives you the collections back should wear
                    // the sign that marks one.
                    icon={Layers}
                    busy={flatLoading}
                    label={flatOn ? "Show collections" : "Show all items in order"}
                    title="Collections — group the run back into its collections. Flat, everything is in order and reordering is off."
                  />
                ) : null}
                <HeaderToggle
                  active={childrenShown}
                  onToggle={onChildrenToggle}
                  icon={FolderTree}
                  label={childrenShown ? "Hide children timelines" : "Show children timelines"}
                  title="Children timelines — show the nested timeline tree"
                />
                {/* NO trailing fence. A fence is the edge BETWEEN two groups,
                    and there is nothing after this one — the column ends here.
                    One was briefly left behind when Add item moved to the front
                    of the row, drawing a line against empty space. */}
              </div>

              {/* CENTRE COLUMN — WHAT THE BOARD AMOUNTS TO. One readout, and
                  the only thing in this row that is a statement rather than a
                  control, which is why it gets the middle to itself.

                  `justify-center` inside an `auto` column is belt and braces:
                  the column is already exactly its content's width. It matters
                  the moment anything joins the readout here.

                  `min-w-0 overflow-hidden` IS NOT decoration — it fixes a real
                  bug this grid introduced. On a narrow viewport the three
                  columns cannot all fit; the sides hold their `min-content`
                  floors, so CSS squeezes the flexible `auto` track instead —
                  measured at 30px against a 91px readout. The readout is
                  `shrink-0`, so it kept its full width and, being centred,
                  overhung its own column by 30px on EACH side, landing on top
                  of the buttons either way. Not a cosmetic overlap: it
                  intercepted their pointer events, and at 560px the children
                  toggle became unclickable. Flex children cannot do this to
                  each other, which is why the old flex row never could.

                  Clipping is the right thing to lose first. Everything either
                  side is a control; this is the one thing in the row you only
                  read. */}
              <div className="flex min-w-0 items-center justify-center overflow-hidden">
                <FocusedAggregate
                  focusedId={focusedId}
                  pixelsPerSecond={deferredPixelsPerSecond}
                />
              </div>

              {/* RIGHT COLUMN — THE TIME AXIS, then what qualifies the totals.
                  `justify-end` rather than `ml-auto` on a child: this is a
                  grid cell, so the cluster is pinned to the column's right
                  edge and stays there even when the aggregate in the middle
                  renders nothing (an empty timeline). */}
              <div className="flex min-w-0 items-center justify-end gap-2">
                {/* THE TIME AXIS: ticks, peaks, and the scale all three are
                    measured at. Ruler and waveform came down out of the
                    breadcrumb row to join the zoom that was already here.

                    Gated as ONE unit on `surface === "strip"`, INCLUDING the
                    fence that closes it — a separator is the edge of a group,
                    so it has to come and go with the group it edges or it is
                    just a stray line beside the filter in grid mode.

                    The fence is gated on strip rather than on flat because the
                    zoom is the member always present in a strip, so this group
                    can thin to the slider but never empty while the fence is
                    drawn. Ruler and waveform sit behind the narrower FLAT gate
                    inside it — both draw against a single continuous time
                    axis, which only the flat run is. */}
                {surface === "strip" ? (
                  <>
                    {flatOn ? (
                      <>
                        <HeaderToggle
                          active={rulerOn}
                          onToggle={onRulerToggle}
                          icon={Ruler}
                          label={rulerOn ? "Hide time ruler" : "Show time ruler"}
                          title="Time ruler — tick marks over every strip"
                        />
                        <HeaderToggle
                          active={waveformOn}
                          onToggle={onWaveformToggle}
                          icon={AudioLines}
                          label={waveformOn ? "Hide audio waveform" : "Show audio waveform"}
                          title="Audio waveform — peaks and pauses under the ruler"
                        />
                      </>
                    ) : null}
                    {/* The ruler and the waveform are TOGGLES — things drawn
                        onto the strip. The slider is a continuous control that
                        changes the axis they are drawn against. Fenced apart
                        because they read as one undifferentiated run
                        otherwise, and only inside the flat branch: with the
                        toggles gone this fence would open the group with a
                        line against nothing. */}
                    {flatOn ? <ControlFence /> : null}
                    <HeaderZoomControl
                      pixelsPerSecond={pixelsPerSecond}
                      onChange={onPixelsPerSecondChange}
                    />
                    <ControlFence />
                  </>
                ) : null}
                {/* The filter sits with the settings rather than with the
                    groups on the left because it does not change the board's
                    shape or its contents — it changes what you are COUNTING,
                    and the count it changes is one column over. */}
                <TagFilterControl />
                {/* LAST, at the far right of the row — the settings that
                    outlive the session, after the controls you actually ride
                    while working. Back from the icon rail (PL14-005); see the
                    note where BoardMenuSlot used to be. */}
                <BoardMenu
                  itemSize={itemSize}
                  onItemSizeChange={onItemSizeChange}
                  clipNamesShown={clipNamesShown}
                  onClipNamesChange={onClipNamesChange}
                  playbarThumbnails={playbarThumbnails}
                  onPlaybarThumbnailsChange={onPlaybarThumbnailsChange}
                  playbarThumbnailStyle={playbarThumbnailStyle}
                  onPlaybarThumbnailStyleChange={onPlaybarThumbnailStyleChange}
                  projectId={projectId}
                />
              </div>
            </div>
          </DragChromeFade>

          {/* OUTSIDE the sticky header, deliberately. It belongs to the board
              rather than the toolbar — it describes what you are looking at,
              and it is the one piece of chrome whose height varies (chips wrap
              on a narrow viewport). Inside the header that variation would
              move everything below it — surfaces AND the preview, which now
              pins to the header's measured height — every time a tag was
              added. */}
          <ActiveTagFilters />

          {/* THE HYDRATION GAP, before either surface branch. It replaces the
              surface rather than overlaying it: an empty VirtualStrip/Grid
              underneath would still render its trailing "add" slot, so the
              user would be offered a place to insert into a collection whose
              contents have not arrived — and a drop there is refused until
              hydration completes anyway.

              Only ever true for a beat. `skeletonCount` returns 0 the moment
              the children land, or immediately if the collection is stored as
              empty (whose own empty state is the correct thing to show). */}
          {/* INSET, now that there is a panel to be inset from.
              The surface used to run edge-to-edge so its sides lined up with
              the full-bleed breadcrumb bar above it — correct while the board
              had no frame of its own. The panel is that frame now, and cards
              flush against its ring read as overflowing it, so the content
              takes the same gutter the header row has. */}
          {/* SELECT MODE, published for the cards below.
              A data attribute rather than a store read in every card: this is
              a whole-surface state and subscribing dozens of cards to it would
              re-render all of them on a toggle, for a border colour. One
              attribute here and a CSS variant there costs nothing. */}
          <div
            data-board-panel-content
            data-select-mode={multiSelectMode ? "" : undefined}
            className="p-3"
          >
          {skeletonCount > 0 ? (
            <div data-focused-surface-shell={surface}>
              <SurfaceSkeleton
                count={skeletonCount}
                surface={surface}
                dims={dims}
                pixelsPerSecond={deferredPixelsPerSecond}
              />
            </div>
          ) : surface === "strip" ? (
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
                // Flat mode owns the item source when it is on; otherwise the
                // lane split does, but ONLY when something is on a lane —
                // undefined means "your own children", which is the original
                // behaviour and the one every unlayered board still gets.
                itemIds={flatItemIds ?? laneRows?.itemIds}
                itemTimes={laneRows?.itemTimes}
                layers={laneRows?.layers}
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
                  previewOn || rulerOn || waveformOn ? (
                    <>
                      {rulerOn ? (
                        <GraphRuler
                          focusedId={focusedId}
                          pixelsPerSecond={deferredPixelsPerSecond}
                          cardHeight={dims.strip}
                          laneScope="picture"
                        />
                      ) : null}
                      {waveformOn ? (
                        <GraphWaveformBand
                          focusedId={focusedId}
                          pixelsPerSecond={deferredPixelsPerSecond}
                          cardHeight={dims.strip}
                          laneScope="picture"
                        />
                      ) : null}
                      {previewOn ? (
                        <GraphPlayhead
                          focusedId={focusedId}
                          channel={timeChannel}
                          pixelsPerSecond={deferredPixelsPerSecond}
                          cardHeight={dims.strip}
                          laneScope="picture"
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
                  // pb-1.5: the cards sat directly ON the horizontal
                  // scrollbar. Bottom padding on a horizontal scroller is part
                  // of the scrollable area and lands ABOVE the bar, so this is
                  // a gap between the filmstrip and its scrollbar rather than
                  // one under the whole strip. Small on purpose — the strip's
                  // height is the picture's, and every pixel here is a pixel
                  // the frames do not get. Must follow `p-0`: twMerge keeps
                  // the later of two conflicting spacing utilities.
                  "pb-1.5",
                  GRAPH_STRIP_TRACK_CLASS,
                  // Same 16px, same wait, same one-step landing as the grid's
                  // — see the note there. Ruler and waveform have no reveal to
                  // wait for, so they still spend it immediately.
                  // The RULER and the WAVEFORM still need their band — they
                  // ARE bands, drawn above the cards. The preview's rail no
                  // longer does: it rides the cards' own top padding. See the
                  // grid's note below.
                  rulerOn || waveformOn ? "pt-4" : "",
                ].join(" ")}
              />
              {/* The strip's scrub control — the same rail treatment as the
                  grid's, riding the strip's top padding band and scrolling
                  with the content; a drag held at the scroller's edge
                  auto-pans to reveal more items mid-scrub. Replaces the old
                  invisible PlayheadScrubBand. */}
              {previewOn && (
                <AfterPreviewOpens>
                <GraphStripSeekRail
                  focusedId={focusedId}
                  channel={timeChannel}
                  pixelsPerSecond={deferredPixelsPerSecond}
                  cardHeight={dims.strip}
                  laneScope="picture"
                />
                </AfterPreviewOpens>
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
              {/* The starts are computed once for the surface and read by each
                  card's play button — see the note in that file for why they
                  come from `childSpans` rather than the spans context. */}
              <GridPlayStarts focusedId={focusedId} pixelsPerSecond={deferredPixelsPerSecond}>
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
                  // A PLAY BUTTON ON EVERY CARD WHILE THE PREVIEW IS OPEN.
                  // Only while it is open: the button starts playback in the
                  // pane, so without a pane there is nowhere for it to play
                  // and it would be a control that does nothing.
                  cellOverlay={playButtonCell}
                  // NO TRAILING ADD SLOT IN THE GRID.
                  //
                  // It costs a whole cell, and when it wraps it costs a whole
                  // ROW — `VirtualGrid` sizes itself as
                  // `ceil((children + slot) / cols)`, so a grid whose item
                  // count divides evenly by its columns grows a row holding
                  // nothing but the slot, and everything below is pushed down
                  // for it.
                  //
                  // Nothing is lost. The same two actions live in the header
                  // as tools — "Collection" and "Media", both of which append
                  // to the end of this surface — so the slot was a second
                  // control for an action that already had one, paid for in
                  // grid height. The STRIP keeps its slot: a strip grows
                  // sideways, so its slot costs a card's width at the end of a
                  // row that already existed rather than a new row.
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
                  //
                  // TRANSITIONED, because this 16px is spent the instant the
                  // preview is switched on — while the pane itself is still
                  // getting ready to slide. Measured, the board jolted down
                  // 16 pixels about 65ms after the click and the slide began
                  // 30-80ms after THAT: a bump, a pause, then the movement,
                  // which is most of what "not smooth at the beginning" was.
                  // On the pane's own clock it stops being a separate event.
                  className={[
                    "rounded-none border-0 bg-transparent p-0",
                    // WAITS FOR THE SLIDE, and then lands in ONE STEP.
                    //
                    // It waits because the 16px used to be spent at the click,
                    // mid-reveal, as a jolt against a moving pane. It does NOT
                    // animate, and that is the second half of the lesson: a
                    // transition here means this grid's layout moves for 380ms,
                    // and this grid is a drag surface. The e2e suite caught it
                    // at once — a hold-drag reordered one slot too far, which
                    // is the same failure that test's own comment records from
                    // an earlier 40px of chrome appearing above the grid. Cards
                    // that shift under a pointer resolve the wrong drop.
                    //
                    // One step, at a moment when nothing else is moving and the
                    // user is watching the pane arrive, is both calmer and safe.
                    // NO BAND FOR THE RAIL ANY MORE. It rides the top edge of
                    // the cards now, over the ~6px of padding they already
                    // carry above their artwork, so there is nothing to make
                    // room for. This 16px used to be spent whenever the
                    // preview came on, and the whole surface moved down for it
                    // — for a control that is a single dot.
                    //
                    // Which also retires the timing problem the 16px created:
                    // spent at the click it was a jolt against a moving pane;
                    // deferred to the settle it moved a drag surface's layout
                    // half a second after the click. Space you never take
                    // needs no schedule.
                  ].join(" ")}
                />
              </NativeDropGrid>
              </GridPlayStarts>
              {previewOn && (
                <AfterPreviewOpens>
                  <GraphSeekRails
                    focusedId={focusedId}
                    channel={timeChannel}
                    cellHeight={dims.gridHeight}
                    pixelsPerSecond={deferredPixelsPerSecond}
                  />
                </AfterPreviewOpens>
              )}
            </div>
          )}

          </div>
          </div>

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
                waveformOn={waveformOn}
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
      </TagFilterProvider>
      </CollectionHoverProvider>
      </ClipNamesProvider>
      </PlaybarThumbnailsProvider>
      </ItemDetailsProvider>
    </OpenKeyBoundary>
  );
}
