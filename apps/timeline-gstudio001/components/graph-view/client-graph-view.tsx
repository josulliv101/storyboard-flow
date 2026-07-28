"use client";

import dynamic from "next/dynamic";

import type { GraphServerPayload } from "@/lib/graph-documents-gateway";
import { GraphViewLoadingSkeleton } from "./graph-view-loading";

const GraphTimelineView = dynamic(
  () => import("./graph-timeline-view").then((module) => module.GraphTimelineView),
  {
    ssr: false,
    loading: () => <GraphViewLoadingSkeleton />,
  },
);

export function ClientGraphView({
  projectId,
  bootstrap,
}: {
  projectId: string;
  /** Server-read boot documents (RSC layout) — null without a session. */
  bootstrap?: readonly GraphServerPayload[] | null;
}) {
  return <GraphTimelineView projectId={projectId} bootstrap={bootstrap ?? null} />;
}
