import Link from "next/link";
import { notFound } from "next/navigation";

import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { parseTimelineViewState } from "@/components/timeline/timeline-view-state";
import { getTimelinePage } from "@/lib/timeline-documents";

type TimelinePageProps = {
  params: Promise<{
    pageId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TimelinePage({
  params,
  searchParams,
}: TimelinePageProps) {
  const { pageId } = await params;
  const viewState = parseTimelineViewState(await searchParams);
  const page = getTimelinePage(pageId);

  if (!page) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-8 py-10 text-white">
      <div className="mx-auto grid w-full max-w-[1400px] gap-12">
        <header className="grid gap-2">
          <nav className="flex items-center gap-2 text-xs text-zinc-400">
            <Link href="/" className="text-zinc-300 hover:text-white">
              Demo
            </Link>
            <span>/</span>
            <Link
              href="/timeline-pages/three"
              className="text-zinc-300 hover:text-white"
            >
              Timeline pages
            </Link>
          </nav>
          <h1 className="text-2xl font-semibold text-zinc-50">
            {page.title}
          </h1>
          {page.description ? (
            <p className="text-sm text-zinc-400">{page.description}</p>
          ) : null}
        </header>

        {page.timelines.map((timeline) => (
          <section
            key={timeline.id}
            aria-label={timeline.title}
            className="grid"
          >
            <SmoothScrollList
              timelineId={timeline.id}
              timelineTitle={timeline.title}
              initialClips={timeline.clips}
              initialViewState={viewState}
              syncMediaDuration={false}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
