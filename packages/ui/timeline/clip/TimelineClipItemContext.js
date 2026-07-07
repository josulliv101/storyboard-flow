"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext } from "react";
const TimelineClipItemContext = createContext(null);
export function TimelineClipItemProvider({ value, children, }) {
    return (_jsx(TimelineClipItemContext.Provider, { value: value, children: children }));
}
export function useTimelineClipItemContext() {
    const value = useContext(TimelineClipItemContext);
    if (!value) {
        throw new Error("Timeline clip item components must be rendered inside TimelineClipItemProvider.");
    }
    return value;
}
