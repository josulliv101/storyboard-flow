"use client";

import { useContext, useState } from "react";
import { CornerDownRight, Folder, FolderOpen } from "lucide-react";

import {
  VirtualStrip,
  getChildren,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

import { useClipDetail, useGraphDetailsStore, useTimelineTitle } from "./graph-details-context";
import { hydrateTimeline } from "./graph-hydration";
import { NativeDropStrip } from "./graph-native-drop";
import { GraphViewNavContext } from "./graph-navigation";
import { MAX_SUBTREE_DEPTH, SUBTIMELINE_INDENT_PX, TIMELINE_PPS } from "./graph-view-config";

/** The focused collection's direct collection child ids, as a stable joined
 *  key so a node subscribes only to ITS OWN child-set identity — a selector
 *  returning a fresh array would re-render on every unrelated graph change. */
function useCollectionChildIds(collectionId: NodeId): NodeId[] {
  const joined = useCollectionsSelector((snapshot) =>
    getChildren(snapshot.graph, collectionId)
      .filter((childId) => snapshot.graph.nodesById.get(childId)?.kind === "collection")
      .map((childId) => childId as string)
      .join(","),
  );
  return joined === "" ? [] : joined.split(",").map((id) => parseNodeId(id));
}

/** One collection row in the sub-graph tree: collapsed by default, expands to
 *  lazy-hydrate its clips then reveal its strip AND its own collection children
 *  as further-indented rows (recursively). */
function SubTimelineNode({
  collectionId,
  depth,
}: Readonly<{
  collectionId: NodeId;
  depth: number;
}>) {
  const nav = useContext(GraphViewNavContext);
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const id = collectionId as string;

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Primitive subscriptions only (see useCollectionChildIds). The display
  // name is the gateway document title (source of truth), with the graph node
  // name as a fallback until the document is cached.
  const nodeName = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(collectionId)?.name ?? id,
  );
  const name = useTimelineTitle(id) ?? nodeName;
  const detail = useClipDetail(id);
  const hydrated = detail?.hydrated === true;
  const liveCount = useCollectionsSelector((snapshot) =>
    getChildren(snapshot.graph, collectionId).length,
  );
  const childIds = useCollectionChildIds(collectionId);

  const toggle = () => {
    if (!expanded && !hydrated) {
      // Fire-and-forget: the store subscription re-renders this node once the
      // children land, and the body is gated on `hydrated` until then.
      void hydrateTimeline(store, detailsStore, id);
    }
    setExpanded((current) => !current);
  };

  const startEditing = () => {
    setDraft(name);
    setEditing(true);
  };
  const commitEditing = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) void graphDocumentsGateway.renameTimeline(id, next);
  };

  return (
    <section aria-label={`Sub-timeline: ${name}`} className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2">
        <button
          type="button"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          onClick={toggle}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sky-400 transition-colors hover:bg-zinc-800 hover:text-sky-300"
        >
          {expanded ? (
            <FolderOpen aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Folder aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
        {editing ? (
          <input
            aria-label="Timeline name"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitEditing();
              else if (event.key === "Escape") setEditing(false);
            }}
            className="min-w-0 flex-1 rounded border border-sky-500/60 bg-zinc-900 px-1.5 py-0.5 text-sm font-semibold text-zinc-100 outline-none"
          />
        ) : (
          <h3
            onDoubleClick={startEditing}
            title="Double-click to rename"
            className="cursor-text truncate text-sm font-semibold text-zinc-100"
          >
            {name}
          </h3>
        )}
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {hydrated ? liveCount : (detail?.itemCount ?? 0)} clips
        </span>
        {expanded && !hydrated && (
          <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
            loading…
          </span>
        )}
        <span className="grow" />
        <button
          type="button"
          aria-label="Focus"
          title="Focus this timeline"
          onClick={() => nav?.openTimeline(collectionId)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          <CornerDownRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {expanded && hydrated && (
        // Indent the body so the strip's left edge lines up with the LABEL
        // (past the folder icon), and nested rows nest structurally under it.
        // The indent sits here, NOT on the NativeDropStrip wrapper (its drop
        // math is clientX-vs-own-rect; padding there would drift the indicator).
        <div
          className="flex min-w-0 flex-col gap-3"
          style={{ paddingLeft: SUBTIMELINE_INDENT_PX }}
        >
          <NativeDropStrip collectionId={id}>
            <VirtualStrip
              collectionId={collectionId}
              pixelsPerSecond={TIMELINE_PPS}
              itemHeight={64}
              itemDragActivation="hold"
              className="bg-black/20"
            />
          </NativeDropStrip>

          {depth + 1 < MAX_SUBTREE_DEPTH &&
            childIds.map((childId) => (
              <SubTimelineNode key={childId as string} collectionId={childId} depth={depth + 1} />
            ))}
        </div>
      )}
    </section>
  );
}

export function SubTimelines({ focusedId }: Readonly<{ focusedId: string }>) {
  const childIds = useCollectionChildIds(parseNodeId(focusedId));
  if (childIds.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {childIds.map((collectionId) => (
        <SubTimelineNode key={collectionId as string} collectionId={collectionId} depth={0} />
      ))}
    </div>
  );
}
