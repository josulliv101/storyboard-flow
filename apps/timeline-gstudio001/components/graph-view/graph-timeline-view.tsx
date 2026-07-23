"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  DndCollections,
  buildGraph,
  parseNodeId,
  type CollectionItemNode,
  type CollectionsGraph,
  type CommandPolicy,
  type GraphNodeSpec,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  buildHydrationSpecs,
  collectUnhydratedDropTargets,
  type ClipDetail,
} from "@storyboard/timeline-domain";

import { useAuth } from "@/components/auth/auth-provider";
import { createGraphDetailsStore } from "@/lib/graph-details-store";
import {
  graphDocumentsGateway,
  type GraphServerPayload,
} from "@/lib/graph-documents-gateway";
import {
  GRAPH_ASSETS_TOGGLE_EVENT,
  GRAPH_CHILDREN_TOGGLE_EVENT,
  GRAPH_PREVIEW_TOGGLE_EVENT,
  GRAPH_RULER_TOGGLE_EVENT,
  GRAPH_SURFACE_EVENT,
  broadcastGraphViewState,
  type GraphSurface,
} from "@/lib/graph-view-events";

import { AssetPaletteDrawer } from "./graph-asset-palette";
import { toast } from "@/components/core/sonner";

import { bootSessionKey } from "./boot-session-key";
import { trashDocumentId as deriveTrashDocumentId } from "./trash-document-id";

import { GraphBoard, type FocusSurface, type ItemSize } from "./graph-board";
import { GraphDetailsProvider } from "./graph-details-context";
import { HydrationController } from "./graph-hydration";
import { GRAPH_VIEW_COMPONENTS } from "./graph-item-content";
import { GraphViewNavProvider } from "./graph-navigation";
import {
  GraphDetailsJanitor,
  PersistenceBridge,
  type SyncEntry,
} from "./graph-persistence";
import { unparkPendingDetail } from "./graph-pending-details";
import { createPreviewTimeChannel } from "./graph-preview";
import {
  DEFAULT_ITEM_SIZE,
  DEFAULT_TIMELINE_PPS,
  FALLBACK_DETAIL,
} from "./graph-view-config";
import { GraphBreadcrumb } from "./graph-view-chrome";

type BootState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      graph: CollectionsGraph;
      trashRootId: string | null;
      // Identity of the session this graph belongs to. Rides along with the
      // graph so the <DndCollections> remount key changes atomically with the
      // graph it consumes (initialGraph is initial-only), never before it.
      sessionKey: string;
    }>;

/**
 * Session orchestration for the graph route. Feature behavior lives in the
 * sibling graph-* modules; this root owns only boot data and durable view state.
 */
