"use client";

import type { ReactNode } from "react";

import type { CollectionTimelineClip, TimelineDocument } from "../types";

type TimelineHierarchyViewProps = {
  childCollections: CollectionTimelineClip[];
  getTimelineDocument: (id: string) => TimelineDocument | null;
  renderTimeline: (
    collection: CollectionTimelineClip,
    document: TimelineDocument | null,
  ) => ReactNode;
  visible: boolean;
};

export function TimelineHierarchyView({
  childCollections,
  getTimelineDocument,
  renderTimeline,
  visible,
}: TimelineHierarchyViewProps) {
  if (!visible || childCollections.length === 0) return null;

  return (
    <div className="flex flex-col gap-5 pl-20 border-l border-zinc-800/80 mt-0 w-full max-w-full min-w-0">
      {childCollections.map((collection) => {
        const document = getTimelineDocument(collection.childTimelineId);
        return renderTimeline(collection, document);
      })}
    </div>
  );
}
