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
import { toast } from "@/components/core/sonner";
import { cn } from "@/lib/utils";

import { SidebarCollectionShortcuts } from "./sidebar-collection-shortcuts";
import {
  SidebarLabelsInlineContext,
  SidebarTooltipLabel,
} from "./sidebar-tooltip-label";

/** Survives a reload — a rail that collapsed itself on every navigation would
 *  be a preference in name only. */
const RAIL_EXPANDED_STORAGE_KEY = "sw:sidebar-expanded";

/**
 * Published to the document so surfaces BESIDE the rail can be offset by it.
 *
 * The trash drawer hardcoded `ml-[72px]`, which is correct exactly while the
 * rail cannot change width — so opening the rail would have slid it
 * underneath. A variable is the seam: one writer here, and any number of
 * readers that keep working when this number moves again.
 */
const RAIL_WIDTH_VAR = "--sw-rail-width";

/** Fires when THIS tab toggles the rail. `storage` only notifies other tabs,
 *  so without this the toggle would not re-render the tab that pressed it. */
const RAIL_EXPANDED_EVENT = "sw:sidebar-expanded-changed";

function readRailExpanded(): boolean {
  try {
    return window.localStorage.getItem(RAIL_EXPANDED_STORAGE_KEY) === "true";
  } catch {
    // Private mode or a blocked origin: the rail still works, it just forgets.
    return false;
  }
}

function subscribeRailExpanded(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(RAIL_EXPANDED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RAIL_EXPANDED_EVENT, onChange);
  };
}

function writeRailExpanded(next: boolean): void {
  try {
    window.localStorage.setItem(RAIL_EXPANDED_STORAGE_KEY, String(next));
  } catch {
    // A quota or private-mode failure costs the preference, not the toggle —
    // the event still fires, so the rail still moves for this session.
  }
  window.dispatchEvent(new Event(RAIL_EXPANDED_EVENT));
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
function suppressTipUntilPointerReturns(event: React.MouseEvent<HTMLElement>): void {
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
          "transition-[width] duration-200 motion-reduce:transition-none",
          // From RAIL_WIDTH_CLASS, which holds the literals Tailwind's scanner
          // needs — see the note there on why these cannot be built by template.
          railExpanded
            ? `${RAIL_WIDTH_CLASS.open} ${RAIL_OPEN_CLASS}`
            : RAIL_WIDTH_CLASS.collapsed,
        )}
      >
        <Link
          href="/"
          aria-label="Storyboard Workbench home"
          // Pinned to the icon column's width. Everything else here widens
          // because it gains a label; the mark has none, and a 232px-wide "SW"
          // centred over the rail would read as a banner.
          className="flex w-full aspect-square items-center justify-center text-lg font-black text-white transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 [.rail_&]:w-[72px]"
        >
          SW
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
    </SidebarLabelsInlineContext.Provider>
  );
}