export function GraphTimelineView({
  projectId,
  bootstrap,
}: {
  projectId: string;
  /** Server-read boot payloads (RSC layout). Null = no session at render
   *  time; the legacy fetch boot covers it. */
  bootstrap?: readonly GraphServerPayload[] | null;
}) {
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
  const [detailsStore] = useState(() => createGraphDetailsStore());
  const [focusError, setFocusError] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<readonly SyncEntry[]>([]);
  // GRID is the load default (the sidebar's first icon); `?surface=strip`
  // lets a link land directly in strip mode. The graph tree mounts
  // client-only (`ssr: false` in client-graph-view), so useSearchParams has
  // no prerender/Suspense implications.
  const initialSurface = useSearchParams().get("surface");
  const [surface, setSurface] = useState<FocusSurface>(
    initialSurface === "strip" ? "strip" : "grid",
  );
  const [itemSize, setItemSize] = useState<ItemSize>(DEFAULT_ITEM_SIZE);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_TIMELINE_PPS);
  // Children timelines are OFF by default (the focused timeline is the
  // page's subject; the tree is opt-in) — the sidebar's children icon
  // mounts them.
  const [childrenShown, setChildrenShown] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [rulerOn, setRulerOn] = useState(false);
  const [timeChannel] = useState(createPreviewTimeChannel);
  const [assetsOpen, setAssetsOpen] = useState(false);

  useEffect(() => {
    const toggle = () => setAssetsOpen((current) => !current);
    window.addEventListener(GRAPH_ASSETS_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(GRAPH_ASSETS_TOGGLE_EVENT, toggle);
  }, []);

  // The sidebar owns the layout switch and the ruler toggle (its top icons /
  // tool cluster); it drives this state through request events…
  useEffect(() => {
    const onSurface = (event: Event) => {
      const detail = (event as CustomEvent<GraphSurface>).detail;
      if (detail === "strip" || detail === "grid") setSurface(detail);
    };
    const onRulerToggle = () => setRulerOn((current) => !current);
    const onChildrenToggle = () => setChildrenShown((current) => !current);
    const onPreviewToggle = () => setPreviewOn((current) => !current);
    window.addEventListener(GRAPH_SURFACE_EVENT, onSurface);
    window.addEventListener(GRAPH_RULER_TOGGLE_EVENT, onRulerToggle);
    window.addEventListener(GRAPH_CHILDREN_TOGGLE_EVENT, onChildrenToggle);
    window.addEventListener(GRAPH_PREVIEW_TOGGLE_EVENT, onPreviewToggle);
    return () => {
      window.removeEventListener(GRAPH_SURFACE_EVENT, onSurface);
      window.removeEventListener(GRAPH_RULER_TOGGLE_EVENT, onRulerToggle);
      window.removeEventListener(GRAPH_CHILDREN_TOGGLE_EVENT, onChildrenToggle);
      window.removeEventListener(GRAPH_PREVIEW_TOGGLE_EVENT, onPreviewToggle);
    };
  }, []);

  // …and this broadcast (on mount and every change) is what lets its
  // controls show the current surface, ruler, children, and preview state.
  useEffect(() => {
    broadcastGraphViewState({ surface, rulerOn, childrenShown, previewOn });
  }, [surface, rulerOn, childrenShown, previewOn]);

  const gatewayError = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.lastError,
    graphDocumentsGateway.lastError,
  );

  const { user } = useAuth();
  const uid = user ? user.uid : null;
  // Gate on presence (null = signed out), NOT truthiness: a signed-in user
  // with an empty-string uid still owns a trash document, and the boot effect
  // returns early when this is null — a truthiness check would strand that
  // user on the loading screen.
  const trashDocumentId = deriveTrashDocumentId(uid);

  // AUTH BINDING first: the gateway is a module singleton that outlives
  // soft logout/login, so a different signed-in user must reset it before
  // anything reads or primes. Declared before the prime and boot effects
  // so mount-order runs bind → prime → boot.
  useEffect(() => {
    if (user) graphDocumentsGateway.bindUser(user.uid);
  }, [user]);

  // RSC payloads prime the gateway (guarded inside it: only for the bound
  // user, never over local edits, never regressing the revision ledger).
  // `user` is a dep so payloads that arrived before the client-side auth
  // resolved get re-applied once the binding exists.
  useEffect(() => {
    for (const payload of bootstrap ?? []) {
      graphDocumentsGateway.prime(payload.document, payload.revision, payload.forUid);
    }
  }, [bootstrap, user]);
  // Whether THIS mount booted from server payloads — captured once: the
  // boot effect must not re-run when later layout renders replace the
  // bootstrap array's identity.
  const [bootedFromServer] = useState(
    () => bootstrap !== null && bootstrap !== undefined && bootstrap.length > 0,
  );

  useEffect(() => {
    if (trashDocumentId === null) return;

    // A server-primed boot IS fresh — re-marking the cache stale would just
    // refetch what the layout already read. The legacy path keeps its
    // don't-trust-the-session-cache refresh.
    if (!bootedFromServer) graphDocumentsGateway.refresh();
    let cancelled = false;
    void (async () => {
      const [projectDocument, trashDocument] = await Promise.all([
        graphDocumentsGateway.ensure(projectId),
        graphDocumentsGateway.ensure(trashDocumentId),
      ]);
      if (cancelled) return;
      if (!projectDocument) {
        setBoot({
          status: "error",
          message:
            graphDocumentsGateway.lastError() ??
            `Project timeline "${projectId}" did not load.`,
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
        name: projectDocument.title,
        children: projectSpecs.value.specs,
      };
      let bootDetails: Record<string, ClipDetail> = { ...projectSpecs.value.details };
      let trashRootId: string | null = null;
      let roots: GraphNodeSpec[] = [projectRoot];

      if (trashDocument) {
        const trashSpecs = buildHydrationSpecs(
          graphDocumentsGateway.read(),
          trashDocumentId,
          0,
          [projectId, ...Object.keys(bootDetails)],
        );
        if (trashSpecs.ok) {
          roots = [
            projectRoot,
            {
              kind: "collection",
              id: trashDocumentId,
              name: trashDocument.title || "Trash Bin",
              children: trashSpecs.value.specs,
            },
          ];
          bootDetails = {
            ...bootDetails,
            ...trashSpecs.value.details,
            [trashDocumentId]: { ...FALLBACK_DETAIL, hydrated: true },
          };
          trashRootId = trashDocumentId;
        }
      }

      let built = buildGraph(roots);
      if (!built.ok && trashRootId !== null) {
        trashRootId = null;
        built = buildGraph([projectRoot]);
      }
      if (!built.ok) {
        setBoot({ status: "error", message: JSON.stringify(built.error) });
        return;
      }

      detailsStore.replaceAll(bootDetails);
      setBoot({
        status: "ready",
        graph: built.value,
        trashRootId,
        sessionKey: bootSessionKey(uid, projectId),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, trashDocumentId, uid, detailsStore, bootedFromServer]);

  const onSync = useCallback((entry: SyncEntry) => {
    setSyncLog((log) => [entry, ...log].slice(0, 6));
  }, []);

  // Gate-until-hydrated, as a PRE-COMMIT veto. A collection whose stored
  // clips haven't loaded is an empty placeholder: content landing in it would
  // block its future hydration (the engine only fills an EMPTY collection)
  // and let the patch-scoped write overwrite the stored document with just
  // the new content.
  //
  // This has to run before the command commits. The previous design let the
  // drop commit and had the PersistenceBridge undo it back out, which is not
  // the same thing — committing clears the redo branch, so a bounced drop
  // silently threw away whatever the user still had to redo and left the
  // refused drop itself on the redo stack.
  //
  // Reads `detailsStore` live (it is a stable external store), so this
  // closure never goes stale. The onSync call is a deliberate exception to
  // the "pure predicate" rule — it feeds the SyncPanel's telemetry and fires
  // at most once per blocked dispatch.
  const commandPolicy = useCallback<CommandPolicy>(
    (command) => {
      const blocked = collectUnhydratedDropTargets(command, detailsStore.read());
      if (blocked.length === 0) return null;
      onSync({
        at: Date.now(),
        origin: "command",
        patchType: command.type === "add-nodes" ? "nodes-added" : "nodes-moved",
        collections: blocked,
        bounced: true,
      });
      // The SyncPanel entry above is developer telemetry. This is the part the
      // USER sees: without it a refused drop just silently snapped back, with
      // the explanation buried in a debug panel.
      const message = "That collection is still loading — drop again once its clips appear.";
      toast.error(message, { id: `blocked-${blocked.join(",")}` });
      return {
        reason: "blocked-by-policy",
        blockedIds: blocked.map(parseNodeId),
        message,
      };
    },
    [detailsStore, onSync],
  );

  // A palette drag's factory parks a ClipDetail under each minted id (see
  // graph-asset-palette.tsx). When the drag dies uncommitted — cancelled,
  // vetoed, orphaned — those ids can never exist, so release the metadata now
  // instead of leaving it until the NEXT palette drag happens to clear it.
  const handlePaletteDiscard = useCallback((nodes: readonly CollectionItemNode[]) => {
    for (const node of nodes) unparkPendingDetail(node.id as string);
  }, []);

  // Click-to-open (the pointer twin of the O key): the provider's
  // onOpenNode fires on a plain click on an open-target card — after the
  // package's gesture arbitration, so a drag, a hold-grab, or a pan never
  // opens. The actual focus logic lives in GraphViewNavProvider (it needs
  // the engine store, which only exists INSIDE <DndCollections>), so it
  // registers itself into this ref.
  const openNodeRef = useRef<(nodeId: NodeId) => void>(() => {});
  const handleOpenNode = useCallback((nodeId: NodeId) => openNodeRef.current(nodeId), []);
  // A plain click on a COLLECTION now SELECTS it (so it can be trashed with
  // Delete like any clip); its own folder button is the only pointer path
  // that drills in (see GraphClipContent). Duplicate-reference cards — media
  // standing in for a twice-referenced timeline — have no such button, so a
  // plain click still opens those. The O key opens both regardless
  // (OpenKeyBoundary), so keyboard drill-in is unchanged.
  const openOnClick = useCallback(
    (nodeId: NodeId) =>
      detailsStore.get(nodeId as string)?.duplicateOfTimelineId !== undefined,
    [detailsStore],
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
        <Link
          href="/"
          className="mt-3 inline-block text-xs text-red-200 underline underline-offset-4"
        >
          Back to Projects
        </Link>
      </div>
    );
  }

  // The old "Storyboard view" chrome row above the preview is gone — the
  // link lives in the board's overflow menu now, so the page starts at the
  // preview itself.
  const storyboardHref = `/timeline/${encodeURIComponent(projectId)}/storyboard${
    focusedId === projectId ? "" : `/${encodeURIComponent(focusedId)}`
  }`;

  return (
    <div className="flex flex-col gap-4">
      {gatewayError !== null && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {gatewayError}
        </p>
      )}

      {/* GraphDetailsProvider wraps DndCollections (not just its children) so
          the details store is reachable inside the drag OVERLAY too — the
          collection drag ghost reads a placeholder's stored preview frames
          there the same way the card does. */}
      <GraphDetailsProvider store={detailsStore}>
      <DndCollections
        // initialGraph is initial-only (the store is the source of truth
        // thereafter), so a boot re-run for a new session must remount to
        // adopt the freshly built graph. The key is stable across ordinary
        // renders and route drill-in — only a different uid/project changes
        // it — so undo history and selection survive navigation.
        key={boot.sessionKey}
        initialGraph={boot.graph}
        components={GRAPH_VIEW_COMPONENTS}
        maxHistoryEntries={200}
        // The interaction model: click toggles a clip's selection (trim
        // handles exist only while selected), click on a collection or
        // duplicate-reference card drills in, Ctrl/Cmd+click multi-selects,
        // press-and-hold drags — the package's arbitration keeps the four
        // from ever colliding.
        clickSelection="toggle"
        trimRequiresSelection
        // The drag ghost is a fixed 16:9 thumbnail of the item (see
        // GraphGhost): width AND height pinned so it shows the clip's own
        // frame at a stable landscape ratio, centred on the grabbed pixel,
        // instead of a duration-shaped card that (for a long clip) buried the
        // drop target it was aimed at. Kept SMALL so it doesn't cover the
        // breadcrumb drop zones the user is aiming the drag at.
        dragGhostWidth={72}
        dragGhostHeight={40}
        onOpenNode={handleOpenNode}
        openOnClick={openOnClick}
        commandPolicy={commandPolicy}
        onPaletteDiscard={handlePaletteDiscard}
      >
          <PersistenceBridge onSync={onSync} />
          <GraphDetailsJanitor />
          <AssetPaletteDrawer open={assetsOpen} onClose={() => setAssetsOpen(false)} />
          <HydrationController
            projectId={projectId}
            segments={timelinePath}
            serverPrimed={bootedFromServer}
            onFocusError={setFocusError}
          />

          <GraphViewNavProvider
            projectId={projectId}
            focusedId={focusedId}
            openNodeRef={openNodeRef}
          >
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
              <GraphBoard
                focusedId={focusedId}
                breadcrumb={
                  <GraphBreadcrumb projectId={projectId} timelinePath={timelinePath} />
                }
                surface={surface}
                itemSize={itemSize}
                onItemSizeChange={setItemSize}
                pixelsPerSecond={pixelsPerSecond}
                onPixelsPerSecondChange={setPixelsPerSecond}
                previewOn={previewOn}
                rulerOn={rulerOn}
                storyboardHref={storyboardHref}
                childrenShown={childrenShown}
                timeChannel={timeChannel}
                trashRootId={boot.trashRootId}
                syncEntries={syncLog}
              />
            )}
          </GraphViewNavProvider>
      </DndCollections>
      </GraphDetailsProvider>
    </div>
  );
}
