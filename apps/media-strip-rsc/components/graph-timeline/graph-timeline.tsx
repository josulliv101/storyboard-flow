"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@storyboard/ui/core/badge";
import { Button } from "@storyboard/ui/core/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@storyboard/ui/core/card";
import {
  DndCollections,
  UndoRedoControls,
  VirtualStrip,
  getChildren,
  mediaDurationSeconds,
  parseNodeId,
  useCollectionsContainer,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  videoFrameCount,
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
  type CollectionTrimHandleContentProps,
  type CollectionsChange,
  type CollectionsComponents,
  type CollectionsStore,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  collectUnhydratedDropTargets,
  graphChildrenToClips,
  type ClipDetail,
  type DetailsById,
  type DocumentsById,
} from "@storyboard/timeline-domain";
import { createInitialTimelineDocuments } from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip } from "@storyboard/ui/timeline/types";

// The phase-2 proof of docs/storyboard-graph-architecture.md, on the app's
// REAL data (`createInitialTimelineDocuments`):
//
//   - ONE <DndCollections> owns the whole SESSION. The provider mounts once
//     with the root timeline; focus (the URL's catch-all path) is pure view
//     state, and drilling in never remounts anything — which is why the
//     UNDO STACK SURVIVES navigation. Cross-timeline drags, nesting, and
//     undo are all one store's business.
//   - Documents hydrate on focus through the engine's hydration seam
//     (`store.hydrate` — IO landing, invisible to undo and the change
//     feed): navigating to a placeholder timeline fills it in place, and a
//     placeholder sub-timeline can also be loaded inline without leaving
//     the current focus.
//   - Persistence is patch-scoped: every committed change (command, undo,
//     redo) is mapped by `collectAffectedCollectionIds` to the documents it
//     touched, and ONLY those are rewritten via `graphChildrenToClips` — the
//     write path the sync panel makes visible.

const ROOT_TIMELINE_ID = "root";
const TIMELINE_PPS = 40;

// ── Session document store ──────────────────────────────────────────────────
// Module scope stands in for the persistence layer: committed edits survive
// full page remounts, so what a session hydrates is what previous sessions
// wrote — a true storage round-trip.

let sessionDocuments: DocumentsById = createInitialTimelineDocuments();

function readDocuments(): DocumentsById {
  return sessionDocuments;
}

function writeDocumentClips(timelineId: string, clips: TimelineClip[]) {
  const doc = sessionDocuments[timelineId];
  if (!doc) return;
  sessionDocuments = { ...sessionDocuments, [timelineId]: { ...doc, clips } };
}

// ── Hydration ───────────────────────────────────────────────────────────────

/**
 * Fill one placeholder timeline through the engine's hydration seam and
 * return the side-table entries to merge (or null when there was nothing to
 * do). `levels` as in `buildHydrationSpecs`: 0 loads the timeline's own
 * clips, 1 also loads each child collection's clips.
 */
function hydrateTimeline(
  store: CollectionsStore,
  details: Readonly<Record<string, ClipDetail>>,
  timelineId: string,
  levels: number,
): Record<string, ClipDetail> | null {
  const graph = store.getSnapshot().graph;
  const doc = readDocuments()[timelineId];
  if (!doc) return null;
  const alreadyHydrated = details[timelineId]?.hydrated === true;
  if (alreadyHydrated || getChildren(graph, parseNodeId(timelineId)).length > 0) return null;

  const payload = buildHydrationSpecs(readDocuments(), timelineId, levels, graph.nodesById.keys());
  if (!payload.ok) return null;
  const applied = store.hydrate(parseNodeId(timelineId), payload.value.specs);
  if (!applied.ok) return null;

  const merged: Record<string, ClipDetail> = { ...payload.value.details };
  const own = details[timelineId];
  if (own) merged[timelineId] = { ...own, hydrated: true };
  return merged;
}

