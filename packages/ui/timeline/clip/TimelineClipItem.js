"use client";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { cva } from "class-variance-authority";
import { DragPreviewPortal } from "../../drag-drop";
import { TimelineClipItemContent } from "./TimelineClipItemContent";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
import { getTimelineClipItemModel, } from "./TimelineClipItemModel";
function getTimelineClipViewTransitionName(clip) {
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
export const TimelineClipItem = memo(function TimelineClipItem({ clip, state, children, }) {
    const { metrics, collectionActions } = useTimelineClipItemContext();
    const model = getTimelineClipItemModel({
        clip,
        state,
        metrics,
        getCollectionHref: collectionActions === null || collectionActions === void 0 ? void 0 : collectionActions.getCollectionHref,
    });
    const innerContent = children !== null && children !== void 0 ? children : (_jsx(TimelineClipItemContent, { clip: clip, view: model.content }));
    return (_jsxs(_Fragment, { children: [_jsx("div", Object.assign({}, model.dataAttributes, { draggable: false, className: timelineClipItemFrame({
                    reordering: model.frame.isReordering && !model.frame.isLifted,
                    lifted: model.frame.isLifted,
                    collectionHovered: model.frame.isCollectionHovered,
                }), style: {
                    top: `${model.layout.top}px`,
                    width: `${model.layout.width}px`,
                    height: `${model.layout.height}px`,
                    transform: `translateX(${model.layout.left}px)`,
                    zIndex: model.frame.zIndex,
                    viewTransitionName: getTimelineClipViewTransitionName(clip),
                    viewTransitionClass: "timeline-clip-item",
                }, children: innerContent })), _jsx(DragPreviewPortal, { preview: model.reorderPreview, width: model.layout.width, height: model.layout.height, testId: "timeline-reorder-preview", children: innerContent })] }));
});
