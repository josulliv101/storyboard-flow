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
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";

import {
  DndCollections,
  PaletteItem,
  TrashTarget,
  UndoRedoControls,
  VirtualGrid,
  VirtualStrip,
  buildGraph,
  getChildren,
  mediaDurationSeconds,
  parseNodeId,
  useCollectionsContainer,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  usePanWithMomentum,
  videoFrameCount,
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
  type CollectionItemNode,
  type CollectionTrimHandleContentProps,
  type CollectionsChange,
  type CollectionsComponents,
  type CollectionsGraph,
  type CollectionsStore,
  type GraphNodeSpec,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  collectUnhydratedDropTargets,
  graphChildrenToClips,
  type ClipDetail,
  type DetailsById,
} from "@storyboard/timeline-domain";
import { MIN_ITEM_WIDTH, durationToWidth } from "@storyboard/ui/dnd-collections";
import { WorkbenchSplitPane } from "@storyboard/ui/timeline/viewport/workbench-display-surface";
import {
  TimelineDocumentsProvider,
  useTimelineDocuments,
} from "@storyboard/ui/timeline/timeline-document-store";
import { createTimelineDocumentsState } from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/core/button";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { GRAPH_ASSETS_TOGGLE_EVENT } from "@/lib/graph-view-events";
import type { CloudinaryAsset } from "@/lib/cloudinary-media-store";

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

/**
 * Keyboard path to drill-in: "O" on a focused collection card opens it.
 * Collection cards render their open affordance as a double-click on the
 * card CONTENT, but the focusable element is the card's selection button —
 * an interactive child inside a button would be invalid HTML, so pointer-
 * free users had no way to invoke it. The card's keyboard surface is owned
 * by the package (Enter grabs, arrows rove, Alt+arrows move), so the app
 * claims a free key at a bubble boundary instead of touching the shell.
 *
 * display: contents — a listener boundary only, invisible to layout.
 *
 * NOTE for the upcoming interaction model (click = navigate on collections):
 * this key stays the keyboard twin of whatever pointer gesture navigation
 * settles on; only the hint copy should need to change.
 */
