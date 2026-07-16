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
    <div className="mx-auto grid w-full max-w-[1400px] gap-5">
      <ClientGraphView projectId={timelineId} />
      {children}
    </div>
  );
}
