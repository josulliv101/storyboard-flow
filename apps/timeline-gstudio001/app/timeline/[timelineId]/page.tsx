"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, use } from "react";
import { ArrowLeft } from "lucide-react";

import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { parseTimelineViewState } from "@/components/timeline/timeline-view-state";
import { getTimelineDocument, getTimelinePath, createCollectionTimelineDocument } from "@/lib/timeline-documents";

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
  const { timelineId } = use(params);
  const resolvedSearchParams = use(searchParams);
  const viewState = parseTimelineViewState(resolvedSearchParams);
  
  let document = getTimelineDocument(timelineId);
  if (!document && timelineId.startsWith("timeline-")) {
    document = createCollectionTimelineDocument(timelineId, "New Collection");
  }

  if (!document) {
    notFound();
  }

  const path = getTimelinePath(timelineId);
  const parentCollection = path.length > 0 ? path[path.length - 1] : null;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-5">
      <div className="flex items-center gap-3">
        <Link
          href={parentCollection ? `/timeline/${parentCollection.id}` : "/"}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 hover:bg-zinc-800 transition-all shrink-0 animate-in fade-in"
          title={parentCollection ? `Go to parent: ${parentCollection.title}` : "Go to Demo home"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <nav className="flex items-center gap-2 text-xs text-zinc-400 select-none">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            Demo
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

      <SmoothScrollList
        timelineId={document.id}
        timelineTitle={document.title}
        initialClips={document.clips}
        initialViewState={viewState}
        syncMediaDuration={false}
      />
    </div>
  );
}
