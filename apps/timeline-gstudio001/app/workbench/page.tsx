"use client";

import React, { Suspense, useCallback, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { ToggleSwitch } from "@storyboard/ui/timeline/controls/timeline-toolbar";
import { WorkbenchSplitPane } from "@storyboard/ui/timeline/viewport/workbench-display-surface";
import { getTimelineDocument, getTimelinePath } from "@storyboard/ui/timeline/timeline-documents";
import { parseTimelineViewState } from "@storyboard/ui/timeline/timeline-view-state";
import type { TimelineClip } from "@storyboard/ui/timeline/types";

function WorkbenchPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const timelineId = searchParams.get("timelineId") || "workbench";
  const viewState = parseTimelineViewState(Object.fromEntries(searchParams.entries()));

  const [document, setDocument] = useState(() => getTimelineDocument(timelineId));
  const [previewTime, setPreviewTime] = useState(0);
  const [previewClips, setPreviewClips] = useState<TimelineClip[] | null>(null);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [previewLargeSurface, setPreviewLargeSurface] = useState(false);

  const [prevTimelineId, setPrevTimelineId] = useState(timelineId);
  if (timelineId !== prevTimelineId) {
    setPrevTimelineId(timelineId);
    setDocument(getTimelineDocument(timelineId));
    setPreviewClips(null);
    setPreviewClipId(null);
  }

  // Subscribe to external store updates
  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        timelineId?: string;
        document?: NonNullable<typeof document>;
      };
      if (detail && detail.timelineId === timelineId) {
        const updatedDocument = detail.document ?? getTimelineDocument(timelineId);
        if (updatedDocument) {
          setDocument({ ...updatedDocument });
        }
      }
    };
    window.addEventListener("gstudio-timeline-update", handleUpdate);
    return () => {
      window.removeEventListener("gstudio-timeline-update", handleUpdate);
    };
  }, [timelineId]);

  // Above the early return: hooks must run on EVERY render, and this
  // component can bail before rendering when the document is missing.
  const handlePreviewTimeChange = useCallback((
    time: number,
    clips?: TimelineClip[],
    activeClipId?: string,
  ) => {
    setPreviewTime(time);
    if (clips) {
      setPreviewClips(clips);
    }
    setPreviewClipId(activeClipId ?? null);
  }, []);

  if (!document) return null;

  const path = getTimelinePath(timelineId);
  const parentCollection = path.length > 0 ? path[path.length - 1] : null;

  const getParentHref = () => {
    if (!parentCollection) return "/";
    if (parentCollection.id === "workbench") return pathname;
    return `${pathname}?timelineId=${parentCollection.id}`;
  };

  const getSegmentHref = (segmentId: string) => {
    if (segmentId === "workbench") return pathname;
    return `${pathname}?timelineId=${segmentId}`;
  };

  const handleOpenCollection = (nextId: string) => {
    router.push(`${pathname}?timelineId=${nextId}`);
  };

  const timelineChrome = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {timelineId !== "workbench" && (
          <Link
            href={getParentHref()}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 hover:bg-zinc-800 transition-all shrink-0 animate-in fade-in"
            title={parentCollection ? `Go to parent: ${parentCollection.title}` : "Go back"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}

        <nav className="flex min-w-0 items-center gap-2 text-xs text-zinc-400 select-none">
          <Link href={pathname} className="text-zinc-400 hover:text-white transition-colors">
            Workbench Workspace
          </Link>

          {path.length > 0 && <span>/</span>}

          {path.map((segment) => {
            if (segment.id === "workbench") return null;
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

          {timelineId !== "workbench" && (
            <span className="text-zinc-100 font-semibold truncate max-w-[250px]">
              {document.title}
            </span>
          )}
        </nav>
      </div>

      <div className="shrink-0">
        <ToggleSwitch
          id="workbench-preview-lg-toggle"
          label="Preview LG"
          checked={previewLargeSurface}
          onChange={setPreviewLargeSurface}
          title="Preview play bar scrubbing on the large workbench display"
        />
      </div>
    </div>
  );

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-5 animate-fade-in">
      <WorkbenchSplitPane
        clips={previewClips ?? document.clips}
        currentTime={previewTime}
        onCurrentTimeChange={handlePreviewTimeChange}
        preferredClipId={previewClipId}
      >
        <div className="grid gap-3">
          {timelineChrome}
          <SmoothScrollList
            timelineId={document.id}
            timelineTitle={document.title}
            initialClips={document.clips}
            onOpenCollection={handleOpenCollection}
            initialViewState={{
              ...viewState,
              thumbnailMode: false,
              gridMode: false,
              itemSize: "md",
            }}
            thumbnailMode={false}
            playheadTime={previewTime}
            onPlayheadTimeChange={handlePreviewTimeChange}
            previewLargeSurface={previewLargeSurface}
            syncMediaDuration={false}
          />
        </div>
      </WorkbenchSplitPane>
    </div>
  );
}

export default function WorkbenchPage() {
  return (
    <Suspense fallback={null}>
      <WorkbenchPageContent />
    </Suspense>
  );
}
