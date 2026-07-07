"use client";
import { useEffect } from "react";
export function TimelineKeyboardShortcuts({ displayClipsRef, onMoveClipToTrash, selectedIndex, sourceClips, timelineId, }) {
    useEffect(() => {
        const handleGlobalKeyDown = async (event) => {
            var _a;
            if (event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement) {
                return;
            }
            if (event.key !== "Delete" && event.key !== "Backspace")
                return;
            if (selectedIndex === null)
                return;
            const thisTimelineId = timelineId || "";
            const selectedViewClip = displayClipsRef.current.find((clip) => clip.index === selectedIndex);
            if ((selectedViewClip === null || selectedViewClip === void 0 ? void 0 : selectedViewClip.viewRole) ||
                (selectedViewClip === null || selectedViewClip === void 0 ? void 0 : selectedViewClip.viewSourceTimelineId) !== thisTimelineId) {
                event.preventDefault();
                return;
            }
            const sourceClipId = (_a = selectedViewClip === null || selectedViewClip === void 0 ? void 0 : selectedViewClip.viewSourceClipId) !== null && _a !== void 0 ? _a : selectedViewClip === null || selectedViewClip === void 0 ? void 0 : selectedViewClip.id;
            const selectedClip = sourceClips.find((clip) => clip.id === sourceClipId);
            if (!selectedClip)
                return;
            event.preventDefault();
            await onMoveClipToTrash(selectedClip);
        };
        window.addEventListener("keydown", handleGlobalKeyDown);
        return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    }, [
        displayClipsRef,
        onMoveClipToTrash,
        selectedIndex,
        sourceClips,
        timelineId,
    ]);
    return null;
}
