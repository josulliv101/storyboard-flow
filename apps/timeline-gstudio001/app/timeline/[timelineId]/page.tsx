"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Film, Hammer } from "lucide-react";

import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import {
  parseProjectViewMode,
  parseTimelineViewState,
  setSearchParam,
  type ProjectViewMode,
} from "@/components/timeline/timeline-view-state";
import {
  createCollectionTimelineDocument,
  getTimelineDocument,
  getTimelinePath,
  registerTimelineDocument,
} from "@/lib/timeline-documents";
import type { TimelineDocument } from "@/components/timeline/types";
import { cn } from "@/lib/utils";

type TimelineDocumentPageProps = {
  params: Promise<{
    timelineId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function TimelineDocumentPage({
  params,
  searchParams,
}: TimelineDocumentPageProps) {
  const router = useRouter();
  const { timelineId } = use(params);
  const resolvedSearchParams = use(searchParams);
  const viewState = parseTimelineViewState(resolvedSearchParams);
  const projectView = parseProjectViewMode(resolvedSearchParams);
  const isProjectTimeline = timelineId.startsWith("project-");
  const normalizedProjectSearchParams = new URLSearchParams();

  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (key === "view") return;

    if (Array.isArray(value)) {
      value.forEach((item) => normalizedProjectSearchParams.append(key, item));
      return;
    }

    if (value !== undefined) {
      normalizedProjectSearchParams.set(key, value);
    }
  });

  const normalizedProjectSearch = normalizedProjectSearchParams.toString();

  useEffect(() => {
    if (!isProjectTimeline) return;

    router.replace(
      `/timeline/${encodeURIComponent(timelineId)}/${projectView}${
        normalizedProjectSearch ? `?${normalizedProjectSearch}` : ""
      }`,
    );
  }, [isProjectTimeline, normalizedProjectSearch, projectView, router, timelineId]);

  if (isProjectTimeline) {
    return null;
  }
  
  let document: TimelineDocument | null = getTimelineDocument(timelineId);
  if (!document && timelineId.startsWith("timeline-")) {
    document = createCollectionTimelineDocument(timelineId, "New Collection");
  }
  if (!document && timelineId.startsWith("project-")) {
    document = registerTimelineDocument({
      id: timelineId,
      title: "Loading Project",
      description: "Loading saved timeline project.",
      clips: [],
    });
  }

  if (!document) {
    notFound();
  }

  const path = getTimelinePath(timelineId);
  const parentCollection = path.length > 0 ? path[path.length - 1] : null;
  const projectInitialViewState =
    isProjectTimeline && projectView === "storyboard"
      ? {
          ...viewState,
          thumbnailMode: true,
          hierarchyMode: true,
          itemSize: "sm" as const,
        }
      : isProjectTimeline
      ? {
          ...viewState,
          itemSize: viewState.itemSize ?? ("md" as const),
        }
      : viewState;

  const getProjectViewHref = (mode: ProjectViewMode) => {
    const search = setSearchParam(resolvedSearchParams, "view", mode).toString();
    return `/timeline/${encodeURIComponent(timelineId)}${search ? `?${search}` : ""}`;
  };

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={parentCollection ? `/timeline/${parentCollection.id}` : "/"}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 hover:bg-zinc-800 transition-all shrink-0 animate-in fade-in"
            title={parentCollection ? `Go to parent: ${parentCollection.title}` : "Go to Projects"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <nav className="flex items-center gap-2 text-xs text-zinc-400 select-none">
            <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
              Projects
            </Link>
            <span>/</span>

            {path.map((segment) => (
              <Fragment key={segment.id}>
                <Link
                  href={`/timeline/${segment.id}`}
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

        {isProjectTimeline && (
          <div
            className="inline-grid w-fit grid-cols-2 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
            role="tablist"
            aria-label="Project view"
          >
            {[
              { mode: "storyboard" as const, label: "Storyboard", icon: Film },
              { mode: "workbench" as const, label: "Workbench", icon: Hammer },
            ].map(({ mode, label, icon: Icon }) => {
              const active = projectView === mode;

              return (
                <Link
                  key={mode}
                  href={getProjectViewHref(mode)}
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    "flex h-9 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold transition-colors",
                    active
                      ? "bg-amber-400 text-zinc-950"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <SmoothScrollList
        timelineId={document.id}
        timelineTitle={document.title}
        initialClips={document.clips}
        initialViewState={projectInitialViewState}
        syncMediaDuration={false}
      />
    </div>
  );
}
