"use client";

import React, { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { Ban, CircleCheck, ClipboardPaste, Copy, CopyPlus, Folder, FolderTree, GalleryHorizontalEnd, Images, Layers, LayoutGrid, ListOrdered, LogOut, Ruler, Scissors, Settings, Trash2, TvMinimal, X } from "lucide-react";
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

import { SidebarTooltipLabel } from "./sidebar-tooltip-label";

type UtilityItem = {
  id: "assets" | "trash" | "settings";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * The trash BIN as this app means it: a folder (it holds timeline items, and
 * they come back) with a trash can sitting in its body. Lucide has no such
 * glyph, so it is composed — the folder at full size, the can scaled into the
 * pocket below the tab. Both strokes inherit `currentColor`, so every state
 * the button paints (idle, pressed, drop-hover) still styles one icon.
 *
 * `className` sizes the WRAPPER (the call site passes the same `h-4 w-4` every
 * other sidebar icon gets) and the parts size off it, so the composition can
 * never drift from the row.
 */
function FolderTrashIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden="true"
      // The animated element: the sidebar hands its drop-hover / arrival
      // classes to THIS wrapper (both glyphs move together), so it is also
      // what the e2e watches.
      data-sidebar-icon="trash"
      className={cn("relative inline-block shrink-0", className)}
    >
      <Folder className="h-full w-full" />
      {/* Nudged below the folder's tab so the can reads as sitting INSIDE the
          pocket; the heavier stroke keeps it legible at 16px. */}
      <Trash2
        className="absolute left-1/2 top-[58%] h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2"
        strokeWidth={2.75}
      />
    </span>
  );
}

const SIDEBAR_ICON_BASE =
  "group/sidebar-item relative flex size-11 items-center justify-center rounded-lg border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400";
const SIDEBAR_ICON_IDLE =
  "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-100";
const SIDEBAR_ICON_PRESSED =
  "translate-y-px border-zinc-600 bg-zinc-800 text-zinc-100 shadow-inner shadow-black/50 ring-1 ring-inset ring-zinc-700/70";

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
      <Icon className="h-4 w-4 transition-colors" />
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

// Recessed, not invisible. This used to dim TWICE — a zinc-600 glyph and then
// `opacity-50` over it — which on the near-black rail left the Paste icon
// (item mode's resting state, disabled until something is copied) barely
// legible. One dimming step is enough: a solid zinc-500 glyph reads as
// available-but-not-now, and the flat border plus the missing hover response
// carry "disabled" on their own.
const SIDEBAR_ICON_DISABLED =
  "cursor-not-allowed border-zinc-800/70 bg-zinc-900/20 text-zinc-500";

// Item mode borrows the SELECTION colour. A selected card is ring-2
// ring-amber-400 (graph-item-content), and these buttons act on that card, so
// they carry the same amber — but only in the FILL. Bordering them in amber
// too was too loud next to the card it is meant to refer to; the tint alone
// carries the connection. Disabled buttons stay ZINC: an amber-tinted
// disabled button reads as available, and Paste is disabled most of the time.
const SIDEBAR_ICON_ITEM_IDLE =
  "border-zinc-800 bg-amber-400/10 text-amber-200/80 hover:border-zinc-600 hover:bg-amber-400/20 hover:text-amber-100";

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
      <Icon className="h-4 w-4 transition-colors" />
      <SidebarTooltipLabel id={tooltipId} label={label} description={description} />
    </button>
  );
}

