"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
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
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  videoFrameCount,
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
  type CollectionTrimHandleContentProps,
  type CollectionsChange,
  type CollectionsComponents,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  buildFocusedGraph,
  collectAffectedCollectionIds,
  graphChildrenToClips,
  type DetailsById,
  type DocumentsById,
  type FocusedGraph,
} from "@storyboard/timeline-domain";
import { createInitialTimelineDocuments } from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip } from "@storyboard/ui/timeline/types";

// The phase-2 proof of docs/storyboard-graph-architecture.md, on the app's
// REAL data (`createInitialTimelineDocuments`):
//
//   - ONE <DndCollections> owns the page. The focused timeline and every
//     inline sub-timeline are projections of the same graph, so dragging a
//     clip between timelines, nesting it into a collection card, and undoing
//     all of it are one store's business — no cross-provider choreography.
//   - The URL is the focus path (per-view state lives in the route). Double-
//     clicking a collection clip or pressing a sub-timeline's Focus button
//     pushes its timeline id onto the path; landing there hydrates that
//     document into a fresh graph (hydrate-on-focus).
//   - Persistence is patch-scoped: every committed change (command, undo,
//     redo) is mapped by `collectAffectedCollectionIds` to the documents it
//     touched, and ONLY those are rewritten via `graphChildrenToClips` — the
//     write path the sync panel makes visible.
//
// Known, deliberate trade-off: drilling in remounts the provider, so the
// undo stack is scoped to a focus session (hydration stays out-of-band from
// undo; see the architecture doc's open questions).

const ROOT_TIMELINE_ID = "root";
const TIMELINE_PPS = 40;

// ── Session document store ──────────────────────────────────────────────────
// Module scope stands in for the persistence layer: committed edits survive
// drill-in navigation (which remounts the provider), so what a focus session
// hydrates is what previous sessions wrote — a true storage round-trip.

let sessionDocuments: DocumentsById = createInitialTimelineDocuments();

function readDocuments(): DocumentsById {
  return sessionDocuments;
}

function writeDocumentClips(timelineId: string, clips: TimelineClip[]) {
  const doc = sessionDocuments[timelineId];
  if (!doc) return;
  sessionDocuments = { ...sessionDocuments, [timelineId]: { ...doc, clips } };
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
  timelinePath,
  children,
}: Readonly<{
  details: DetailsById;
  focusedId: string;
  timelinePath: readonly string[];
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
        // Build the URL chain by walking up the LIVE graph to the focused
        // root — the node may have been dragged under a different collection
        // since mount, and the path must reflect where it lives now.
        const { graph } = store.getSnapshot();
        const chain: string[] = [timelineId];
        let parent = graph.parentById.get(parseNodeId(timelineId)) ?? null;
        while (parent !== null && (parent as string) !== focusedId) {
          chain.unshift(parent as string);
          parent = graph.parentById.get(parent) ?? null;
        }
        if ((parent as string | null) !== focusedId) return; // detached — no route to it
        router.push(`/graph-timeline/${[...timelinePath, ...chain].join("/")}`);
      },
    }),
    [details, focusedId, timelinePath, router, store],
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

