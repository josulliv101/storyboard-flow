"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useCollectionsSelector, type NodeId } from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";

function useGraphPathTitles() {
  return useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.read,
    graphDocumentsGateway.read,
  );
}

function graphBase(projectId: string) {
  return `/timeline/${encodeURIComponent(projectId)}/graph`;
}

function focusedIdOf(projectId: string, timelinePath: readonly string[]) {
  return timelinePath[timelinePath.length - 1] ?? projectId;
}

/**
 * Where you ARE and how to go up — the navigation unit, rendered inside the
 * board's own header rather than as page chrome above it. It sits where a
 * paragraph of interaction hints used to: the trail is worth permanent space,
 * a list of things you can try is not.
 */
export function GraphBreadcrumb({
  projectId,
  timelinePath,
}: Readonly<{
  projectId: string;
  timelinePath: readonly string[];
}>) {
  const documents = useGraphPathTitles();
  const base = graphBase(projectId);
  const focusedId = focusedIdOf(projectId, timelinePath);
  // The current crumb is renamable in place (R6 #10). Fall back to the graph
  // node name (not just the id) so the crumb reflects a rename immediately —
  // the store updates optimistically before the document write lands, exactly
  // as the collection card does.
  const focusedNodeName = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(focusedId as NodeId)?.name,
  );
  const focusedTitle = documents[focusedId]?.title ?? focusedNodeName ?? focusedId;
  const rename = useInlineRename(focusedId as NodeId, focusedTitle);
  const parentHref =
    timelinePath.length > 1
      ? `${base}/${timelinePath.slice(0, -1).map(encodeURIComponent).join("/")}`
      : timelinePath.length === 1
        ? base
        : "/";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link
        href={parentHref}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50 text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
        title={focusedId === projectId ? "Go to Projects" : "Go to parent timeline"}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>
      <nav
        aria-label="Timeline focus path"
        className="flex min-w-0 items-center gap-2 text-xs text-zinc-400 select-none"
      >
        {/* The project is the ROOT crumb, not a child of a "Projects / Graph"
            chrome path: the trail reads as the timeline tree the user is
            standing in. At the root the project IS the focused crumb, so it
            renders once, as the current one. */}
        {focusedId !== projectId && (
          <>
            <Link href={base} className="text-zinc-400 transition-colors hover:text-white">
              {documents[projectId]?.title ?? projectId}
            </Link>
            <span>/</span>
          </>
        )}
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
        {rename.editing ? (
          <InlineNameEditor
            initialValue={focusedTitle}
            onInput={rename.setDraft}
            onCommit={rename.commit}
            onCancel={rename.cancel}
            className="max-w-[250px] truncate rounded-sm bg-zinc-800 px-1 font-semibold text-zinc-100 outline-none ring-1 ring-sky-500/60"
          />
        ) : (
          <span
            onDoubleClick={rename.begin}
            title="Double-click to rename"
            className="max-w-[250px] cursor-text truncate font-semibold text-zinc-100"
          >
            {focusedTitle}
          </span>
        )}
      </nav>
    </div>
  );
}

// (The old GraphViewChrome row — a full-width strip holding only the
// "Storyboard view" link — is gone: the link lives in the board's overflow
// menu now, so the page starts at the preview itself.)
