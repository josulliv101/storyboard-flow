import Link from "next/link";
import type { Metadata } from "next";

import { ClientGraphTimeline } from "../../../components/graph-timeline/client-graph-timeline";

export const metadata: Metadata = {
  title: "Graph Timeline | StoryboardFlow",
  description:
    "The app's real TimelineDocuments rendered through the collections graph: one provider, drill-in focus, inline sub-timelines, and patch-scoped persistence.",
};

type GraphTimelinePageProps = Readonly<{
  params: Promise<{ timelinePath?: string[] }>;
}>;

// The phase-2 proof of docs/storyboard-graph-architecture.md: the graph is
// the structural source of truth, ONE <DndCollections> hosts every view, and
// the route's catch-all segments are the drill-in focus path (per-view state
// lives in the route, shared state lives in the store).
export default async function GraphTimelinePage({ params }: GraphTimelinePageProps) {
  const { timelinePath } = await params;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-8 px-5 py-8 md:px-8">
      <header className="flex flex-col gap-5 border-b border-border pb-6">
        <nav aria-label="Labs">
          <Link
            href="/dnd-collections"
            className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Back to DnD Collections Lab
          </Link>
        </nav>

        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
            StoryboardFlow graph architecture proof
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-balance md:text-5xl">
            Graph Timeline
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground text-pretty">
            The app&apos;s real TimelineDocuments projected through the collections graph. One
            provider owns the page: the focused timeline, every inline sub-timeline, undo, and
            cross-timeline drags all share a single graph. Double-click a collection clip (or use a
            sub-timeline&apos;s Focus button) to drill in — the URL is the focus path, and the
            document for that timeline hydrates on arrival.
          </p>
        </div>
      </header>

      <ClientGraphTimeline timelinePath={timelinePath ?? []} />
    </main>
  );
}
