import Link from "next/link";
import { notFound } from "next/navigation";

import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { parseTimelineViewState } from "@/components/timeline/timeline-view-state";
import { getTimelineDocument } from "@/lib/timeline-documents";

type TimelineDocumentPageProps = {
  params: Promise<{
    timelineId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TimelineDocumentPage({
  params,
  searchParams,
}: TimelineDocumentPageProps) {
  const { timelineId } = await params;
  const viewState = parseTimelineViewState(await searchParams);
  const document = getTimelineDocument(timelineId);

  if (!document) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-10 text-white">
      <div className="mx-auto grid w-full max-w-[1400px] gap-5">
        <nav className="flex items-center gap-2 text-xs text-zinc-400">
          <Link href="/" className="text-zinc-300 hover:text-white">
            Demo
          </Link>
          <span>/</span>
          <Link href="/timeline/root" className="text-zinc-300 hover:text-white">
            Root timeline
          </Link>
        </nav>

        <SmoothScrollList
          timelineId={document.id}
          timelineTitle={document.title}
          initialClips={document.clips}
          initialViewState={viewState}
          syncMediaDuration={false}
        />
      </div>
    </main>
  );
}
