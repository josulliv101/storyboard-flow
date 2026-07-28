"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useDroppable } from "@dnd-kit/core";

import {
  encodeDropTarget,
  parseNodeId,
  useCollectionsSelector,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { cn } from "@/lib/utils";
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

type CrumbDropState = "idle" | "droppable" | "hovered";

function EditableCrumbName({
  crumbId,
  label,
}: Readonly<{
  crumbId: string;
  label: string;
}>) {
  const nodeName = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(crumbId as NodeId)?.name,
  );
  const displayName = nodeName ?? label;
  const rename = useInlineRename(crumbId as NodeId, displayName, "breadcrumb");

  if (rename.editing) {
    return (
      <InlineNameEditor
        initialValue={displayName}
        ariaLabel={`Rename ${displayName}`}
        onInput={rename.setDraft}
        onCommit={rename.commit}
        onCancel={rename.cancel}
        className="h-7 min-w-0 w-full max-w-[250px] truncate rounded-md bg-zinc-800 px-1.5 font-semibold text-zinc-100 outline-none ring-1 ring-sky-500/60"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Rename ${displayName}`}
      aria-current="page"
      title={`Rename ${displayName}`}
      onClick={rename.begin}
      className={cn(
        "min-w-0 max-w-[250px] shrink cursor-text truncate rounded-md px-1.5 py-1 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
        "font-semibold text-zinc-100 hover:bg-zinc-800/70",
      )}
    >
      {displayName}
    </button>
  );
}

/**
 * A breadcrumb crumb that DOUBLES AS a drop target while a card is dragged.
 * The trail already IS the ancestor chain (root … parent), so dropping a card
 * on any ancestor crumb moves it to THAT collection — up one level, or several,
 * all the way to the root, in a single motion. Idle it is a plain nav link;
 * during a drag every ancestor crumb reads as droppable (a dotted underline),
 * and the crumb under the pointer shows where the item will land (a solid sky
 * underline). Text-decoration only, so the crumb's width never changes and
 * nothing shifts as the states toggle. The focused (current) crumb is NOT one
 * of these — the item already lives there.
 */
function AncestorCrumb({
  crumbId,
  href,
  label,
}: Readonly<{ crumbId: string; href: string; label: string }>) {
  const { setNodeRef } = useDroppable({
    id: encodeDropTarget({ type: "panel", collectionId: parseNodeId(crumbId) }),
  });
  const state = useCollectionsSelector((snapshot): CrumbDropState => {
    if (!snapshot.interaction.isDragging) return "idle";
    const intent = snapshot.interaction.dropIntent;
    return intent?.type === "append-to-collection" && String(intent.collectionId) === crumbId
      ? "hovered"
      : "droppable";
  });
  return (
    <span
      ref={setNodeRef}
      data-graph-ancestor-drop={crumbId}
      className="flex min-w-0 shrink-[2]"
    >
      <Link
        href={href}
        className={cn(
          "block min-w-0 max-w-[180px] truncate rounded-md px-1.5 py-1 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
          state === "hovered"
            ? "text-sky-200 underline decoration-sky-400 decoration-2 underline-offset-4"
            : state === "droppable"
              ? "text-zinc-300 underline decoration-dotted decoration-zinc-500 underline-offset-4"
              : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
        )}
      >
        {label}
      </Link>
    </span>
  );
}

/**
 * Where you ARE and how to go up — the navigation unit, rendered inside the
 * board's own header rather than as page chrome above it. It sits where a
 * paragraph of interaction hints used to: the trail is worth permanent space,
 * a list of things you can try is not. During a card drag the ancestor crumbs
 * become drop targets (see AncestorCrumb).
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
  const parentHref =
    timelinePath.length > 1
      ? `${base}/${timelinePath.slice(0, -1).map(encodeURIComponent).join("/")}`
      : timelinePath.length === 1
        ? base
        : "/";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
      <Link
        href={parentHref}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50 text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
        title={focusedId === projectId ? "Go to Projects" : "Go to parent timeline"}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>
      <nav
        aria-label="Timeline focus path"
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs text-zinc-400 select-none"
      >
        {/* The project is the ROOT crumb, not a child of a "Projects / Graph"
            chrome path: the trail reads as the timeline tree the user is
            standing in. At the root the project IS the focused crumb, so it
            renders once, as the current one. */}
        {focusedId !== projectId && (
          <>
            <AncestorCrumb
              crumbId={projectId}
              href={base}
              label={documents[projectId]?.title ?? projectId}
            />
            <span aria-hidden="true" className="shrink-0">/</span>
          </>
        )}
        {timelinePath.slice(0, -1).map((segment, index) => (
          <span key={segment} className="flex min-w-0 shrink-[2] items-center gap-2">
            <AncestorCrumb
              crumbId={segment}
              href={`${base}/${timelinePath
                .slice(0, index + 1)
                .map(encodeURIComponent)
                .join("/")}`}
              label={documents[segment]?.title ?? segment}
            />
            <span aria-hidden="true" className="shrink-0">/</span>
          </span>
        ))}
        <EditableCrumbName crumbId={focusedId} label={focusedTitle} />
      </nav>
    </div>
  );
}

// (The old GraphViewChrome row — a full-width strip holding only the
// "Storyboard view" link — is gone: the link lives in the board's overflow
// menu now, so the page starts at the preview itself.)
