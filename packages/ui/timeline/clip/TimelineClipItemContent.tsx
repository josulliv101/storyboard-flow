import React from "react";
import { cva } from "class-variance-authority";

import type {
  CollectionEndpoint,
  CollectionTimelineClip,
  TimelineClip,
} from "../types";
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
import { getCollectionAccentGradientByIndex } from "../collection-accent";

export type { ClipItemContentRing };

const clipItemContent = cva(
  "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-all duration-200",
  {
    variants: {
      ring: {
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
  const onCollectionTitleChange =
    clip.kind === "collection" && collectionActions?.onRenameCollection
      ? (title: string) =>
          collectionActions.onRenameCollection?.(
            clip as CollectionTimelineClip,
            title,
          )
      : undefined;

  return (
    <div className={clipItemContent({ ring: view.ring })}>
      {clip.viewRole === "collection-endpoint" &&
        clip.viewCollectionAccentIndex !== undefined && (
          <div
            className="absolute left-0 right-0 top-0 z-10 h-[2.5px] opacity-90"
            data-testid="collection-endpoint-accent-bar"
            style={{
              background: getCollectionAccentGradientByIndex(
                clip.viewCollectionAccentIndex,
              ),
            }}
          />
        )}
      <ClipMediaBody
        clip={clip}
        view={view.media}
        onDurationLoaded={onDurationLoaded}
        collectionHref={clip.kind === "collection" ? view.collection.href : undefined}
        onOpenCollection={collectionActions?.onOpenCollection}
        onCollectionEndpointClick={onCollectionEndpointClick}
        onCollectionTitleChange={onCollectionTitleChange}
      />

      {(clip.kind === "video" || clip.kind === "collection") && (
        <ClipKindBadge kind={clip.kind} />
      )}

      {clip.kind === "collection" && (
        <ClipCollectionControls
          clip={clip as CollectionTimelineClip}
          hasCollectionBreadcrumb={view.collection.hasBreadcrumb}
          breadcrumbLevels={view.collection.breadcrumbLevels}
        />
      )}

      <ClipDurationLabel clip={clip} />

      {view.isGrowingOpposite && <ClipGrowingOppositeOverlay />}

      <ClipTrimOverlay clip={clip} view={view.trim} />
    </div>
  );
}
