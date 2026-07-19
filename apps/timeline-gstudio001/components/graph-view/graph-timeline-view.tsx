"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { GRAPH_ASSETS_TOGGLE_EVENT } from "@/lib/graph-view-events";

import { AssetPaletteDrawer } from "./graph-asset-palette";
import { GraphBoard, type FocusSurface } from "./graph-board";
import { GraphDetailsProvider } from "./graph-details-context";
import { HydrationController } from "./graph-hydration";
import { GRAPH_VIEW_COMPONENTS } from "./graph-item-content";
import { GraphViewNavProvider } from "./graph-navigation";
import {
  GraphDetailsJanitor,
  PersistenceBridge,
  type SyncEntry,
} from "./graph-persistence";
import { createPreviewTimeChannel } from "./graph-preview";
import { FALLBACK_DETAIL } from "./graph-view-config";
import { GraphViewChrome } from "./graph-view-chrome";

type BootState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      graph: CollectionsGraph;
      trashRootId: string | null;
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
  const [surface, setSurface] = useState<FocusSurface>("strip");
  const [previewOn, setPreviewOn] = useState(false);
  const [timeChannel] = useState(createPreviewTimeChannel);
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

  const { user } = useAuth();
  const trashDocumentId = user ? `trash-${user.uid}` : null;

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
      setBoot({ status: "ready", graph: built.value, trashRootId });
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, trashDocumentId, detailsStore, bootedFromServer]);

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
      return {
        reason: "blocked-by-policy",
        blockedIds: blocked.map(parseNodeId),
        message: "That collection is still loading — drop again once its clips appear.",
      };
    },
    [detailsStore, onSync],
  );

  // Click-to-open (the pointer twin of the O key): the provider's
  // onOpenNode fires on a plain click on an open-target card — after the
  // package's gesture arbitration, so a drag, a hold-grab, or a pan never
  // opens. The actual focus logic lives in GraphViewNavProvider (it needs
  // the engine store, which only exists INSIDE <DndCollections>), so it
  // registers itself into this ref.
  const openNodeRef = useRef<(nodeId: NodeId) => void>(() => {});
  const handleOpenNode = useCallback((nodeId: NodeId) => openNodeRef.current(nodeId), []);
  // Collections open — and so do duplicate-reference cards (media cards
  // standing in for a timeline referenced twice; same set the O key uses).
  const openOnClick = useCallback(
    (nodeId: NodeId, node: CollectionItemNode) =>
      node.kind === "collection" ||
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
        maxHistoryEntries={200}
        // The interaction model: click toggles a clip's selection (trim
        // handles exist only while selected), click on a collection or
        // duplicate-reference card drills in, Ctrl/Cmd+click multi-selects,
        // press-and-hold drags — the package's arbitration keeps the four
        // from ever colliding.
        clickSelection="toggle"
        trimRequiresSelection
        onOpenNode={handleOpenNode}
        openOnClick={openOnClick}
        commandPolicy={commandPolicy}
      >
        <GraphDetailsProvider store={detailsStore}>
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
                surface={surface}
                onSurfaceChange={setSurface}
                previewOn={previewOn}
                onTogglePreview={() => setPreviewOn((current) => !current)}
                assetsOpen={assetsOpen}
                onToggleAssets={() => setAssetsOpen((current) => !current)}
                timeChannel={timeChannel}
                trashRootId={boot.trashRootId}
                syncEntries={syncLog}
              />
            )}
          </GraphViewNavProvider>
        </GraphDetailsProvider>
      </DndCollections>
    </div>
  );
}
