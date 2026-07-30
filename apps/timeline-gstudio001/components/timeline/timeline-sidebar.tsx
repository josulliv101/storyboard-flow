"use client";

import React, { useState, useEffect, useRef, useSyncExternalStore } from "react";
import {
  Ban,
  CircleCheck,
  ClipboardPaste,
  Copy,
  ChevronsLeftRightEllipsis,
  Pencil,
  CopyPlus,
  EllipsisVertical,
  Film,
  Folder,
  Image as ImageIcon,
  Layers,
  LogOut,
  Scissors,
  Trash2,
  TvMinimal,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrashDrawer } from "@/components/assets/trash-drawer";
import { useAuth } from "@/components/auth/auth-provider";
import {
  GRAPH_SELECTION_EVENT,
  GRAPH_TRASH_ARRIVAL_EVENT,
  GRAPH_TRASH_HOVER_EVENT,
  GRAPH_VIEW_STATE_EVENT,
  isGraphViewRoute,
  requestGraphItemAction,
  requestGraphFlatToggle,
  requestGraphPreviewToggle,
  requestGraphSurface,
  type GraphItemAction,
  type GraphSelectionDetail,
  type GraphSurface,
  type GraphViewStateDetail,
} from "@/lib/graph-view-events";
import { graphClipboard } from "@/lib/graph-clipboard";
import { toast } from "@/components/core/sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";

import { SidebarTooltipLabel } from "./sidebar-tooltip-label";

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
      className={cn("relative inline-flex shrink-0 overflow-visible", className)}
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
      className={cn("relative inline-flex shrink-0 overflow-visible", className)}
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
const SIDEBAR_ICON_BASE = [
  "group/sidebar-item relative flex w-full aspect-square items-center justify-center",
  "transition-all duration-200 focus-visible:outline-none",
  "before:absolute before:inset-2 before:rounded-2xl before:transition-colors before:content-['']",
  "focus-visible:before:ring-2 focus-visible:before:ring-zinc-400",
].join(" ");
/** The glyph inside a tile. Larger than the old h-4: legibility is the point
 *  of the bigger tiles, and a 16px icon in a 72px square reads as a dot.
 *
 *  `relative` is load-bearing: the pill above is an absolutely-positioned
 *  pseudo-element, so a statically-positioned glyph would paint UNDER it. */
const SIDEBAR_GLYPH = "relative h-7 w-7 [stroke-width:1.5] transition-colors";
const SIDEBAR_ICON_IDLE =
  "text-zinc-400 before:bg-zinc-900/40 hover:text-zinc-100 hover:before:bg-zinc-800/80";
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
/**
 * The rule between tile groups: longer than the glyphs it separates, with air
 * above and below.
 *
 * It has been both extremes. Flush against the tiles it disappeared into them;
 * as a short 28px hairline with 8px of margin it read as a gap the tiles had
 * fallen out of. What makes it work is the pill treatment above — the tiles no
 * longer run edge to edge either, so a wider rule with matching breathing room
 * sits in the same rhythm instead of interrupting one.
 */
const SIDEBAR_SEPARATOR_CLASS = "mx-auto my-2 h-px w-10 shrink-0";

function SidebarSeparator({ selected = false }: Readonly<{ selected?: boolean }>) {
  return (
    <div
      aria-hidden="true"
      data-sidebar-separator={selected ? "selected" : "normal"}
      className={cn(
        SIDEBAR_SEPARATOR_CLASS,
        selected ? "bg-amber-300/65" : "bg-zinc-500",
      )}
    />
  );
}

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
      <SidebarTooltipLabel id={tooltipId} label={label} description={description} />
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

// Recessed, not invisible. One dimming step is enough: a solid zinc-500 glyph
// reads as available-but-not-now, and the flat border plus the missing hover
// response carry "disabled" on their own.
const SIDEBAR_ICON_DISABLED =
  "cursor-not-allowed text-zinc-500 before:bg-zinc-900/20";

// Item mode borrows a restrained trace of the selection colour. These actions
// relate to the selected card, but should remain secondary to the content.
const SIDEBAR_ICON_ITEM_IDLE =
  "text-amber-100/60 before:bg-amber-200/[0.035] hover:text-amber-100/85 hover:before:bg-amber-200/[0.075]";

/** One button in the item-actions cluster — dispatches its action across the
 *  window-event seam for the graph provider to perform on the selection. */
