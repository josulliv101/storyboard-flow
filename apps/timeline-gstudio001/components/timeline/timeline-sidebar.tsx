"use client";

import React, { useState, useEffect } from "react";
import {
  Images,
  Layers,
  FolderPlus,
  Image,
  Video,
  Film,
  Hammer,
  Settings,
  UserCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AssetLibraryDrawer } from "@/components/assets/asset-library-drawer";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/utils";
import type { ProjectViewMode } from "./timeline-view-state";

type DraggableItem = {
  type: "timeline" | "collection" | "image" | "video";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

type UtilityItem = {
  id: "assets" | "settings";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

type TooltipLabelProps = {
  id: string;
  label: string;
  description?: string;
};

function TooltipLabel({ id, label, description }: TooltipLabelProps) {
  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 min-w-max -translate-y-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-left opacity-0 shadow-xl shadow-black/30 transition-opacity duration-150 group-hover/sidebar-item:opacity-100 group-focus-visible/sidebar-item:opacity-100"
    >
      <span className="block whitespace-nowrap text-xs font-semibold text-zinc-100">
        {label}
      </span>
      {description ? (
        <span className="mt-0.5 block whitespace-nowrap text-[10px] font-medium text-zinc-500">
          {description}
        </span>
      ) : null}
    </span>
  );
}

type IconLinkProps = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  label: string;
  description: string;
};

