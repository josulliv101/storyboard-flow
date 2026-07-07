"use client";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "../../lib/utils";
import { DEFAULT_PIXELS_PER_SECOND, ITEM_HEIGHTS, MIN_WIDTH, TIMELINE_LEADING_PADDING_SECONDS, CLIP_GAP_SECONDS, VIDEO_SOURCES, } from "../constants";
import { useTimelineClipState } from "../hooks/use-timeline-clip-state";
import { useTimelineInteractions } from "../hooks/use-timeline-interactions";
import { useTimelineLayout } from "../hooks/use-timeline-layout";
import { useTimelineMediaDuration } from "../hooks/use-timeline-media-duration";
import { useTimelineOverhang } from "../hooks/use-timeline-overhang";
import { useTimelineScrollState } from "../hooks/use-timeline-scroll-state";
import { useTimelineZoom } from "../hooks/use-timeline-zoom";
import { TimelineOverhangHint } from "../overlays/timeline-overhang-hint";
import { TimelineToolbar } from "../controls/timeline-toolbar";
import { getTimelineGridContentHeight, getTimelineGridMetrics, } from "../timeline-grid";
import { TimelineViewport } from "./timeline-viewport";
import { appendTimelineViewStateToHref, } from "../timeline-view-state";
import { startTimelineFadeNavigation } from "../timeline-route-fade";
import { reindexAndPackClips } from "../hooks/use-timeline-clips";
import { createInitialTimelineDocuments, createTimelineDocumentsState, getFolderPathFromTimelineId, encodeFolderPath, } from "../timeline-documents";
import { TimelineDocumentsProvider, useOptionalTimelineDocuments, useTimelineDocuments, } from "../timeline-document-store";
import { TimelineKeyboardShortcuts } from "./timeline-keyboard-shortcuts";
import { useTimelineUploadHandler } from "./use-timeline-upload-handler";
import { useTimelinePersistenceProvider } from "./use-timeline-persistence-provider";
import { TimelineHierarchyView } from "./timeline-hierarchy-view";
function runTimelineEndpointViewTransition(update) {
    if (typeof document === "undefined") {
        update();
        return;
    }
    const transitionDocument = document;
    if (!transitionDocument.startViewTransition) {
        update();
        return;
    }
    document.documentElement.dataset.timelineEndpointTransition = "active";
    const transition = transitionDocument.startViewTransition(() => {
        flushSync(update);
    });
    transition.finished.finally(() => {
        if (document.documentElement.dataset.timelineEndpointTransition === "active") {
            delete document.documentElement.dataset.timelineEndpointTransition;
        }
    });
}
function getInlineExpansionKey(parentKey, clipId) {
    return parentKey ? `${parentKey}/${clipId}` : clipId;
}
function getCollectionEndpointKey(collectionKey, endpoint) {
    return `${collectionKey}::${endpoint}`;
}
function getCollectionEndpointClip(getTimelineDocument, collectionClip, endpoint) {
    var _a;
    const childDoc = getTimelineDocument(collectionClip.childTimelineId);
    const childClips = (_a = childDoc === null || childDoc === void 0 ? void 0 : childDoc.clips) !== null && _a !== void 0 ? _a : [];
    if (childClips.length === 0)
        return null;
    return endpoint === "first" ? childClips[0] : childClips[childClips.length - 1];
}
function buildInlineCollectionView({ clips, endpointKeys, getTimelineDocument, timelineId, }) {
    const displayClips = [];
    let nextIndex = 0;
    let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;
    const appendDisplayClip = (clip) => {
        displayClips.push(Object.assign(Object.assign({}, clip), { index: nextIndex, startTime: nextStartTime }));
        nextIndex += 1;
        nextStartTime += clip.duration + CLIP_GAP_SECONDS;
    };
    const appendClip = (clip, sourceTimelineId, parentKey, depth, viewOptions) => {
        var _a, _b;
        const sourceClipId = (_a = clip.viewSourceClipId) !== null && _a !== void 0 ? _a : clip.id;
        const expansionKey = clip.kind === "collection"
            ? getInlineExpansionKey(parentKey, sourceClipId)
            : undefined;
        const appendCollectionEndpoint = (endpoint) => {
            if (clip.kind !== "collection" || !expansionKey)
                return;
            const endpointKey = getCollectionEndpointKey(expansionKey, endpoint);
            if (!endpointKeys.has(endpointKey))
                return;
            const endpointClip = getCollectionEndpointClip(getTimelineDocument, clip, endpoint);
            if (!endpointClip)
                return;
            appendClip(endpointClip, clip.childTimelineId, endpointKey, depth + 1, {
                endpoint,
                idPrefix: `inline-endpoint:${endpointKey}`,
                role: "collection-endpoint",
                collectionAccentIndex: viewOptions === null || viewOptions === void 0 ? void 0 : viewOptions.collectionAccentIndex,
                parentCollectionKey: expansionKey,
            });
        };
        appendCollectionEndpoint("first");
        appendDisplayClip(Object.assign(Object.assign({}, clip), { id: (viewOptions === null || viewOptions === void 0 ? void 0 : viewOptions.idPrefix) ? `${viewOptions.idPrefix}:${sourceClipId}` : clip.id, viewDepth: depth, viewExpansionKey: expansionKey, viewSourceClipId: sourceClipId, viewSourceTimelineId: sourceTimelineId, viewEndpoint: viewOptions === null || viewOptions === void 0 ? void 0 : viewOptions.endpoint, viewParentCollectionKey: viewOptions === null || viewOptions === void 0 ? void 0 : viewOptions.parentCollectionKey, viewRole: viewOptions === null || viewOptions === void 0 ? void 0 : viewOptions.role, viewCollectionAccentIndex: (_b = viewOptions === null || viewOptions === void 0 ? void 0 : viewOptions.collectionAccentIndex) !== null && _b !== void 0 ? _b : clip.viewCollectionAccentIndex }));
        appendCollectionEndpoint("last");
    };
    let rootCollectionAccentIndex = 0;
    clips.forEach((clip) => {
        const collectionAccentIndex = clip.kind === "collection" ? rootCollectionAccentIndex++ : undefined;
        appendClip(Object.assign(Object.assign({}, clip), { viewCollectionAccentIndex: collectionAccentIndex }), timelineId, "", 0, { collectionAccentIndex });
    });
    return displayClips;
}
export function SmoothScrollList(props) {
    const existingStore = useOptionalTimelineDocuments();
    const fallbackInitialState = useMemo(() => {
        var _a;
        if (!props.timelineId || !props.initialClips)
            return undefined;
        const documents = createInitialTimelineDocuments();
        documents[props.timelineId] = {
            id: props.timelineId,
            title: (_a = props.timelineTitle) !== null && _a !== void 0 ? _a : props.timelineId,
            clips: props.initialClips,
        };
        return createTimelineDocumentsState(documents);
    }, [props.initialClips, props.timelineId, props.timelineTitle]);
    if (existingStore) {
        return _jsx(SmoothScrollListContent, Object.assign({}, props));
    }
    return (_jsx(TimelineDocumentsProvider, { initialState: fallbackInitialState, children: _jsx(SmoothScrollListContent, Object.assign({}, props)) }));
}
function SmoothScrollListContent(_a) {
    var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    var { collectionHrefPrefix = "/timeline", initialClips, initialViewState, itemCount = 1000, onOpenCollection, timelineId, timelineTitle, viewportWidth, width: _deprecatedWidth, pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND, syncMediaDuration = true, isChildTimeline = false, hierarchyMode: propHierarchyMode, onHierarchyModeChange, thumbnailMode: propThumbnailMode, playheadTime, onPlayheadTimeChange, previewLargeSurface = false, disablePersistence = false, className, style, onTimelineIdChange, titleMeta, toolbarActions, navigate, persistenceReady = true, userId, uploadTimelineMedia } = _a, props = __rest(_a, ["collectionHrefPrefix", "initialClips", "initialViewState", "itemCount", "onOpenCollection", "timelineId", "timelineTitle", "viewportWidth", "width", "pixelsPerSecond", "syncMediaDuration", "isChildTimeline", "hierarchyMode", "onHierarchyModeChange", "thumbnailMode", "playheadTime", "onPlayheadTimeChange", "previewLargeSurface", "disablePersistence", "className", "style", "onTimelineIdChange", "titleMeta", "toolbarActions", "navigate", "persistenceReady", "userId", "uploadTimelineMedia"]);
    const { addClipToCollection, createCollectionTimelineDocument, emitTimelineUpdate, getCollectionClipSourceDuration, getTimelineDocument, getTimelinePath, registerTimelineDocument, syncParentCollections, } = useTimelineDocuments();
    const parentRef = useRef(null);
    const safeItemCount = initialClips
        ? initialClips.length
        : Math.max(0, Math.floor(itemCount));
    const resolvedViewportWidth = viewportWidth !== null && viewportWidth !== void 0 ? viewportWidth : "100%";
    const initialScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * 100;
    const timelineResetKey = useMemo(() => initialClips
        ? (timelineId !== null && timelineId !== void 0 ? timelineId : initialClips.map((clip) => clip.id).join("|"))
        : `generated:${safeItemCount}`, [initialClips, safeItemCount, timelineId]);
    const [thumbnailModeState] = useState((_b = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.thumbnailMode) !== null && _b !== void 0 ? _b : false);
    const thumbnailMode = propThumbnailMode !== null && propThumbnailMode !== void 0 ? propThumbnailMode : thumbnailModeState;
    const [hierarchyModeState, setHierarchyModeState] = useState((_d = (_c = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.hierarchyMode) !== null && _c !== void 0 ? _c : propHierarchyMode) !== null && _d !== void 0 ? _d : false);
    const setHierarchyMode = useCallback((value) => {
        setHierarchyModeState(value);
        if (onHierarchyModeChange) {
            onHierarchyModeChange(value);
        }
    }, [onHierarchyModeChange]);
    const hierarchyMode = hierarchyModeState;
    const [childCollectionsExpanded, setChildCollectionsExpanded] = useState(false);
    const [exposedCollectionEndpointKeys, setExposedCollectionEndpointKeys] = useState(() => new Set());
    const [inlineViewVersion, setInlineViewVersion] = useState(0);
    const [persistedTimelineTitle, setPersistedTimelineTitle] = useState(timelineTitle);
    const canPersistTimeline = !disablePersistence && persistenceReady;
    const latestClipsRef = useRef([]);
    const latestDisplayClipsRef = useRef([]);
    const localEditVersionRef = useRef(0);
    const [prevPropHierarchyMode, setPrevPropHierarchyMode] = useState(propHierarchyMode);
    if (propHierarchyMode !== prevPropHierarchyMode) {
        setPrevPropHierarchyMode(propHierarchyMode);
        if (propHierarchyMode !== undefined) {
            setHierarchyModeState(propHierarchyMode);
        }
    }
    const [prevTimelineTitle, setPrevTimelineTitle] = useState(timelineTitle);
    if (timelineTitle !== prevTimelineTitle) {
        setPrevTimelineTitle(timelineTitle);
        setPersistedTimelineTitle(timelineTitle);
    }
    const handleTitleChange = useCallback((newTitle) => {
        setPersistedTimelineTitle(newTitle);
        const thisTimelineId = timelineId || "";
        const doc = getTimelineDocument(thisTimelineId);
        if (doc) {
            doc.title = newTitle;
            registerTimelineDocument(doc, { persist: !disablePersistence });
            syncParentCollections(thisTimelineId, doc.clips);
        }
    }, [timelineId, disablePersistence]);
    const [gridMode, setGridMode] = useState((_e = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.gridMode) !== null && _e !== void 0 ? _e : false);
    const [itemSize, setItemSize] = useState((_f = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.itemSize) !== null && _f !== void 0 ? _f : "md");
    const [manualOverhangScroll, setManualOverhangScroll] = useState((_g = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.manualOverhangScroll) !== null && _g !== void 0 ? _g : true);
    const [showPlayBarArea, setShowPlayBarArea] = useState((_h = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.showPlayBarArea) !== null && _h !== void 0 ? _h : false);
    const [showPassiveFilmstrips, setShowPassiveFilmstrips] = useState((_j = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.showPassiveFilmstrips) !== null && _j !== void 0 ? _j : false);
    const itemTop = 0;
    const itemHeight = ITEM_HEIGHTS[itemSize];
    const thumbnailWidth = (itemHeight * 16) / 9;
    const scrollState = useTimelineScrollState({
        initialScrollLeft,
        parentRef,
    });
    const clipState = useTimelineClipState({
        initialClips,
        itemCount: safeItemCount,
        parentRef,
        pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
        resetKey: timelineResetKey,
        setScrollLeft: scrollState.setScrollLeft,
    });
    const timelineItemCount = clipState.clips.length;
    const gridModeEnabled = thumbnailMode && gridMode;
    const gridMetrics = useMemo(() => getTimelineGridMetrics({
        enabled: gridModeEnabled,
        fallbackItemWidth: thumbnailWidth,
        itemHeight,
        itemTop,
        itemCount: timelineItemCount,
        viewportWidth: scrollState.viewportClientWidth,
    }), [
        gridModeEnabled,
        itemHeight,
        itemTop,
        timelineItemCount,
        scrollState.viewportClientWidth,
        thumbnailWidth,
    ]);
    const effectiveThumbnailWidth = gridModeEnabled
        ? gridMetrics.itemWidth
        : thumbnailWidth;
    const timelineHeight = gridModeEnabled
        ? getTimelineGridContentHeight(gridMetrics, itemTop)
        : itemHeight + itemTop;
    useEffect(() => {
        latestClipsRef.current = clipState.clips;
    }, [clipState.clips]);
    const markLocalEdit = useCallback(() => {
        localEditVersionRef.current += 1;
    }, []);
    const applyLocalClipsNow = useCallback((nextClips) => {
        markLocalEdit();
        latestClipsRef.current = nextClips;
        clipState.applyClipsNow(nextClips);
    }, [clipState.applyClipsNow, markLocalEdit]);
    const { isLoadingTimeline, timelineLoadError } = useTimelinePersistenceProvider({
        applyClipsNow: clipState.applyClipsNow,
        canPersistTimeline,
        emitTimelineUpdate,
        clips: clipState.clips,
        getTimelineDocument,
        latestClipsRef,
        localEditVersionRef,
        persistedTimelineTitle,
        registerTimelineDocument,
        setPersistedTimelineTitle,
        timelineId,
        timelineTitle,
    });
    const moveClipToTrash = useCallback(async (clipToTrash) => {
        if (!userId)
            return;
        // 1. Remove the clip from the current timeline
        const nextClips = clipState.clips.filter((c) => c.id !== clipToTrash.id);
        const packedClips = reindexAndPackClips(nextClips);
        clipState.applyClipsNow(packedClips);
        clipState.setSelectedIndex(null);
        // Save current timeline to DB
        const thisTimelineId = timelineId || "";
        const doc = getTimelineDocument(thisTimelineId);
        if (doc) {
            registerTimelineDocument(Object.assign(Object.assign({}, doc), { clips: packedClips }), { persist: !disablePersistence });
            syncParentCollections(thisTimelineId, packedClips);
        }
        // 2. Fetch the trash timeline, append the clip, and save it!
        const trashId = `trash-${userId}`;
        try {
            const response = await fetch(`/api/timelines/${encodeURIComponent(trashId)}`);
            let trashDoc;
            if (response.ok) {
                const res = await response.json();
                trashDoc = res.document || { id: trashId, title: "Trash Bin", clips: [] };
            }
            else {
                trashDoc = { id: trashId, title: "Trash Bin", clips: [] };
            }
            // Add the clip to trash document clips
            const nextIndex = trashDoc.clips.length;
            let nextStartTime = 1;
            if (trashDoc.clips.length > 0) {
                const lastClip = trashDoc.clips[trashDoc.clips.length - 1];
                nextStartTime = lastClip.startTime + lastClip.duration + 1;
            }
            const trashedClip = Object.assign(Object.assign({}, clipToTrash), { index: nextIndex, startTime: nextStartTime });
            const nextTrashClips = [...trashDoc.clips, trashedClip];
            // Save trash document to Firestore
            await fetch(`/api/timelines/${encodeURIComponent(trashId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    document: {
                        id: trashId,
                        title: trashDoc.title,
                        description: trashDoc.description || "",
                        clips: nextTrashClips,
                    },
                }),
            });
            // Show a toast message!
            window.dispatchEvent(new CustomEvent("gstudio-toast", {
                detail: { message: `Moved "${clipToTrash.title || clipToTrash.alt || "Clip"}" to Trash` }
            }));
        }
        catch (err) {
            console.error("Failed to move clip to trash:", err);
        }
    }, [
        clipState,
        disablePersistence,
        getTimelineDocument,
        registerTimelineDocument,
        syncParentCollections,
        timelineId,
        userId,
    ]);
    const lastSelectedIndexRef = useRef(null);
    useEffect(() => {
        if (clipState.selectedIndex === null) {
            lastSelectedIndexRef.current = null;
            return;
        }
        if (clipState.selectedIndex !== lastSelectedIndexRef.current) {
            lastSelectedIndexRef.current = clipState.selectedIndex;
            const selectedClip = latestDisplayClipsRef.current.find((c) => c.index === clipState.selectedIndex);
            if (selectedClip && onPlayheadTimeChange) {
                onPlayheadTimeChange(selectedClip.startTime, latestDisplayClipsRef.current);
            }
        }
    }, [clipState.selectedIndex, onPlayheadTimeChange]);
    const childCollections = useMemo(() => {
        if (!hierarchyMode)
            return [];
        return clipState.clips.filter((c) => c.kind === "collection");
    }, [clipState.clips, hierarchyMode]);
    const visibleExposedCollectionEndpointKeys = useMemo(() => {
        const availableRootIds = new Set(clipState.clips
            .filter((clip) => clip.kind === "collection")
            .map((clip) => clip.id));
        return new Set(Array.from(exposedCollectionEndpointKeys).filter((key) => availableRootIds.has(key.split("::")[0].split("/")[0])));
    }, [clipState.clips, exposedCollectionEndpointKeys]);
    const handleToggleCollectionEndpoint = useCallback((clip, endpoint) => {
        var _a;
        const expansionKey = (_a = clip.viewExpansionKey) !== null && _a !== void 0 ? _a : clip.id;
        const endpointKey = getCollectionEndpointKey(expansionKey, endpoint);
        runTimelineEndpointViewTransition(() => {
            setExposedCollectionEndpointKeys((current) => {
                const next = new Set(current);
                if (next.has(endpointKey)) {
                    next.delete(endpointKey);
                }
                else {
                    next.add(endpointKey);
                }
                return next;
            });
        });
    }, []);
    const handleRenameCollection = useCallback((clip, nextTitle) => {
        var _a, _b;
        const title = nextTitle.trim().slice(0, 80);
        if (!title || title === clip.title)
            return;
        const currentTimelineId = timelineId || "";
        const sourceTimelineId = (_a = clip.viewSourceTimelineId) !== null && _a !== void 0 ? _a : currentTimelineId;
        const sourceClipId = (_b = clip.viewSourceClipId) !== null && _b !== void 0 ? _b : clip.id;
        const sourceDocument = getTimelineDocument(sourceTimelineId);
        if (sourceDocument) {
            const nextSourceClips = sourceDocument.clips.map((sourceClip) => sourceClip.id === sourceClipId && sourceClip.kind === "collection"
                ? Object.assign(Object.assign({}, sourceClip), { title, alt: `${title} collection` }) : sourceClip);
            registerTimelineDocument(Object.assign(Object.assign({}, sourceDocument), { clips: reindexAndPackClips(nextSourceClips) }), { persist: !disablePersistence });
        }
        const childDocument = getTimelineDocument(clip.childTimelineId);
        if (childDocument) {
            registerTimelineDocument(Object.assign(Object.assign({}, childDocument), { title }), { persist: !disablePersistence });
            syncParentCollections(clip.childTimelineId, childDocument.clips);
        }
        else if (sourceDocument) {
            syncParentCollections(sourceTimelineId, sourceDocument.clips);
        }
        const currentDocument = getTimelineDocument(currentTimelineId);
        if (currentDocument) {
            applyLocalClipsNow(currentDocument.clips);
        }
        else {
            setInlineViewVersion((version) => version + 1);
        }
    }, [applyLocalClipsNow, disablePersistence, timelineId]);
    const displayClips = useMemo(() => {
        if (inlineViewVersion < 0)
            return [];
        return buildInlineCollectionView({
            clips: clipState.clips,
            endpointKeys: visibleExposedCollectionEndpointKeys,
            getTimelineDocument,
            timelineId: timelineId || "",
        });
    }, [
        clipState.clips,
        getTimelineDocument,
        inlineViewVersion,
        timelineId,
        visibleExposedCollectionEndpointKeys,
    ]);
    useEffect(() => {
        latestDisplayClipsRef.current = displayClips;
    }, [displayClips]);
    const handleOpenCollection = useCallback((nextTimelineId, href) => {
        if (onOpenCollection) {
            onOpenCollection(nextTimelineId);
            return;
        }
        startTimelineFadeNavigation({
            navigate: () => {
                if (navigate) {
                    navigate(href);
                    return;
                }
                window.location.assign(href);
            },
        });
    }, [navigate, onOpenCollection]);
    const zoom = useTimelineZoom({
        clips: displayClips,
        initialZoom: (_k = initialViewState === null || initialViewState === void 0 ? void 0 : initialViewState.zoom) !== null && _k !== void 0 ? _k : pixelsPerSecond,
        parentRef,
        prevScrollLeftRef: scrollState.prevScrollLeftRef,
        selectedIndex: clipState.selectedIndex,
        setScrollLeft: scrollState.setScrollLeft,
        thumbnailMode,
        thumbnailWidth: effectiveThumbnailWidth,
    });
    const adjustedClips = useMemo(() => {
        if (thumbnailMode)
            return displayClips;
        const gapInSeconds = 6 / zoom.safePixelsPerSecond;
        let currentStartTime = TIMELINE_LEADING_PADDING_SECONDS;
        return displayClips.map((clip) => {
            const duration = clip.kind === "collection"
                ? (effectiveThumbnailWidth / zoom.safePixelsPerSecond)
                : clip.duration;
            const playbackDuration = clip.kind === "collection"
                ? getCollectionClipSourceDuration(clip)
                : clip.duration;
            const adjClip = Object.assign(Object.assign({}, clip), { startTime: currentStartTime, duration, playbackStartTime: clip.startTime, playbackDuration });
            currentStartTime += duration + gapInSeconds;
            return adjClip;
        });
    }, [displayClips, thumbnailMode, effectiveThumbnailWidth, zoom.safePixelsPerSecond]);
    const selectedDisplayClip = useMemo(() => {
        var _a;
        if (clipState.selectedIndex === null)
            return null;
        return ((_a = adjustedClips.find((clip) => clip.index === clipState.selectedIndex)) !== null && _a !== void 0 ? _a : null);
    }, [adjustedClips, clipState.selectedIndex]);
    const selectedVideoClip = selectedDisplayClip;
    const getCollectionHref = useCallback((nextTimelineId) => {
        const basePath = collectionHrefPrefix.replace(/\/$/, "");
        const href = `${basePath}/${encodeURIComponent(nextTimelineId)}`;
        return appendTimelineViewStateToHref(href, {
            thumbnailMode,
            gridMode,
            itemSize,
            manualOverhangScroll,
            showPlayBarArea,
            showPassiveFilmstrips,
            zoom: zoom.zoomLevel,
        });
    }, [
        collectionHrefPrefix,
        gridMode,
        itemSize,
        manualOverhangScroll,
        showPlayBarArea,
        showPassiveFilmstrips,
        thumbnailMode,
        zoom.zoomLevel,
    ]);
    const minDuration = MIN_WIDTH / zoom.safePixelsPerSecond;
    const handleClipDurationLoad = useTimelineMediaDuration({
        itemHeight,
        pixelsPerSecond: zoom.safePixelsPerSecond,
        setClips: clipState.setClips,
    });
    const handleClipDurationLoadSimple = useCallback((index, duration) => {
        clipState.setClips((previousClips) => {
            const clip = previousClips.find((candidate) => candidate.index === index);
            if (!clip || clip.kind !== "video")
                return previousClips;
            if (Math.abs(clip.sourceDuration - duration) < 0.1)
                return previousClips;
            const nextClips = previousClips.map((candidate) => (Object.assign({}, candidate)));
            const clipIdx = previousClips.findIndex((candidate) => candidate.index === index);
            if (clipIdx !== -1) {
                nextClips[clipIdx] = Object.assign(Object.assign({}, clip), { sourceDuration: duration });
            }
            return nextClips;
        });
    }, [clipState.setClips]);
    const { handleDropFiles, isUploadingMedia, mediaUploadError, uploadProgress, } = useTimelineUploadHandler({
        applyLocalClipsNow,
        clips: clipState.clips,
        getTimelineDocument,
        getTimelinePath,
        timelineId,
        uploadTimelineMedia,
        userId,
    });
    const handleDropClip = useCallback((insertIndex, clip, sourceTimelineId) => {
        const thisTimelineId = timelineId || "";
        if (sourceTimelineId === thisTimelineId) {
            // Reordering within the same timeline
            const sourceIndex = clipState.clips.findIndex((c) => c.id === clip.id);
            if (sourceIndex === -1)
                return;
            const nextClips = [...clipState.clips];
            const [removed] = nextClips.splice(sourceIndex, 1);
            // Adjust target index if inserting after the source position
            let targetIndex = insertIndex;
            if (sourceIndex < insertIndex) {
                targetIndex = insertIndex - 1;
            }
            nextClips.splice(targetIndex, 0, removed);
            const packed = reindexAndPackClips(nextClips);
            // Update document registry synchronously to avoid race conditions
            const doc = getTimelineDocument(thisTimelineId);
            if (doc) {
                registerTimelineDocument(Object.assign(Object.assign({}, doc), { clips: packed }), { persist: !disablePersistence });
                emitTimelineUpdate(thisTimelineId, Object.assign(Object.assign({}, doc), { clips: packed }));
                syncParentCollections(thisTimelineId, packed);
            }
            applyLocalClipsNow(packed);
        }
        else {
            // Dragged from another timeline to this timeline
            // 1. Insert clip locally
            const isAssetLibrarySource = sourceTimelineId.startsWith("asset-library");
            const nextClips = [...clipState.clips];
            const newClip = Object.assign(Object.assign({}, clip), { id: isAssetLibrarySource
                    ? `${clip.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                    : clip.id, index: insertIndex });
            nextClips.splice(insertIndex, 0, newClip);
            const packed = reindexAndPackClips(nextClips);
            // Update document registry synchronously to avoid race conditions
            const doc = getTimelineDocument(thisTimelineId);
            if (doc) {
                registerTimelineDocument(Object.assign(Object.assign({}, doc), { clips: packed }), { persist: !disablePersistence });
                emitTimelineUpdate(thisTimelineId, Object.assign(Object.assign({}, doc), { clips: packed }));
                syncParentCollections(thisTimelineId, packed);
            }
            applyLocalClipsNow(packed);
            // 2. Notify the source timeline to remove it. Assets are copied, not moved.
            if (!isAssetLibrarySource) {
                window.dispatchEvent(new CustomEvent("timeline-clip-moved", {
                    detail: {
                        clipId: clip.id,
                        sourceTimelineId,
                        targetTimelineId: thisTimelineId,
                    },
                }));
            }
        }
    }, [
        applyLocalClipsNow,
        clipState,
        disablePersistence,
        emitTimelineUpdate,
        getTimelineDocument,
        registerTimelineDocument,
        syncParentCollections,
        timelineId,
    ]);
    const handleDropSidebarClip = useCallback((insertIndex, type) => {
        const thisTimelineId = timelineId || "";
        const uniqueId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        let newClip;
        if (type === "collection") {
            let childId = `timeline-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            if (thisTimelineId.startsWith("asset-library")) {
                const assetUserId = userId || "default";
                const currentFolderPath = getFolderPathFromTimelineId(thisTimelineId, assetUserId);
                const newCollectionId = `col-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                const newFolderPath = currentFolderPath
                    ? `${currentFolderPath}/${newCollectionId}`
                    : newCollectionId;
                const encoded = encodeFolderPath(newFolderPath);
                childId = `asset-library-col-${assetUserId}-${encoded}`;
            }
            createCollectionTimelineDocument(childId, "New Collection");
            newClip = {
                id: uniqueId,
                index: insertIndex,
                kind: "collection",
                title: "New Collection",
                childTimelineId: childId,
                itemCount: 0,
                duration: 3,
                sourceDuration: 3,
                trimIn: 0,
                trimOut: 0,
                alt: "New Collection",
                aspect: 16 / 9,
                trackIndex: 0,
                startTime: 0,
            };
        }
        else if (type === "image") {
            newClip = {
                id: uniqueId,
                index: insertIndex,
                kind: "image",
                src: `https://picsum.photos/seed/${uniqueId}/360/200`,
                alt: "New Image",
                aspect: 16 / 9,
                trackIndex: 0,
                startTime: 0,
                duration: 4,
                sourceDuration: 4,
                trimIn: 0,
                trimOut: 0,
            };
        }
        else {
            // video
            newClip = {
                id: uniqueId,
                index: insertIndex,
                kind: "video",
                src: VIDEO_SOURCES[0],
                alt: "New Video",
                aspect: 16 / 9,
                trackIndex: 0,
                startTime: 0,
                duration: 5,
                sourceDuration: 12,
                trimIn: 0,
                trimOut: 7,
            };
        }
        const nextClips = [...clipState.clips];
        nextClips.splice(insertIndex, 0, newClip);
        const packedClips = reindexAndPackClips(nextClips);
        const doc = getTimelineDocument(thisTimelineId);
        if (doc) {
            registerTimelineDocument(Object.assign(Object.assign({}, doc), { clips: packedClips }), { persist: !disablePersistence });
            emitTimelineUpdate(thisTimelineId, Object.assign(Object.assign({}, doc), { clips: packedClips }));
            syncParentCollections(thisTimelineId, packedClips);
        }
        applyLocalClipsNow(packedClips);
    }, [
        applyLocalClipsNow,
        clipState,
        disablePersistence,
        emitTimelineUpdate,
        getTimelineDocument,
        registerTimelineDocument,
        syncParentCollections,
        timelineId,
        userId,
    ]);
    const handleDropClipIntoCollection = useCallback((clip, targetCollectionTimelineId, sourceTimelineId) => {
        const isAssetLibrarySource = sourceTimelineId.startsWith("asset-library");
        addClipToCollection(targetCollectionTimelineId, isAssetLibrarySource
            ? Object.assign(Object.assign({}, clip), { id: `${clip.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }) : clip);
        // Notify source timeline to remove it. Assets are copied, not moved.
        if (!isAssetLibrarySource) {
            window.dispatchEvent(new CustomEvent("gstudio-clip-remove", {
                detail: { clipId: clip.id, timelineId: sourceTimelineId },
            }));
        }
    }, []);
    const handleDropSidebarClipIntoCollection = useCallback((type, targetCollectionTimelineId) => {
        const uniqueId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        let newClip = {
            id: uniqueId,
            kind: type,
            aspect: 16 / 9,
            trackIndex: 0,
            startTime: 0,
            duration: type === "collection" ? 3 : type === "image" ? 4 : 5,
            sourceDuration: type === "collection" ? 3 : type === "image" ? 4 : 12,
            trimIn: 0,
            trimOut: type === "collection" ? 0 : type === "image" ? 0 : 7,
        };
        if (type === "collection") {
            const childId = `timeline-${Date.now()}`;
            createCollectionTimelineDocument(childId, "Nested Collection");
            newClip = Object.assign(Object.assign({}, newClip), { title: "Nested Collection", alt: "Nested Collection", childTimelineId: childId, itemCount: 0, previewItems: [] });
        }
        else if (type === "image") {
            newClip.title = "New Image";
            newClip.alt = "New Image";
            newClip.src = `https://picsum.photos/seed/${uniqueId}/360/200`;
        }
        else {
            newClip.title = "New Video";
            newClip.alt = "New Video";
            newClip.src = VIDEO_SOURCES[0];
        }
        addClipToCollection(targetCollectionTimelineId, newClip);
    }, []);
    useEffect(() => {
        const handleTimelineUpdate = (e) => {
            var _a;
            const customEvent = e;
            if (customEvent.detail.timelineId === timelineId) {
                const doc = (_a = customEvent.detail.document) !== null && _a !== void 0 ? _a : getTimelineDocument(timelineId);
                if (doc) {
                    clipState.applyClipsNow(doc.clips);
                }
            }
        };
        const handleClipRemove = (e) => {
            const customEvent = e;
            const thisTimelineId = timelineId || "";
            if (customEvent.detail.timelineId === thisTimelineId) {
                const doc = getTimelineDocument(thisTimelineId);
                if (doc) {
                    const nextClips = doc.clips.filter((c) => c.id !== customEvent.detail.clipId);
                    const packed = reindexAndPackClips(nextClips);
                    registerTimelineDocument(Object.assign(Object.assign({}, doc), { clips: packed }), { persist: !disablePersistence });
                    emitTimelineUpdate(thisTimelineId, Object.assign(Object.assign({}, doc), { clips: packed }));
                    syncParentCollections(thisTimelineId, packed);
                    applyLocalClipsNow(packed);
                }
            }
        };
        const handleClipMoved = (e) => {
            const customEvent = e;
            const { clipId, sourceTimelineId, targetTimelineId } = customEvent.detail;
            const thisTimelineId = timelineId || "";
            if (sourceTimelineId === thisTimelineId && targetTimelineId !== thisTimelineId) {
                const doc = getTimelineDocument(thisTimelineId);
                if (doc) {
                    const nextClips = doc.clips.filter((c) => c.id !== clipId);
                    const packed = reindexAndPackClips(nextClips);
                    registerTimelineDocument(Object.assign(Object.assign({}, doc), { clips: packed }), { persist: !disablePersistence });
                    emitTimelineUpdate(thisTimelineId, Object.assign(Object.assign({}, doc), { clips: packed }));
                    syncParentCollections(thisTimelineId, packed);
                    applyLocalClipsNow(packed);
                }
            }
        };
        window.addEventListener("gstudio-timeline-update", handleTimelineUpdate);
        window.addEventListener("gstudio-clip-remove", handleClipRemove);
        window.addEventListener("timeline-clip-moved", handleClipMoved);
        return () => {
            window.removeEventListener("gstudio-timeline-update", handleTimelineUpdate);
            window.removeEventListener("gstudio-clip-remove", handleClipRemove);
            window.removeEventListener("timeline-clip-moved", handleClipMoved);
        };
    }, [
        applyLocalClipsNow,
        clipState,
        disablePersistence,
        emitTimelineUpdate,
        getTimelineDocument,
        registerTimelineDocument,
        syncParentCollections,
        timelineId,
    ]);
    const applyTimelineViewClipsNow = useCallback((nextViewClips) => {
        if (!displayClips.some((clip) => clip.viewRole)) {
            applyLocalClipsNow(nextViewClips);
            return;
        }
        const previousById = new Map(displayClips.map((clip) => [clip.id, clip]));
        const currentTimelineId = timelineId || "";
        let parentClips = clipState.clips;
        let parentChanged = false;
        let childChanged = false;
        const hasTimingChange = (previous, next) => Math.abs(previous.duration - next.duration) > 0.0001 ||
            Math.abs(previous.sourceDuration - next.sourceDuration) > 0.0001 ||
            Math.abs(previous.trimIn - next.trimIn) > 0.0001 ||
            Math.abs(previous.trimOut - next.trimOut) > 0.0001;
        const copyTiming = (sourceClip, viewClip) => (Object.assign(Object.assign({}, sourceClip), { duration: viewClip.duration, sourceDuration: viewClip.sourceDuration, trimIn: viewClip.trimIn, trimOut: viewClip.trimOut }));
        nextViewClips.forEach((nextClip) => {
            var _a, _b;
            const previousClip = previousById.get(nextClip.id);
            if (!previousClip || !hasTimingChange(previousClip, nextClip))
                return;
            const sourceTimelineId = (_a = nextClip.viewSourceTimelineId) !== null && _a !== void 0 ? _a : currentTimelineId;
            const sourceClipId = (_b = nextClip.viewSourceClipId) !== null && _b !== void 0 ? _b : nextClip.id;
            if (sourceTimelineId === currentTimelineId) {
                parentClips = parentClips.map((clip) => clip.id === sourceClipId ? copyTiming(clip, nextClip) : clip);
                parentChanged = true;
                return;
            }
            const sourceDocument = getTimelineDocument(sourceTimelineId);
            if (!sourceDocument)
                return;
            const nextSourceClips = sourceDocument.clips.map((clip) => clip.id === sourceClipId ? copyTiming(clip, nextClip) : clip);
            const packedSourceClips = reindexAndPackClips(nextSourceClips);
            registerTimelineDocument(Object.assign(Object.assign({}, sourceDocument), { clips: packedSourceClips }), { persist: !disablePersistence });
            syncParentCollections(sourceTimelineId, packedSourceClips);
            childChanged = true;
        });
        if (parentChanged) {
            const packedParentClips = reindexAndPackClips(parentClips);
            const doc = getTimelineDocument(currentTimelineId);
            if (doc) {
                registerTimelineDocument(Object.assign(Object.assign({}, doc), { clips: packedParentClips }), { persist: !disablePersistence });
                syncParentCollections(currentTimelineId, packedParentClips);
            }
            applyLocalClipsNow(packedParentClips);
        }
        else if (childChanged) {
            setInlineViewVersion((version) => version + 1);
        }
    }, [
        applyLocalClipsNow,
        clipState.clips,
        disablePersistence,
        displayClips,
        timelineId,
    ]);
    const interactions = useTimelineInteractions({
        parentRef,
        clips: displayClips,
        safePixelsPerSecond: zoom.safePixelsPerSecond,
        minDuration,
        thumbnailMode,
        thumbnailWidth: effectiveThumbnailWidth,
        gridMetrics,
        itemTop,
        setScrollLeft: scrollState.setScrollLeft,
        setSelectedIndex: clipState.setSelectedIndex,
        setScrubPreview: clipState.setScrubPreview,
        scheduleClips: clipState.scheduleClips,
        applyClipsNow: applyTimelineViewClipsNow,
        pendingScrollLeftRef: scrollState.pendingScrollLeftRef,
        timelineId,
    });
    const overhang = useTimelineOverhang({
        activeFilmStripEdit: interactions.activeFilmStripEdit,
        activeResize: interactions.activeResize,
        clipsLength: displayClips.length,
        isFilmStripEditing: interactions.isFilmStripEditing,
        isResizing: interactions.isResizing,
        isUnfreezing: interactions.isUnfreezing,
        manualOverhangScroll,
        parentRef,
        pixelsPerSecond: zoom.safePixelsPerSecond,
        prevScrollLeftRef: scrollState.prevScrollLeftRef,
        scrollLeft: scrollState.scrollLeft,
        selectedVideoClip: showPlayBarArea ? selectedVideoClip : null,
        setScrollLeft: scrollState.setScrollLeft,
        thumbnailMode,
        thumbnailWidth: effectiveThumbnailWidth,
    });
    const layout = useTimelineLayout({
        clips: adjustedClips,
        closingOverhangOffset: overhang.closingOverhangOffset,
        firstOverhang: overhang.firstOverhang,
        isResizing: interactions.isResizing,
        lastOverhang: overhang.lastOverhang,
        pixelsPerSecond: zoom.safePixelsPerSecond,
        scrollLeft: scrollState.scrollLeft,
        scrollTop: gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop,
        gridMetrics,
        itemTop,
        thumbnailMode,
        thumbnailWidth: effectiveThumbnailWidth,
        viewportClientHeight: gridModeEnabled
            ? scrollState.pageViewportHeight
            : scrollState.viewportClientHeight,
        viewportClientWidth: scrollState.viewportClientWidth,
    });
    useEffect(() => {
        const currentInteractions = interactions;
        return () => {
            currentInteractions.stopInertia();
            currentInteractions.cleanupWindowDragListeners();
            scrollState.cleanupScrollFrame();
            clipState.cleanupClipFrames();
        };
        // These callbacks are stable; cleanup should only register once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx(TimelineKeyboardShortcuts, { displayClipsRef: latestDisplayClipsRef, onMoveClipToTrash: moveClipToTrash, selectedIndex: clipState.selectedIndex, sourceClips: clipState.clips, timelineId: timelineId }), _jsxs("div", Object.assign({}, props, { "data-testid": "timeline-editor", "data-timeline-id": timelineId !== null && timelineId !== void 0 ? timelineId : "", "data-timeline-title": timelineTitle !== null && timelineTitle !== void 0 ? timelineTitle : "", "data-selected-index": (_l = clipState.selectedIndex) !== null && _l !== void 0 ? _l : "", "data-zoom": zoom.safePixelsPerSecond, "data-thumbnail-mode": thumbnailMode, "data-grid-mode": gridModeEnabled, "data-grid-columns": gridMetrics.columnsPerPage, "data-grid-rows": gridMetrics.rowsPerPage, "data-playbar-area": showPlayBarArea, "data-passive-filmstrips": showPassiveFilmstrips, "data-item-count": displayClips.length, "data-first-overhang": overhang.firstOverhang, "data-last-overhang": overhang.lastOverhang, "data-reordering": interactions.isReordering, "data-reorder-target-index": (_o = (_m = interactions.reorderPreview) === null || _m === void 0 ? void 0 : _m.targetIndex) !== null && _o !== void 0 ? _o : "", "data-timeline-width": layout.timelineWidth, "data-viewport-width": scrollState.viewportClientWidth, "data-scroll-top": gridModeEnabled ? scrollState.pageScrollTop : scrollState.scrollTop, "data-viewport-height": gridModeEnabled
                    ? scrollState.pageViewportHeight
                    : scrollState.viewportClientHeight, "data-timeline-height": timelineHeight, "data-max-scroll": Math.max(0, layout.timelineWidth - scrollState.viewportClientWidth), "data-max-scroll-top": Math.max(0, timelineHeight -
                    (gridModeEnabled
                        ? scrollState.pageViewportHeight
                        : scrollState.viewportClientHeight)), className: cn("box-border grid w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 font-sans shadow-2xl", className), style: Object.assign({ width: "100%", maxWidth: "min(100%, calc(100vw - 2rem))", minWidth: 0, boxSizing: "border-box" }, style), children: [_jsx(TimelineToolbar, { itemSize: itemSize, showPlayBarArea: showPlayBarArea, showPassiveFilmstrips: showPassiveFilmstrips, title: persistedTimelineTitle, gridMode: gridModeEnabled, onItemSizeChange: setItemSize, onGridModeChange: setGridMode, onPlayBarAreaChange: setShowPlayBarArea, onPassiveFilmstripsChange: setShowPassiveFilmstrips, onZoomChange: zoom.handleZoomChange, thumbnailMode: thumbnailMode, zoomLevel: zoom.zoomLevel, timelineId: timelineId, hierarchyMode: hierarchyMode, onHierarchyModeChange: setHierarchyMode, hasChildCollections: childCollections.length > 0, onTitleChange: timelineId && (timelineId.startsWith("timeline-") || timelineId.startsWith("asset-library-col-"))
                            ? handleTitleChange
                            : undefined, childCollectionsExpanded: childCollectionsExpanded, onToggleChildCollections: () => setChildCollectionsExpanded(!childCollectionsExpanded), titleMeta: titleMeta, toolbarActions: toolbarActions }), mediaUploadError && (_jsx("div", { role: "status", className: "rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-100", children: mediaUploadError })), isLoadingTimeline && (_jsx("div", { role: "status", className: "rounded-md border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-sm text-sky-100", children: "Loading saved timeline..." })), timelineLoadError && (_jsxs("div", { role: "alert", className: "rounded-md border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-100", children: ["Failed to load saved timeline: ", timelineLoadError] })), isUploadingMedia && (_jsxs("div", { className: "flex flex-col gap-2 rounded-lg border border-sky-500/35 bg-sky-950/20 px-4 py-3 shadow-lg select-none", children: [_jsxs("div", { className: "flex items-center justify-between text-xs font-medium text-sky-200", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("svg", { className: "animate-spin h-3.5 w-3.5 text-sky-400", viewBox: "0 0 24 24", fill: "none", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" })] }), _jsx("span", { children: "Uploading media to timeline..." })] }), _jsxs("span", { className: "font-semibold", children: [Math.round(uploadProgress), "%"] })] }), _jsx("div", { className: "h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden", children: _jsx("div", { className: "h-full bg-sky-500 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(56,189,248,0.6)]", style: { width: `${uploadProgress}%` } }) })] })), _jsxs("div", { className: "relative w-full max-w-full min-w-0", children: [_jsx(TimelineViewport, { collections: {
                                    exposedCollectionEndpointIds: visibleExposedCollectionEndpointKeys,
                                    getCollectionHref,
                                    onOpenCollection: handleOpenCollection,
                                    onRenameCollection: handleRenameCollection,
                                    onToggleCollectionEndpoint: handleToggleCollectionEndpoint,
                                }, dropHandlers: {
                                    onDropClip: handleDropClip,
                                    onDropClipIntoCollection: handleDropClipIntoCollection,
                                    onDropFiles: handleDropFiles,
                                    onDropSidebarClip: handleDropSidebarClip,
                                    onDropSidebarClipIntoCollection: handleDropSidebarClipIntoCollection,
                                }, frame: {
                                    handleScroll: scrollState.handleScroll,
                                    parentRef,
                                    resolvedViewportWidth,
                                    scrollLeft: scrollState.scrollLeft,
                                    scrollTop: gridModeEnabled
                                        ? scrollState.pageScrollTop
                                        : scrollState.scrollTop,
                                    timelineHeight,
                                    timelineWidth: layout.timelineWidth,
                                }, interactions: interactions, isZooming: zoom.isZooming, layout: {
                                    gridMetrics,
                                    hasClips: displayClips.length > 0,
                                    itemHeight,
                                    itemTop,
                                    pixelsPerSecond: zoom.safePixelsPerSecond,
                                    thumbnailMode,
                                    thumbnailWidth: effectiveThumbnailWidth,
                                    visibleClips: layout.visibleClips,
                                }, overhang: {
                                    closingOverhangOffset: overhang.closingOverhangOffset,
                                    firstOverhang: overhang.firstOverhang,
                                    isClosingOverhang: overhang.isClosingOverhang,
                                    isResizingFirstClipLeft: overhang.isResizingFirstClipLeft,
                                    manualOverhangScroll,
                                    prevFirstOverhang: overhang.prevFirstOverhangRef.current,
                                }, playback: {
                                    onPlayheadTimeChange,
                                    playheadTime,
                                    previewLargeSurface,
                                    selectedVideoClip: showPlayBarArea ? selectedVideoClip : null,
                                    showPassiveFilmstrips,
                                    showPlayBarArea,
                                }, selection: {
                                    handleClipDurationLoad: syncMediaDuration
                                        ? handleClipDurationLoad
                                        : handleClipDurationLoadSimple,
                                    scrubPreview: clipState.scrubPreview,
                                    selectedIndex: clipState.selectedIndex,
                                }, timelineId: timelineId }), overhang.hasOffscreenOverhang && (_jsx(TimelineOverhangHint, { onClick: overhang.scrollToOverhang }))] })] })), _jsx(TimelineHierarchyView, { childCollections: childCollections, getTimelineDocument: getTimelineDocument, visible: childCollectionsExpanded, renderTimeline: (collection, document) => (_jsx(SmoothScrollList, { timelineId: collection.childTimelineId, timelineTitle: collection.title, initialClips: document ? document.clips : [], initialViewState: {
                        thumbnailMode,
                        itemSize: "sm",
                        gridMode: false,
                        showPlayBarArea,
                        showPassiveFilmstrips,
                    }, thumbnailMode: thumbnailMode, isChildTimeline: true, syncMediaDuration: syncMediaDuration, hierarchyMode: hierarchyMode, previewLargeSurface: previewLargeSurface, playheadTime: playheadTime, onPlayheadTimeChange: onPlayheadTimeChange }, `hierarchy-${collection.childTimelineId}`)) })] }));
}
