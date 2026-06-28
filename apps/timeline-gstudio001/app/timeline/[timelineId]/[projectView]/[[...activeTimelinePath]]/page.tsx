"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, use, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ToggleSwitch } from "@/components/timeline/timeline-toolbar";

import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import {
  parseTimelineViewState,
  type ProjectViewMode,
} from "@/components/timeline/timeline-view-state";
import type { TimelineDocument } from "@/components/timeline/types";
import {
  createCollectionTimelineDocument,
  getTimelineDocument,
  getTimelinePath,
  registerTimelineDocument,
} from "@/lib/timeline-documents";

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
  const [globalHierarchyMode, setGlobalHierarchyMode] = useState(true);
  const [globalDragBar, setGlobalDragBar] = useState(false);
  const viewState = parseTimelineViewState(resolvedSearchParams);

  if (!projectId.startsWith("project-")) {
    notFound();
  }

  const normalizedProjectView: ProjectViewMode =
    projectView === "workbench" ? "workbench" : projectView === "storyboard" ? "storyboard" : "storyboard";

  if (projectView !== normalizedProjectView) {
    notFound();
  }

  const activeTimelineId = activeTimelinePath?.[0] || projectId;
  let document: TimelineDocument | null = getTimelineDocument(activeTimelineId);

  if (!getTimelineDocument(projectId)) {
    registerTimelineDocument({
      id: projectId,
      title: "Loading Project",
      description: "Loading saved timeline project.",
      clips: [],
    });
  }

  if (!document && activeTimelineId.startsWith("timeline-")) {
    document = {
      id: activeTimelineId,
      title: "Loading...",
      clips: [],
    };
  }

  if (!document && activeTimelineId === projectId) {
    document = registerTimelineDocument({
      id: projectId,
      title: "Loading Project",
      description: "Loading saved timeline project.",
      clips: [],
    });
  }

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
          hierarchyMode: true,
          itemSize: "sm" as const,
        }
      : {
          ...viewState,
          itemSize: viewState.itemSize ?? ("md" as const),
        };
  const collectionHrefPrefix = `/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}`;

  const parentHref =
    parentCollection && parentCollection.id !== projectId
      ? `/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}/${encodeURIComponent(parentCollection.id)}`
      : `/timeline/${encodeURIComponent(projectId)}/${normalizedProjectView}`;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-5">
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
            <ToggleSwitch
              id="global-dragbar-toggle"
              label="Drag Bar"
              checked={globalDragBar}
              onChange={setGlobalDragBar}
            />
            <ToggleSwitch
              id="global-hierarchy-toggle"
              label="Hierarchy Mode"
              checked={globalHierarchyMode}
              onChange={setGlobalHierarchyMode}
            />
          </div>
        </div>
      </div>

      <SmoothScrollList
        collectionHrefPrefix={collectionHrefPrefix}
        timelineId={document.id}
        timelineTitle={document.title}
        initialClips={document.clips}
        initialViewState={initialViewState}
        syncMediaDuration={false}
        hierarchyMode={globalHierarchyMode}
        onHierarchyModeChange={setGlobalHierarchyMode}
        dragBarEnabled={globalDragBar}
      />
    </div>
  );
}
