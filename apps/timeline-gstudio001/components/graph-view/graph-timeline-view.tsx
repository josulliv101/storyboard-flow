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
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowLeft } from "lucide-react";

import {
  DndCollections,
  UndoRedoControls,
  VirtualGrid,
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
  type CollectionsGraph,
  type CollectionsStore,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  graphChildrenToClips,
  type ClipDetail,
  type DetailsById,
} from "@storyboard/timeline-domain";

import { Button } from "@/components/core/button";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

// The graph project view — phase 3 of docs/storyboard-graph-architecture.md,
// running against the app's REAL persistence (the same auth-gated
// GET/PATCH /api/timelines contract the storyboard/workbench views use):
//
//   - ONE <DndCollections> owns the whole view session. Focus (the URL's
//     catch-all path) is pure view state read from usePathname(); the
//     provider mounts once per project (hosted by the route-group layout —
//     pages remount per param change, layouts persist), so the UNDO STACK
//     SURVIVES drill-in navigation.
//   - Documents hydrate on focus through the engine's hydration seam
//     (`store.hydrate`): navigating to a collection fetches its document
//     and fills the placeholder in place — async IO, invisible to undo and
//     the change feed.
//   - Persistence is patch-scoped: every committed change (command, undo,
//     redo) is mapped by `collectAffectedCollectionIds` to the documents it
//     touched, and ONLY those are PATCHed (debounced per timeline) — no
//     parent-scan resync pass.
//
// Deliberately additive: nothing in the storyboard/workbench pipeline is
// imported or modified. Both view systems speak the same storage contract,
// which is the whole migration strategy.

const TIMELINE_PPS = 40;

/** How the FOCUSED timeline's children render: duration-mapped strip or a
 *  wrapping grid (better at scale). Per-view state, deliberately outside
 *  the store — the graph doesn't know or care how a view projects it. */
type FocusSurface = "strip" | "grid";

