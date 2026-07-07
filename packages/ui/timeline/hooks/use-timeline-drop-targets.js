import { useCallback, useEffect, useRef, useState } from "react";
export function useTimelineDropTargets({ contentRef, getClipLeft, getClipWidth, hasClips, onDropClip, onDropClipIntoCollection, onDropFiles, onDropSidebarClip, onDropSidebarClipIntoCollection, timelineId, visibleClips, }) {
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const [activeCollectionHoverId, setActiveCollectionHoverId] = useState(null);
    const [activeDropIndex, setActiveDropIndex] = useState(null);
    const [isAnyDragActive, setIsAnyDragActive] = useState(false);
    useEffect(() => {
        const handleDragStartGlobal = (e) => {
            const customEvent = e;
            const type = customEvent.detail.type;
            if (type !== "timeline") {
                setIsAnyDragActive(true);
            }
        };
        const handleDragEndGlobal = () => {
            setIsAnyDragActive(false);
        };
        window.addEventListener("gstudio-drag-start", handleDragStartGlobal);
        window.addEventListener("gstudio-drag-end", handleDragEndGlobal);
        return () => {
            window.removeEventListener("gstudio-drag-start", handleDragStartGlobal);
            window.removeEventListener("gstudio-drag-end", handleDragEndGlobal);
        };
    }, []);
    const handleDragEnter = useCallback((e) => {
        e.preventDefault();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes("Files")) {
            setIsDragOver(true);
        }
    }, []);
    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
            setActiveDropIndex(null);
            setActiveCollectionHoverId(null);
        }
    }, []);
    useEffect(() => {
        const handleClipDragGlobal = (e) => {
            var _a;
            const customEvent = e;
            const { clip, sourceTimelineId, clientX, clientY, isDropping } = customEvent.detail;
            const thisTimelineId = timelineId || "";
            const isSameTimeline = sourceTimelineId === thisTimelineId;
            const rect = (_a = contentRef.current) === null || _a === void 0 ? void 0 : _a.getBoundingClientRect();
            const isInside = rect &&
                clientX >= rect.left &&
                clientX <= rect.right &&
                clientY >= rect.top &&
                clientY <= rect.bottom;
            if (isInside) {
                let hoveredCollection = null;
                let insertIndex = visibleClips.length;
                if (hasClips && contentRef.current) {
                    const dropX = clientX - rect.left;
                    for (let i = 0; i < visibleClips.length; i++) {
                        const c = visibleClips[i];
                        if (c.kind === "collection" && c.id !== clip.id) {
                            const left = getClipLeft(c);
                            const width = getClipWidth(c);
                            const paddingX = width * 0.2;
                            if (dropX >= left + paddingX && dropX <= left + width - paddingX) {
                                hoveredCollection = c;
                                break;
                            }
                        }
                    }
                    if (!hoveredCollection) {
                        if (!isSameTimeline) {
                            insertIndex = visibleClips.length;
                            for (let i = 0; i < visibleClips.length; i++) {
                                const c = visibleClips[i];
                                const left = getClipLeft(c);
                                const width = getClipWidth(c);
                                const midpoint = left + width / 2;
                                if (dropX < midpoint) {
                                    insertIndex = c.index;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (isDropping) {
                    setActiveDropIndex(null);
                    setActiveCollectionHoverId(null);
                    if (hoveredCollection) {
                        if (hoveredCollection.kind === "collection" && onDropClipIntoCollection) {
                            onDropClipIntoCollection(clip, hoveredCollection.childTimelineId, sourceTimelineId);
                            customEvent.detail.handled = true;
                        }
                    }
                    else {
                        if (!isSameTimeline && onDropClip) {
                            onDropClip(insertIndex, clip, sourceTimelineId);
                            customEvent.detail.handled = true;
                        }
                    }
                }
                else {
                    if (hoveredCollection) {
                        setActiveCollectionHoverId(hoveredCollection.id);
                        setActiveDropIndex(null);
                    }
                    else {
                        setActiveCollectionHoverId(null);
                        if (!isSameTimeline) {
                            setActiveDropIndex(insertIndex);
                        }
                        else {
                            setActiveDropIndex(null);
                        }
                    }
                }
            }
            else {
                setActiveDropIndex(null);
                setActiveCollectionHoverId(null);
            }
        };
        window.addEventListener("gstudio-clip-drag", handleClipDragGlobal);
        return () => {
            window.removeEventListener("gstudio-clip-drag", handleClipDragGlobal);
        };
    }, [
        contentRef,
        getClipLeft,
        getClipWidth,
        hasClips,
        onDropClip,
        onDropClipIntoCollection,
        timelineId,
        visibleClips,
    ]);
    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        const isFiles = e.dataTransfer.types.includes("Files");
        const isClip = e.dataTransfer.types.includes("application/json") ||
            e.dataTransfer.types.includes("application/x-gstudio-type");
        if (!isFiles && !isClip)
            return;
        let hoveredCollection = null;
        let insertIndex = 0;
        if (hasClips && contentRef.current) {
            const rect = contentRef.current.getBoundingClientRect();
            const dropX = e.clientX - rect.left;
            for (let i = 0; i < visibleClips.length; i++) {
                const c = visibleClips[i];
                if (c.kind === "collection") {
                    const left = getClipLeft(c);
                    const width = getClipWidth(c);
                    const paddingX = width * 0.2;
                    if (dropX >= left + paddingX && dropX <= left + width - paddingX) {
                        hoveredCollection = c;
                        break;
                    }
                }
            }
            if (!hoveredCollection) {
                insertIndex = visibleClips.length;
                for (let i = 0; i < visibleClips.length; i++) {
                    const clip = visibleClips[i];
                    const left = getClipLeft(clip);
                    const width = getClipWidth(clip);
                    const midpoint = left + width / 2;
                    if (dropX < midpoint) {
                        insertIndex = clip.index;
                        break;
                    }
                }
            }
        }
        if (hoveredCollection) {
            setActiveCollectionHoverId(hoveredCollection.id);
            setActiveDropIndex(null);
        }
        else {
            setActiveCollectionHoverId(null);
            setActiveDropIndex(insertIndex);
        }
    }, [contentRef, getClipLeft, getClipWidth, hasClips, visibleClips]);
    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragOver(false);
        setActiveDropIndex(null);
        dragCounterRef.current = 0;
        const sidebarType = e.dataTransfer.getData("application/x-gstudio-type");
        if (sidebarType &&
            (sidebarType === "collection" || sidebarType === "image" || sidebarType === "video")) {
            if (activeCollectionHoverId) {
                const targetCol = visibleClips.find((c) => c.id === activeCollectionHoverId);
                if (targetCol && targetCol.kind === "collection" && onDropSidebarClipIntoCollection) {
                    onDropSidebarClipIntoCollection(sidebarType, targetCol.childTimelineId);
                }
                setActiveCollectionHoverId(null);
                return;
            }
            let insertIndex = 0;
            if (hasClips && contentRef.current) {
                const rect = contentRef.current.getBoundingClientRect();
                const dropX = e.clientX - rect.left;
                insertIndex = visibleClips.length;
                for (let i = 0; i < visibleClips.length; i++) {
                    const clip = visibleClips[i];
                    const left = getClipLeft(clip);
                    const width = getClipWidth(clip);
                    const midpoint = left + width / 2;
                    if (dropX < midpoint) {
                        insertIndex = clip.index;
                        break;
                    }
                }
            }
            if (onDropSidebarClip) {
                onDropSidebarClip(insertIndex, sidebarType);
            }
            setActiveCollectionHoverId(null);
            return;
        }
        const rawData = e.dataTransfer.getData("application/json");
        if (rawData) {
            try {
                const data = JSON.parse(rawData);
                if (data && data.clip && data.sourceTimelineId !== undefined) {
                    if (activeCollectionHoverId) {
                        const targetCol = visibleClips.find((c) => c.id === activeCollectionHoverId);
                        if (targetCol && targetCol.kind === "collection" && onDropClipIntoCollection) {
                            onDropClipIntoCollection(data.clip, targetCol.childTimelineId, data.sourceTimelineId);
                        }
                        setActiveCollectionHoverId(null);
                        return;
                    }
                    let insertIndex = 0;
                    if (hasClips && contentRef.current) {
                        const rect = contentRef.current.getBoundingClientRect();
                        const dropX = e.clientX - rect.left;
                        insertIndex = visibleClips.length;
                        for (let i = 0; i < visibleClips.length; i++) {
                            const clip = visibleClips[i];
                            const left = getClipLeft(clip);
                            const width = getClipWidth(clip);
                            const midpoint = left + width / 2;
                            if (dropX < midpoint) {
                                insertIndex = clip.index;
                                break;
                            }
                        }
                    }
                    if (onDropClip) {
                        onDropClip(insertIndex, data.clip, data.sourceTimelineId);
                    }
                    setActiveCollectionHoverId(null);
                    return;
                }
            }
            catch (_a) {
                // Not JSON; fall through to file handling.
            }
        }
        if (!onDropFiles || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
            setActiveCollectionHoverId(null);
            return;
        }
        const files = Array.from(e.dataTransfer.files);
        const mediaFiles = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
        if (mediaFiles.length === 0) {
            setActiveCollectionHoverId(null);
            return;
        }
        let insertIndex = 0;
        if (hasClips && contentRef.current) {
            const rect = contentRef.current.getBoundingClientRect();
            const dropX = e.clientX - rect.left;
            insertIndex = visibleClips.length;
            for (let i = 0; i < visibleClips.length; i++) {
                const clip = visibleClips[i];
                const left = getClipLeft(clip);
                const width = getClipWidth(clip);
                const midpoint = left + width / 2;
                if (dropX < midpoint) {
                    insertIndex = clip.index;
                    break;
                }
            }
        }
        onDropFiles(insertIndex, mediaFiles);
        setActiveCollectionHoverId(null);
    }, [
        activeCollectionHoverId,
        contentRef,
        getClipLeft,
        getClipWidth,
        hasClips,
        onDropClip,
        onDropClipIntoCollection,
        onDropFiles,
        onDropSidebarClip,
        onDropSidebarClipIntoCollection,
        visibleClips,
    ]);
    return {
        activeCollectionHoverId,
        activeDropIndex,
        handleDragEnter,
        handleDragLeave,
        handleDragOver,
        handleDrop,
        isAnyDragActive,
        isDragOver,
    };
}
