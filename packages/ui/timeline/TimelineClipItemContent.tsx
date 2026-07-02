import React from "react";
import { cva } from "class-variance-authority";

import type {
  CollectionEndpoint,
  CollectionTimelineClip,
  TimelineClip,
} from "./types";
import { ClipMediaBody } from "./ClipMediaBody";
import { ClipKindBadge } from "./ClipKindBadge";
import { ClipDurationLabel } from "./ClipDurationLabel";
import { ClipCollectionControls } from "./ClipCollectionControls";
import { ClipGrowingOppositeOverlay } from "./ClipGrowingOppositeOverlay";
import { ClipTrimOverlay } from "./ClipTrimOverlay";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
import type {
  ClipItemContentRing,
  TimelineClipItemContentView,
} from "./TimelineClipItemModel";

export type { ClipItemContentRing };

const clipItemContent = cva(
  "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-all duration-200",
  {
    variants: {
      ring: {
        collectionCollapse:
          "ring-2 ring-sky-400/70 border border-dashed border-sky-300/40 bg-sky-950/20 shadow-lg shadow-sky-400/15",
        lifted: "ring-2 ring-sky-300 shadow-2xl shadow-sky-400/30",
        collectionHovered:
          "ring-2 ring-sky-400 bg-sky-950/20 shadow-lg shadow-sky-400/40",
        selected: "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20",
        default: "ring-1 ring-zinc-900",
      } satisfies Record<ClipItemContentRing, string>,
    },
    defaultVariants: {
      ring: "default",
    },
  },
);

export type TimelineClipItemContentProps = {
  clip: TimelineClip;
  view: TimelineClipItemContentView;
};

export function TimelineClipItemContent({
  clip,
  view,
}: TimelineClipItemContentProps) {
  const { collectionActions, mediaActions } = useTimelineClipItemContext();
  const onDurationLoaded =
    mediaActions?.onDurationLoaded && !clip.viewRole
      ? (duration: number) => mediaActions.onDurationLoaded?.(clip.index, duration)
      : undefined;
  const onCollectionEndpointClick =
    clip.kind === "collection" && collectionActions?.onToggleCollectionEndpoint
      ? (endpoint: CollectionEndpoint) =>
          collectionActions.onToggleCollectionEndpoint?.(
            clip as CollectionTimelineClip,
            endpoint,
          )
      : undefined;

  return (
    <div className={clipItemContent({ ring: view.ring })}>
      <ClipMediaBody
        clip={clip}
        view={view.media}
        onDurationLoaded={onDurationLoaded}
        onCollectionEndpointClick={onCollectionEndpointClick}
      />

      {(clip.kind === "video" || clip.kind === "collection") && (
        <ClipKindBadge kind={clip.kind} />
      )}

      {clip.kind === "collection" && (
        <ClipCollectionControls
          clip={clip as CollectionTimelineClip}
          collectionHref={view.collection.href}
          hasCollectionBreadcrumb={view.collection.hasBreadcrumb}
          breadcrumbLevels={view.collection.breadcrumbLevels}
          isCollectionExpanded={view.collection.isExpanded}
          onToggleCollectionExpanded={collectionActions?.onToggleCollectionExpanded}
          onOpenCollection={collectionActions?.onOpenCollection}
        />
      )}

      <ClipDurationLabel clip={clip} />

      {view.isGrowingOpposite && <ClipGrowingOppositeOverlay />}

      <ClipTrimOverlay clip={clip} view={view.trim} />
    </div>
  );
}
