"use client";

import { useContext, useMemo, useState } from "react";
import { FolderDown, Folder, FolderOpen } from "lucide-react";

import {
  VirtualGrid,
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
import {
  GraphGridPlayhead,
  GraphGridScrubSurface,
  GraphPlayhead,
  PlayheadScrubBand,
  collectionCardWidth,
  usePreviewCardSpans,
  type PreviewTimeChannel,
} from "./graph-preview";
import {
  GRID_GAP,
  GRID_UNCAPPED_HEIGHT,
  ITEM_SIZE_DIMENSIONS,
  MAX_SUBTREE_DEPTH,
  SUBTIMELINE_INDENT_PX,
  type FocusSurface,
  type ItemSize,
} from "./graph-view-config";

/**
 * The focused collection's direct COLLECTION child ids.
 *
 * The subscription is the raw children array, which the reducer shares
 * structurally: its identity survives every change that doesn't touch THIS
 * collection's children, so the selector returns a stable reference (what
 * `useCollectionsSelector` requires) without allocating.
 *
 * This used to subscribe to `ids.join(",")` and rebuild the list with
 * `split(",")`. That worked only for ids containing no comma — but the core
 * explicitly allows ANY non-whitespace string as a `NodeId` (see graph.ts),
 * so an id like `client,a` would have been torn into two ids that address
 * nothing. Nothing in the app mints such an id today, which is precisely why
 * it would have failed the first time some other id source did.
 *
 * The kind filter reads the store WITHOUT subscribing to it, which is sound
 * because a node's `kind` is fixed for its lifetime — no command changes it
 * (`update-media` only rewrites media fields), so this derivation is a pure
 * function of the children array it is keyed on.
 */
function useCollectionChildIds(collectionId: NodeId): readonly NodeId[] {
  const store = useCollectionsStore();
  const children = useCollectionsSelector((snapshot) =>
    getChildren(snapshot.graph, collectionId),
  );
  return useMemo(
    () =>
      children.filter(
        (childId) => store.getSnapshot().graph.nodesById.get(childId)?.kind === "collection",
      ),
    [children, store],
  );
}

/** One collection row in the sub-graph tree: collapsed by default, expands to
 *  lazy-hydrate its clips then reveal its strip AND its own collection children
 *  as further-indented rows (recursively). */
function SubTimelineNode({
  collectionId,
  depth,
  surface,
  itemSize,
  pixelsPerSecond,
  previewOn,
  timeChannel,
}: Readonly<{
  collectionId: NodeId;
  depth: number;
  surface: FocusSurface;
  itemSize: ItemSize;
  pixelsPerSecond: number;
  previewOn: boolean;
  timeChannel: PreviewTimeChannel;
}>) {
  const nav = useContext(GraphViewNavContext);
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = usePreviewCardSpans();
  const id = collectionId as string;

  // This row shows a playhead only when the pane is on the manifest (spans
  // present) AND the clock actually visits this collection (it has a window).
  // On the projection fallback a sub-row's local times don't line up with the
  // global clock, so the marker would lie — better absent for that ~2.5s.
  const window = spans?.get(id);
  const showPlayhead = previewOn && window !== undefined;
  const dims = ITEM_SIZE_DIMENSIONS[itemSize];

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
    if (!next || next === name) return;
    // Rename the GRAPH node, not just the document. The card's visible title
    // reads the gateway, but its aria-label, the drag ghost, and every pickup
    // and drop announcement read `node.name` — updating only the document
    // left those speaking the old name indefinitely. The PersistenceBridge
    // turns this patch into the document write (and does the same on undo).
    store.dispatch({ type: "rename-node", nodeId: collectionId, name: next });
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
          aria-label="Drill into timeline"
          title="Drill into this timeline"
          onClick={() => nav?.openTimeline(collectionId)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          <FolderDown aria-hidden="true" className="h-4 w-4" />
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
          {surface === "grid" ? (
            // Grid mode is page-wide: mirror the focused grid (no NativeDropStrip
            // wrapper — the focused grid has none either, so native drops are a
            // strip-mode affordance).
            <div className="relative">
              <VirtualGrid
                collectionId={collectionId}
                cellWidth={dims.gridWidth}
                cellHeight={dims.gridHeight}
                gap={GRID_GAP}
                height={GRID_UNCAPPED_HEIGHT}
                overlay={
                  showPlayhead ? (
                    <GraphGridPlayhead
                      focusedId={id}
                      channel={timeChannel}
                      cellHeight={dims.gridHeight}
                      pixelsPerSecond={pixelsPerSecond}
                      activeWindow={window}
                    />
                  ) : undefined
                }
                className="bg-black/20"
              />
              {showPlayhead && (
                <GraphGridScrubSurface
                  focusedId={id}
                  channel={timeChannel}
                  cellHeight={dims.gridHeight}
                  pixelsPerSecond={pixelsPerSecond}
                />
              )}
            </div>
          ) : (
            <NativeDropStrip collectionId={id}>
              <VirtualStrip
                collectionId={collectionId}
                pixelsPerSecond={pixelsPerSecond}
                itemWidth={collectionCardWidth(pixelsPerSecond)}
                itemHeight={dims.strip}
                itemDragActivation="hold"
                overlay={
                  showPlayhead ? (
                    <GraphPlayhead
                      focusedId={id}
                      channel={timeChannel}
                      pixelsPerSecond={pixelsPerSecond}
                      activeWindow={window}
                    />
                  ) : undefined
                }
                className="bg-black/20"
              />
              {showPlayhead && (
                <PlayheadScrubBand
                  focusedId={id}
                  channel={timeChannel}
                  pixelsPerSecond={pixelsPerSecond}
                />
              )}
            </NativeDropStrip>
          )}

          {depth + 1 < MAX_SUBTREE_DEPTH &&
            childIds.map((childId) => (
              <SubTimelineNode
                key={childId as string}
                collectionId={childId}
                depth={depth + 1}
                surface={surface}
                itemSize={itemSize}
                pixelsPerSecond={pixelsPerSecond}
                previewOn={previewOn}
                timeChannel={timeChannel}
              />
            ))}
        </div>
      )}
    </section>
  );
}

export function SubTimelines({
  focusedId,
  surface,
  itemSize,
  pixelsPerSecond,
  previewOn,
  timeChannel,
}: Readonly<{
  focusedId: string;
  surface: FocusSurface;
  itemSize: ItemSize;
  pixelsPerSecond: number;
  previewOn: boolean;
  timeChannel: PreviewTimeChannel;
}>) {
  const childIds = useCollectionChildIds(parseNodeId(focusedId));
  if (childIds.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {childIds.map((collectionId) => (
        <SubTimelineNode
          key={collectionId as string}
          collectionId={collectionId}
          depth={0}
          surface={surface}
          itemSize={itemSize}
          pixelsPerSecond={pixelsPerSecond}
          previewOn={previewOn}
          timeChannel={timeChannel}
        />
      ))}
    </div>
  );
}
