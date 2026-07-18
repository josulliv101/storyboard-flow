"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSyncExternalStore } from "react";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

export function GraphViewChrome({
  projectId,
  timelinePath,
}: Readonly<{
  projectId: string;
  timelinePath: readonly string[];
}>) {
  const documents = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.read,
    graphDocumentsGateway.read,
  );
  const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
  const focusedId = timelinePath[timelinePath.length - 1] ?? projectId;
  const parentHref =
    timelinePath.length > 1
      ? `${base}/${timelinePath.slice(0, -1).map(encodeURIComponent).join("/")}`
      : timelinePath.length === 1
        ? base
        : "/";

  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={parentHref}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50 text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
          title={focusedId === projectId ? "Go to Projects" : "Go to parent timeline"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <nav
          aria-label="Timeline focus path"
          className="flex items-center gap-2 text-xs text-zinc-400 select-none"
        >
          <Link href="/" className="text-zinc-400 transition-colors hover:text-white">
            Projects
          </Link>
          <span>/</span>
          <Link href={base} className="text-zinc-400 transition-colors hover:text-white">
            Graph
          </Link>
          <span>/</span>
          {timelinePath.slice(0, -1).map((segment, index) => (
            <span key={segment} className="flex items-center gap-2">
              <Link
                href={`${base}/${timelinePath
                  .slice(0, index + 1)
                  .map(encodeURIComponent)
                  .join("/")}`}
                className="text-zinc-400 transition-colors hover:text-white"
              >
                {documents[segment]?.title ?? segment}
              </Link>
              <span>/</span>
            </span>
          ))}
          <span className="max-w-[250px] truncate font-semibold text-zinc-100">
            {documents[focusedId]?.title ?? focusedId}
          </span>
        </nav>
      </div>

      <Link
        href={`/timeline/${encodeURIComponent(projectId)}/storyboard${
          focusedId === projectId ? "" : `/${encodeURIComponent(focusedId)}`
        }`}
        className="shrink-0 text-xs text-zinc-400 transition-colors hover:text-white"
      >
        Storyboard view
      </Link>
    </div>
  );
}
