"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, use, useCallback, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ToggleSwitch } from "@storyboard/ui/timeline/controls/timeline-toolbar";

import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { WorkbenchSplitPane } from "@storyboard/ui/timeline/viewport/workbench-display-surface";
import {
  parseTimelineViewState,
  type ProjectViewMode,
} from "@storyboard/ui/timeline/timeline-view-state";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";
import {
  getTimelineDocument,
  getTimelinePath,
} from "@storyboard/ui/timeline/timeline-documents";

type ProjectTimelinePageProps = {
  params: Promise<{
    timelineId: string;
    projectView: string;
    activeTimelinePath?: string[];
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ProjectTimelinePage({
  params,
  searchParams,
}: ProjectTimelinePageProps) {
  const { timelineId: projectId, projectView, activeTimelinePath } = use(params);
  const resolvedSearchParams = use(searchParams);
  const [globalHierarchyMode, setGlobalHierarchyMode] = useState(false);
  const [globalPreviewLargeSurface, setGlobalPreviewLargeSurface] = useState(false);
  const [workbenchPreviewTime, setWorkbenchPreviewTime] = useState(0);
  const [workbenchPreviewClips, setWorkbenchPreviewClips] = useState<TimelineClip[] | null>(null);
  const [workbenchPreviewClipId, setWorkbenchPreviewClipId] = useState<string | null>(null);
  const viewState = parseTimelineViewState(resolvedSearchParams);
  const handleWorkbenchPreviewTimeChange = useCallback((
    time: number,
    clips?: TimelineClip[],
    activeClipId?: string,
  ) => {
    setWorkbenchPreviewTime(time);
    if (clips) {
      setWorkbenchPreviewClips(clips);
    }
    setWorkbenchPreviewClipId(activeClipId ?? null);
  }, []);

  if (!projectId.startsWith("project-")) {
    notFound();
  }

  const normalizedProjectView: ProjectViewMode =
    projectView === "workbench" ? "workbench" : projectView === "storyboard" ? "storyboard" : "storyboard";

  if (projectView !== normalizedProjectView) {
    notFound();
  }

  const activeTimelineId = activeTimelinePath?.[0] || projectId;
  const fallbackDocument = useMemo<TimelineDocument | null>(() => {
    if (activeTimelineId.startsWith("timeline-")) {
      return {
        id: activeTimelineId,
        title: "Loading...",
        clips: [],
      };
    }

    if (activeTimelineId === projectId) {
      return {
        id: projectId,
        title: "Loading Project",
        description: "Loading saved timeline project.",
        clips: [],
      };
    }

    return null;
  }, [activeTimelineId, projectId]);
  const document: TimelineDocument | null =
    getTimelineDocument(activeTimelineId) ?? fallbackDocument;

  if (!document) {
    notFound();
  }

  const path = getTimelinePath(activeTimelineId);
  const parentCollection = path.length > 0 ? path[path.length - 1] : null;
  const initialViewState =
    normalizedProjectView === "storyboard"
      ? {
          ...viewState,
          thumbnailMode: true,
          hierarchyMode: false,
          itemSize: "sm" as const,
        }
      : {
          ...viewState,
          thumbnailMode: false,
          gridMode: false,
          hierarchyMode: false,
          itemSize: viewState.itemSize ?? ("md" as const),
        };
  const collectionHrefPrefix = `/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}`;

  const parentHref =
    parentCollection && parentCollection.id !== projectId
      ? `/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}/${encodeURIComponent(parentCollection.id)}`
      : `/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}`;
  const timelineChrome = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 w-full">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={activeTimelineId === projectId ? "/" : parentHref}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 hover:bg-zinc-800 transition-all shrink-0 animate-in fade-in"
            title={activeTimelineId === projectId ? "Go to Projects" : "Go to parent timeline"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <nav className="flex items-center gap-2 text-xs text-zinc-400 select-none">
            <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
              Projects
            </Link>
            <span>/</span>
            <Link
              href={`/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}`}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              {normalizedProjectView === "storyboard" ? "Storyboard" : "Workbench"}
            </Link>
            <span>/</span>

            {path.map((segment) => (
              <Fragment key={segment.id}>
                <Link
                  href={`/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}/${encodeURIComponent(segment.id)}`}
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  {segment.title}
                </Link>
                <span>/</span>
              </Fragment>
            ))}

            <span className="text-zinc-100 font-semibold truncate max-w-[250px]">
              {document.title}
            </span>
          </nav>
        </div>
        <div className="shrink-0 flex items-center gap-4">
          <Link
            href={`/timeline/${encodeURIComponent(projectId)}/graph`}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
            title="Open this project in the graph view (architecture preview)"
          >
            Graph view
          </Link>
          <ToggleSwitch
            id="global-hierarchy-toggle"
            label="Hierarchy Mode"
            checked={globalHierarchyMode}
            onChange={setGlobalHierarchyMode}
          />
          {normalizedProjectView === "workbench" && (
            <ToggleSwitch
              id="global-preview-lg-toggle"
              label="Preview LG"
              checked={globalPreviewLargeSurface}
              onChange={setGlobalPreviewLargeSurface}
              title="Preview play drag bar scrubbing on the large workbench display"
            />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-5">
      {normalizedProjectView !== "workbench" ? timelineChrome : null}

      {normalizedProjectView === "workbench" ? (
        <WorkbenchSplitPane
          clips={workbenchPreviewClips ?? document.clips}
          currentTime={workbenchPreviewTime}
          onCurrentTimeChange={handleWorkbenchPreviewTimeChange}
          preferredClipId={workbenchPreviewClipId}
        >
          <div className="grid gap-3">
            {timelineChrome}
            <SmoothScrollList
              collectionHrefPrefix={collectionHrefPrefix}
              timelineId={document.id}
              timelineTitle={document.title}
              initialClips={document.clips}
              initialViewState={initialViewState}
              syncMediaDuration={false}
              thumbnailMode={false}
              playheadTime={workbenchPreviewTime}
              onPlayheadTimeChange={handleWorkbenchPreviewTimeChange}
              hierarchyMode={globalHierarchyMode}
              onHierarchyModeChange={setGlobalHierarchyMode}
              previewLargeSurface={globalPreviewLargeSurface}
            />
          </div>
        </WorkbenchSplitPane>
      ) : (
        <SmoothScrollList
          collectionHrefPrefix={collectionHrefPrefix}
          timelineId={document.id}
          timelineTitle={document.title}
          initialClips={document.clips}
          initialViewState={initialViewState}
          syncMediaDuration={false}
          thumbnailMode={true}
          hierarchyMode={globalHierarchyMode}
          onHierarchyModeChange={setGlobalHierarchyMode}
          previewLargeSurface={globalPreviewLargeSurface}
        />
      )}
    </div>
  );
}

