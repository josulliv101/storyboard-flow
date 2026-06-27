"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { getTimelineDocument, getTimelinePath } from "@/lib/timeline-documents";
import { parseTimelineViewState } from "@/components/timeline/timeline-view-state";

export default function StoryboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const timelineId = searchParams.get("timelineId") || "storyboard";
  const viewState = parseTimelineViewState(Object.fromEntries(searchParams.entries()));

  const [document, setDocument] = useState(() => getTimelineDocument(timelineId));

  const [prevTimelineId, setPrevTimelineId] = useState(timelineId);
  if (timelineId !== prevTimelineId) {
    setPrevTimelineId(timelineId);
    setDocument(getTimelineDocument(timelineId));
  }

  // Subscribe to external store updates
  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.timelineId === timelineId) {
        setDocument({ ...getTimelineDocument(timelineId)! });
      }
    };
    window.addEventListener("gstudio-timeline-update", handleUpdate);
    return () => {
      window.removeEventListener("gstudio-timeline-update", handleUpdate);
    };
  }, [timelineId]);

  if (!document) return null;

  const path = getTimelinePath(timelineId);
  const parentCollection = path.length > 0 ? path[path.length - 1] : null;

  const getParentHref = () => {
    if (!parentCollection) return "/";
    if (parentCollection.id === "storyboard") return pathname;
    return `${pathname}?timelineId=${parentCollection.id}`;
  };

  const getSegmentHref = (segmentId: string) => {
    if (segmentId === "storyboard") return pathname;
    return `${pathname}?timelineId=${segmentId}`;
  };

  const handleOpenCollection = (nextId: string) => {
    router.push(`${pathname}?timelineId=${nextId}`);
  };

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-5 animate-fade-in">
      <div className="flex items-center gap-3">
        {timelineId !== "storyboard" && (
          <Link
            href={getParentHref()}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 hover:bg-zinc-800 transition-all shrink-0 animate-in fade-in"
            title={parentCollection ? `Go to parent: ${parentCollection.title}` : "Go back"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}

        <nav className="flex items-center gap-2 text-xs text-zinc-400 select-none">
          <Link href={pathname} className="text-zinc-400 hover:text-white transition-colors">
            Storyboard Workspace
          </Link>

          {path.length > 0 && <span>/</span>}

          {path.map((segment) => {
            if (segment.id === "storyboard") return null;
            return (
              <React.Fragment key={segment.id}>
                <Link
                  href={getSegmentHref(segment.id)}
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  {segment.title}
                </Link>
                <span>/</span>
              </React.Fragment>
            );
          })}

          {timelineId !== "storyboard" && (
            <span className="text-zinc-100 font-semibold truncate max-w-[250px]">
              {document.title}
            </span>
          )}
        </nav>
      </div>

      <SmoothScrollList
        timelineId={document.id}
        timelineTitle={document.title}
        initialClips={document.clips}
        onOpenCollection={handleOpenCollection}
        initialViewState={{
          ...viewState,
          thumbnailMode: true,
          hierarchyMode: true,
          itemSize: "sm",
        }}
        syncMediaDuration={false}
      />
    </div>
  );
}
