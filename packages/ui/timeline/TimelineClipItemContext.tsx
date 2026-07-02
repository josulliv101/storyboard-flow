"use client";

import React, { createContext, useContext } from "react";

import type {
  CollectionEndpoint,
  CollectionTimelineClip,
  TimelineClip,
} from "./types";
import type { TimelineGridMetrics } from "./timeline-grid";

export type TimelineClipItemMetrics = {
  pixelsPerSecond: number;
  itemTop: number;
  itemHeight: number;
  gridMetrics?: TimelineGridMetrics;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  thumbnailGap?: number;
};

export type TimelineClipResizeHandlers = {
  onResizeDown: (
    event: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
  onResizeMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
};

export type TimelineClipMediaActions = {
  onDurationLoaded?: (index: number, duration: number) => void;
};

export type TimelineClipCollectionActions = {
  getCollectionHref?: (timelineId: string) => string;
  onOpenCollection?: (timelineId: string, href: string) => void;
  onToggleCollectionExpanded?: (clip: CollectionTimelineClip) => void;
  onToggleCollectionEndpoint?: (
    clip: CollectionTimelineClip,
    endpoint: CollectionEndpoint,
  ) => void;
};

export type TimelineClipItemContextValue = {
  metrics: TimelineClipItemMetrics;
  resizeHandlers: TimelineClipResizeHandlers;
  mediaActions?: TimelineClipMediaActions;
  collectionActions?: TimelineClipCollectionActions;
};

const TimelineClipItemContext = createContext<TimelineClipItemContextValue | null>(null);

export type TimelineClipItemProviderProps = {
  value: TimelineClipItemContextValue;
  children: React.ReactNode;
};

export function TimelineClipItemProvider({
  value,
  children,
}: TimelineClipItemProviderProps) {
  return (
    <TimelineClipItemContext.Provider value={value}>
      {children}
    </TimelineClipItemContext.Provider>
  );
}

export function useTimelineClipItemContext() {
  const value = useContext(TimelineClipItemContext);

  if (!value) {
    throw new Error("Timeline clip item components must be rendered inside TimelineClipItemProvider.");
  }

  return value;
}
