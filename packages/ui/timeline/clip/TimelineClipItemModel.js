import { getTimelineGridItemLayout } from "../timeline-grid";
export function getClipItemContentRing({ isLifted, isCollectionHovered, isSelected, }) {
    if (isLifted)
        return "lifted";
    if (isCollectionHovered)
        return "collectionHovered";
    if (isSelected)
        return "selected";
    return "default";
}
export function getTimelineClipItemModel({ clip, state = {}, metrics, getCollectionHref, }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
    const itemHeight = metrics.itemHeight;
    const thumbnailMode = (_a = metrics.thumbnailMode) !== null && _a !== void 0 ? _a : false;
    const thumbnailWidth = (_b = metrics.thumbnailWidth) !== null && _b !== void 0 ? _b : (itemHeight * 16) / 9;
    const thumbnailGap = (_c = metrics.thumbnailGap) !== null && _c !== void 0 ? _c : 16;
    const gridLayout = thumbnailMode && ((_d = metrics.gridMetrics) === null || _d === void 0 ? void 0 : _d.enabled)
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
    const isSelected = (_e = state.isSelected) !== null && _e !== void 0 ? _e : false;
    const usesSelectionTrimAffordance = isSelected && clip.kind !== "collection";
    const isLifted = Boolean(state.reorderPreview);
    const isCollectionHovered = (_f = state.isCollectionHovered) !== null && _f !== void 0 ? _f : false;
    const hasCollectionBreadcrumb = Boolean(clip.viewRole);
    const breadcrumbLevelCount = hasCollectionBreadcrumb
        ? Math.max(1, (_g = clip.viewDepth) !== null && _g !== void 0 ? _g : 1)
        : 0;
    return {
        layout,
        frame: {
            isSelected,
            isLifted,
            isReordering: (_h = state.isReordering) !== null && _h !== void 0 ? _h : false,
            isCollectionHovered,
            zIndex: isSelected ? 40 : isCollectionHovered ? 35 : 10,
        },
        content: {
            ring: getClipItemContentRing({
                isLifted,
                isCollectionHovered,
                isSelected: usesSelectionTrimAffordance,
            }),
            media: {
                displayWidth: layout.width,
                previewTime: (_j = state.scrubPreviewTime) !== null && _j !== void 0 ? _j : null,
                collectionEndpointSelection: state.collectionEndpointSelection,
            },
            collection: {
                hasBreadcrumb: hasCollectionBreadcrumb,
                breadcrumbLevels: Array.from({ length: Math.min(breadcrumbLevelCount, 4) }, (_, level) => level),
                href: clip.kind === "collection"
                    ? (_k = getCollectionHref === null || getCollectionHref === void 0 ? void 0 : getCollectionHref(clip.childTimelineId)) !== null && _k !== void 0 ? _k : null
                    : null,
            },
            trim: {
                isSelected: usesSelectionTrimAffordance,
                thumbnailMode,
                width: layout.width,
            },
            isGrowingOpposite: (_l = state.isGrowingOpposite) !== null && _l !== void 0 ? _l : false,
            isCollectionHovered,
        },
        reorderPreview: (_m = state.reorderPreview) !== null && _m !== void 0 ? _m : null,
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
            "data-view-role": (_o = clip.viewRole) !== null && _o !== void 0 ? _o : "",
            "data-view-endpoint": (_p = clip.viewEndpoint) !== null && _p !== void 0 ? _p : "",
            "data-parent-collection-key": (_q = clip.viewParentCollectionKey) !== null && _q !== void 0 ? _q : "",
            "data-expansion-key": (_r = clip.viewExpansionKey) !== null && _r !== void 0 ? _r : "",
            "data-source-timeline-id": (_s = clip.viewSourceTimelineId) !== null && _s !== void 0 ? _s : "",
            "data-source-clip-id": (_t = clip.viewSourceClipId) !== null && _t !== void 0 ? _t : "",
            "data-view-depth": (_u = clip.viewDepth) !== null && _u !== void 0 ? _u : "",
        },
    };
}
