"use client";

import { useEffect, useState, useCallback } from "react";
import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { getTimelinePage } from "@/lib/timeline-documents";
import type { TimelineDocument } from "@/components/timeline/types";
import { TimelineSidebar } from "@/components/timeline/timeline-sidebar";

function TimelineDropZone({
  onDropTimeline,
  isActive,
  isReorder,
  isHovered,
  index,
}: {
  onDropTimeline: (draggedTimelineId?: string) => void;
  isActive: boolean;
  isReorder: boolean;
  isHovered: boolean;
  index: number;
}) {
  const [isLocalOver, setIsLocalOver] = useState(false);

  if (!isActive) return null;

  const activeHover = isHovered || isLocalOver;

  return (
    <div
      data-drop-zone-index={index}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsLocalOver(true);
      }}
      onDragLeave={() => setIsLocalOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsLocalOver(false);
        const draggedTimelineId = e.dataTransfer.getData("application/x-gstudio-timeline-id") || e.dataTransfer.getData("text/plain");
        onDropTimeline(draggedTimelineId || undefined);
      }}
      className={`h-16 w-full rounded-lg border-2 border-dashed transition-all duration-200 flex items-center justify-center ${
        activeHover
          ? "border-sky-400 bg-sky-950/30 text-sky-300 scale-[1.01]"
          : "border-zinc-800 bg-zinc-900/10 text-zinc-600"
      }`}
    >
      <span className="text-xs font-semibold uppercase tracking-wider select-none">
        {activeHover
          ? (isReorder ? "Drop to reorder timeline here" : "Drop to add timeline here")
          : (isReorder ? "Drag timeline here to reorder" : "Drag timeline block here")
        }
      </span>
    </div>
  );
}

