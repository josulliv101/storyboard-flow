"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@storyboard/ui/core/skeleton";

import type { DemoMediaStripProps } from "./demo-media-strip";

const ClientOnlyMediaStrip = dynamic<DemoMediaStripProps>(
  () => import("./demo-media-strip").then((module) => module.DemoMediaStrip),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="min-w-0 rounded-lg border border-border bg-card/50 p-3"
      >
        <Skeleton className="h-40 w-full" />
      </div>
    ),
  }
);

export function ClientDemoMediaStrip(props: DemoMediaStripProps) {
  return <ClientOnlyMediaStrip {...props} />;
}
