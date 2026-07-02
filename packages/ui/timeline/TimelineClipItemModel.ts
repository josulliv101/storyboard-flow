import type { DragPreviewCoordinates } from "../drag-drop";
import type { CollectionEndpoint, TimelineClip } from "./types";
import type { TimelineClipItemMetrics } from "./TimelineClipItemContext";
import { getTimelineGridItemLayout } from "./timeline-grid";

export type TimelineReorderPreview = DragPreviewCoordinates & {
  activeClipId: string;
  dragLeft: number;
  dragTop: number;
  dragOffsetY: number;
  targetIndex: number;
};

export type TimelineClipItemState = {
  isSelected?: boolean;
  scrubPreviewTime?: number | null;
  isGrowingOpposite?: boolean;
  isReordering?: boolean;
  isCollectionHovered?: boolean;
  reorderPreview?: TimelineReorderPreview | null;
  isCollectionExpanded?: boolean;
  collectionEndpointSelection?: Partial<Record<CollectionEndpoint, boolean>>;
};

export type ClipItemContentRing =
  | "collectionCollapse"
  | "lifted"
  | "collectionHovered"
  | "selected"
  | "default";

export type TimelineClipLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
  thumbnailMode: boolean;
};

export type TimelineClipMediaView = {
  displayWidth: number;
  previewTime: number | null;
  collectionEndpointSelection?: Partial<Record<CollectionEndpoint, boolean>>;
};

export type TimelineClipCollectionView = {
  isCollapseCard: boolean;
  hasBreadcrumb: boolean;
  breadcrumbLevels: number[];
  href: string | null;
  isExpanded: boolean;
};

export type TimelineClipTrimView = {
  isSelected: boolean;
  thumbnailMode: boolean;
  isCollectionCollapseCard: boolean;
  width: number;
};

export type TimelineClipItemContentView = {
  ring: ClipItemContentRing;
  media: TimelineClipMediaView;
  collection: TimelineClipCollectionView;
  trim: TimelineClipTrimView;
  isGrowingOpposite: boolean;
  isCollectionHovered: boolean;
};

export type TimelineClipFrameView = {
  isSelected: boolean;
  isLifted: boolean;
  isReordering: boolean;
  isCollectionHovered: boolean;
  zIndex: number;
};

export type TimelineClipItemModel = {
  layout: TimelineClipLayout;
  frame: TimelineClipFrameView;
  content: TimelineClipItemContentView;
  reorderPreview: TimelineReorderPreview | null;
  dataAttributes: Record<string, string | number | boolean>;
};

type GetTimelineClipItemModelOptions = {
  clip: TimelineClip;
  state?: TimelineClipItemState;
  metrics: TimelineClipItemMetrics;
  getCollectionHref?: (timelineId: string) => string;
};

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

export function getTimelineClipItemModel({
  clip,
  state = {},
  metrics,
  getCollectionHref,
}: GetTimelineClipItemModelOptions): TimelineClipItemModel {
  const itemHeight = metrics.itemHeight;
  const thumbnailMode = metrics.thumbnailMode ?? false;
  const thumbnailWidth = metrics.thumbnailWidth ?? (itemHeight * 16) / 9;
  const thumbnailGap = metrics.thumbnailGap ?? 16;
  const gridLayout =
    thumbnailMode && metrics.gridMetrics?.enabled
      ? getTimelineGridItemLayout(clip.index, metrics.gridMetrics)
      : null;
  const layout = gridLayout
    ? {
        left: gridLayout.left,
        top: metrics.itemTop + gridLayout.top,
        width: gridLayout.width,
        height: itemHeight,
        thumbnailMode,
      }
    : thumbnailMode
      ? {
          left: clip.index * (thumbnailWidth + thumbnailGap),
          top: metrics.itemTop,
          width: thumbnailWidth,
          height: itemHeight,
          thumbnailMode,
        }
      : {
          left: clip.startTime * metrics.pixelsPerSecond,
          top: metrics.itemTop,
          width: clip.duration * metrics.pixelsPerSecond,
          height: itemHeight,
          thumbnailMode,
        };

  const isSelected = state.isSelected ?? false;
  const isLifted = Boolean(state.reorderPreview);
  const isCollectionHovered = state.isCollectionHovered ?? false;
  const isCollectionCollapseCard =
    clip.kind === "collection" && clip.viewRole === "collection-collapse";
  const hasCollectionBreadcrumb = Boolean(clip.viewRole);
  const breadcrumbLevelCount = hasCollectionBreadcrumb
    ? Math.max(
        1,
        clip.viewRole === "collection-collapse"
          ? (clip.viewDepth ?? 0) + 1
          : (clip.viewDepth ?? 1),
      )
    : 0;

  return {
    layout,
    frame: {
      isSelected,
      isLifted,
      isReordering: state.isReordering ?? false,
      isCollectionHovered,
      zIndex: isSelected ? 40 : isCollectionHovered ? 35 : 10,
    },
    content: {
      ring: getClipItemContentRing({
        isCollectionCollapseCard,
        isLifted,
        isCollectionHovered,
        isSelected,
      }),
      media: {
        displayWidth: layout.width,
        previewTime: state.scrubPreviewTime ?? null,
        collectionEndpointSelection: state.collectionEndpointSelection,
      },
      collection: {
        isCollapseCard: isCollectionCollapseCard,
        hasBreadcrumb: hasCollectionBreadcrumb,
        breadcrumbLevels: Array.from(
          { length: Math.min(breadcrumbLevelCount, 4) },
          (_, level) => level,
        ),
        href:
          clip.kind === "collection"
            ? getCollectionHref?.(clip.childTimelineId) ?? null
            : null,
        isExpanded: state.isCollectionExpanded ?? false,
      },
      trim: {
        isSelected,
        thumbnailMode,
        isCollectionCollapseCard,
        width: layout.width,
      },
      isGrowingOpposite: state.isGrowingOpposite ?? false,
      isCollectionHovered,
    },
    reorderPreview: state.reorderPreview ?? null,
    dataAttributes: {
      "data-clip-index": clip.index,
      "data-testid": `timeline-clip-${clip.index}`,
      "data-clip-id": clip.id,
      "data-start-time": clip.startTime,
      "data-duration": clip.duration,
      "data-source-duration": clip.sourceDuration,
      "data-trim-in": clip.trimIn,
      "data-trim-out": clip.trimOut,
      "data-selected": isSelected,
      "data-reordering": isLifted,
      "data-is-first": clip.index === 0,
      "data-view-role": clip.viewRole ?? "",
      "data-view-endpoint": clip.viewEndpoint ?? "",
      "data-expansion-key": clip.viewExpansionKey ?? "",
      "data-source-timeline-id": clip.viewSourceTimelineId ?? "",
      "data-source-clip-id": clip.viewSourceClipId ?? "",
      "data-view-depth": clip.viewDepth ?? "",
    },
  };
}
