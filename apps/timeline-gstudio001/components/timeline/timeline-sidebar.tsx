"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Images,
  Layers,
  FolderTree,
  GalleryHorizontalEnd,
  LayoutGrid,
  Ruler,
  Settings,
  TvMinimal,
  LogOut,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AssetLibraryDrawer } from "@/components/assets/asset-library-drawer";
import { TrashDrawer } from "@/components/assets/trash-drawer";
import { useAuth } from "@/components/auth/auth-provider";
import {
  GRAPH_ASSETS_TOGGLE_EVENT,
  GRAPH_TRASH_ARRIVAL_EVENT,
  GRAPH_VIEW_STATE_EVENT,
  isGraphViewRoute,
  requestGraphChildrenToggle,
  requestGraphPreviewToggle,
  requestGraphRulerToggle,
  requestGraphSurface,
  type GraphSurface,
  type GraphViewStateDetail,
} from "@/lib/graph-view-events";
import { toast } from "@/components/core/sonner";
import { cn } from "@/lib/utils";

import { SidebarTooltipLabel } from "./sidebar-tooltip-label";

type UtilityItem = {
  id: "assets" | "trash" | "settings";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

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
    icon: Trash2,
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
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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
  });
  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<GraphViewStateDetail>).detail;
      if (detail) setGraphView(detail);
    };
    window.addEventListener(GRAPH_VIEW_STATE_EVENT, onState);
    return () => window.removeEventListener(GRAPH_VIEW_STATE_EVENT, onState);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const handleToastEvent = (e: any) => {
      if (e.detail?.message) {
        setToastMessage(e.detail.message);
      }
    };
    window.addEventListener("gstudio-toast" as any, handleToastEvent);
    return () => window.removeEventListener("gstudio-toast" as any, handleToastEvent);
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

  const onGraphRoute = isGraphViewRoute(pathname);

  const handleLogout = async () => {
    try {
      await logout();
      setToastMessage("Signed out.");
    } catch {
      setToastMessage("Unable to sign out.");
    }
  };

  // z-50, not z-40: the aside is sticky, so it IS a stacking context and
  // every child z-index (the fly-out tooltips' z-50 included) is trapped
  // inside it. The preview region + graph header sit at z-40 later in the
  // DOM, which painted over the tooltips at equal z — the whole column must
  // outrank them (R7 #8). Nothing overlaps the 72px rail itself, so raising
  // it hides nothing.
  return (
    <aside className="sticky top-0 z-50 flex h-screen w-[72px] shrink-0 flex-col items-center gap-5 overflow-visible border-r border-zinc-800 bg-zinc-900/50 px-3 py-5 backdrop-blur-md">
      <Link
        href="/"
        aria-label="Storyboard Workbench home"
        className="flex size-11 items-center justify-center rounded-lg border border-zinc-700/55 bg-zinc-800/35 text-[13px] font-black text-zinc-400 shadow-sm shadow-black/10 transition-colors hover:border-zinc-600/70 hover:bg-zinc-800/55 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
      >
        SW
      </Link>

      {activeProjectId && (
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

      {activeProjectId && (
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
          </div>
        </>
      )}

      <div className="mt-auto flex flex-col items-center gap-2 relative">
        {UTILITY_ITEMS.map((item) => {
          const Icon = item.icon;
          const tooltipId = `sidebar-tooltip-utility-${item.id}`;
          const isPressed =
            (item.id === "assets" && isAssetLibraryOpen) ||
            (item.id === "trash" && isTrashOpen);
          const handleClick =
            item.id === "assets"
              ? () => {
                  // On graph routes the asset surface is the graph view's own
                  // palette drawer (its drags work with dnd-collections; the
                  // legacy drawer's can't land there) — hand off to it.
                  if (isGraphViewRoute(pathname)) {
                    window.dispatchEvent(new CustomEvent(GRAPH_ASSETS_TOGGLE_EVENT));
                    setIsTrashOpen(false);
                    return;
                  }
                  setIsAssetLibraryOpen(!isAssetLibraryOpen);
                  setIsTrashOpen(false);
                }
              : item.id === "trash"
                ? () => {
                    setIsTrashOpen(!isTrashOpen);
                    setIsAssetLibraryOpen(false);
                  }
                : // Placeholder until real settings exist — and the app's
                  // first sonner-driven surface, next to the legacy
                  // `gstudio-toast` pill the trash drawer still uses.
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

      <AssetLibraryDrawer
        isOpen={isAssetLibraryOpen}
        onClose={() => setIsAssetLibraryOpen(false)}
      />

      <TrashDrawer
        isOpen={isTrashOpen}
        onClose={() => setIsTrashOpen(false)}
      />

      <style>{`
        @keyframes slideDown {
          from {
            transform: translate(-50%, -20px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
        .timeline-toast-animate {
          animation: slideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
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

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
          }}
          className="timeline-toast-animate flex h-10 items-center gap-2.5 rounded-full border border-sky-500/30 bg-zinc-900/95 px-5 text-xs font-medium text-zinc-100 shadow-2xl backdrop-blur-md select-none"
        >
          <Layers className="h-3.5 w-3.5 text-sky-400 shrink-0" aria-hidden="true" />
          <span className="text-zinc-200">
            {toastMessage}
          </span>
        </div>
      )}
    </aside>
  );
}