/**
 * Keeps the graph hydrated for the current focus path: every route segment's
 * document is loaded (deep links land on a root-only graph), and the focused
 * timeline's child collections load their own clips so the inline
 * sub-timelines render. Renders nothing; runs at navigation cadence.
 */
function HydrationController({
  segments,
  focusedId,
  details,
  onDetails,
  onFocusError,
}: Readonly<{
  segments: readonly string[];
  focusedId: string;
  details: DetailsById;
  onDetails: (merged: Readonly<Record<string, ClipDetail>>) => void;
  onFocusError: (error: string | null) => void;
}>) {
  const store = useCollectionsStore();
  const pathKey = segments.join("/");

  useEffect(() => {
    const path = pathKey === "" ? [] : pathKey.split("/");
    const merged: Record<string, ClipDetail> = {};
    const detailOf = (id: string) => merged[id] ?? details[id];
    const ensure = (timelineId: string, levels: number) => {
      const hydrated = hydrateTimeline(
        store,
        { ...details, ...merged },
        timelineId,
        levels,
      );
      if (hydrated) Object.assign(merged, hydrated);
    };

    let error: string | null = null;
    for (const segment of [ROOT_TIMELINE_ID, ...path]) {
      if (!store.getSnapshot().graph.nodesById.has(parseNodeId(segment))) {
        error = `Unknown timeline "${segment}".`;
        break;
      }
      ensure(segment, 1);
    }
    if (error === null) {
      // The focused timeline's placeholder child collections load their own
      // clips (one level) so their inline strips have content — and then one
      // more shallow level: grandchild collections are VISIBLE as cards
      // inside those strips, and every visible collection is a drop target,
      // so hydrating them keeps the gate-until-hydrated bounce
      // (PersistenceBridge) a rare race fallback instead of the common path.
      const collectionChildrenOf = (id: string) => {
        const graph = store.getSnapshot().graph;
        return getChildren(graph, parseNodeId(id))
          .filter((childId) => graph.nodesById.get(childId)?.kind === "collection")
          .map((childId) => childId as string);
      };
      const children = collectionChildrenOf(focusedId);
      for (const childId of children) {
        if (detailOf(childId)?.hydrated === false) ensure(childId, 0);
      }
      for (const grandchildId of children.flatMap(collectionChildrenOf)) {
        if (detailOf(grandchildId)?.hydrated === false) ensure(grandchildId, 0);
      }
    }

    onFocusError(error);
    if (Object.keys(merged).length > 0) onDetails(merged);
  }, [pathKey, focusedId, details, store, onDetails, onFocusError]);

  return null;
}

// ── Navigation context ──────────────────────────────────────────────────────
// Content components are module-scope (identity-stable, per the package's
// registry contract), so drill-in and detail lookups reach them via context.

type GraphTimelineNav = Readonly<{
  details: DetailsById;
  openTimeline: (nodeId: NodeId) => void;
}>;

const GraphTimelineNavContext = createContext<GraphTimelineNav | null>(null);

