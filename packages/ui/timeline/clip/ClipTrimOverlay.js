import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { TrimHandle } from "./TrimHandle";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
export function ClipTrimOverlay({ clip, view }) {
    const { resizeHandlers } = useTimelineClipItemContext();
    if (!view.isSelected)
        return null;
    // In thumbnail mode only render the selection ring, no trim handles.
    if (view.thumbnailMode) {
        return (_jsx("div", { className: "pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" }));
    }
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" }), _jsx(TrimHandle, { edge: "left", currentWidth: view.width, currentDuration: clip.duration, onPointerDown: (event) => resizeHandlers.onResizeDown(event, clip, "left"), onPointerMove: resizeHandlers.onResizeMove, onPointerUp: resizeHandlers.onResizeUp, onPointerCancel: resizeHandlers.onResizeUp, onKeyDown: (event) => resizeHandlers.onResizeKeyDown(event, clip, "left") }), _jsx(TrimHandle, { edge: "right", currentWidth: view.width, currentDuration: clip.duration, onPointerDown: (event) => resizeHandlers.onResizeDown(event, clip, "right"), onPointerMove: resizeHandlers.onResizeMove, onPointerUp: resizeHandlers.onResizeUp, onPointerCancel: resizeHandlers.onResizeUp, onKeyDown: (event) => resizeHandlers.onResizeKeyDown(event, clip, "right") })] }));
}