function ItemActionButton({
  action,
  icon: Icon,
  label,
  description,
  disabled = false,
  /** "item" acts on the selected card and carries its amber; "neutral" does
   *  not — Done exits the mode rather than doing anything to the selection,
   *  so it stays on the sidebar's ordinary zinc. */
  tone = "item",
}: Readonly<{
  action: GraphItemAction;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  disabled?: boolean;
  tone?: "item" | "neutral";
}>) {
  const tooltipId = `sidebar-tooltip-item-${action}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={tooltipId}
      disabled={disabled}
      onClick={() => requestGraphItemAction(action)}
      className={cn(
        SIDEBAR_ICON_BASE,
        disabled
          ? SIDEBAR_ICON_DISABLED
          : tone === "item"
            ? SIDEBAR_ICON_ITEM_IDLE
            : SIDEBAR_ICON_IDLE,
      )}
    >
      <Icon className={SIDEBAR_GLYPH} />
      <SidebarTooltipLabel id={tooltipId} label={label} description={description} />
    </button>
  );
}

function ItemActionsOverflow({
  hasSelection,
  busy,
  allDisabled,
}: Readonly<{
  hasSelection: boolean;
  busy: boolean;
  allDisabled: boolean;
}>) {
  const disabled = busy || !hasSelection;
  const tooltipId = "sidebar-tooltip-item-more";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More item actions"
          aria-describedby={tooltipId}
          disabled={disabled}
          className={cn(
            SIDEBAR_ICON_BASE,
            disabled ? SIDEBAR_ICON_DISABLED : SIDEBAR_ICON_ITEM_IDLE,
          )}
        >
          <EllipsisVertical className={SIDEBAR_GLYPH} />
          <SidebarTooltipLabel
            id={tooltipId}
            label="More"
            description="More actions for the selected item"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={disabled}
            onSelect={() => requestGraphItemAction("duplicate")}
          >
            <CopyPlus className="mr-2 h-4 w-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onSelect={() => requestGraphItemAction("toggle-disabled")}
          >
            {allDisabled ? (
              <CircleCheck className="mr-2 h-4 w-4" />
            ) : (
              <Ban className="mr-2 h-4 w-4" />
            )}
            {allDisabled ? "Enable" : "Disable"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The contextual cluster shown while an item is selected (or something is on
 * the clipboard). Replaces the layout/toggle controls with actions on the
 * selected item. Copy/Cut are replaced by Paste while the clipboard is armed;
 * Duplicate/Delete need a live selection. Done exits back to the normal
 * controls (clearing the clipboard — with contents kept, item mode couldn't
 * close). While an async
 * action is in flight (`busy`) every button disables, so nothing double-fires.
 */
function ItemActionsCluster({
  hasSelection,
  isSingleSelection,
  canPaste,
  busy,
  allDisabled,
}: Readonly<{
  hasSelection: boolean;
  /** Exactly ONE item selected — the only shape the details view can render.
   *  Distinct from `hasSelection`, which every other action here is happy
   *  with. */
  isSingleSelection: boolean;
  canPaste: boolean;
  busy: boolean;
  /** Every selected item is already skipped — flips the toggle to "Enable". */
  allDisabled: boolean;
}>) {
  return (
    <div className="flex w-full flex-col items-stretch gap-0">
      {/* Only actions that operate on the selection or clipboard sit inside the amber
          block — a wash, no border, so the group reads as one thing tied to
          the selected card without drawing a box around itself. Done is
          deliberately outside it: it exits the mode, it does nothing to the
          card, and it keeps the sidebar's ordinary zinc. */}
      <div
        data-item-actions-cluster
        className="flex w-full flex-col items-stretch gap-0 bg-amber-200/[0.025]"
      >
        {/* FIRST, because it is the action that tells you WHAT you have
            selected before you act on it — and because the details view lost
            its per-card trigger to get here (PL13-009). Disabled, not hidden,
            past one selection: a control that vanishes teaches nothing, while a
            disabled one says "wrong shape of selection for that". */}
        <ItemActionButton
          action="details"
          icon={Pencil}
          label="Edit"
          description="Open the selected item's details"
          disabled={busy || !isSingleSelection}
        />
        {!canPaste ? (
          <>
            <ItemActionButton
              action="copy"
              icon={Copy}
              label="Copy"
              description="Copy the selected item"
              disabled={busy || !hasSelection}
            />
            <ItemActionButton
              action="cut"
              icon={Scissors}
              label="Cut"
              description="Cut the selected item — paste to move it"
              disabled={busy || !hasSelection}
            />
          </>
        ) : null}
        {canPaste ? (
          <ItemActionButton
            action="paste"
            icon={ClipboardPaste}
            label="Paste"
            description="Paste into this timeline"
            disabled={busy}
          />
        ) : null}
        <ItemActionButton
          action="delete"
          icon={Trash2}
          label="Delete"
          description="Move the selected item to trash"
          disabled={busy || !hasSelection}
        />
        <ItemActionsOverflow
          hasSelection={hasSelection}
          busy={busy}
          allDisabled={allDisabled}
        />
      </div>
      <SidebarSeparator selected />
      <ItemActionButton
        action="cancel"
        icon={X}
        label="Done"
        description="Exit item actions and clear the clipboard"
        disabled={busy}
        tone="neutral"
      />
    </div>
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
    return () => window.removeEventListener(GRAPH_TRASH_ARRIVAL_EVENT, handleArrival);
  }, []);

  // A dragged card is (or is not) currently over the breadcrumb's trash drop
  // zone — the icon does an attention wiggle while it is, pointing the user at
  // where the drop lands.
  const [trashDropHover, setTrashDropHover] = useState(false);
  useEffect(() => {
    const handleHover = (event: Event) =>
      setTrashDropHover((event as CustomEvent<boolean>).detail === true);
    window.addEventListener(GRAPH_TRASH_HOVER_EVENT, handleHover);
    return () => window.removeEventListener(GRAPH_TRASH_HOVER_EVENT, handleHover);
  }, []);

  // The graph broadcasts how many items are selected; while something is
  // selected — OR the clipboard holds a copy/cut — the contextual controls
  // switch to item actions (copy, cut, paste, duplicate, delete, cancel). The
  // clipboard condition is what keeps Paste reachable after Copy clears the
  // selection (copy here, drill into another timeline, paste there).
  const [selectionCount, setSelectionCount] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [selectionAllDisabled, setSelectionAllDisabled] = useState(false);
  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<GraphSelectionDetail>).detail;
      if (detail) {
        setSelectionCount(detail.count);
        setActionBusy(detail.busy);
        setSelectionAllDisabled(detail.allDisabled);
      }
    };
    window.addEventListener(GRAPH_SELECTION_EVENT, onSelection);
    return () => window.removeEventListener(GRAPH_SELECTION_EVENT, onSelection);
  }, []);
  const canPaste = useSyncExternalStore(
    graphClipboard.subscribe,
    () => !graphClipboard.isEmpty(),
    () => false,
  );

  const onGraphRoute = isGraphViewRoute(pathname);
  const itemMode = onGraphRoute && (selectionCount > 0 || canPaste);

  // Swapping clusters unmounts the control that held keyboard focus (e.g. the
  // Delete button the user just activated), dumping focus to <body>. Restore
  // it to the rail's first enabled control — but ONLY on a real mode
  // TRANSITION (not mount: focus starts on <body> on every page load, and
  // grabbing it then would steal focus from the document), and ONLY when the
  // swap actually orphaned focus: a mouse click on a card also flips
  // itemMode, and focus is on the card then, which must not be stolen.
  const railRef = useRef<HTMLElement>(null);
  const prevItemModeRef = useRef<boolean | null>(null);
  useEffect(() => {
    const previous = prevItemModeRef.current;
    prevItemModeRef.current = itemMode;
    if (previous === null || previous === itemMode) return;
    if (document.activeElement !== document.body && document.activeElement !== null) return;
    railRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [itemMode]);

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
    <aside
      ref={railRef}
      // No horizontal padding and `items-stretch`: the tiles ARE the rail's
      // width, which is what makes them full-width squares. Vertical padding
      // stays — it separates the rail's contents from the screen edges, which
      // the side padding was not doing for the tiles.
      className="sticky top-0 z-50 flex h-screen w-[72px] shrink-0 flex-col items-stretch gap-0 overflow-visible border-r border-zinc-800 bg-zinc-900/50 pt-1.5 pb-5 backdrop-blur-md"
    >
      <Link
        href="/"
        aria-label="Storyboard Workbench home"
        className="flex w-full aspect-square items-center justify-center text-lg font-black text-white transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
      >
        SW
      </Link>

      {activeProjectId && itemMode && (
        <ItemActionsCluster
          hasSelection={selectionCount > 0}
          isSingleSelection={selectionCount === 1}
          canPaste={canPaste}
          busy={actionBusy}
          allDisabled={selectionAllDisabled}
        />
      )}

      {activeProjectId && !itemMode && (
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

      {activeProjectId && !itemMode && (
        <>
          {/* zinc-500: the old zinc-800/80 vanished against the rail. */}
          <SidebarSeparator />

          <div className="flex w-full flex-col items-stretch gap-0">
            {/* PREVIEW leads this group, directly under the separator.

                It is a toggle, not a destination, so it wears the tint rather
                than the indicator bar — but it sits in the rail rather than
                with the other toggles in the breadcrumb row because it is one
                of the two controls worth calling out at rail scale. The rail
                is where the eye goes first; giving up a slot there is how a
                control gets promoted above the toolbar's noise.

                Ungated by surface deliberately: the pane plays the focused
                timeline in grid as well as strip, so hiding it in grid would
                remove a working control. */}
            {onGraphRoute && (
              <button
                type="button"
                aria-pressed={graphView.previewOn}
                aria-label={graphView.previewOn ? "Hide preview" : "Show preview"}
                aria-describedby="sidebar-tooltip-preview"
                onClick={requestGraphPreviewToggle}
                className={cn(
                  SIDEBAR_ICON_BASE,
                  graphView.previewOn ? SIDEBAR_ICON_TOGGLE_ON : SIDEBAR_ICON_IDLE,
                )}
              >
                <TvMinimal className={SIDEBAR_GLYPH} />
                <SidebarTooltipLabel
                  id="sidebar-tooltip-preview"
                  label="Preview"
                  description="Play the focused timeline"
                />
              </button>
            )}

            {/* The children-timelines toggle is in the board's breadcrumb row
                (see graph-board), alongside the ruler. */}

            {/* Flat mode — strip only. Grid keeps its nesting, so there is
                nothing to flatten there. */}
            {onGraphRoute && graphView.surface === "strip" && (
              <button
                type="button"
                aria-pressed={graphView.flatOn}
                aria-label={graphView.flatOn ? "Show collections" : "Show all items in order"}
                aria-describedby="sidebar-tooltip-flat"
                aria-busy={graphView.flatLoading}
                onClick={requestGraphFlatToggle}
                className={cn(
                  SIDEBAR_ICON_BASE,
                  // TOGGLE, not a destination — see SIDEBAR_ICON_TOGGLE_ON.
                  graphView.flatOn ? SIDEBAR_ICON_TOGGLE_ON : SIDEBAR_ICON_IDLE,
                )}
              >
                <ChevronsLeftRightEllipsis
                  className={cn(
                    SIDEBAR_GLYPH,
                    // Loading the closure can take a moment on a deep project,
                    // and a half-built run would otherwise look like the real
                    // answer.
                    graphView.flatLoading ? "motion-safe:animate-pulse" : "",
                  )}
                />
                <SidebarTooltipLabel
                  id="sidebar-tooltip-flat"
                  label="All items in order"
                  description={
                    graphView.flatLoading
                      ? "Loading every collection…"
                      : "One flat run — no collections. Reordering is off."
                  }
                />
              </button>
            )}

            {/* The time-ruler toggle moved to the board's breadcrumb row,
                sitting left of the children toggle. It is still scoped to flat
                mode and still appears and disappears with it — only its home
                changed, joining the view controls it belongs with. */}
          </div>
        </>
      )}

      <div className="relative mt-auto flex w-full flex-col items-stretch gap-0">
        {UTILITY_ITEMS.map((item) => {
          if (item.id === "trash" && pathname === "/") return null;

          const Icon = item.icon;
          const tooltipId = `sidebar-tooltip-utility-${item.id}`;
          const isPressed = isTrashOpen;
          const handleClick = () => setIsTrashOpen(!isTrashOpen);

          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-describedby={tooltipId}
              aria-pressed={isPressed}
              onClick={handleClick}
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
                  item.id === "trash" && trashDropHover && "animate-trash-hover-attention",
                  item.id === "trash" && trashArrival > 0 && "animate-trash-arrival",
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

        <button
          ref={buttonRef}
          type="button"
          aria-label="Account"
          aria-describedby="sidebar-tooltip-utility-account"
          aria-pressed={isProfileOpen}
          onClick={() => setIsProfileOpen((open) => !open)}
          className={cn(
            SIDEBAR_ICON_BASE,
            isProfileOpen ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE
          )}
        >
          {user?.picture ? (
            <img
              src={user.picture}
              alt={user.name || user.email || "Profile"}
              className="h-8 w-8 rounded-full object-cover border border-zinc-700 group-hover/sidebar-item:border-zinc-500 transition-colors"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/60 text-xs font-bold text-zinc-400 transition-colors select-none group-hover/sidebar-item:border-zinc-600 group-hover/sidebar-item:bg-zinc-800 group-hover/sidebar-item:text-zinc-100">
              {user?.name ? user.name[0].toUpperCase() : (user?.email ? user.email[0].toUpperCase() : "U")}
            </div>
          )}
          <SidebarTooltipLabel
            id="sidebar-tooltip-utility-account"
            label="Account"
            description={user?.email ? `Signed in as ${user.email}` : "Signed in"}
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
                  {user?.name ? user.name[0].toUpperCase() : (user?.email ? user.email[0].toUpperCase() : "U")}
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
        onClose={() => setIsTrashOpen(false)}
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
  );
}