function SurfaceToggle({
  surface,
  onChange,
}: Readonly<{ surface: FocusSurface; onChange: (surface: FocusSurface) => void }>) {
  return (
    <div
      role="group"
      aria-label="Focused timeline layout"
      className="flex items-center rounded-md border border-zinc-800 p-0.5"
    >
      {(["strip", "grid"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={surface === option}
          onClick={() => onChange(option)}
          className={[
            "rounded px-2 py-1 text-xs capitalize transition-colors",
            surface === option
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-200",
          ].join(" ")}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

// ── Navigation context ──────────────────────────────────────────────────────
// Content components are module-scope (identity-stable, per the package's
// registry contract), so drill-in and detail lookups reach them via context.

type GraphViewNav = Readonly<{
  details: DetailsById;
  openTimeline: (nodeId: NodeId) => void;
}>;

const GraphViewNavContext = createContext<GraphViewNav | null>(null);

function GraphViewNavProvider({
  details,
  projectId,
  focusedId,
  children,
}: Readonly<{
  details: DetailsById;
  projectId: string;
  focusedId: string;
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const store = useCollectionsStore();

  const value = useMemo<GraphViewNav>(
    () => ({
      details,
      openTimeline: (nodeId) => {
        // A duplicate-reference card opens the timeline it points at.
        const timelineId = details[nodeId as string]?.duplicateOfTimelineId ?? (nodeId as string);
        if (timelineId === focusedId) return;
        const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
        if (timelineId === projectId) {
          router.push(base);
          return;
        }
        // Focus paths are PROJECT-anchored: walk up the LIVE graph (the node
        // may have been dragged elsewhere since it appeared) to the root.
        const { graph } = store.getSnapshot();
        const chain: string[] = [timelineId];
        let parent = graph.parentById.get(parseNodeId(timelineId)) ?? null;
        while (parent !== null && (parent as string) !== projectId) {
          chain.unshift(parent as string);
          parent = graph.parentById.get(parent) ?? null;
        }
        if ((parent as string | null) !== projectId) return; // detached — no route to it
        router.push(`${base}/${chain.map(encodeURIComponent).join("/")}`);
      },
    }),
    [details, focusedId, projectId, router, store],
  );

  return <GraphViewNavContext.Provider value={value}>{children}</GraphViewNavContext.Provider>;
}

// ── Async hydration ─────────────────────────────────────────────────────────

/**
 * Fetch (if needed) and hydrate one placeholder timeline through the
 * engine's hydration seam; returns side-table entries to merge, or null when
 * there was nothing to do. Levels as in `buildHydrationSpecs` — the gateway
 * caches one document per fetch, so hydration is always level 0 (a
 * timeline's own clips; its child collections stay placeholders until
 * focused or expanded).
 */
async function hydrateTimeline(
  store: CollectionsStore,
  details: Readonly<Record<string, ClipDetail>>,
  timelineId: string,
): Promise<Record<string, ClipDetail> | null> {
  if (details[timelineId]?.hydrated === true) return null;
  const graph = store.getSnapshot().graph;
  if (getChildren(graph, parseNodeId(timelineId)).length > 0) return null;

  const doc = await graphDocumentsGateway.ensure(timelineId);
  if (!doc) return null;

  // Re-read the graph — the await may have raced another hydration.
  const current = store.getSnapshot().graph;
  if (!current.nodesById.has(parseNodeId(timelineId))) return null;
  const payload = buildHydrationSpecs(
    graphDocumentsGateway.read(),
    timelineId,
    0,
    current.nodesById.keys(),
  );
  if (!payload.ok) return null;
  const applied = store.hydrate(parseNodeId(timelineId), payload.value.specs);
  if (!applied.ok) return null;

  const merged: Record<string, ClipDetail> = { ...payload.value.details };
  const own = details[timelineId];
  merged[timelineId] = own ? { ...own, hydrated: true } : { ...FALLBACK_DETAIL, hydrated: true };
  return merged;
}

/** Detail for a timeline the graph knows only as a root (no source clip). */
const FALLBACK_DETAIL: ClipDetail = { alt: "", aspect: 16 / 9, trackIndex: 0 };

/**
 * Keeps the graph hydrated for the current focus path: every route segment's
 * document is fetched and loaded (deep links land on a root-only graph),
 * then the focused timeline's child collections load their own clips so the
 * inline sub-timelines render. Renders nothing; runs at navigation cadence,
 * cancellation-safe across route changes.
 */
function HydrationController({
  projectId,
  segments,
  details,
  onDetails,
  onFocusError,
}: Readonly<{
  projectId: string;
  segments: readonly string[];
  details: DetailsById;
  onDetails: (merged: Readonly<Record<string, ClipDetail>>) => void;
  onFocusError: (error: string | null) => void;
}>) {
  const store = useCollectionsStore();
  const pathKey = segments.join("/");

  useEffect(() => {
    let cancelled = false;
    const path = pathKey === "" ? [] : pathKey.split("/");
    const focusedId = path[path.length - 1] ?? projectId;

    void (async () => {
      const merged: Record<string, ClipDetail> = {};
      const detailsNow = () => ({ ...details, ...merged });
      const ensure = async (timelineId: string) => {
        const hydrated = await hydrateTimeline(store, detailsNow(), timelineId);
        if (hydrated && !cancelled) Object.assign(merged, hydrated);
      };

      let error: string | null = null;
      for (const segment of [projectId, ...path]) {
        if (cancelled) return;
        if (!store.getSnapshot().graph.nodesById.has(parseNodeId(segment))) {
          error = `This project has no timeline "${segment}".`;
          break;
        }
        await ensure(segment);
      }
      if (error === null && !cancelled) {
        // The focused timeline's placeholder child collections load their
        // own clips so their inline strips have content. Fetches run in
        // parallel; hydration applies as each lands.
        const graph = store.getSnapshot().graph;
        const collectionChildren = getChildren(graph, parseNodeId(focusedId)).filter(
          (childId) => graph.nodesById.get(childId)?.kind === "collection",
        );
        await Promise.all(collectionChildren.map((childId) => ensure(childId as string)));
      }
      if (cancelled) return;
      onFocusError(error);
      if (Object.keys(merged).length > 0) onDetails(merged);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathKey, projectId, details, store, onDetails, onFocusError]);

  return null;
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
  const nav = useContext(GraphViewNavContext);

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
          "relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-dashed border-sky-500/40 bg-sky-500/[0.08] p-1.5",
          selected ? "ring-2 ring-amber-400" : "",
          rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
          isDragSource ? "opacity-40" : "",
        ].join(" ")}
      >
        <span className="flex min-h-0 flex-1 gap-0.5 overflow-hidden">
          {previews.length === 0 ? (
            <span className="flex flex-1 items-center justify-center text-[9px] text-zinc-500">
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
          <span className="truncate text-[10px] font-semibold text-zinc-100">{node.name}</span>
          <span className="shrink-0 font-mono text-[9px] text-zinc-400">{count}</span>
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
        <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
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

const GRAPH_VIEW_COMPONENTS: CollectionsComponents = {
  ItemContent: GraphClipContent,
  TrimHandleContent: GraphTrimHandle,
  GhostContent: GraphGhost,
};

// ── Inline sub-timelines ────────────────────────────────────────────────────

function SubTimelines({
  focusedId,
  details,
  onDetails,
}: Readonly<{
  focusedId: string;
  details: DetailsById;
  onDetails: (merged: Readonly<Record<string, ClipDetail>>) => void;
}>) {
  const nav = useContext(GraphViewNavContext);
  const store = useCollectionsStore();
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
              <span className="h-3 w-3 rounded-sm border border-dashed border-sky-500/60 bg-sky-500/20" />
              <h3 className="text-sm font-semibold text-zinc-100">{node.name}</h3>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                {hydrated ? liveCount : (detail?.itemCount ?? 0)} clips
              </span>
              {!hydrated && (
                <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  loading…
                </span>
              )}
              <span className="grow" />
              {!hydrated && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void hydrateTimeline(store, details, id).then((merged) => {
                      if (merged) onDetails(merged);
                    });
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Patch-scoped document saves
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          No saves yet — reorder, trim, nest, or undo and watch which timeline documents get
          PATCHed. Hydration never appears here: loading data is not a change worth writing back.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-zinc-400">
          {entries.map((entry) => (
            <li key={entry.at} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-zinc-100">{entry.origin}</span>
              <span>{entry.patchType}</span>
              <span aria-hidden="true">→</span>
              <span className="text-sky-400">
                {entry.collections.length === 0 ? "(nothing stored)" : entry.collections.join(", ")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Chrome: back arrow + breadcrumbs in the app's own style ─────────────────

function GraphViewChrome({
  projectId,
  timelinePath,
}: Readonly<{ projectId: string; timelinePath: readonly string[] }>) {
  // Titles arrive as documents land in the gateway cache.
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
    <div className="flex items-center justify-between gap-3 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href={parentHref}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 hover:bg-zinc-800 transition-all shrink-0"
          title={focusedId === projectId ? "Go to Projects" : "Go to parent timeline"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <nav
          aria-label="Timeline focus path"
          className="flex items-center gap-2 text-xs text-zinc-400 select-none"
        >
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            Projects
          </Link>
          <span>/</span>
          <Link href={base} className="text-zinc-400 hover:text-white transition-colors">
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
                className="text-zinc-400 hover:text-white transition-colors"
              >
                {documents[segment]?.title ?? segment}
              </Link>
              <span>/</span>
            </span>
          ))}
          <span className="text-zinc-100 font-semibold truncate max-w-[250px]">
            {documents[focusedId]?.title ?? focusedId}
          </span>
        </nav>
      </div>
      <div className="shrink-0 flex items-center gap-3">
        <Link
          href={`/timeline/${encodeURIComponent(projectId)}/storyboard${
            focusedId === projectId ? "" : `/${encodeURIComponent(focusedId)}`
          }`}
          className="text-xs text-zinc-400 hover:text-white transition-colors"
        >
          Storyboard view
        </Link>
      </div>
    </div>
  );
}

// ── Entry ───────────────────────────────────────────────────────────────────

type BootState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; graph: CollectionsGraph; details: DetailsById }>;

export function GraphTimelineView({ projectId }: { projectId: string }) {
  // Mounted by the route-group LAYOUT (which persists across focus
  // navigation — pages remount per param change), so the focus path comes
  // from the pathname, not page props.
  const pathname = usePathname();
  const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
  const timelinePath = useMemo(
    () =>
      pathname.startsWith(base)
        ? pathname
            .slice(base.length)
            .split("/")
            .filter(Boolean)
            .map(decodeURIComponent)
        : [],
    [pathname, base],
  );
  const focusedId = timelinePath[timelinePath.length - 1] ?? projectId;

  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [details, setDetails] = useState<DetailsById>({});
  const [focusError, setFocusError] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<readonly SyncEntry[]>([]);
  // Hosted by the persistent layout, so the chosen surface survives
  // drill-in navigation along with the provider itself.
  const [surface, setSurface] = useState<FocusSurface>("strip");
  const gatewayError = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.lastError,
    graphDocumentsGateway.lastError,
  );

  // Boot: fetch the project's own document, then build the initial graph
  // rooted at it. Referenced child timelines start as placeholders — each is
  // its own stored document, fetched on focus/expand by the controller.
  useEffect(() => {
    let cancelled = false;
    void graphDocumentsGateway.ensure(projectId).then((doc) => {
      if (cancelled) return;
      if (!doc) {
        setBoot({
          status: "error",
          message:
            graphDocumentsGateway.lastError() ?? `Project timeline "${projectId}" did not load.`,
        });
        return;
      }
      const built = buildFocusedGraph(graphDocumentsGateway.read(), projectId, 0);
      if (!built.ok) {
        setBoot({ status: "error", message: built.error });
        return;
      }
      setDetails(built.value.details);
      setBoot({ status: "ready", graph: built.value.graph, details: built.value.details });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const onDetails = useCallback(
    (merged: Readonly<Record<string, ClipDetail>>) =>
      setDetails((current) => ({ ...current, ...merged })),
    [],
  );

  // The persistence write path: map the committed patch to the documents it
  // touched, rewrite ONLY those through the gateway (debounced PATCH each).
  const handleChange = useCallback(
    (change: CollectionsChange) => {
      const affected = collectAffectedCollectionIds(change.graph, change.patch).filter(
        (id) => graphDocumentsGateway.peek(id) !== null,
      );
      for (const id of affected) {
        graphDocumentsGateway.writeClips(id, graphChildrenToClips(change.graph, details, id));
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

  if (boot.status === "loading") {
    return (
      <div className="grid gap-3" aria-label="Loading graph view">
        <div className="h-8 w-1/2 animate-pulse rounded-lg bg-zinc-900" />
        <div className="h-28 w-full animate-pulse rounded-lg bg-zinc-900" />
        <div className="h-20 w-full animate-pulse rounded-lg bg-zinc-900/60" />
      </div>
    );
  }
  if (boot.status === "error") {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
        <p className="font-semibold">Could not load this project&apos;s graph view.</p>
        <p className="mt-1 text-red-300/80">{boot.message}</p>
        <Link href="/" className="mt-3 inline-block text-xs text-red-200 underline underline-offset-4">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GraphViewChrome projectId={projectId} timelinePath={timelinePath} />
      {gatewayError !== null && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {gatewayError}
        </p>
      )}
      <DndCollections
        initialGraph={boot.graph}
        components={GRAPH_VIEW_COMPONENTS}
        onChange={handleChange}
      >
        <HydrationController
          projectId={projectId}
          segments={timelinePath}
          details={details}
          onDetails={onDetails}
          onFocusError={setFocusError}
        />
        <GraphViewNavProvider details={details} projectId={projectId} focusedId={focusedId}>
          {focusError !== null ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
              <p className="font-semibold text-zinc-100">Unknown timeline</p>
              <p className="mt-1">{focusError}</p>
              <Link
                href={base}
                className="mt-3 inline-block text-xs text-sky-400 underline underline-offset-4"
              >
                Back to the project timeline
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  Press-and-hold to drag (cross-timeline included) · amber edges trim ·
                  double-click a dashed clip to focus it · undo survives drill-in.
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  <SurfaceToggle surface={surface} onChange={setSurface} />
                  <UndoRedoControls />
                </div>
              </div>
              {surface === "strip" ? (
                <VirtualStrip
                  collectionId={parseNodeId(focusedId)}
                  pixelsPerSecond={TIMELINE_PPS}
                  itemHeight={88}
                  itemDragActivation="hold"
                  className="bg-black/25"
                />
              ) : (
                // Same graph, same provider — dragging between this grid and
                // the sub-timeline strips below is native.
                <VirtualGrid
                  collectionId={parseNodeId(focusedId)}
                  cellWidth={160}
                  cellHeight={96}
                  height={420}
                  className="bg-black/25"
                />
              )}
              <SubTimelines focusedId={focusedId} details={details} onDetails={onDetails} />
              <SyncPanel entries={syncLog} />
            </div>
          )}
        </GraphViewNavProvider>
      </DndCollections>
    </div>
  );
}