function GraphTimelineNavProvider({
  details,
  focusedId,
  children,
}: Readonly<{
  details: DetailsById;
  focusedId: string;
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const store = useCollectionsStore();

  const value = useMemo<GraphTimelineNav>(
    () => ({
      details,
      openTimeline: (nodeId) => {
        // A duplicate-reference card opens the timeline it points at.
        const timelineId = details[nodeId as string]?.duplicateOfTimelineId ?? (nodeId as string);
        if (timelineId === focusedId) return;
        if (timelineId === ROOT_TIMELINE_ID) {
          router.push("/graph-timeline");
          return;
        }
        // Focus paths are ROOT-anchored: walk up the LIVE graph (the node
        // may have been dragged elsewhere since it appeared) to the root.
        const { graph } = store.getSnapshot();
        const chain: string[] = [timelineId];
        let parent = graph.parentById.get(parseNodeId(timelineId)) ?? null;
        while (parent !== null && (parent as string) !== ROOT_TIMELINE_ID) {
          chain.unshift(parent as string);
          parent = graph.parentById.get(parent) ?? null;
        }
        if ((parent as string | null) !== ROOT_TIMELINE_ID) return; // detached — no route to it
        router.push(`/graph-timeline/${chain.join("/")}`);
      },
    }),
    [details, focusedId, router, store],
  );

  return (
    <GraphTimelineNavContext.Provider value={value}>{children}</GraphTimelineNavContext.Provider>
  );
}

// ── Consumer pixels (module scope — identity-stable) ────────────────────────

/** Live-tracking duration readout — a LEAF so only the clip being trimmed
 *  re-renders per pointer move (useLiveTrim re-renders its caller). */
function LiveDurationPill({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  const showing = live ? live.effectiveSeconds : mediaDurationSeconds(node);
  return (
    <span className="pointer-events-none absolute right-1 bottom-1 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-zinc-100">
      {node.mediaKind === "video"
        ? `${showing.toFixed(2)}s / ${node.fullDurationSeconds.toFixed(2)}s`
        : `${showing.toFixed(2)}s`}
    </span>
  );
}

const GraphClipContent = memo(function GraphClipContent({
  id,
  node,
  childCount,
  selected,
  rejected,
  isDragSource,
  trimEnabled,
}: CollectionItemContentProps) {
  const nav = useContext(GraphTimelineNavContext);

  if (node.kind === "collection") {
    const detail = nav?.details[id as string];
    const hydrated = detail?.hydrated === true;
    const count = hydrated ? childCount : (detail?.itemCount ?? childCount);
    const previews = detail?.previewItems?.slice(0, 3) ?? [];
    return (
      <span
        title="Double-click to open this timeline"
        onDoubleClick={() => nav?.openTimeline(id)}
        className={[
          "relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-dashed border-primary/40 bg-primary/[0.08] p-1.5",
          selected ? "ring-2 ring-amber-400" : "",
          rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
          isDragSource ? "opacity-40" : "",
        ].join(" ")}
      >
        <span className="flex min-h-0 flex-1 gap-0.5 overflow-hidden">
          {previews.length === 0 ? (
            <span className="flex flex-1 items-center justify-center text-[9px] text-muted-foreground">
              {hydrated ? "Empty" : "Open to load"}
            </span>
          ) : (
            previews.map((preview) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={preview.id}
                src={preview.poster ?? preview.src}
                alt=""
                draggable={false}
                loading="lazy"
                className="h-full min-w-0 flex-1 rounded-sm object-cover"
              />
            ))
          )}
        </span>
        <span className="mt-1 flex items-baseline justify-between gap-1">
          <span className="truncate text-[10px] font-semibold text-foreground">{node.name}</span>
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{count}</span>
        </span>
      </span>
    );
  }

  const isVideo = node.mediaKind === "video";
  const posters = isVideo ? (node.posterSrcs ?? []) : node.src ? [node.src] : [];
  const frames = isVideo ? videoFrameCount(mediaDurationSeconds(node), 6) : 1;
  return (
    <span
      className={[
        "relative flex h-full w-full overflow-hidden rounded-md bg-zinc-900",
        selected ? "ring-2 ring-amber-400" : "ring-1 ring-white/15",
        rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
        isDragSource ? "opacity-40" : "",
      ].join(" ")}
    >
      {posters.length === 0 ? (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          No preview
        </span>
      ) : (
        <span className="flex h-full w-full">
          {Array.from({ length: frames }).map((_, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={posters[index % posters.length]}
              alt=""
              draggable={false}
              loading="lazy"
              className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
            />
          ))}
        </span>
      )}
      {trimEnabled && <LiveDurationPill id={id} node={node} />}
    </span>
  );
});

const GraphTrimHandle = memo(function GraphTrimHandle({
  side,
  selected,
}: CollectionTrimHandleContentProps) {
  return (
    <span
      className={[
        "flex h-full w-full items-center justify-center transition-opacity",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
        selected ? "bg-amber-400 opacity-95" : "bg-amber-400/50 opacity-0 group-hover:opacity-90",
      ].join(" ")}
    >
      <span className="h-4 w-0.5 rounded bg-black/60" />
    </span>
  );
});

const GraphGhost = memo(function GraphGhost({ node, extraCount }: CollectionGhostContentProps) {
  return (
    <span className="relative flex h-full w-full flex-col justify-between rounded-md bg-zinc-900/95 p-2 text-xs shadow-2xl ring-2 ring-amber-400">
      <span className="truncate font-semibold text-zinc-100">{node.name}</span>
      <span className="font-mono text-[10px] text-zinc-400">
        {node.kind === "collection" ? "Timeline" : `${mediaDurationSeconds(node).toFixed(2)}s`}
      </span>
      {extraCount > 0 && (
        <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-black shadow">
          +{extraCount}
        </span>
      )}
    </span>
  );
});

const GRAPH_TIMELINE_COMPONENTS: CollectionsComponents = {
  ItemContent: GraphClipContent,
  TrimHandleContent: GraphTrimHandle,
  GhostContent: GraphGhost,
};

// ── Inline sub-timelines ────────────────────────────────────────────────────
// Every collection child of the focused timeline gets its own strip UNDER
// the parent — a second projection of the same graph in the same provider,
// which is exactly what makes cross-timeline drags native.

function SubTimelines({
  focusedId,
  details,
  onDetails,
}: Readonly<{
  focusedId: string;
  details: DetailsById;
  onDetails: (merged: Readonly<Record<string, ClipDetail>>) => void;
}>) {
  const nav = useContext(GraphTimelineNavContext);
  const store = useCollectionsStore();
  // Graph identity changes only per committed change/hydration — this
  // section re-renders at commit cadence (cheap), never per drag move.
  const graph = useCollectionsSelector((s) => s.graph);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());

  const collections = getChildren(graph, parseNodeId(focusedId)).filter(
    (childId) => graph.nodesById.get(childId)?.kind === "collection",
  );
  if (collections.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {collections.map((collectionId) => {
        const node = graph.nodesById.get(collectionId);
        if (node?.kind !== "collection") return null;
        const id = collectionId as string;
        const detail = details[id];
        const hydrated = detail?.hydrated === true;
        const collapsed = collapsedIds.has(id);
        const liveCount = getChildren(graph, collectionId).length;

        return (
          <section key={id} aria-label={`Sub-timeline: ${node.name}`}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm border border-dashed border-primary/60 bg-primary/20" />
              <h3 className="text-sm font-semibold">{node.name}</h3>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {hydrated ? liveCount : (detail?.itemCount ?? 0)} clips
              </Badge>
              {!hydrated && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  not hydrated
                </Badge>
              )}
              <span className="grow" />
              {!hydrated && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const merged = hydrateTimeline(store, details, id, 0);
                    if (merged) onDetails(merged);
                  }}
                >
                  Load inline
                </Button>
              )}
              {hydrated && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCollapsedIds((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                >
                  {collapsed ? "Expand" : "Collapse"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => nav?.openTimeline(collectionId)}
              >
                Focus
              </Button>
            </div>
            {hydrated && !collapsed && (
              <VirtualStrip
                collectionId={collectionId}
                pixelsPerSecond={TIMELINE_PPS}
                itemHeight={64}
                itemDragActivation="hold"
                className="bg-black/20"
              />
            )}
            {!hydrated && (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                This timeline&apos;s document hasn&apos;t loaded — Load inline hydrates it right
                here (undo history is untouched), Focus navigates to it.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Persistence bridge ──────────────────────────────────────────────────────

type SyncEntry = Readonly<{
  at: number;
  origin: CollectionsChange["origin"];
  patchType: CollectionsChange["patch"]["type"];
  collections: readonly string[];
  /** True when the change was REVERTED (drop into an un-hydrated collection). */
  bounced?: boolean;
}>;

/**
 * The write path AND the gate-until-hydrated policy, in one subscriber: a
 * command (or redo) placing content INTO an un-hydrated placeholder is
 * BOUNCED — undone on the spot with a rejection flash — because letting it
 * stand would block the collection's hydration (the engine refuses to fill
 * a non-empty collection) and let a write clobber the stored document.
 * Everything else writes patch-scoped, never touching a document whose
 * clips haven't loaded. Lives INSIDE the provider (unlike an `onChange`
 * prop) because bouncing needs the store; `subscribeToChanges` supports
 * reentrant dispatch, so undoing from within the feed is safe and ordered.
 */
function PersistenceBridge({
  details,
  onSync,
}: Readonly<{ details: DetailsById; onSync: (entry: SyncEntry) => void }>) {
  const store = useCollectionsStore();
  const { announce } = useCollectionsContainer();
  const detailsRef = useRef(details);
  useEffect(() => {
    detailsRef.current = details;
  });

  useEffect(
    () =>
      store.subscribeToChanges((change) => {
        const current = detailsRef.current;

        if (change.origin !== "undo") {
          const blocked = collectUnhydratedDropTargets(change.patch, current);
          if (blocked.length > 0) {
            store.undo();
            const placedIds =
              change.patch.type === "nodes-moved"
                ? change.patch.moves.map((move) => move.nodeId)
                : change.patch.type === "nodes-added"
                  ? change.patch.adds.map((add) => add.node.id)
                  : [];
            if (placedIds.length > 0) store.flashRejection(placedIds);
            announce("That collection is still loading — drop again once its clips appear.");
            onSync({
              at: Date.now(),
              origin: change.origin,
              patchType: change.patch.type,
              collections: blocked,
              bounced: true,
            });
            return;
          }
        }

        const affected = collectAffectedCollectionIds(change.graph, change.patch).filter(
          (id) => readDocuments()[id] !== undefined && current[id]?.hydrated !== false,
        );
        for (const id of affected) {
          writeDocumentClips(id, graphChildrenToClips(change.graph, current, id));
        }
        onSync({
          at: Date.now(),
          origin: change.origin,
          patchType: change.patch.type,
          collections: affected,
        });
      }),
    [store, announce, onSync],
  );

  return null;
}

// ── Persistence sync panel ──────────────────────────────────────────────────

function SyncPanel({ entries }: { entries: readonly SyncEntry[] }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Patch-scoped document writes
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No writes yet — reorder, trim, nest, or undo and watch which documents get rewritten.
          Hydration never appears here: loading data is not a change worth writing back.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
          {entries.map((entry) => (
            <li key={entry.at} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-foreground">{entry.origin}</span>
              <span>{entry.patchType}</span>
              <span aria-hidden="true">→</span>
              {entry.bounced ? (
                <span className="text-amber-400">
                  reverted — {entry.collections.join(", ")} still loading
                </span>
              ) : (
                <span className="text-primary">
                  {entry.collections.length === 0
                    ? "(no stored documents)"
                    : entry.collections.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── The focused board (a PROJECTION — the provider lives above it) ──────────

function GraphTimelineBoard({
  focusedId,
  details,
  onDetails,
  syncLog,
}: Readonly<{
  focusedId: string;
  details: DetailsById;
  onDetails: (merged: Readonly<Record<string, ClipDetail>>) => void;
  syncLog: readonly SyncEntry[];
}>) {
  const focusedDoc = readDocuments()[focusedId];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{focusedDoc?.title ?? focusedId}</h2>
        </CardTitle>
        {focusedDoc?.description && <CardDescription>{focusedDoc.description}</CardDescription>}
        <CardAction>
          <UndoRedoControls />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <VirtualStrip
          collectionId={parseNodeId(focusedId)}
          pixelsPerSecond={TIMELINE_PPS}
          itemHeight={88}
          itemDragActivation="hold"
          className="bg-black/25"
        />
        <SubTimelines focusedId={focusedId} details={details} onDetails={onDetails} />
        <SyncPanel entries={syncLog} />
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <li>Press-and-hold a clip to drag — including between the timelines above.</li>
          <li>Drag a clip&apos;s amber edges to trim; drop a clip ON a dashed card to nest it.</li>
          <li>Double-click a dashed collection clip to focus its timeline (the URL follows).</li>
          <li>
            Undo/redo covers all of it AND survives drill-in — one provider, one graph, one
            history for the whole session.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Breadcrumbs (route state — outside the provider on purpose) ─────────────

function Breadcrumbs({ timelinePath }: { timelinePath: readonly string[] }) {
  const documents = readDocuments();
  const crumbs = [
    { id: ROOT_TIMELINE_ID, title: documents[ROOT_TIMELINE_ID]?.title ?? "Root", href: "/graph-timeline" },
    ...timelinePath.map((id, index) => ({
      id,
      title: documents[id]?.title ?? id,
      href: `/graph-timeline/${timelinePath.slice(0, index + 1).join("/")}`,
    })),
  ];

  return (
    <nav aria-label="Timeline focus path">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex items-center gap-1">
              {index > 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              )}
              {isCurrent ? (
                <span aria-current="page" className="font-semibold text-foreground">
                  {crumb.title}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {crumb.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Entry ───────────────────────────────────────────────────────────────────

export function GraphTimeline() {
  // Mounted by the route-group LAYOUT (which persists across focus
  // navigation — pages remount per param change), so the focus path comes
  // from the pathname, not page props.
  const pathname = usePathname();
  const timelinePath = useMemo(
    () =>
      pathname
        .replace(/^\/graph-timeline\/?/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent),
    [pathname],
  );
  const focusedId = timelinePath[timelinePath.length - 1] ?? ROOT_TIMELINE_ID;
  // The provider's graph mounts ONCE, rooted at the root timeline with one
  // child level; everything deeper hydrates on focus (HydrationController)
  // or inline (SubTimelines). Session documents carry all committed writes,
  // so a full reload rebuilds from what was persisted.
  const [initial] = useState(() => buildFocusedGraph(readDocuments(), ROOT_TIMELINE_ID));
  const [details, setDetails] = useState<DetailsById>(() =>
    initial.ok ? initial.value.details : {},
  );
  const [focusError, setFocusError] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<readonly SyncEntry[]>([]);

  const onDetails = useCallback(
    (merged: Readonly<Record<string, ClipDetail>>) =>
      setDetails((current) => ({ ...current, ...merged })),
    [],
  );

  // Persistence (write path + gate-until-hydrated bounce) lives in
  // <PersistenceBridge> inside the provider — bouncing needs the store.
  const onSync = useCallback((entry: SyncEntry) => {
    setSyncLog((log) => [entry, ...log].slice(0, 6));
  }, []);

  if (!initial.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Could not load the root timeline</h2>
          </CardTitle>
          <CardDescription>{initial.error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs timelinePath={timelinePath} />
      <DndCollections initialGraph={initial.value.graph} components={GRAPH_TIMELINE_COMPONENTS}>
        <PersistenceBridge details={details} onSync={onSync} />
        <HydrationController
          segments={timelinePath}
          focusedId={focusedId}
          details={details}
          onDetails={onDetails}
          onFocusError={setFocusError}
        />
        <GraphTimelineNavProvider details={details} focusedId={focusedId}>
          {focusError !== null ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Unknown timeline</h2>
                </CardTitle>
                <CardDescription>{focusError}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href="/graph-timeline"
                  className="text-sm text-primary underline underline-offset-4"
                >
                  Back to the root timeline
                </Link>
              </CardContent>
            </Card>
          ) : (
            <GraphTimelineBoard
              focusedId={focusedId}
              details={details}
              onDetails={onDetails}
              syncLog={syncLog}
            />
          )}
        </GraphTimelineNavProvider>
      </DndCollections>
    </div>
  );
}
