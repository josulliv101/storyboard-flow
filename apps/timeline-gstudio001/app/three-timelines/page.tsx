"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Layers, FolderPlus, Image, Video } from "lucide-react";
import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { getTimelinePage, getTimelineDocument, registerTimelineDocument } from "@/lib/timeline-documents";
import type { TimelineDocument } from "@/components/timeline/types";

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

  if (!isActive || isReorder) return null;

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
  const [activeDraggedTimelineId, setActiveDraggedTimelineId] = useState<string | null>(null);
  const [activeSidebarDragType, setActiveSidebarDragType] = useState<string | null>(null);

  const isReorderDragRef = useRef(isReorderDrag);
  const activeDraggedTimelineIdRef = useRef(activeDraggedTimelineId);

  useEffect(() => {
    isReorderDragRef.current = isReorderDrag;
  }, [isReorderDrag]);

  useEffect(() => {
    activeDraggedTimelineIdRef.current = activeDraggedTimelineId;
  }, [activeDraggedTimelineId]);

  const [hoveredDropZoneIndex, setHoveredDropZoneIndex] = useState<number | null>(null);
  const [activeDragClip, setActiveDragClip] = useState<any | null>(null);
  const [dragCoords, setDragCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Subscribe to external store updates to sync clips across timelines and prevent re-render loss
  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.timelineId) {
        const updatedDoc = getTimelineDocument(detail.timelineId);
        if (updatedDoc) {
          setTimelines((prev) =>
            prev.map((t) =>
              t.id === detail.timelineId
                ? { ...t, clips: [...updatedDoc.clips] }
                : t
            )
          );
        }
      }
    };
    window.addEventListener("gstudio-timeline-update", handleUpdate);
    return () => {
      window.removeEventListener("gstudio-timeline-update", handleUpdate);
    };
  }, []);

  const handleDropTimeline = useCallback((insertIndex: number, draggedTimelineId?: string) => {
    if (draggedTimelineId && timelines.some((t) => t.id === draggedTimelineId)) {
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
      registerTimelineDocument(newTimeline);
      const next = [...timelines];
      next.splice(insertIndex, 0, newTimeline);
      setTimelines(next);
    }
  }, [timelines]);

  useEffect(() => {
    const handleDragStart = (e: Event) => {
      const customEvent = e as CustomEvent<{ type: string; isReorder?: boolean }>;
      const { type, isReorder } = customEvent.detail;
      if (type === "timeline") {
        setIsTimelineDragActive(true);
        setIsReorderDrag(!!isReorder);
      }
      setActiveSidebarDragType(type);
    };

    const handleDragEnd = () => {
      setIsTimelineDragActive(false);
      setIsReorderDrag(false);
      setActiveDragClip(null);
      setActiveDraggedTimelineId(null);
      setActiveSidebarDragType(null);
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
        setActiveDraggedTimelineId(timelineId);
        setDragCoords({ x: clientX, y: clientY });
      } else if (type === "move") {
        setDragCoords({ x: clientX, y: clientY });
        if (isReorderDragRef.current || activeDraggedTimelineIdRef.current || timelineId) {
          const elements = document.querySelectorAll("[data-timeline-id]");
          let targetTimelineId: string | null = null;
          elements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (
              clientX >= rect.left &&
              clientX <= rect.right &&
              clientY >= rect.top &&
              clientY <= rect.bottom
            ) {
              targetTimelineId = el.getAttribute("data-timeline-id");
            }
          });

          const currentDragId = activeDraggedTimelineIdRef.current || timelineId;
          if (targetTimelineId && targetTimelineId !== currentDragId && currentDragId) {
            setTimelines((prev) => {
              const next = [...prev];
              const fromIndex = next.findIndex((t) => t.id === currentDragId);
              const toIndex = next.findIndex((t) => t.id === targetTimelineId);
              if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
                const [removed] = next.splice(fromIndex, 1);
                next.splice(toIndex, 0, removed);
              }
              return next;
            });
          }
        } else {
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
        }
      } else if (type === "drop") {
        if (!isReorderDragRef.current && !activeDraggedTimelineIdRef.current) {
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
        }

        setIsTimelineDragActive(false);
        setIsReorderDrag(false);
        setActiveDraggedTimelineId(null);
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

    const handleDragOverGlobal = (e: DragEvent) => {
      setDragCoords({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("gstudio-drag-start", handleDragStart);
    window.addEventListener("gstudio-drag-end", handleDragEnd);
    window.addEventListener("gstudio-clip-drag", handleClipDrag);
    window.addEventListener("gstudio-timeline-drag", handleTimelineDragGlobal);
    window.addEventListener("dragover", handleDragOverGlobal);
    return () => {
      window.removeEventListener("gstudio-drag-start", handleDragStart);
      window.removeEventListener("gstudio-drag-end", handleDragEnd);
      window.removeEventListener("gstudio-clip-drag", handleClipDrag);
      window.removeEventListener("gstudio-timeline-drag", handleTimelineDragGlobal);
      window.removeEventListener("dragover", handleDragOverGlobal);
    };
  }, [handleDropTimeline]);

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-8">
          <TimelineDropZone
            onDropTimeline={(draggedId) => handleDropTimeline(0, draggedId)}
            isActive={isTimelineDragActive}
            isReorder={isReorderDrag}
            isHovered={hoveredDropZoneIndex === 0}
            index={0}
          />

          {timelines.map((timeline, index) => {
            const isDraggingThis = activeDraggedTimelineId === timeline.id;
            return (
              <div key={timeline.id} className="grid gap-8">
                <section
                  aria-label={timeline.title}
                  className={`grid transition-all duration-200 ${
                    isDraggingThis
                      ? "opacity-40 scale-[0.98] border-2 border-dashed border-sky-500/50 rounded-lg p-2 bg-zinc-900/20"
                      : ""
                  }`}
                  data-timeline-id={timeline.id}
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
          )})}

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

      {activeDraggedTimelineId && (() => {
        const draggedTimeline = timelines.find((t) => t.id === activeDraggedTimelineId);
        if (!draggedTimeline) return null;
        return (
          <div
            style={{
              position: "fixed",
              left: `${dragCoords.x}px`,
              top: `${dragCoords.y}px`,
              transform: "translate(-50%, -50%) scale(1.05)",
              pointerEvents: "none",
              zIndex: 9999,
            }}
            className="flex h-12 items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800/95 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-2xl backdrop-blur select-none"
          >
            <Layers className="h-4 w-4 text-sky-400 shrink-0" />
            <span className="truncate max-w-[120px] text-zinc-200">
              {draggedTimeline.title}
            </span>
          </div>
        );
      })()}

      {activeSidebarDragType && (() => {
        let label = "";
        let IconComponent = Layers;
        
        switch (activeSidebarDragType) {
          case "timeline":
            label = "New Timeline Layer";
            IconComponent = Layers;
            break;
          case "collection":
            label = "New Collection / Beat";
            IconComponent = FolderPlus;
            break;
          case "image":
            label = "New Image Clip";
            IconComponent = Image;
            break;
          case "video":
            label = "New Video Clip";
            IconComponent = Video;
            break;
          default:
            return null;
        }

        return (
          <div
            style={{
              position: "fixed",
              left: `${dragCoords.x}px`,
              top: `${dragCoords.y}px`,
              transform: "translate(-50%, -50%) scale(1.05)",
              pointerEvents: "none",
              zIndex: 9999,
            }}
            className="flex h-12 items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800/95 px-4 py-2 text-xs font-semibold text-zinc-100 shadow-2xl backdrop-blur select-none"
          >
            <IconComponent className="h-4 w-4 text-sky-400 shrink-0" />
            <span className="truncate max-w-[150px] text-zinc-200">
              {label}
            </span>
          </div>
        );
      })()}
    </div>
  );
}
