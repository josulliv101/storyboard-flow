import { useCallback, useEffect, useRef, useState } from "react";
import { TIMELINE_LEADING_PADDING_SECONDS, } from "../constants";
import { createInitialClips } from "./use-timeline-clips";
function cloneTimelineClips(clips) {
    return clips.map((clip) => {
        var _a;
        return clip.kind === "collection"
            ? Object.assign(Object.assign({}, clip), { previewItems: (_a = clip.previewItems) === null || _a === void 0 ? void 0 : _a.map((item) => (Object.assign({}, item))) }) : Object.assign({}, clip);
    });
}
export function useTimelineClipState({ initialClips, itemCount, parentRef, pendingScrollLeftRef, resetKey, setScrollLeft, }) {
    const resizeFrameRef = useRef(null);
    const pendingClipsRef = useRef(null);
    const isInitialMount = useRef(true);
    const [clips, setClips] = useState(() => initialClips
        ? cloneTimelineClips(initialClips)
        : createInitialClips(itemCount, 100));
    const [selectedIndex, setSelectedIndex] = useState(null);
    const [scrubPreview, setScrubPreview] = useState(null);
    const lastResetKeyRef = useRef(resetKey);
    useEffect(() => {
        const isKeyChange = lastResetKeyRef.current !== resetKey;
        lastResetKeyRef.current = resetKey;
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        const nextClips = initialClips
            ? cloneTimelineClips(initialClips)
            : createInitialClips(itemCount, 100);
        setClips(nextClips);
        if (isKeyChange) {
            const nextScrollLeft = TIMELINE_LEADING_PADDING_SECONDS * 100;
            setSelectedIndex(null);
            setScrubPreview(null);
            setScrollLeft(nextScrollLeft);
            if (parentRef.current) {
                parentRef.current.scrollLeft = nextScrollLeft;
            }
        }
    }, [initialClips, itemCount, parentRef, resetKey, setScrollLeft]);
    const scheduleClips = useCallback((nextClips) => {
        pendingClipsRef.current = nextClips;
        if (resizeFrameRef.current !== null)
            return;
        resizeFrameRef.current = requestAnimationFrame(() => {
            const pendingClips = pendingClipsRef.current;
            pendingClipsRef.current = null;
            resizeFrameRef.current = null;
            if (pendingClips)
                setClips(pendingClips);
        });
    }, []);
    const applyClipsNow = useCallback((nextClips) => {
        if (resizeFrameRef.current !== null) {
            cancelAnimationFrame(resizeFrameRef.current);
            resizeFrameRef.current = null;
        }
        pendingClipsRef.current = null;
        setClips(nextClips);
    }, []);
    useEffect(() => {
        if (pendingScrollLeftRef.current !== null && parentRef.current) {
            parentRef.current.scrollLeft = pendingScrollLeftRef.current;
            pendingScrollLeftRef.current = null;
        }
    }, [clips, parentRef, pendingScrollLeftRef]);
    const cleanupClipFrames = useCallback(() => {
        if (resizeFrameRef.current !== null) {
            cancelAnimationFrame(resizeFrameRef.current);
        }
    }, []);
    return {
        clips,
        setClips,
        selectedIndex,
        setSelectedIndex,
        scrubPreview,
        setScrubPreview,
        scheduleClips,
        applyClipsNow,
        cleanupClipFrames,
    };
}
