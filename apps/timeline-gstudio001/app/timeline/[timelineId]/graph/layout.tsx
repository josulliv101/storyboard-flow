import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ClientGraphView } from "@/components/graph-view/client-graph-view";

// The graph project view lives in this LAYOUT, not the page: App Router
// remounts page components when their dynamic params change, but layouts
// persist — and persistence is the point (one provider, one graph, one undo
// stack across every drill-in). The catch-all page below is an empty shell;
// the client component reads the focus path from usePathname().
//
// This static `graph` segment wins over the sibling dynamic `[projectView]`
// route, so the storyboard/workbench pipeline is untouched.
export default async function GraphViewLayout({
  params,
  children,
}: {
  params: Promise<{ timelineId: string }>;
  children: ReactNode;
}) {
  const { timelineId } = await params;
  if (!timelineId.startsWith("project-")) {
    notFound();
  }

  return (
    // graph-view-theme scopes the design-token VALUES (see globals.css) so
    // the dnd-collections package's own pixels paint here without altering
    // the token-less legacy views.
    //
    // flex-col, NOT grid: a grid's auto track sizes to its items'
    // min-content, and a virtualized strip's scroll container contributes
    // its full CONTENT width there — the track (and the strip) would grow
    // past the container instead of overflowing inside it, killing
    // pan-to-scroll. Column flex stretches children to this container's
    // definite width, which is what the strip's overflow-x needs.
    <div className="graph-view-theme mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <ClientGraphView projectId={timelineId} />
      {children}
    </div>
  );
}