function SubTimelines({ focusedId, details }: { focusedId: string; details: DetailsById }) {
  const nav = useContext(GraphTimelineNavContext);
  // Graph identity changes only per committed change — this section re-
  // renders at commit cadence (cheap), never per drag move.
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
                This timeline&apos;s document loads when focused — press Focus (or double-click its
                clip above).
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Persistence sync panel ──────────────────────────────────────────────────

type SyncEntry = Readonly<{
  at: number;
  origin: CollectionsChange["origin"];
  patchType: CollectionsChange["patch"]["type"];
  collections: readonly string[];
}>;

function SyncPanel({ entries }: { entries: readonly SyncEntry[] }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Patch-scoped document writes
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No writes yet — reorder, trim, nest, or undo and watch which documents get rewritten.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
          {entries.map((entry) => (
            <li key={entry.at} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-foreground">{entry.origin}</span>
              <span>{entry.patchType}</span>
              <span aria-hidden="true">→</span>
              <span className="text-primary">
                {entry.collections.length === 0 ? "(no stored documents)" : entry.collections.join(", ")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── The board (one provider per focus session) ──────────────────────────────

function GraphTimelineBoard({
  focusedId,
  timelinePath,
  focusedGraph,
}: Readonly<{
  focusedId: string;
  timelinePath: readonly string[];
  focusedGraph: FocusedGraph;
}>) {
  const { graph: initialGraph, details, missingDocuments } = focusedGraph;
  const [syncLog, setSyncLog] = useState<readonly SyncEntry[]>([]);
  const focusedDoc = readDocuments()[focusedId];

  // The persistence write path: map the committed patch to the documents it
  // touched, rewrite only those. `change.graph` is post-commit, so the
  // projection reads the truth the engine just established.
  const handleChange = useCallback(
    (change: CollectionsChange) => {
      const affected = collectAffectedCollectionIds(change.graph, change.patch).filter(
        (id) => readDocuments()[id] !== undefined,
      );
      for (const id of affected) {
        writeDocumentClips(id, graphChildrenToClips(change.graph, details, id));
      }
      setSyncLog((log) =>
        [
          {
            at: Date.now(),
            origin: change.origin,
            patchType: change.patch.type,
            collections: affected,
          },
          ...log,
        ].slice(0, 6),
      );
    },
    [details],
  );

  return (
    <DndCollections
      initialGraph={initialGraph}
      components={GRAPH_TIMELINE_COMPONENTS}
      onChange={handleChange}
    >
      <GraphTimelineNavProvider details={details} focusedId={focusedId} timelinePath={timelinePath}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{focusedDoc?.title ?? focusedId}</h2>
            </CardTitle>
            {focusedDoc?.description && (
              <CardDescription>{focusedDoc.description}</CardDescription>
            )}
            <CardAction>
              <UndoRedoControls />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {missingDocuments.length > 0 && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Referenced timelines without documents: {missingDocuments.join(", ")} (left as
                placeholders).
              </p>
            )}
            <VirtualStrip
              collectionId={parseNodeId(focusedId)}
              pixelsPerSecond={TIMELINE_PPS}
              itemHeight={88}
              itemDragActivation="hold"
              className="bg-black/25"
            />
            <SubTimelines focusedId={focusedId} details={details} />
            <SyncPanel entries={syncLog} />
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <li>Press-and-hold a clip to drag — including between the timelines above.</li>
              <li>Drag a clip&apos;s amber edges to trim; drop a clip ON a dashed card to nest it.</li>
              <li>Double-click a dashed collection clip to focus its timeline (the URL follows).</li>
              <li>Undo/redo covers all of it — one history, because it&apos;s one graph.</li>
            </ul>
          </CardContent>
        </Card>
      </GraphTimelineNavProvider>
    </DndCollections>
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

export function GraphTimeline({ timelinePath }: { timelinePath: string[] }) {
  const focusedId = timelinePath[timelinePath.length - 1] ?? ROOT_TIMELINE_ID;
  // Hydrate-on-focus: every focus change re-reads the session documents —
  // which carry all previously committed writes — and builds a fresh graph
  // for the focused timeline plus one level of child collections.
  const built = useMemo(() => buildFocusedGraph(readDocuments(), focusedId), [focusedId]);

  if (!built.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Unknown timeline</h2>
          </CardTitle>
          <CardDescription>{built.error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/graph-timeline" className="text-sm text-primary underline underline-offset-4">
            Back to the root timeline
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs timelinePath={timelinePath} />
      {/* Keyed remount per focus: a focus session is a hydration boundary. */}
      <GraphTimelineBoard
        key={focusedId}
        focusedId={focusedId}
        timelinePath={timelinePath}
        focusedGraph={built.value}
      />
    </div>
  );
}