function IconLink({
  href,
  icon: Icon,
  isActive,
  label,
  description,
}: IconLinkProps) {
  const tooltipId = `sidebar-tooltip-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <Link
      href={href}
      aria-label={label}
      aria-describedby={tooltipId}
      className={cn(
        "group/sidebar-item relative flex size-11 items-center justify-center rounded-lg border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
        isActive
          ? "border-amber-500 bg-amber-500/10 text-amber-300 shadow-lg shadow-amber-500/5"
          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-amber-500/50 hover:bg-amber-500/5 hover:text-amber-400",
      )}
    >
      <Icon className="h-4 w-4 transition-colors" />
      <TooltipLabel id={tooltipId} label={label} description={description} />
    </Link>
  );
}

const ITEMS: DraggableItem[] = [
  {
    type: "timeline",
    label: "Timeline",
    description: "New timeline layer",
    icon: Layers,
  },
  {
    type: "collection",
    label: "Collection",
    description: "Nested timeline beat",
    icon: FolderPlus,
  },
  {
    type: "image",
    label: "Image Clip",
    description: "Image timeline clip",
    icon: Image,
  },
  {
    type: "video",
    label: "Video Clip",
    description: "Video timeline clip",
    icon: Video,
  },
];

const UTILITY_ITEMS: UtilityItem[] = [
  {
    id: "assets",
    label: "Assets",
    description: "Media and project assets",
    icon: Images,
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
  const searchParams = useSearchParams();
  const { user, logout } = useAuth();
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const pathSegments = pathname.split("/").filter(Boolean);
  const activeProjectId =
    pathSegments[0] === "timeline" && pathSegments[1]?.startsWith("project-")
      ? pathSegments[1]
      : undefined;
  const projectView: ProjectViewMode | null = activeProjectId
    ? pathSegments[2] === "workbench"
      ? "workbench"
      : "storyboard"
    : null;
  const activeTimelinePath = activeProjectId ? pathSegments.slice(3).join("/") : "";

  const getProjectViewHref = (mode: ProjectViewMode) => {
    if (!activeProjectId) return mode === "storyboard" ? "/storyboard" : "/workbench";

    const search = searchParams.toString();
    const childPath = activeTimelinePath ? `/${activeTimelinePath}` : "";
    return `/timeline/${encodeURIComponent(activeProjectId)}/${mode}${childPath}${
      search ? `?${search}` : ""
    }`;
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData("application/x-gstudio-type", type);
    e.dataTransfer.effectAllowed = "copyMove";
    
    // Create a transparent 1x1 base64 GIF to hide the browser's default drag ghost preview
    const img = new window.Image();
    img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    e.dataTransfer.setDragImage(img, 0, 0);

    // Dispatch window event so viewports / drop zones highlight
    window.dispatchEvent(
      new CustomEvent("gstudio-drag-start", { detail: { type } })
    );
  };

  const handleDragEnd = () => {
    window.dispatchEvent(new CustomEvent("gstudio-drag-end"));
  };

  const showDragToast = (label: string) => {
    setToastMessage(`Drag this "${label}" block onto the workspace to add it!`);
  };

  const showUtilityToast = (label: string) => {
    setToastMessage(`${label} controls are not available yet.`);
  };

  const handleLogout = async () => {
    try {
      await logout();
      setToastMessage("Signed out.");
    } catch {
      setToastMessage("Unable to sign out.");
    }
  };

  return (
    <aside className="sticky top-0 z-40 flex h-screen w-[72px] shrink-0 flex-col items-center gap-5 overflow-visible border-r border-zinc-800 bg-zinc-900/50 px-3 py-5 backdrop-blur-md">
      <Link
        href="/"
        aria-label="Storyboard Workbench home"
        className="flex size-11 items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/10 text-[13px] font-black text-amber-300 shadow-lg shadow-amber-500/5 transition-colors hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        SW
      </Link>

      {activeProjectId && (
        <div className="flex flex-col items-center gap-2">
          <IconLink
            href={getProjectViewHref("storyboard")}
            icon={Film}
            isActive={projectView === "storyboard"}
            label="Storyboard"
            description="Project storyboard"
          />
          <IconLink
            href={getProjectViewHref("workbench")}
            icon={Hammer}
            isActive={projectView === "workbench"}
            label="Workbench"
            description="Project workbench"
          />
        </div>
      )}

      {activeProjectId && (
        <>
          <div className="h-px w-10 shrink-0 bg-zinc-800/80" />

          <div className="flex flex-col items-center gap-2">
            {ITEMS.map((item) => {
              const Icon = item.icon;
              const tooltipId = `sidebar-tooltip-new-${item.type}`;

              return (
                <div
                  key={item.type}
                  role="button"
                  tabIndex={0}
                  aria-label={item.label}
                  aria-describedby={tooltipId}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.type)}
                  onDragEnd={handleDragEnd}
                  onClick={() => showDragToast(item.label)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    showDragToast(item.label);
                  }}
                  className="group/sidebar-item relative flex size-11 cursor-grab select-none items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition-all duration-200 hover:border-sky-500 hover:bg-sky-950/20 hover:text-sky-400 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  <Icon className="h-4 w-4 transition-colors" />
                  <TooltipLabel
                    id={tooltipId}
                    label={item.label}
                    description={item.description}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          type="button"
          aria-label="Account"
          aria-describedby="sidebar-tooltip-utility-account"
          onClick={() => void handleLogout()}
          className="group/sidebar-item relative flex size-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition-all duration-200 hover:border-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        >
          <UserCircle className="h-4 w-4 transition-colors" />
          <TooltipLabel
            id="sidebar-tooltip-utility-account"
            label="Account"
            description={user?.email ? `Signed in as ${user.email}` : "Signed in"}
          />
        </button>

        {UTILITY_ITEMS.map((item) => {
          const Icon = item.icon;
          const tooltipId = `sidebar-tooltip-utility-${item.id}`;
          const handleClick =
            item.id === "assets"
              ? () => setIsAssetLibraryOpen(true)
              : () => showUtilityToast(item.label);

          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-describedby={tooltipId}
              onClick={handleClick}
              className="group/sidebar-item relative flex size-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition-all duration-200 hover:border-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              <Icon className="h-4 w-4 transition-colors" />
              <TooltipLabel
                id={tooltipId}
                label={item.label}
                description={item.description}
              />
            </button>
          );
        })}
      </div>

      <AssetLibraryDrawer
        isOpen={isAssetLibraryOpen}
        onClose={() => setIsAssetLibraryOpen(false)}
      />

      {toastMessage && (
        <>
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
          `}</style>
          <div
            style={{
              position: "fixed",
              top: "24px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 10000,
            }}
            className="timeline-toast-animate flex h-10 items-center gap-2.5 rounded-full border border-sky-500/30 bg-zinc-900/95 px-5 text-xs font-medium text-zinc-100 shadow-2xl backdrop-blur-md select-none"
          >
            <Layers className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            <span className="text-zinc-200">
              {toastMessage}
            </span>
          </div>
        </>
      )}
    </aside>
  );
}
