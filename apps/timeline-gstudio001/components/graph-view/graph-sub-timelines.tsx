"use client";

import { useContext, useMemo, useRef, useState } from "react";
import { FolderInput, Folder, FolderOpen } from "lucide-react";

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
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { NativeDropGrid, NativeDropStrip } from "./graph-native-drop";
import {
  subTimelineRowStatus,
  subTimelineRowStatusLabel,
} from "./graph-sub-timeline-status";
import { GraphViewNavContext } from "./graph-navigation";
import {
  GraphGridPlayhead,
  GraphPlayhead,
  GraphRuler,
  GraphSeekRails,
  GraphStripSeekRail,
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
  rulerOn,
  timeChannel,
}: Readonly<{
  collectionId: NodeId;
  depth: number;
  surface: FocusSurface;
  itemSize: ItemSize;
  pixelsPerSecond: number;
  previewOn: boolean;
  rulerOn: boolean;
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
  const clockWindow = spans?.get(id);
  const showPlayhead = previewOn && clockWindow !== undefined;
  const dims = ITEM_SIZE_DIMENSIONS[itemSize];

  const [expanded, setExpanded] = useState(false);
  // "Attempted and failed" flag: hydration has several paths that leave the
  // details store un-hydrated permanently (document fetch failed, spec build
  // refused, store rejected). Those report to the global banner but left THIS
  // row stuck on "loading…". `attemptRef` fences stale resolutions so a slow
  // failed attempt can't flip a newer, still-in-flight expand back to failed.
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef(0);

  // Primitive subscriptions only (see useCollectionChildIds). The display
  // name is the gateway document title (source of truth), with the graph node
  // name as a fallback until the document is cached.
  const nodeName = useCollectionsSelector(
    (snapshot) => snapshot.graph.nodesById.get(collectionId)?.name ?? id,
  );
  const name = useTimelineTitle(id) ?? nodeName;
  const rename = useInlineRename(collectionId, name);
  const detail = useClipDetail(id);
  const hydrated = detail?.hydrated === true;
  const liveCount = useCollectionsSelector((snapshot) =>
    getChildren(snapshot.graph, collectionId).length,
  );
  const childIds = useCollectionChildIds(collectionId);
  const status = subTimelineRowStatus({ expanded, hydrated, failed });

  const toggle = () => {
    if (!expanded && !hydrated) {
      // Clear any prior failure for this fresh attempt, then hydrate. The store
      // subscription re-renders this node once the children land; the body is
      // gated on `hydrated` until then. If the attempt finishes WITHOUT
      // hydrating (see graph-hydration's failure paths), flip the row to a
      // "failed" badge instead of leaving it on "loading…" forever. Setting
      // state from the resolved promise (not an effect) keeps clear of the
      // repo's react-hooks/set-state-in-effect rule.
      setFailed(false);
      const attempt = ++attemptRef.current;
      void hydrateTimeline(store, detailsStore, id)
        .catch(() => undefined)
        .then(() => {
          if (attempt !== attemptRef.current) return; // superseded by a newer expand
          if (detailsStore.get(id)?.hydrated !== true) setFailed(true);
        });
    }
    setExpanded((current) => !current);
  };

  return (
    // Each timeline is its OWN gray panel (header + surface in one box) —
    // the storyboard view's idiom, adopted so every strip reads as one
    // distinct area; nested rows nest panels, echoing the hierarchy.
    <section
      aria-label={`Sub-timeline: ${name}`}
      className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3"
    >
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
        {rename.editing ? (
          <InlineNameEditor
            initialValue={name}
            onInput={rename.setDraft}
            onCommit={rename.commit}
            onCancel={rename.cancel}
            className="min-w-0 flex-1 rounded border border-sky-500/60 bg-zinc-900 px-1.5 py-0.5 text-sm font-semibold text-zinc-100 outline-none"
          />
        ) : (
          <h3
            onDoubleClick={rename.begin}
            title="Double-click to rename"
            className="cursor-text truncate text-sm font-semibold text-zinc-100"
          >
            {name}
          </h3>
        )}
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {hydrated ? liveCount : (detail?.itemCount ?? 0)} clips
        </span>
        {status !== "idle" && (
          <span
            className={
              status === "failed"
                ? "shrink-0 rounded border border-red-700/60 px-1.5 py-0.5 text-[10px] text-red-400"
                : "shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500"
            }
          >
            {subTimelineRowStatusLabel(status)}
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
          {/* FolderInput — a folder with an arrow going INTO it. This button
              NAVIGATES; the sidebar's FolderTree toggles whether the children
              tree is shown. Those are different verbs and no longer share an
              icon. The collection card's drill button is the same verb as
              this one and uses the same icon. */}
          <FolderInput aria-hidden="true" className="h-4 w-4" />
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
            // Grid mode now accepts native drops too (a NativeDropGrid),
            // matching the strip. Scrubbing is this timeline's per-row SEEK
            // RAILS layer — its windows sit inside the shared clock, so
            // pressing a rail SUMMONS the playhead into this timeline;
            // cards keep every pointerdown and the in-grid line is a
            // passive indicator.
            <div className="relative min-w-0">
              <NativeDropGrid collectionId={id}>
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
                        activeWindow={clockWindow}
                      />
                    ) : undefined
                  }
                  // pt-4 = GRID_GAP: row 0's rail band matches the row gaps.
                  className="bg-black/20 pt-4"
                />
              </NativeDropGrid>
              {showPlayhead && (
                <GraphSeekRails
                  focusedId={id}
                  channel={timeChannel}
                  cellHeight={dims.gridHeight}
                  pixelsPerSecond={pixelsPerSecond}
                  ariaLabel={`Seek preview in ${name}`}
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
                  showPlayhead || rulerOn ? (
                    <>
                      {rulerOn ? (
                        <GraphRuler focusedId={id} pixelsPerSecond={pixelsPerSecond} />
                      ) : null}
                      {showPlayhead ? (
                        <GraphPlayhead
                          focusedId={id}
                          channel={timeChannel}
                          pixelsPerSecond={pixelsPerSecond}
                          activeWindow={clockWindow}
                        />
                      ) : null}
                    </>
                  ) : undefined
                }
                // pt-4: the 16px top band the seek rail centres in.
                className="bg-black/20 pt-4"
              />
              {showPlayhead && (
                <GraphStripSeekRail
                  focusedId={id}
                  channel={timeChannel}
                  pixelsPerSecond={pixelsPerSecond}
                  ariaLabel={`Seek preview in ${name}`}
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
                rulerOn={rulerOn}
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
  rulerOn,
  timeChannel,
}: Readonly<{
  focusedId: string;
  surface: FocusSurface;
  itemSize: ItemSize;
  pixelsPerSecond: number;
  previewOn: boolean;
  rulerOn: boolean;
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
          rulerOn={rulerOn}
          timeChannel={timeChannel}
        />
      ))}
    </div>
  );
}
