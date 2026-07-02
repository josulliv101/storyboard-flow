"use client";

import React, { memo } from "react";
import { cva } from "class-variance-authority";

import type { TimelineClip } from "../types";
import { DragPreviewPortal } from "../../drag-drop";
import { TimelineClipItemContent } from "./TimelineClipItemContent";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
import {
  getTimelineClipItemModel,
  type TimelineClipItemState,
  type TimelineReorderPreview,
} from "./TimelineClipItemModel";

export type { TimelineClipItemState, TimelineReorderPreview };

export type TimelineClipItemProps = {
  clip: TimelineClip;
  state?: TimelineClipItemState;
  children?: React.ReactNode;
};

function getTimelineClipViewTransitionName(clip: TimelineClip) {
  return `timeline-clip-${clip.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const timelineClipItemFrame = cva("absolute cursor-grab active:cursor-grabbing", {
  variants: {
    reordering: {
      true: "transition-transform duration-200 ease-out",
      false: "",
    },
    lifted: {
      true: "pointer-events-none opacity-25",
      false: "",
    },
    collectionHovered: {
      true: "scale-[1.03] z-50 transition-transform duration-200",
      false: "",
    },
  },
  defaultVariants: {
    reordering: false,
    lifted: false,
    collectionHovered: false,
  },
});

export const TimelineClipItem = memo(function TimelineClipItem({
  clip,
  state,
  children,
}: TimelineClipItemProps) {
  const { metrics, collectionActions } = useTimelineClipItemContext();
  const model = getTimelineClipItemModel({
    clip,
    state,
    metrics,
    getCollectionHref: collectionActions?.getCollectionHref,
  });

  const innerContent = children ?? (
    <TimelineClipItemContent clip={clip} view={model.content} />
  );

  return (
    <>
      <div
        {...model.dataAttributes}
        draggable={false}
        className={timelineClipItemFrame({
          reordering: model.frame.isReordering && !model.frame.isLifted,
          lifted: model.frame.isLifted,
          collectionHovered: model.frame.isCollectionHovered,
        })}
        style={{
          top: `${model.layout.top}px`,
          width: `${model.layout.width}px`,
          height: `${model.layout.height}px`,
          transform: `translateX(${model.layout.left}px)`,
          zIndex: model.frame.zIndex,
          viewTransitionName: getTimelineClipViewTransitionName(clip),
          viewTransitionClass: "timeline-clip-item",
        }}
      >
        {innerContent}
      </div>

      <DragPreviewPortal
        preview={model.reorderPreview}
        width={model.layout.width}
        height={model.layout.height}
        testId="timeline-reorder-preview"
      >
        {innerContent}
      </DragPreviewPortal>
    </>
  );
});
