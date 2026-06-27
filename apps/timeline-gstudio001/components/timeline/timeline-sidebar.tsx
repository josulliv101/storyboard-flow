"use client";

import React, { useState, useEffect } from "react";
import { Layers, FolderPlus, Image, Video, Film, Hammer, FolderOpen } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ProjectViewMode } from "./timeline-view-state";

type DraggableItem = {
  type: "timeline" | "collection" | "image" | "video";
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

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

export function TimelineSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  return (
    <aside className="w-[260px] border-r border-zinc-800 bg-zinc-900/50 backdrop-blur-md p-6 flex flex-col gap-6 shrink-0 h-screen sticky top-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-widest">
          GStudio Builder
        </h2>
        <p className="text-[10px] text-zinc-500 font-medium">
          Drag blocks onto the workspace to insert them.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer select-none group",
            pathname === "/"
              ? "border-amber-500 bg-amber-500/10 text-amber-300 shadow-lg shadow-amber-500/5"
              : "border-zinc-800 bg-zinc-900/40 hover:border-amber-500/50 hover:bg-amber-500/5"
          )}
        >
          <div className={cn(
            "p-2 rounded transition-colors",
            pathname === "/" ? "bg-amber-500/20 text-amber-400" : "bg-zinc-800 group-hover:bg-amber-500/20 group-hover:text-amber-400"
          )}>
            <FolderOpen className={cn(
              "h-4 w-4 transition-colors",
              pathname === "/" ? "text-amber-400" : "text-zinc-400 group-hover:text-amber-400"
            )} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-zinc-200">
              Projects
            </span>
            <span className="text-[9px] text-zinc-500">
              All timelines
            </span>
          </div>
        </Link>
        <Link
          href={getProjectViewHref("storyboard")}
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer select-none group",
            activeProjectId ? projectView === "storyboard" : pathname === "/storyboard"
              ? "border-amber-500 bg-amber-500/10 text-amber-300 shadow-lg shadow-amber-500/5"
              : "border-zinc-800 bg-zinc-900/40 hover:border-amber-500/50 hover:bg-amber-500/5"
          )}
        >
          <div className={cn(
            "p-2 rounded transition-colors",
            (activeProjectId ? projectView === "storyboard" : pathname === "/storyboard") ? "bg-amber-500/20 text-amber-400" : "bg-zinc-800 group-hover:bg-amber-500/20 group-hover:text-amber-400"
          )}>
            <Film className={cn(
              "h-4 w-4 transition-colors",
              (activeProjectId ? projectView === "storyboard" : pathname === "/storyboard") ? "text-amber-400" : "text-zinc-400 group-hover:text-amber-400"
            )} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-zinc-200">
              Storyboard
            </span>
            <span className="text-[9px] text-zinc-500">
              {activeProjectId ? "Project storyboard" : "Go to storyboard"}
            </span>
          </div>
        </Link>
        <Link
          href={getProjectViewHref("workbench")}
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer select-none group",
            activeProjectId ? projectView === "workbench" : pathname === "/workbench"
              ? "border-amber-500 bg-amber-500/10 text-amber-300 shadow-lg shadow-amber-500/5"
              : "border-zinc-800 bg-zinc-900/40 hover:border-amber-500/50 hover:bg-amber-500/5"
          )}
        >
          <div className={cn(
            "p-2 rounded transition-colors",
            (activeProjectId ? projectView === "workbench" : pathname === "/workbench") ? "bg-amber-500/20 text-amber-400" : "bg-zinc-800 group-hover:bg-amber-500/20 group-hover:text-amber-400"
          )}>
            <Hammer className={cn(
              "h-4 w-4 transition-colors",
              (activeProjectId ? projectView === "workbench" : pathname === "/workbench") ? "text-amber-400" : "text-zinc-400 group-hover:text-amber-400"
            )} />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-zinc-200">
              Workbench
            </span>
            <span className="text-[9px] text-zinc-500">
              {activeProjectId ? "Project workbench" : "Go to workbench"}
            </span>
          </div>
        </Link>
      </div>

      <div className="border-t border-zinc-800/80 my-1 shrink-0" />

      <div className="flex flex-col gap-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => handleDragStart(e, item.type)}
              onDragEnd={handleDragEnd}
              onClick={() => setToastMessage(`Drag this "${item.label}" block onto the workspace to add it!`)}
              className="flex items-center gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:border-sky-500 hover:bg-sky-950/20 hover:text-sky-300 transition-all duration-200 cursor-grab active:cursor-grabbing select-none group"
            >
              <div className="p-2 rounded bg-zinc-800 group-hover:bg-sky-950/50 group-hover:text-sky-400 transition-colors">
                <Icon className="h-4 w-4 text-zinc-400 group-hover:text-sky-400" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-zinc-200 group-hover:text-sky-200">
                  {item.label}
                </span>
                <span className="text-[9px] text-zinc-500 group-hover:text-sky-400/60">
                  {item.description}
                </span>
              </div>
            </div>
          );
        })}
      </div>

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