function OpenKeyBoundary({ children }: Readonly<{ children: React.ReactNode }>) {
  const nav = useContext(GraphViewNavContext);
  const store = useCollectionsStore();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "o" && event.key !== "O") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // A keyboard-grabbed card is mid-drag: navigating away now would strand
    // the drag session in a view where its source card no longer exists.
    if (store.getSnapshot().interaction.isDragging) return;
    const target = event.target as HTMLElement;
    // Never swallow typing (no editable fields render in the board today,
    // but a future rename input inside a card must not lose its "o").
    if (target.closest("input, textarea, [contenteditable=true]")) return;
    const id = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!id) return;
    const node = store.getSnapshot().graph.nodesById.get(parseNodeId(id));
    // Same set double-click navigates: collections, plus duplicate-reference
    // cards (openTimeline resolves those to the timeline they point at).
    const opensTimeline =
      node?.kind === "collection" || nav?.details[id]?.duplicateOfTimelineId !== undefined;
    if (!opensTimeline) return;
    event.preventDefault();
    nav?.openTimeline(parseNodeId(id));
  };

  return (
    <div style={{ display: "contents" }} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
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

  const doc = await graphDocumentsGateway.ensure(timelineId);
  if (!doc) return null;

  // Re-read the graph — the await may have raced another hydration.
  const current = store.getSnapshot().graph;
  if (!current.nodesById.has(parseNodeId(timelineId))) return null;

  if (getChildren(current, parseNodeId(timelineId)).length > 0) {
    // REPAIR path: the graph holds this collection's children but the
    // side-table never recorded them (a past run hydrated the graph, then
    // its details were lost — or another hydration raced this one). The
    // graph can't be re-hydrated (the engine only fills empty collections),
    // but the details CAN be rebuilt from the cached document. Fill only
    // entries that are missing — never overwrite committed ones (a child
    // collection's own `hydrated: true` must survive a parent repair).
    const payload = buildHydrationSpecs(graphDocumentsGateway.read(), timelineId, 0);
    if (!payload.ok) return null;
    const merged: Record<string, ClipDetail> = {};
    for (const [id, detail] of Object.entries(payload.value.details)) {
      if (details[id] === undefined && current.nodesById.has(parseNodeId(id))) {
        merged[id] = detail;
      }
    }
    const own = details[timelineId];
    merged[timelineId] = own ? { ...own, hydrated: true } : { ...FALLBACK_DETAIL, hydrated: true };
    return merged;
  }

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

  // The traversal reads `details` only to check hydrated flags, so it goes
  // through a ref: with `details` in the effect deps, every detail commit
  // would cancel and restart the in-flight traversal. Declared BEFORE the
  // main effect so the ref is current when a run starts.
  const detailsRef = useRef(details);
  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  useEffect(() => {
    let cancelled = false;
    const path = pathKey === "" ? [] : pathKey.split("/");
    const focusedId = path[path.length - 1] ?? projectId;

    void (async () => {
      const merged: Record<string, ClipDetail> = {};
      const detailsNow = () => ({ ...detailsRef.current, ...merged });
      const ensure = async (timelineId: string) => {
        const hydrated = await hydrateTimeline(store, detailsNow(), timelineId);
        if (hydrated) {
          Object.assign(merged, hydrated);
          // Committed immediately and UNCONDITIONALLY — `cancelled` guards
          // focus-scoped work, but these entries are GRAPH-scoped: the
          // store.hydrate inside hydrateTimeline already mutated the shared
          // graph, and the graph outlives this focus run. Dropping them on a
          // cancelled run would strand hydrated nodes without their aspect/
          // poster/trim metadata, and the next write touching that document
          // would bake fallback values into storage.
          onDetails(hydrated);
        }
      };

      let error: string | null = null;
      let previous: string | null = null;
      for (const segment of [projectId, ...path]) {
        if (cancelled) return;
        const graph = store.getSnapshot().graph;
        const node = graph.nodesById.get(parseNodeId(segment));
        // Kind check: a media clip's id in the path is not a timeline.
        if (node === undefined || node.kind !== "collection") {
          error = `This project has no timeline "${segment}".`;
          break;
        }
        // Chain check: each focus segment must be a CHILD of the previous
        // one. Existence alone would accept the trash root or any collection
        // loaded elsewhere in the graph (crafted or stale URLs) — focusing
        // content the path never led to. Runs after the previous segment's
        // hydration, so the parent edge is present for legitimate deep
        // links; a collection that was MOVED since the URL was minted fails
        // here and lands on the route's unknown-timeline state.
        if (previous !== null && graph.parentById.get(parseNodeId(segment)) !== parseNodeId(previous)) {
          error = `Timeline "${segment}" is not inside "${previous}".`;
          break;
        }
        await ensure(segment);
        previous = segment;
      }
      if (error === null && !cancelled) {
        // The focused timeline's placeholder child collections load their
        // own clips so their inline strips have content. Fetches run in
        // parallel; hydration applies as each lands.
        const collectionChildrenOf = (id: string) => {
          const graph = store.getSnapshot().graph;
          return getChildren(graph, parseNodeId(id))
            .filter((childId) => graph.nodesById.get(childId)?.kind === "collection")
            .map((childId) => childId as string);
        };
        const children = collectionChildrenOf(focusedId);
        await Promise.all(children.map(ensure));
        if (!cancelled) {
          // One more shallow level: grandchild collections are VISIBLE as
          // cards inside the sub-timeline strips, and every visible
          // collection is a drop target — hydrating them keeps the
          // gate-until-hydrated bounce (PersistenceBridge) a rare race
          // fallback instead of the common path.
          const grandchildren = children.flatMap(collectionChildrenOf);
          await Promise.all(grandchildren.map(ensure));
        }
      }
      if (cancelled) return;
      onFocusError(error);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathKey, projectId, store, onDetails, onFocusError]);

  return null;
}

// ── Asset palette ───────────────────────────────────────────────────────────
// The user's Cloudinary library as external drag sources: PaletteItem's
// factory runs at drag START (fresh node id per drag), and the drop commits
// an ordinary add-nodes through the intent pipeline — undoable, persisted
// patch-scoped like any other change.

/** App-side fields for a node created by a palette drag, keyed by the
 *  freshly minted node id. The factory can't reach React state (it runs
 *  inside dnd-kit's drag start), so it parks the detail here and the
 *  PersistenceBridge claims it when the add COMMITS — before the first
 *  write, so poster/aspect round-trip into the stored clip. */
const pendingPaletteDetails = new Map<string, ClipDetail>();

const DEFAULT_IMAGE_SECONDS = 4;
const DEFAULT_VIDEO_SECONDS = 8;

function assetDisplayName(asset: CloudinaryAsset): string {
  const path = asset.relativePath ?? asset.pathname;
  return path.split("/").pop() ?? path;
}

function createNodeFromAsset(asset: CloudinaryAsset): CollectionItemNode {
  // One drag is in flight at a time, and the bridge deletes the entry on
  // commit — so anything still in the map here is leftover from a CANCELLED
  // or rejected drag (its minted id can never be referenced again). Clearing
  // at the next drag start caps the leak at a single stale entry.
  pendingPaletteDetails.clear();
  const id = parseNodeId(
    `asset-${asset.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  );
  const name = assetDisplayName(asset);
  const aspect =
    asset.width && asset.height && asset.height > 0 ? asset.width / asset.height : 16 / 9;
  pendingPaletteDetails.set(id as string, {
    alt: name,
    aspect,
    trackIndex: 0,
    poster: asset.thumbnailUrl,
    ...(asset.resourceType === "image"
      ? { sourceDuration: DEFAULT_IMAGE_SECONDS, trimIn: 0, trimOut: 0 }
      : {}),
  });
  if (asset.resourceType === "video") {
    return {
      id,
      kind: "media",
      mediaKind: "video",
      name,
      src: asset.url,
      posterSrcs: [asset.thumbnailUrl],
      // Real duration from the Search-API listing; the default only covers
      // the degraded duration-less listing path.
      fullDurationSeconds: asset.duration ?? DEFAULT_VIDEO_SECONDS,
      trimInSeconds: 0,
      trimOutSeconds: 0,
    };
  }
  return {
    id,
    kind: "media",
    mediaKind: "image",
    name,
    src: asset.url,
    durationSeconds: DEFAULT_IMAGE_SECONDS,
  };
}

type AssetPaletteState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; assets: readonly CloudinaryAsset[]; truncated: boolean }>;

const PALETTE_ASSET_LIMIT = 48;

/**
 * The graph view's asset surface: the SAME bottom-drawer position and look
 * as the app's legacy asset library, but its thumbnails are PaletteItems —
 * external dnd-collections drag sources. Rendered via a portal FROM INSIDE
 * the provider (portals keep React context, so dnd-kit wiring works across
 * it) because the drawer must float over the whole page. The sidebar's
 * Assets button opens this drawer on graph routes (see
 * lib/graph-view-events.ts); the legacy drawer — whose media-strip drags
 * cannot land on dnd-collections timelines — stays off these routes.
 */
/**
 * The scrollable thumbnail rail. Its OWN component on purpose:
 * `usePanWithMomentum` attaches listeners in an effect that reads the ref
 * once (its deps never change), so the hook must run in the component that
 * MOUNTS the scroll container — hoisted into the drawer (which renders this
 * rail conditionally), the ref would still be null when the effect ran and
 * grab-to-pan would silently never engage.
 */
function PaletteRail({ assets }: Readonly<{ assets: readonly CloudinaryAsset[] }>) {
  const store = useCollectionsStore();
  const railRef = useRef<HTMLDivElement>(null);

  // Grab-to-pan with momentum, exactly like the timeline strips: the rail's
  // hold marker (below) makes thumbnail presses press-and-hold to DRAG, so
  // fast swipes cancel the pending drag and pan instead; the pan stands
  // down when a still press claims the pointer.
  const panOptions = useMemo<Parameters<typeof usePanWithMomentum>[2]>(
    () => ({ isGestureClaimed: () => store.getSnapshot().interaction.isDragging }),
    [store],
  );
  usePanWithMomentum(railRef, "x", panOptions);

  return (
    // The hold marker routes thumbnail presses through press-and-hold
    // activation (CollectionsPointerSensor), freeing fast swipes for the
    // grab-to-pan. pan-y leaves vertical touch scrolling to the page.
    <div
      ref={railRef}
      data-drag-activation="hold"
      className="flex cursor-grab gap-2 overflow-x-auto pb-1 select-none active:cursor-grabbing"
      style={{ touchAction: "pan-y" }}
    >
      {assets.map((asset) => (
        <PaletteItem
          key={asset.id}
          paletteId={`asset-${asset.id}`}
          createNode={() => createNodeFromAsset(asset)}
          className="relative h-24 w-36 shrink-0 overflow-hidden p-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.thumbnailUrl}
            alt={assetDisplayName(asset)}
            draggable={false}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {asset.resourceType === "video" && (
            <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1 py-0.5 text-[9px] font-bold tracking-wide text-zinc-100">
              VIDEO
            </span>
          )}
        </PaletteItem>
      ))}
    </div>
  );
}

function AssetPaletteDrawer({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const [state, setState] = useState<AssetPaletteState>({ status: "loading" });

  // Lazy: fetch on first open, keep a SUCCESS for the session. Failures are
  // never latched (the old fetched-once ref marked the attempt as done
  // before it ran, so one transient error made the palette unrecoverable
  // until reload): the error state has its own Retry, and closing an
  // errored drawer resets it so the next open refetches.
  const handleClose = () => {
    if (state.status === "error") setState({ status: "loading" });
    onClose();
  };

  useEffect(() => {
    if (!open || state.status !== "loading") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/assets", { cache: "no-store" });
        const result = (await response.json().catch(() => ({}))) as {
          assets?: CloudinaryAsset[];
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !result.assets) {
          setState({ status: "error", message: result.error ?? "Could not load assets." });
          return;
        }
        setState({
          status: "ready",
          assets: result.assets.slice(0, PALETTE_ASSET_LIMIT),
          truncated: result.assets.length > PALETTE_ASSET_LIMIT,
        });
      } catch (cause) {
        if (!cancelled) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Could not load assets.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, state.status]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // z-40: above the page content (strips top out at z-30) but BELOW
    // dnd-kit's DragOverlay (z-index 999) — the drag ghost must float over
    // this drawer, not under it.
    <section
      aria-label="Asset palette"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40"
    >
      <aside
        role="dialog"
        aria-modal="false"
        aria-label="Asset palette"
        className="pointer-events-auto ml-[72px] flex max-h-[38vh] flex-col border-t border-zinc-800 bg-zinc-950 p-3 text-white shadow-2xl shadow-black/50"
      >
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Assets
          </h3>
          <span className="text-[10px] text-zinc-600">
            Drag a thumbnail into any timeline · Enter picks one up for keyboard placement
          </span>
          <span className="grow" />
          <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
        {state.status === "loading" && (
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-24 w-36 shrink-0 animate-pulse rounded-md bg-zinc-900"
              />
            ))}
          </div>
        )}
        {state.status === "error" && (
          <div className="flex items-center gap-3 rounded-md border border-zinc-800 px-3 py-2">
            <p className="text-xs text-zinc-500">{state.message}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setState({ status: "loading" })}
            >
              Retry
            </Button>
          </div>
        )}
        {state.status === "ready" &&
          (state.assets.length === 0 ? (
            <p className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-500">
              No assets yet — upload some from the asset library on the storyboard view.
            </p>
          ) : (
            <>
              <PaletteRail assets={state.assets} />
              {state.truncated && (
                <p className="mt-1 text-[10px] text-zinc-600">
                  Showing the newest {PALETTE_ASSET_LIMIT} assets — the full library is on the
                  storyboard view.
                </p>
              )}
            </>
          ))}
      </aside>
    </section>,
    document.body,
  );
}

// ── Playback preview ────────────────────────────────────────────────────────
// The graph view drives the SAME preview surface the legacy workbench uses
// (WorkbenchSplitPane: player + transport + draggable divider), fed with the
// focused timeline's clips projected from the graph at commit cadence. Two
// render-cost decisions keep playback cheap:
//
//   - The board rides through PreviewShell as `children`, so the per-frame
//     time state inside the shell never re-renders a single card (stable
//     children identity skips the whole subtree).
//   - The strip's playhead paints IMPERATIVELY: time ticks travel a
//     ref-backed channel (never React state), and the line's transform is
//     written directly — the documented createTimeToOffset pattern.

type PreviewTimeChannel = Readonly<{
  get: () => number;
  set: (time: number) => void;
  subscribe: (listener: () => void) => () => void;
}>;

function createPreviewTimeChannel(): PreviewTimeChannel {
  let time = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    set: (next) => {
      time = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Bidirectional playback-time ↔ content-x map over the SAME clips
 * projection the preview pane plays. This matters: the pane's clock runs
 * over the projected TimelineClips — packing gaps and collection durations
 * included — so the playhead must map that clock, not the engine's
 * media-only contiguous one, or it drifts around collections and gaps.
 * Widths use the strip's own conversions (durationToWidth for media at
 * TIMELINE_PPS, the 128px default card for collections), interpolating
 * linearly inside each clip and across each gap.
 */
type PlayheadMap = Readonly<{
  xAt: (time: number) => number;
  timeAt: (x: number) => number;
  totalDurationSeconds: number;
}>;

const STRIP_GAP_PX = 8; // VirtualStrip's default gap
const COLLECTION_CARD_PX = 128; // VirtualStrip's default itemWidth

function buildPlayheadMap(clips: readonly TimelineClip[]): PlayheadMap {
  // Piecewise-linear anchors (t, x) at every clip edge; gaps between clips
  // span their own time (CLIP_GAP_SECONDS) across the strip's gap pixels.
  const times: number[] = [];
  const xs: number[] = [];
  let x = 0;
  for (const clip of clips) {
    const width =
      clip.kind === "collection"
        ? Math.max(MIN_ITEM_WIDTH, COLLECTION_CARD_PX)
        : durationToWidth(clip.duration, TIMELINE_PPS);
    times.push(clip.startTime, clip.startTime + clip.duration);
    xs.push(x, x + width);
    x += width + STRIP_GAP_PX;
  }
  const count = times.length;
  const total = count > 0 ? times[count - 1] : 0;

  const lerp = (value: number, from: number[], to: number[]): number => {
    if (count === 0) return 0;
    if (value <= from[0]) return to[0];
    if (value >= from[count - 1]) return to[count - 1];
    let lo = 0;
    let hi = count - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (from[mid] <= value) lo = mid;
      else hi = mid;
    }
    const span = from[hi] - from[lo];
    const fraction = span > 0 ? (value - from[lo]) / span : 0;
    return to[lo] + fraction * (to[hi] - to[lo]);
  };

  return {
    xAt: (time) => lerp(time, times, xs),
    timeAt: (offset) => lerp(offset, xs, times),
    totalDurationSeconds: total,
  };
}

// Grid surface cell geometry — must match the <VirtualGrid> props below and
// its default gap, since the playhead maps time onto that exact layout.
const GRID_CELL_W = 160;
const GRID_CELL_H = 96;
const GRID_GAP = 8;

/**
 * The grid analog of buildPlayheadMap. In the grid every cell is the SAME
 * width regardless of the clip's duration, so time maps onto a cell as a
 * fraction of that constant width, and the playhead advances cell-by-cell,
 * wrapping down a row every `cols` clips. `timeAt` is 2D — column from x AND
 * row from y — so a scrub can move within a row or jump rows.
 */
type GridPlayheadMap = Readonly<{
  posAt: (time: number) => { x: number; y: number };
  timeAt: (x: number, y: number) => number;
  totalDurationSeconds: number;
  rowHeight: number;
}>;

function buildGridPlayheadMap(clips: readonly TimelineClip[], cols: number): GridPlayheadMap {
  const columns = Math.max(1, cols);
  const starts: number[] = [];
  const ends: number[] = [];
  for (const clip of clips) {
    starts.push(clip.startTime);
    ends.push(clip.startTime + clip.duration);
  }
  const n = clips.length;
  const total = n > 0 ? ends[n - 1] : 0;
  const cellX = (i: number) => (i % columns) * (GRID_CELL_W + GRID_GAP);
  const cellY = (i: number) => Math.floor(i / columns) * (GRID_CELL_H + GRID_GAP);
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

  return {
    rowHeight: GRID_CELL_H,
    totalDurationSeconds: total,
    posAt: (time) => {
      if (n === 0) return { x: 0, y: 0 };
      // Last clip whose start <= time (binary search); time landing in the
      // gap after a clip clamps to that clip's right edge.
      let lo = 0;
      if (time >= starts[n - 1]) {
        lo = n - 1;
      } else if (time > starts[0]) {
        let hi = n - 1;
        while (lo < hi - 1) {
          const mid = (lo + hi) >> 1;
          if (starts[mid] <= time) lo = mid;
          else hi = mid;
        }
      }
      const span = ends[lo] - starts[lo];
      const frac = span > 0 ? clamp01((time - starts[lo]) / span) : 0;
      return { x: cellX(lo) + frac * GRID_CELL_W, y: cellY(lo) };
    },
    timeAt: (x, y) => {
      if (n === 0) return 0;
      const row = Math.max(0, Math.floor(y / (GRID_CELL_H + GRID_GAP)));
      const col = Math.max(0, Math.min(columns - 1, Math.floor(x / (GRID_CELL_W + GRID_GAP))));
      const i = Math.max(0, Math.min(n - 1, row * columns + col));
      const frac = clamp01((x - cellX(i)) / GRID_CELL_W);
      return Math.min(total, Math.max(0, starts[i] + frac * (ends[i] - starts[i])));
    },
  };
}

/** The red playhead over the focused strip — a line with a triangle cap,
 *  strictly presentational (the strip overlay layer is aria-hidden and
 *  pointer-events: none; scrubbing lives in PlayheadScrubBand outside the
 *  strip). Rebuilds its map when the graph identity changes (commits AND
 *  hydration), repaints on every channel tick — no React render on either. */
function GraphPlayhead({
  focusedId,
  details,
  channel,
}: Readonly<{ focusedId: string; details: DetailsById; channel: PreviewTimeChannel }>) {
  const store = useCollectionsStore();
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let lastGraph: CollectionsGraph | null = null;
    let map: PlayheadMap | null = null;
    const paint = () => {
      const graph = store.getSnapshot().graph;
      if (graph !== lastGraph) {
        lastGraph = graph;
        map = buildPlayheadMap(graphChildrenToClips(graph, details, focusedId));
      }
      const line = lineRef.current;
      if (line && map) line.style.transform = `translateX(${map.xAt(channel.get())}px)`;
    };
    paint();
    const unsubscribeTime = channel.subscribe(paint);
    const unsubscribeStore = store.subscribe(paint);
    return () => {
      unsubscribeTime();
      unsubscribeStore();
    };
  }, [store, focusedId, details, channel]);

  return (
    <div
      ref={lineRef}
      data-graph-playhead
      className="absolute inset-y-0 left-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
    >
      {/* Triangle cap: lifted into the strip's top padding (p-2 = 8px, the
          triangle's exact height) so it sits ABOVE the items, tip meeting the
          line at their top edge. Absolute, so it still costs no layout. */}
      <div
        className="absolute -left-[5px] -top-2 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500"
      />
    </div>
  );
}

/**
 * The interactive scrub surface: a thin band overlaying the strip's top
 * edge (absolute — no layout shift). The strip's own overlay layer is
 * contractually non-interactive, so the triangle/line VISUALS ride there
 * while THIS band owns the pointer: press or drag anywhere on it to seek —
 * the drag starts wherever the playhead triangle is, which is what makes
 * the triangle feel draggable.
 */
function PlayheadScrubBand({
  focusedId,
  details,
  channel,
}: Readonly<{ focusedId: string; details: DetailsById; channel: PreviewTimeChannel }>) {
  const store = useCollectionsStore();
  const bandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    // The strip's scroll container is the band's next sibling subtree; the
    // seek math needs its live scrollLeft and content origin per event.
    const scroller = band.parentElement?.querySelector<HTMLElement>(".overflow-x-auto") ?? null;
    if (!scroller) return;

    let map: PlayheadMap | null = null;
    let mapGraph: CollectionsGraph | null = null;
    const seek = (event: PointerEvent) => {
      const graph = store.getSnapshot().graph;
      if (graph !== mapGraph || !map) {
        mapGraph = graph;
        map = buildPlayheadMap(graphChildrenToClips(graph, details, focusedId));
      }
      const rect = scroller.getBoundingClientRect();
      const styles = getComputedStyle(scroller);
      const contentX =
        event.clientX -
        rect.left -
        parseFloat(styles.borderLeftWidth) -
        parseFloat(styles.paddingLeft) +
        scroller.scrollLeft;
      channel.set(Math.max(0, Math.min(map.timeAt(contentX), map.totalDurationSeconds)));
    };

    let pointerId: number | null = null;
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) seek(event);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    const handleDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId;
      try {
        band.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointer — window listeners suffice */
      }
      seek(event);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };

    band.addEventListener("pointerdown", handleDown);
    return () => {
      band.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [store, focusedId, details, channel]);

  return (
    <div
      ref={bandRef}
      data-playhead-scrub
      aria-hidden="true"
      className="absolute inset-x-0 top-0 z-10 h-3 cursor-ew-resize"
    />
  );
}

/**
 * The grid playhead: a one-row-tall red line inside the grid's content
 * overlay (so it scrolls with the rows and the scroller's overflow clips it
 * when its row is off-screen). It moves through the active cell as time
 * advances and jumps to the next cell/row on clip boundaries. Column count
 * comes from the grid's own `data-grid-columns`, so the map rebuilds when a
 * resize reflows the grid. Painted imperatively — no React render per tick.
 */
function GraphGridPlayhead({
  focusedId,
  details,
  channel,
}: Readonly<{ focusedId: string; details: DetailsById; channel: PreviewTimeChannel }>) {
  const store = useCollectionsStore();
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const grid = line.closest<HTMLElement>("[data-virtual-grid]");

    let lastGraph: CollectionsGraph | null = null;
    let lastCols = 0;
    let map: GridPlayheadMap | null = null;
    const paint = () => {
      const graph = store.getSnapshot().graph;
      const cols = Number(grid?.dataset.gridColumns) || 1;
      if (graph !== lastGraph || cols !== lastCols) {
        lastGraph = graph;
        lastCols = cols;
        map = buildGridPlayheadMap(graphChildrenToClips(graph, details, focusedId), cols);
      }
      if (!map) return;
      const { x, y } = map.posAt(channel.get());
      line.style.transform = `translate(${x}px, ${y}px)`;
      line.style.height = `${map.rowHeight}px`;
    };
    paint();

    const unsubscribeTime = channel.subscribe(paint);
    const unsubscribeStore = store.subscribe(paint);
    // Responsive columns can change on resize with no store/graph change.
    const observer = grid ? new ResizeObserver(paint) : null;
    if (grid && observer) observer.observe(grid);
    return () => {
      unsubscribeTime();
      unsubscribeStore();
      observer?.disconnect();
    };
  }, [store, focusedId, details, channel]);

  return (
    <div
      ref={lineRef}
      data-graph-grid-playhead
      className="absolute left-0 top-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
    >
      <div className="absolute -left-[5px] -top-2 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
    </div>
  );
}

/**
 * The grid scrub surface: a full-grid pointer layer (the grid has no per-row
 * top gutter the way the strip does, and the user scrubs BOTH axes — column
 * within a row, row by dragging vertically). It reads content coordinates
 * off the overlay wrapper (same rect as the scrolling spacer, so scroll is
 * already folded in) and seeks through the 2D map. Because it overlays the
 * cards, wheel events are forwarded to the grid so it still scrolls while
 * previewing.
 *
 * Trade-off: covering the cards means item drag/reorder is paused while
 * Preview is on in grid mode — toggle Preview off to rearrange.
 */
function GraphGridScrubSurface({
  focusedId,
  details,
  channel,
}: Readonly<{ focusedId: string; details: DetailsById; channel: PreviewTimeChannel }>) {
  const store = useCollectionsStore();
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const grid = surface.parentElement?.querySelector<HTMLElement>("[data-virtual-grid]") ?? null;
    if (!grid) return;

    let map: GridPlayheadMap | null = null;
    let mapGraph: CollectionsGraph | null = null;
    let mapCols = 0;
    const seek = (event: PointerEvent) => {
      const graph = store.getSnapshot().graph;
      const cols = Number(grid.dataset.gridColumns) || 1;
      if (graph !== mapGraph || cols !== mapCols || !map) {
        mapGraph = graph;
        mapCols = cols;
        map = buildGridPlayheadMap(graphChildrenToClips(graph, details, focusedId), cols);
      }
      // The overlay wrapper shares the scrolling spacer's rect, so its top/
      // left already fold in scroll position and container padding.
      const overlay = grid.querySelector<HTMLElement>("[data-virtual-grid-overlay]");
      const rect = (overlay ?? grid).getBoundingClientRect();
      channel.set(map.timeAt(event.clientX - rect.left, event.clientY - rect.top));
    };

    let pointerId: number | null = null;
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) seek(event);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    const handleDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId;
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointer — window listeners suffice */
      }
      seek(event);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };
    // Forward wheel to the grid so it still scrolls under the surface. The
    // grid scroller is a SIBLING subtree, not this surface's scroll ancestor,
    // so the browser's default action would scroll the page while we scroll
    // the grid — a double scroll. Non-passive + preventDefault exactly when
    // the grid consumed the delta; at the grid's boundary the default stands
    // so the page scrolls naturally.
    const handleWheel = (event: WheelEvent) => {
      // deltaMode 1 = lines (e.g. Firefox wheel); normalize to pixels.
      const scale = event.deltaMode === 1 ? 32 : 1;
      const before = grid.scrollTop;
      const max = grid.scrollHeight - grid.clientHeight;
      const next = Math.max(0, Math.min(before + event.deltaY * scale, max));
      if (next !== before) {
        grid.scrollTop = next;
        event.preventDefault();
      }
    };

    surface.addEventListener("pointerdown", handleDown);
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      surface.removeEventListener("pointerdown", handleDown);
      surface.removeEventListener("wheel", handleWheel);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [store, focusedId, details, channel]);

  return (
    <div
      ref={surfaceRef}
      data-grid-scrub
      aria-hidden="true"
      className="absolute inset-0 z-10 cursor-crosshair"
    />
  );
}

/**
 * Keeps the legacy documents context in step with the gateway cache. The
 * preview surface resolves COLLECTION clips' frames through
 * useTimelineDocuments() — without a synced provider it would fall back to
 * the read-only demo store and show the wrong content. Registration only
 * (persist: false): the gateway already owns persistence.
 */
function GatewayDocumentsBridge() {
  const { registerTimelineDocument } = useTimelineDocuments();
  const seenRef = useRef<Readonly<Record<string, TimelineDocument>>>({});

  useEffect(() => {
    const sync = () => {
      const seen = seenRef.current;
      const current = graphDocumentsGateway.read();
      if (current === seen) return;
      for (const [id, doc] of Object.entries(current)) {
        if (seen[id] !== doc) registerTimelineDocument(doc, { persist: false });
      }
      seenRef.current = current;
    };
    sync();
    return graphDocumentsGateway.subscribe(sync);
  }, [registerTimelineDocument]);

  return null;
}

function PreviewShell({
  enabled,
  focusedId,
  details,
  channel,
  children,
}: Readonly<{
  enabled: boolean;
  focusedId: string;
  details: DetailsById;
  channel: PreviewTimeChannel;
  children: React.ReactNode;
}>) {
  // Commit-cadence projection: graph identity changes only per committed
  // change/hydration, so this recomputes exactly when the clips could have.
  const graph = useCollectionsSelector((s) => s.graph);
  const clips = useMemo<TimelineClip[]>(
    () => (enabled ? graphChildrenToClips(graph, details, focusedId) : []),
    [enabled, graph, details, focusedId],
  );

  // Per-frame time lives HERE (the pane is a controlled player); `children`
  // keeps its identity across these renders, so the board subtree skips.
  // The CHANNEL is the time bus both directions converge on: the pane's
  // transport writes it via handleTimeChange, the scrub band writes it
  // directly — and this subscription folds either back into the pane's
  // controlled clock (same-value sets bail, so no feedback loop).
  const [time, setTime] = useState(0);
  useEffect(() => channel.subscribe(() => setTime(channel.get())), [channel]);
  const handleTimeChange = useCallback(
    (next: number) => {
      setTime(next);
      channel.set(next);
    },
    [channel],
  );

  // Time state and the channel outlive drill-in (the provider lives in a
  // persistent layout), but a DIFFERENT focused timeline is a different
  // clock: without a reset, drilling from 60s into a 10s timeline parks the
  // transport at "60 / 10" with the playhead pinned to the end. Both
  // effects write only the CHANNEL (the external clock) — the local `time`
  // state follows through the subscription above, which is also what keeps
  // the playhead and scrub surfaces in step.
  useEffect(() => {
    channel.set(0);
  }, [channel, focusedId]);

  // Edits can also shorten the projection UNDER a parked playhead (trim,
  // delete, undo) — clamp to the new end rather than pointing past it.
  const totalDuration =
    clips.length > 0 ? clips[clips.length - 1].startTime + clips[clips.length - 1].duration : 0;
  useEffect(() => {
    if (channel.get() > totalDuration) channel.set(totalDuration);
  }, [channel, totalDuration]);

  // Created ONCE (lazy useState), never per render: the provider consumes
  // initialState only on its first render, and this component re-renders on
  // every playback tick (up to 30Hz) — building it inline JSON-cloned every
  // cached document per frame just to throw the result away. Documents that
  // land after this snapshot are covered by GatewayDocumentsBridge, which
  // sweeps the full gateway cache on every provider mount.
  const [initialDocumentsState] = useState(() =>
    createTimelineDocumentsState({ ...graphDocumentsGateway.read() }, {}),
  );

  if (!enabled) return <>{children}</>;

  return (
    <TimelineDocumentsProvider initialState={initialDocumentsState}>
      <GatewayDocumentsBridge />
      <WorkbenchSplitPane clips={clips} currentTime={time} onCurrentTimeChange={handleTimeChange}>
        {children}
      </WorkbenchSplitPane>
    </TimelineDocumentsProvider>
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
  const nav = useContext(GraphViewNavContext);

  if (node.kind === "collection") {
    const detail = nav?.details[id as string];
    const hydrated = detail?.hydrated === true;
    const count = hydrated ? childCount : (detail?.itemCount ?? childCount);
    const previews = detail?.previewItems?.slice(0, 3) ?? [];
    return (
      <span
        title="Double-click (or press O) to open this timeline"
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
 * The write path AND the gate-until-hydrated policy, in one subscriber:
 *
 * - A command (or redo) that places content INTO an un-hydrated placeholder
 *   is BOUNCED — undone on the spot with a rejection flash and an
 *   announcement. Letting it stand would block the collection's hydration
 *   (the engine refuses to fill a non-empty collection) and eventually let
 *   a write clobber the stored document. Eager visible hydration
 *   (HydrationController) makes this a rare fetch-latency race, not the
 *   common path.
 * - Everything else is written patch-scoped: only the touched documents,
 *   and never one whose clips haven't loaded (`hydrated: false`).
 *
 * Lives INSIDE the provider (unlike an `onChange` prop) because bouncing
 * needs the store; `subscribeToChanges` supports reentrant dispatch, so
 * undoing from within the feed is safe and ordered.
 */
function PersistenceBridge({
  details,
  onDetails,
  onSync,
}: Readonly<{
  details: DetailsById;
  onDetails: (merged: Readonly<Record<string, ClipDetail>>) => void;
  onSync: (entry: SyncEntry) => void;
}>) {
  const store = useCollectionsStore();
  const { announce } = useCollectionsContainer();
  const detailsRef = useRef(details);
  useEffect(() => {
    detailsRef.current = details;
  });

  useEffect(
    () =>
      store.subscribeToChanges((change) => {
        let current = detailsRef.current;

        // A committed palette add claims its parked detail BEFORE the write
        // below, so poster/aspect round-trip into the very first PATCH.
        if (change.patch.type === "nodes-added") {
          let claimed: Record<string, ClipDetail> | null = null;
          for (const add of change.patch.adds) {
            const detail = pendingPaletteDetails.get(add.node.id as string);
            if (detail) {
              (claimed ??= {})[add.node.id as string] = detail;
              pendingPaletteDetails.delete(add.node.id as string);
            }
          }
          if (claimed) {
            current = { ...current, ...claimed };
            onDetails(claimed);
          }
        }

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
          (id) => graphDocumentsGateway.peek(id) !== null && current[id]?.hydrated !== false,
        );
        for (const id of affected) {
          graphDocumentsGateway.writeClips(id, graphChildrenToClips(change.graph, current, id));
        }
        onSync({
          at: Date.now(),
          origin: change.origin,
          patchType: change.patch.type,
          collections: affected,
        });
      }),
    [store, announce, onDetails, onSync],
  );

  return null;
}

// ── Persistence sync panel ──────────────────────────────────────────────────

function SyncPanel({ entries }: { entries: readonly SyncEntry[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Patch-scoped document writes
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          No writes yet — reorder, trim, nest, or undo and watch which timeline documents are
          QUEUED for a PATCH (writes debounce briefly and any failure appears in the banner
          above). Hydration never appears here: loading data is not a change worth writing back.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-zinc-400">
          {entries.map((entry) => (
            <li key={entry.at} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-zinc-100">{entry.origin}</span>
              <span>{entry.patchType}</span>
              <span aria-hidden="true">→</span>
              {entry.bounced ? (
                <span className="text-amber-400">
                  reverted — {entry.collections.join(", ")} still loading
                </span>
              ) : (
                <span className="text-sky-400">
                  {entry.collections.length === 0
                    ? "(nothing stored)"
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
  | Readonly<{
      status: "ready";
      graph: CollectionsGraph;
      details: DetailsById;
      /** The trash collection's root id, when its document loaded. */
      trashRootId: string | null;
    }>;

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
  // Playback preview: the workbench split pane above the board, plus the
  // strip playhead. Per-view state (survives drill-ins with the provider);
  // the time channel is ref-backed so ticks never render React.
  const [previewOn, setPreviewOn] = useState(false);
  const [timeChannel] = useState(createPreviewTimeChannel);
  // The asset palette drawer — opened by the board's Assets button OR the
  // app sidebar's Assets launcher (which hands off via a window event on
  // graph routes; see lib/graph-view-events.ts).
  const [assetsOpen, setAssetsOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setAssetsOpen((current) => !current);
    window.addEventListener(GRAPH_ASSETS_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(GRAPH_ASSETS_TOGGLE_EVENT, toggle);
  }, []);
  const gatewayError = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.lastError,
    graphDocumentsGateway.lastError,
  );

  // Boot: fetch the project's document AND the user's trash document, then
  // build a TWO-root graph — the project timeline and the trash collection.
  // Trash is just another stored collection document (`trash-<uid>`), so
  // drops onto <TrashTarget> are ordinary moves between roots: undoable,
  // and persisted by the same patch-scoped write path. Referenced child
  // timelines start as placeholders — fetched on focus/expand.
  const { user } = useAuth();
  const trashDocId = user ? `trash-${user.uid}` : null;
  useEffect(() => {
    if (trashDocId === null) return; // auth still resolving (AuthGate guarantees a user)
    // Entering the graph view must not trust the session cache: edits made in
    // the storyboard view (or another tab) since the last graph session would
    // otherwise be overwritten by full-document PATCHes built from stale
    // content. `refresh` flushes pending writes and marks every cached id
    // stale, so the `ensure` calls below (and hydrate-on-focus) refetch.
    graphDocumentsGateway.refresh();
    let cancelled = false;
    void (async () => {
      const [projectDoc, trashDoc] = await Promise.all([
        graphDocumentsGateway.ensure(projectId),
        graphDocumentsGateway.ensure(trashDocId),
      ]);
      if (cancelled) return;
      if (!projectDoc) {
        setBoot({
          status: "error",
          message:
            graphDocumentsGateway.lastError() ?? `Project timeline "${projectId}" did not load.`,
        });
        return;
      }

      const projectSpecs = buildHydrationSpecs(graphDocumentsGateway.read(), projectId, 0);
      if (!projectSpecs.ok) {
        setBoot({ status: "error", message: projectSpecs.error });
        return;
      }
      const projectRoot: GraphNodeSpec = {
        kind: "collection",
        id: projectId,
        name: projectDoc.title,
        children: projectSpecs.value.specs,
      };
      let bootDetails: Record<string, ClipDetail> = { ...projectSpecs.value.details };

      // Trash root — hydrated in FULL at boot: patch-scoped writes replace a
      // document wholesale, so the graph must hold everything the stored
      // trash holds before a write may touch it.
      let trashRootId: string | null = null;
      let roots: GraphNodeSpec[] = [projectRoot];
      if (trashDoc) {
        const trashSpecs = buildHydrationSpecs(graphDocumentsGateway.read(), trashDocId, 0, [
          projectId,
          ...Object.keys(bootDetails),
        ]);
        if (trashSpecs.ok) {
          roots = [
            projectRoot,
            {
              kind: "collection",
              id: trashDocId,
              name: trashDoc.title || "Trash Bin",
              children: trashSpecs.value.specs,
            },
          ];
          bootDetails = {
            ...bootDetails,
            ...trashSpecs.value.details,
            [trashDocId]: { ...FALLBACK_DETAIL, hydrated: true },
          };
          trashRootId = trashDocId;
        }
      }

      let built = buildGraph(roots);
      if (!built.ok && trashRootId !== null) {
        // Id collision between trash content and the project (stale trash
        // data): boot WITHOUT trash rather than not at all.
        trashRootId = null;
        built = buildGraph([projectRoot]);
      }
      if (!built.ok) {
        setBoot({ status: "error", message: JSON.stringify(built.error) });
        return;
      }
      setDetails(bootDetails);
      setBoot({ status: "ready", graph: built.value, details: bootDetails, trashRootId });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, trashDocId]);

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
        // The provider lives in a persistent layout (undo survives drill-in),
        // so an unbounded history would retain every patch — including
        // removed-node payloads — for the whole session. 200 undo steps is
        // far beyond practical use while keeping memory flat.
        maxHistoryEntries={200}
      >
        <PersistenceBridge details={details} onDetails={onDetails} onSync={onSync} />
        {/* Portaled to document.body, but rendered HERE so the PaletteItems
            stay inside the provider's dnd context (portals keep it). */}
        <AssetPaletteDrawer open={assetsOpen} onClose={() => setAssetsOpen(false)} />
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
            <OpenKeyBoundary>
            <PreviewShell
              enabled={previewOn}
              focusedId={focusedId}
              details={details}
              channel={timeChannel}
            >
            <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  Press-and-hold to drag (cross-timeline included) · amber edges trim ·
                  double-click (or O) a dashed clip to focus it · undo survives drill-in.
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={previewOn}
                    onClick={() => setPreviewOn((current) => !current)}
                  >
                    Preview
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={assetsOpen}
                    onClick={() => setAssetsOpen((current) => !current)}
                  >
                    Assets
                  </Button>
                  <SurfaceToggle surface={surface} onChange={setSurface} />
                  <UndoRedoControls />
                </div>
              </div>
              {surface === "strip" ? (
                // relative wrapper: the scrub band overlays the strip's top
                // edge (absolute — no layout shift). Playhead VISUALS ride
                // the strip's presentational overlay; the band owns pointers.
                <div className="relative">
                  <VirtualStrip
                    collectionId={parseNodeId(focusedId)}
                    pixelsPerSecond={TIMELINE_PPS}
                    itemHeight={88}
                    itemDragActivation="hold"
                    overlay={
                      previewOn ? (
                        <GraphPlayhead
                          focusedId={focusedId}
                          details={details}
                          channel={timeChannel}
                        />
                      ) : undefined
                    }
                    className="bg-black/25"
                  />
                  {previewOn && (
                    <PlayheadScrubBand
                      focusedId={focusedId}
                      details={details}
                      channel={timeChannel}
                    />
                  )}
                </div>
              ) : (
                // Same graph, same provider — dragging between this grid and
                // the sub-timeline strips below is native. In Preview the
                // playhead rides the grid's content overlay and the scrub
                // surface owns pointers (see GraphGridScrubSurface).
                <div className="relative">
                  <VirtualGrid
                    collectionId={parseNodeId(focusedId)}
                    cellWidth={GRID_CELL_W}
                    cellHeight={GRID_CELL_H}
                    gap={GRID_GAP}
                    height={420}
                    overlay={
                      previewOn ? (
                        <GraphGridPlayhead
                          focusedId={focusedId}
                          details={details}
                          channel={timeChannel}
                        />
                      ) : undefined
                    }
                    className="bg-black/25"
                  />
                  {previewOn && (
                    <GraphGridScrubSurface
                      focusedId={focusedId}
                      details={details}
                      channel={timeChannel}
                    />
                  )}
                </div>
              )}
              <SubTimelines focusedId={focusedId} details={details} onDetails={onDetails} />
              {boot.trashRootId !== null && (
                <div className="flex items-end justify-end">
                  <div className="shrink-0">
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Trash
                    </h3>
                    {/* Drops here are ordinary moves into the trash-<uid>
                        document — undoable, persisted patch-scoped. Also
                        enables Alt+Delete on focused cards. */}
                    <TrashTarget trashId={parseNodeId(boot.trashRootId)} />
                  </div>
                </div>
              )}
              <SyncPanel entries={syncLog} />
            </div>
            </PreviewShell>
            </OpenKeyBoundary>
          )}
        </GraphViewNavProvider>
      </DndCollections>
    </div>
  );
}
