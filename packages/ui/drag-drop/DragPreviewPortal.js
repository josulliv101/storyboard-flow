"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { createPortal } from "react-dom";
export function DragPreviewPortal({ preview, width, height, children, className = "fixed pointer-events-none z-[9999]", scale = 1.03, testId, }) {
    const [isMounted, setIsMounted] = React.useState(false);
    React.useEffect(() => {
        setIsMounted(true);
    }, []);
    if (!preview || !isMounted || typeof document === "undefined") {
        return null;
    }
    return createPortal(_jsx("div", { className: className, "data-testid": testId, style: {
            left: `${preview.clientX - preview.pointerOffsetX}px`,
            top: `${preview.clientY - preview.pointerOffsetY}px`,
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${scale})`,
        }, children: children }), document.body);
}
