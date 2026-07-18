"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  DndCollections,
  buildGraph,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "@storyboard/ui/dnd-collections";
import { buildHydrationSpecs, type ClipDetail } from "@storyboard/timeline-domain";

import { useAuth } from "@/components/auth/auth-provider";
import { createGraphDetailsStore } from "@/lib/graph-details-store";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
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
export function GraphTimelineView({ projectId }: { projectId: string }) {
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

  useEffect(() => {
    if (trashDocumentId === null) return;

    graphDocumentsGateway.refresh();
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
  }, [projectId, trashDocumentId, detailsStore]);

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
      >
        <GraphDetailsProvider store={detailsStore}>
          <PersistenceBridge onSync={onSync} />
          <GraphDetailsJanitor />
          <AssetPaletteDrawer open={assetsOpen} onClose={() => setAssetsOpen(false)} />
          <HydrationController
            projectId={projectId}
            segments={timelinePath}
            onFocusError={setFocusError}
          />

          <GraphViewNavProvider projectId={projectId} focusedId={focusedId}>
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
