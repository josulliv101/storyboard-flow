"use client";

import React from "react";
import { Layers, FolderPlus, Image, Video } from "lucide-react";

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
  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData("application/x-gstudio-type", type);
    e.dataTransfer.effectAllowed = "copyMove";
    
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

      <div className="flex flex-col gap-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => handleDragStart(e, item.type)}
              onDragEnd={handleDragEnd}
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
    </aside>
  );
}