export default function ThreeTimelinesPage() {
  const page = getTimelinePage("three");
  const [timelines, setTimelines] = useState<TimelineDocument[]>(() => page?.timelines ?? []);
  const [isTimelineDragActive, setIsTimelineDragActive] = useState(false);
  const [isReorderDrag, setIsReorderDrag] = useState(false);
  const [hoveredDropZoneIndex, setHoveredDropZoneIndex] = useState<number | null>(null);
  const [activeDragClip, setActiveDragClip] = useState<any | null>(null);
  const [dragCoords, setDragCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleDropTimeline = useCallback((insertIndex: number, draggedTimelineId?: string) => {
    if (draggedTimelineId) {
      const sourceIndex = timelines.findIndex((t) => t.id === draggedTimelineId);
      if (sourceIndex === -1) return;

      const next = [...timelines];
      const [removed] = next.splice(sourceIndex, 1);

      let targetIndex = insertIndex;
      if (sourceIndex < insertIndex) {
        targetIndex = insertIndex - 1;
      }

      next.splice(targetIndex, 0, removed);
      setTimelines(next);
    } else {
      const newId = `timeline-${Date.now()}`;
      const newTimeline: TimelineDocument = {
        id: newId,
        title: `Timeline ${timelines.length + 1}`,
        description: "Custom user timeline.",
        clips: [],
      };
      const next = [...timelines];
      next.splice(insertIndex, 0, newTimeline);
      setTimelines(next);
    }
  }, [timelines]);

  useEffect(() => {
    const handleDragStart = (e: Event) => {
      const customEvent = e as CustomEvent<{ type: string; isReorder?: boolean }>;
      if (customEvent.detail.type === "timeline") {
        setIsTimelineDragActive(true);
        setIsReorderDrag(!!customEvent.detail.isReorder);
      }
    };

    const handleDragEnd = () => {
      setIsTimelineDragActive(false);
      setIsReorderDrag(false);
      setActiveDragClip(null);
    };

    const handleTimelineDragGlobal = (e: Event) => {
      const customEvent = e as CustomEvent<{
        timelineId: string;
        clientX: number;
        clientY: number;
        isDropping: boolean;
        type: "start" | "move" | "drop";
      }>;
      const { type, timelineId, clientX, clientY } = customEvent.detail;

      if (type === "start") {
        setIsTimelineDragActive(true);
        setIsReorderDrag(true);
      } else if (type === "move") {
        const elements = document.querySelectorAll("[data-drop-zone-index]");
        let foundIndex: number | null = null;
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          ) {
            foundIndex = Number(el.getAttribute("data-drop-zone-index"));
          }
        });
        setHoveredDropZoneIndex(foundIndex);
      } else if (type === "drop") {
        const elements = document.querySelectorAll("[data-drop-zone-index]");
        let dropIndex: number | null = null;
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          ) {
            dropIndex = Number(el.getAttribute("data-drop-zone-index"));
          }
        });

        if (dropIndex !== null) {
          handleDropTimeline(dropIndex, timelineId);
        }

        setIsTimelineDragActive(false);
        setIsReorderDrag(false);
        setHoveredDropZoneIndex(null);
      }
    };

    const handleClipDrag = (e: Event) => {
      const customEvent = e as CustomEvent<{
        clip: any;
        sourceTimelineId: string;
        clientX: number;
        clientY: number;
        isDropping: boolean;
      }>;
      const { clip, clientX, clientY, isDropping } = customEvent.detail;

      if (isDropping) {
        setActiveDragClip(null);
      } else {
        setActiveDragClip(clip);
        setDragCoords({ x: clientX, y: clientY });
      }
    };

    window.addEventListener("gstudio-drag-start", handleDragStart);
    window.addEventListener("gstudio-drag-end", handleDragEnd);
    window.addEventListener("gstudio-clip-drag", handleClipDrag);
    window.addEventListener("gstudio-timeline-drag", handleTimelineDragGlobal);
    return () => {
      window.removeEventListener("gstudio-drag-start", handleDragStart);
      window.removeEventListener("gstudio-drag-end", handleDragEnd);
      window.removeEventListener("gstudio-clip-drag", handleClipDrag);
      window.removeEventListener("gstudio-timeline-drag", handleTimelineDragGlobal);
    };
  }, [handleDropTimeline]);

  return (
    <div className="relative flex min-h-screen bg-zinc-950 text-white font-sans overflow-x-hidden">
      <TimelineSidebar />
      <main className="flex-1 px-8 py-10 overflow-y-auto max-h-screen">
        <div className="mx-auto grid w-full max-w-[1400px] gap-8">
          <TimelineDropZone
            onDropTimeline={(draggedId) => handleDropTimeline(0, draggedId)}
            isActive={isTimelineDragActive}
            isReorder={isReorderDrag}
            isHovered={hoveredDropZoneIndex === 0}
            index={0}
          />

          {timelines.map((timeline, index) => (
            <div key={timeline.id} className="grid gap-8">
              <section
                aria-label={timeline.title}
                className="grid"
              >
                <SmoothScrollList
                  timelineId={timeline.id}
                  timelineTitle={timeline.title}
                  initialClips={timeline.clips}
                  syncMediaDuration={false}
                />
              </section>

              <TimelineDropZone
                onDropTimeline={(draggedId) => handleDropTimeline(index + 1, draggedId)}
                isActive={isTimelineDragActive}
                isReorder={isReorderDrag}
                isHovered={hoveredDropZoneIndex === index + 1}
                index={index + 1}
              />
            </div>
          ))}
        </div>
      </main>

      {activeDragClip && (
        <div
          style={{
            position: "fixed",
            left: `${dragCoords.x}px`,
            top: `${dragCoords.y}px`,
            transform: "translate(-50%, -50%) scale(1.05)",
            pointerEvents: "none",
            zIndex: 9999,
          }}
          className="flex h-16 w-48 items-center gap-2 rounded border border-zinc-700 bg-zinc-800/95 p-2 text-xs font-medium text-zinc-100 shadow-2xl backdrop-blur select-none"
        >
          <div className="h-10 w-16 shrink-0 rounded bg-zinc-700 overflow-hidden flex items-center justify-center">
            {activeDragClip.kind === "collection" ? (
              <span className="text-[10px]">📁 Beat</span>
            ) : activeDragClip.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeDragClip.src}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <video
                src={activeDragClip.src}
                className="h-full w-full object-cover"
                muted
                playsInline
              />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-[10px] font-semibold text-zinc-200">
              {activeDragClip.kind === "collection" ? activeDragClip.title : activeDragClip.alt || "Clip"}
            </span>
            <span className="text-[8px] text-zinc-400">
              {activeDragClip.duration.toFixed(1)}s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
