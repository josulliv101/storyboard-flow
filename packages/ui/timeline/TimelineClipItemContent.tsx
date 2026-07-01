import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import type { CollectionEndpoint, CollectionTimelineClip, TimelineClip } from "./types";
import { cn } from "../lib/utils";
import { ClipMediaBody } from "./ClipMediaBody";
import { ClipKindBadge } from "./ClipKindBadge";
import { ClipDurationLabel } from "./ClipDurationLabel";
import { ClipCollectionControls } from "./ClipCollectionControls";
import { ClipGrowingOppositeOverlay } from "./ClipGrowingOppositeOverlay";
import { ClipTrimOverlay } from "./ClipTrimOverlay";

// ---------------------------------------------------------------------------
// CVA recipe — unchanged so callers that use clipItemContent directly still work
// ---------------------------------------------------------------------------

const clipItemContent = cva(
  "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-all duration-200",
  {
    variants: {
      ring: {
        collectionCollapse:
          "ring-2 ring-sky-400/70 border border-dashed border-sky-300/40 bg-sky-950/20 shadow-lg shadow-sky-400/15",
        lifted:
          "ring-2 ring-sky-300 shadow-2xl shadow-sky-400/30",
        collectionHovered:
          "ring-2 ring-sky-400 bg-sky-950/20 shadow-lg shadow-sky-400/40",
        selected:
          "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20",
        default:
          "ring-1 ring-zinc-900",
      },
    },
    defaultVariants: {
      ring: "default",
    },
  },
);

export type ClipItemContentRing = NonNullable<VariantProps<typeof clipItemContent>["ring"]>;

// ---------------------------------------------------------------------------
// Helper: derive ring variant from state flags
// ---------------------------------------------------------------------------

export function getClipItemContentRing({
  isCollectionCollapseCard,
  isLifted,
  isCollectionHovered,
  isSelected,
}: {
  isCollectionCollapseCard: boolean;
  isLifted: boolean;
  isCollectionHovered: boolean;
  isSelected: boolean;
}): ClipItemContentRing {
  if (isCollectionCollapseCard) return "collectionCollapse";
  if (isLifted) return "lifted";
  if (isCollectionHovered) return "collectionHovered";
  if (isSelected) return "selected";
  return "default";
}

// ---------------------------------------------------------------------------
// Props — kept identical to preserve the existing public API
// ---------------------------------------------------------------------------

export type TimelineClipItemContentProps = VariantProps<typeof clipItemContent> & {
  clip: TimelineClip;
  width: number;
  itemHeight: number;
  pixelsPerSecond: number;
  scrubPreviewTime?: number | null;
  isSelected?: boolean;
  isCollectionHovered?: boolean;
  isGrowingOpposite?: boolean;
  thumbnailMode?: boolean;
  isCollectionCollapseCard?: boolean;
  hasCollectionBreadcrumb?: boolean;
  breadcrumbLevels?: number[];
  collectionHref?: string | null;
  onDurationLoaded?: (duration: number) => void;
  collectionEndpointSelection?: Partial<Record<CollectionEndpoint, boolean>>;
  onCollectionEndpointClick?: (endpoint: CollectionEndpoint) => void;
  isCollectionExpanded?: boolean;
  onToggleCollectionExpanded?: (clip: CollectionTimelineClip) => void;
  onOpenCollection?: (timelineId: string, href: string) => void;
  onResizeDown: (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (
    e: React.KeyboardEvent<HTMLDivElement>,
    clip: TimelineClip,
    edge: "left" | "right",
  ) => void;
};

// ---------------------------------------------------------------------------
// Compositor — assembles focused sub-components
// ---------------------------------------------------------------------------

export function TimelineClipItemContent({
  clip,
  width,
  itemHeight,
  pixelsPerSecond,
  scrubPreviewTime = null,
  isSelected = false,
  isCollectionHovered = false,
  isGrowingOpposite = false,
  thumbnailMode = false,
  isCollectionCollapseCard = false,
  hasCollectionBreadcrumb = false,
  breadcrumbLevels = [],
  collectionHref,
  onDurationLoaded,
  collectionEndpointSelection,
  onCollectionEndpointClick,
  isCollectionExpanded = false,
  onToggleCollectionExpanded,
  onOpenCollection,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  onResizeKeyDown,
  ring,
}: TimelineClipItemContentProps) {
  return (
    <div className={cn(clipItemContent({ ring }))}>
      <ClipMediaBody
        clip={clip}
        displayWidth={width}
        previewTime={scrubPreviewTime}
        itemHeight={itemHeight}
        pixelsPerSecond={pixelsPerSecond}
        onDurationLoaded={onDurationLoaded}
        collectionEndpointSelection={collectionEndpointSelection}
        onCollectionEndpointClick={onCollectionEndpointClick}
      />

      {(clip.kind === "video" || clip.kind === "collection") && (
        <ClipKindBadge kind={clip.kind} />
      )}

      {clip.kind === "collection" && (
        <ClipCollectionControls
          clip={clip as CollectionTimelineClip}
          collectionHref={collectionHref}
          hasCollectionBreadcrumb={hasCollectionBreadcrumb}
          breadcrumbLevels={breadcrumbLevels}
          isCollectionExpanded={isCollectionExpanded}
          onToggleCollectionExpanded={onToggleCollectionExpanded}
          onOpenCollection={onOpenCollection}
        />
      )}

      <ClipDurationLabel clip={clip} />

      {isGrowingOpposite && <ClipGrowingOppositeOverlay />}

      <ClipTrimOverlay
        isSelected={isSelected}
        thumbnailMode={thumbnailMode}
        isCollectionCollapseCard={isCollectionCollapseCard}
        width={width}
        clip={clip}
        onResizeDown={onResizeDown}
        onResizeMove={onResizeMove}
        onResizeUp={onResizeUp}
        onResizeKeyDown={onResizeKeyDown}
      />
    </div>
  );
}
