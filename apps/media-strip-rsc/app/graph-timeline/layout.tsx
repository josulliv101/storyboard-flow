import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ClientGraphTimeline } from "../../components/graph-timeline/client-graph-timeline";

export const metadata: Metadata = {
  title: "Graph Timeline | StoryboardFlow",
  description:
    "The app's real TimelineDocuments rendered through the collections graph: one provider, drill-in focus, inline sub-timelines, and patch-scoped persistence.",
};

// The interactive tree lives in the LAYOUT, not the page: App Router
// remounts page components when their dynamic params change, but layouts
// persist — and persistence is the whole point here (one provider, one
// graph, one undo stack across every focus navigation). The page below is
// an empty shell; the client component reads the focus path from
// usePathname().
export default function GraphTimelineLayout({ children }: { children: ReactNode }) {
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
            provider owns the whole session: the focused timeline, every inline sub-timeline,
            undo, and cross-timeline drags all share a single graph. Double-click a collection
            clip (or use a sub-timeline&apos;s Focus button) to drill in — the URL is the focus
            path, the document hydrates on arrival through the engine&apos;s hydration seam, and
            the undo stack survives every navigation.
          </p>
        </div>
      </header>

      <ClientGraphTimeline />
      {children}
    </main>
  );
}
