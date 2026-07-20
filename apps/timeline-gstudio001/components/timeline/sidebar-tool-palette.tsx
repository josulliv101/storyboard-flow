"use client";

import React from "react";
import { FolderPlus, Image, Video } from "lucide-react";

import { SidebarTooltipLabel } from "./sidebar-tooltip-label";

// The sidebar's "new thing" palette, split out of TimelineSidebar as a PURE
// presentational component: no router, no auth, no drawers. The sidebar as a
// whole can't be rendered in isolation (its AuthProvider fetches /api/auth/me
// on mount, which stories are not allowed to do), and this palette is the part
// whose behavior actually needs covering — a tool can be inserted two ways and
// they must not drift apart.
//
// Two ways in, deliberately:
//   - ACTIVATION (click, Enter, Space) appends to the open timeline. This is
//     the only route available to keyboard, screen-reader, and touch users;
//     these were `div[role="button"]`s whose keys did nothing but show a
//     "drag this" hint, so insertion was pointer-only.
//   - DRAG carries the tool over a strip and picks a POSITION. It stays as the
//     precision affordance, not the only one.

export type SidebarToolType = "collection" | "image" | "video";

export type SidebarToolItem = Readonly<{
  type: SidebarToolType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}>;

export const SIDEBAR_TOOL_ITEMS: readonly SidebarToolItem[] = [
  {
    type: "collection",
    label: "Collection",
    description: "Nested timeline beat",
    icon: FolderPlus,
  },
  { type: "image", label: "Image Clip", description: "Image timeline clip", icon: Image },
  { type: "video", label: "Video Clip", description: "Video timeline clip", icon: Video },
];

export function SidebarToolPalette({
  items = SIDEBAR_TOOL_ITEMS,
  /**
   * Whether activating a tool INSERTS it. False off the graph route, where
   * nothing is listening for the handoff — the label and tooltip then promise
   * only what a drag can deliver, rather than an action that won't happen.
   */
  canInsert,
  onActivate,
  onDragStart,
  onDragEnd,
}: Readonly<{
  items?: readonly SidebarToolItem[];
  canInsert: boolean;
  onActivate: (item: SidebarToolItem) => void;
  onDragStart?: (event: React.DragEvent, type: SidebarToolType) => void;
  onDragEnd?: () => void;
}>) {
  return (
    <div className="flex flex-col items-center gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        const tooltipId = `sidebar-tooltip-new-${item.type}`;

        return (
          <button
            key={item.type}
            type="button"
            aria-label={canInsert ? `Add ${item.label} to the open timeline` : item.label}
            aria-describedby={tooltipId}
            draggable
            onDragStart={(event) => onDragStart?.(event, item.type)}
            onDragEnd={onDragEnd}
            onClick={() => onActivate(item)}
            className="group/sidebar-item relative flex size-11 cursor-grab select-none items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition-all duration-200 hover:border-sky-500 hover:bg-sky-950/20 hover:text-sky-400 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Icon className="h-4 w-4 transition-colors" />
            <SidebarTooltipLabel
              id={tooltipId}
              label={item.label}
              description={
                canInsert
                  ? `${item.description} · click to append, drag to place`
                  : item.description
              }
            />
          </button>
        );
      })}
    </div>
  );
}