/**
 * The contextual cluster shown while an item is selected (or something is on
 * the clipboard). Replaces the layout/toggle controls with actions on the
 * selected item. Copy/Cut/Duplicate/Delete need a live selection; Paste needs
 * a non-empty clipboard; Done exits back to the normal controls (clearing the
 * clipboard — with contents kept, item mode couldn't close). While an async
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
    <div className="flex flex-col items-center gap-2">
      {/* Only the five actions that touch the SELECTION sit inside the amber
          block — a wash, no border, so the group reads as one thing tied to
          the selected card without drawing a box around itself. Done is
          deliberately outside it: it exits the mode, it does nothing to the
          card, and it keeps the sidebar's ordinary zinc. */}
      <div
        data-item-actions-cluster
        className="flex flex-col items-center gap-2 rounded-xl bg-amber-400/[0.07] px-1.5 py-2"
      >
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
        <ItemActionButton
          action="paste"
          icon={ClipboardPaste}
          label="Paste"
          description="Paste into this timeline"
          disabled={busy || !canPaste}
        />
        <ItemActionButton
          action="duplicate"
          icon={CopyPlus}
          label="Duplicate"
          description="Duplicate the selected item in place"
          disabled={busy || !hasSelection}
        />
        <ItemActionButton
          action="delete"
          icon={Trash2}
          label="Delete"
          description="Move the selected item to trash"
          disabled={busy || !hasSelection}
        />
        {/* The button shows the icon of the ACTION it performs, so it reads
            Ban ("disable this") until everything selected is already
            disabled, then offers the way back. */}
        <ItemActionButton
          action="toggle-disabled"
          icon={allDisabled ? CircleCheck : Ban}
          label={allDisabled ? "Enable" : "Disable"}
          description={
            allDisabled
              ? "Play this item again, and count it in the totals"
              : "Skip this item in playback, counts and time totals"
          }
          disabled={busy || !hasSelection}
        />
      </div>
      <div className="h-px w-8 shrink-0 bg-zinc-700" />
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
    icon: Images,
  },
  {
    id: "trash",
    label: "Trash",
    description: "Deleted timeline items",
    icon: FolderTrashIcon,
  },
  {
    id: "settings",
    label: "Settings",
    description: "App-wide settings",
    icon: Settings,
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
      className="sticky top-0 z-50 flex h-screen w-[72px] shrink-0 flex-col items-center gap-5 overflow-visible border-r border-zinc-800 bg-zinc-900/50 px-3 py-5 backdrop-blur-md"
    >
      <Link
        href="/"
        aria-label="Storyboard Workbench home"
        className="flex size-11 items-center justify-center rounded-lg border border-zinc-700/55 bg-zinc-800/35 text-[13px] font-black text-zinc-400 shadow-sm shadow-black/10 transition-colors hover:border-zinc-600/70 hover:bg-zinc-800/55 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
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
        <div className="flex flex-col items-center gap-2">
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
          <div className="h-px w-10 shrink-0 bg-zinc-500" />

          <div className="flex flex-col items-center gap-2">
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
                <TvMinimal className="h-4 w-4 transition-colors" />
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
                <FolderTree className="h-4 w-4 transition-colors" />
                <SidebarTooltipLabel
                  id="sidebar-tooltip-children"
                  label="Children timelines"
                  description="Show the nested timeline tree"
                />
              </button>
            )}

            {/* The strip's time-ruler toggle (was in the breadcrumb row). It
                rides under the children toggle and only exists in strip
                layout — the grid has no single time axis for a ruler to
                mark. */}
            {onGraphRoute && graphView.surface === "strip" && (
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
                <Ruler className="h-4 w-4 transition-colors" />
                <SidebarTooltipLabel
                  id="sidebar-tooltip-ruler"
                  label="Time ruler"
                  description="Tick marks over every strip"
                />
              </button>
            )}

            {/* Flat mode — strip only, like the ruler. Grid keeps its nesting,
                so there is nothing to flatten there. */}
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
                    "h-4 w-4 transition-colors",
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
          </div>
        </>
      )}

      <div className="mt-auto flex flex-col items-center gap-2 relative">
        {UTILITY_ITEMS.map((item) => {
          // Assets is a GRAPH-ROUTE affordance now. The legacy drawer that
          // used to answer it elsewhere is gone: its one remaining route was
          // the project list, where there is no open timeline to drag an
          // asset into — it could browse and do nothing. Rather than leave a
          // button that opens nothing, it is hidden off the graph.
          if (item.id === "assets" && !onGraphRoute) return null;

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
              : item.id === "trash"
                ? () => setIsTrashOpen(!isTrashOpen)
                : // Placeholder until real settings exist.
                  () =>
                    toast("Settings", {
                      description: "App-wide settings aren’t wired up yet.",
                    });

          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-describedby={tooltipId}
              aria-pressed={item.id === "settings" ? undefined : isPressed}
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
                  "h-4 w-4 transition-colors",
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
              className="h-5 w-5 rounded-full object-cover border border-zinc-700 group-hover/sidebar-item:border-zinc-500 transition-colors"
            />
          ) : (
            <div className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/60 text-[9px] font-bold text-zinc-400 transition-colors select-none group-hover/sidebar-item:border-zinc-600 group-hover/sidebar-item:bg-zinc-800 group-hover/sidebar-item:text-zinc-100">
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
            className="absolute bottom-0 left-[52px] z-50 w-64 rounded-xl border border-zinc-800/80 bg-zinc-950/90 p-4 shadow-[0_10px_40px_rgba(0,0,0,0.7)] backdrop-blur-md profile-popover-animate"
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
