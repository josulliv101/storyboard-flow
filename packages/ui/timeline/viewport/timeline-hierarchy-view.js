"use client";
import { jsx as _jsx } from "react/jsx-runtime";
export function TimelineHierarchyView({ childCollections, getTimelineDocument, renderTimeline, visible, }) {
    if (!visible || childCollections.length === 0)
        return null;
    return (_jsx("div", { className: "flex flex-col gap-5 pl-20 border-l border-zinc-800/80 mt-0 w-full max-w-full min-w-0", children: childCollections.map((collection) => {
            const document = getTimelineDocument(collection.childTimelineId);
            return renderTimeline(collection, document);
        }) }));
}
