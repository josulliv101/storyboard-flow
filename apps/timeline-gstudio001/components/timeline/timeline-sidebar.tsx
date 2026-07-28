"use client";

import React, { useState, useEffect, useRef, useSyncExternalStore } from "react";
import {
  Ban,
  CircleCheck,
  ClipboardPaste,
  Copy,
  CopyPlus,
  EllipsisVertical,
  Folder,
  FolderTree,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  ListOrdered,
  LogOut,
  Ruler,
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
  GRAPH_ASSETS_TOGGLE_EVENT,
  GRAPH_SELECTION_EVENT,
  GRAPH_TRASH_ARRIVAL_EVENT,
  GRAPH_TRASH_HOVER_EVENT,
  GRAPH_VIEW_STATE_EVENT,
  isGraphViewRoute,
  requestGraphChildrenToggle,
  requestGraphItemAction,
  requestGraphPreviewToggle,
  requestGraphFlatToggle,
  requestGraphRulerToggle,
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
      <Folder className="h-full w-full" strokeWidth={2.1} />
      <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-zinc-950 ring-1 ring-zinc-600">
        <Trash2 className="size-4" strokeWidth={2.7} />
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
      <Folder className="h-full w-full" strokeWidth={2.1} />
      <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-zinc-950 ring-1 ring-zinc-600">
        <ImageIcon className="size-4" strokeWidth={2.5} />
      </span>
    </span>
  );
}

// Full-width SQUARES: the rail has no horizontal padding, so `w-full` is the
// rail's width and `aspect-square` makes the height follow it. Sized this way
// rather than with a fixed `size-*` so the two can never drift — change the
// rail's width and every tile (and the logo) resizes with it.
const SIDEBAR_ICON_BASE =
  "group/sidebar-item relative flex w-full aspect-square items-center justify-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400";
/** The glyph inside a tile. Larger than the old h-4: legibility is the point
 *  of the bigger tiles, and a 16px icon in a 72px square reads as a dot. */
const SIDEBAR_GLYPH = "h-7 w-7 transition-colors";
const SIDEBAR_ICON_IDLE =
  "bg-zinc-900/40 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100";
// No `translate-y-px` any more: with the tiles flush against each other, a
// pressed tile nudging down by a pixel opened a hairline seam above it and
// read as misalignment rather than as a press. The lifted background and the
// inset shadow carry the state on their own.
const SIDEBAR_ICON_PRESSED =
  "bg-zinc-800 text-zinc-100 shadow-inner shadow-black/50";
const SIDEBAR_SEPARATOR_CLASS = "mx-auto my-2 h-px w-7 shrink-0";

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
  "cursor-not-allowed bg-zinc-900/20 text-zinc-500";

// Item mode borrows a restrained trace of the selection colour. These actions
// relate to the selected card, but should remain secondary to the content.
const SIDEBAR_ICON_ITEM_IDLE =
  "bg-amber-200/[0.035] text-amber-100/60 hover:bg-amber-200/[0.075] hover:text-amber-100/85";

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
  canPaste,
  busy,
  allDisabled,
}: Readonly<{
  hasSelection: boolean;
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
    id: "assets",
    label: "Assets",
    description: "Media and project assets",
    icon: MediaFolderIcon,
  },
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
        className="flex w-full aspect-square items-center justify-center text-lg font-black text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
      >
        SW
      </Link>

      {activeProjectId && itemMode && (
        <ItemActionsCluster
          hasSelection={selectionCount > 0}
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
            icon={LayoutGrid}
            isActive={onGraphRoute && graphView.surface === "grid"}
            label="Grid layout"
            description="Graph timelines as grids"
          />
          <SurfaceIconControl
            surface="strip"
            onGraphRoute={onGraphRoute}
            href={`${graphHref}?surface=strip`}
            icon={GalleryHorizontalEnd}
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
            {/* The preview-pane toggle leads the cluster (was the breadcrumb
                row's TV icon). */}
            {onGraphRoute && (
              <button
                type="button"
                aria-pressed={graphView.previewOn}
                aria-label={graphView.previewOn ? "Hide preview" : "Show preview"}
                aria-describedby="sidebar-tooltip-preview"
                onClick={requestGraphPreviewToggle}
                className={cn(
                  SIDEBAR_ICON_BASE,
                  graphView.previewOn ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE,
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

            {/* The children-timelines toggle. (The Collection tool moved to
                the board's breadcrumb row, and its card-drag trash target
                moved there too — the sidebar no longer hosts either.) */}
            {onGraphRoute && (
              <button
                type="button"
                aria-pressed={graphView.childrenShown}
                aria-label={
                  graphView.childrenShown
                    ? "Hide children timelines"
                    : "Show children timelines"
                }
                aria-describedby="sidebar-tooltip-children"
                onClick={requestGraphChildrenToggle}
                className={cn(
                  SIDEBAR_ICON_BASE,
                  graphView.childrenShown ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE,
                )}
              >
                <FolderTree className={SIDEBAR_GLYPH} />
                <SidebarTooltipLabel
                  id="sidebar-tooltip-children"
                  label="Children timelines"
                  description="Show the nested timeline tree"
                />
              </button>
            )}

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
                  graphView.flatOn ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE,
                )}
              >
                <ListOrdered
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

            {/* The strip's time-ruler toggle, BELOW flat mode and scoped to
                it: a ruler is a single continuous time axis, which only the
                flat run actually is. In the nested strip a collection card
                holds an arbitrary duration in a fixed width, so the ticks
                beside it measure nothing the user can act on. Grid has no
                time axis at all. Flat turning off also turns the ruler off
                (see graph-timeline-view) — otherwise this control vanishes
                while its ruler stays painted. */}
            {onGraphRoute && graphView.surface === "strip" && graphView.flatOn && (
              <button
                type="button"
                aria-pressed={graphView.rulerOn}
                aria-label={graphView.rulerOn ? "Hide time ruler" : "Show time ruler"}
                aria-describedby="sidebar-tooltip-ruler"
                onClick={requestGraphRulerToggle}
                className={cn(
                  SIDEBAR_ICON_BASE,
                  graphView.rulerOn ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE,
                )}
              >
                <Ruler className={SIDEBAR_GLYPH} />
                <SidebarTooltipLabel
                  id="sidebar-tooltip-ruler"
                  label="Time ruler"
                  description="Tick marks over every strip"
                />
              </button>
            )}
          </div>
        </>
      )}

      <div className="relative mt-auto flex w-full flex-col items-stretch gap-0">
        {UTILITY_ITEMS.map((item) => {
          // Assets is a GRAPH-ROUTE affordance now. The legacy drawer that
          // used to answer it elsewhere is gone: its one remaining route was
          // the project list, where there is no open timeline to drag an
          // asset into — it could browse and do nothing. Rather than leave a
          // button that opens nothing, it is hidden off the graph.
          if (item.id === "assets" && !onGraphRoute) return null;
          if (item.id === "trash" && pathname === "/") return null;

          const Icon = item.icon;
          const tooltipId = `sidebar-tooltip-utility-${item.id}`;
          const isPressed = item.id === "trash" && isTrashOpen;
          const handleClick =
            item.id === "assets"
              ? () => {
                  // The asset surface is the graph view's own palette drawer
                  // (its drags work with dnd-collections) — hand off to it.
                  window.dispatchEvent(new CustomEvent(GRAPH_ASSETS_TOGGLE_EVENT));
                  setIsTrashOpen(false);
                }
              : () => setIsTrashOpen(!isTrashOpen);

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
                isPressed ? SIDEBAR_ICON_PRESSED : SIDEBAR_ICON_IDLE,
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
