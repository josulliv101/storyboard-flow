"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
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
  ClearSelectionOnOutsideClick,
  DndCollections,
  buildGraph,
  getChildren,
  parseNodeId,
  useCollectionsStore,
  type CollectionItemNode,
  type CollectionsGraph,
  type AddNodesCommand,
  type CommandPolicy,
  type DropIntent,
  type GraphNodeSpec,
  type MoveNodesCommand,
  type SetNodePlacementCommand,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  buildHydrationSpecs,
  collectUnhydratedDropTargets,
  flattenMediaOrder,
  resolveFlatDropTarget,
  type ClipDetail,
} from "@storyboard/timeline-domain";

import { useAuth } from "@/components/auth/auth-provider";
import { graphClipboard } from "@/lib/graph-clipboard";
import { createGraphDetailsStore } from "@/lib/graph-details-store";
import {
  graphDocumentsGateway,
  type GraphServerPayload,
} from "@/lib/graph-documents-gateway";
import {
  GRAPH_PREVIEW_TOGGLE_EVENT,
  GRAPH_FLAT_TOGGLE_EVENT,
  GRAPH_SURFACE_EVENT,
  GRAPH_TRASH_EMPTIED_EVENT,
  broadcastGraphViewState,
  type GraphSurface,
} from "@/lib/graph-view-events";

import { toast } from "@/components/core/sonner";

import { bootSessionKey } from "./boot-session-key";
import { trashDocumentId as deriveTrashDocumentId } from "./trash-document-id";

import { GraphBoard, type FocusSurface, type ItemSize } from "./graph-board";
import { laneDropIndex, splitLaneRows } from "./graph-lane-rows";
import { withDefaultLayerFrame } from "./graph-layer-frame";
import { GraphViewLoadingSkeleton } from "./graph-view-loading";
import { GraphDetailsProvider } from "./graph-details-context";
import {
  BackgroundClosureHydrator,
  FlatClosureHydrator,
  HydrationController,
} from "./graph-hydration";
import { GraphItemActionsBridge } from "./graph-item-actions";
import { RemoteChangesBridge } from "./graph-remote-changes";
/**
 * LOADED AFTER THE PAINT, NOT BEFORE IT (PL15-027).
 *
 * This bridge registers the in-page agent tools, and it reaches
 * `lib/webmcp/tools.ts` — 650-odd lines of tool definitions built on `zod`.
 * Imported statically, every person who opens a board downloaded all of it
 * before anything appeared on screen, for a feature most sessions never use.
 * Measured on the production build: `zod` accounts for the bulk of a 307 kB
 * chunk, against a first paint that takes 3.3s while the server answers in
 * 0.13s.
 *
 * `ssr: false` because it is a browser-side registration with nothing to
 * render — there is no markup to stream and no fallback worth showing.
 *
 * NOT a behaviour change for an agent: the tools register a tick later than
 * they used to, and a connector that asks before then re-reads the list
 * anyway. Registration was never synchronous with the route from the agent's
 * side.
 */
const McpToolsBridge = dynamic(
  () => import("./graph-mcp-tools").then((m) => m.McpToolsBridge),
  { ssr: false },
);
import { GRAPH_VIEW_COMPONENTS } from "./graph-item-content";
import { GraphViewNavProvider } from "./graph-navigation";
import {
  GraphDetailsJanitor,
  PersistenceBridge,
  type SyncEntry,
} from "./graph-persistence";
import { HistoryPersistenceBridge } from "./graph-history-persistence";
import { createPreviewTimeChannel } from "./graph-preview";
import {
  DEFAULT_ITEM_SIZE,
  DEFAULT_TIMELINE_PPS,
  FALLBACK_DETAIL,
  MAX_SUBTREE_DEPTH,
} from "./graph-view-config";
import { GraphBreadcrumb } from "./graph-view-chrome";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";

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
/**
 * Says what flat mode just put on screen: "Showing 12 items from 3
 * collections".
 *
 * Announced when the run is COMPLETE, not when the toggle is pressed. Flat mode
 * has to hydrate every nested collection before the order is whole (see
 * FlatClosureHydrator), so a toast fired on the click would state a number that
 * was still growing — the counts land with `loading` going false.
 *
 * It says SHOWING, not "added". Nothing moves: flat mode is a view over items
 * that were already there, and a toast claiming otherwise would describe an
 * edit the undo stack knows nothing about.
 *
 * The collection count includes the focused timeline when it has direct
 * children of its own, because it IS one of the collections the run is drawn
 * from — counting only the nested ones would under-report the moment a timeline
 * mixes loose clips with folders. With nothing nested the phrase drops entirely
 * rather than reading "from 1 collection", which tells nobody anything.
 *
 * Once per activation: a ref keeps a re-render — or a child edit re-running the
 * flatten — from re-announcing, and it resets when flat mode goes off.
 */
function FlatRunAnnouncement({
  enabled,
  loading,
  focusedId,
}: Readonly<{ enabled: boolean; loading: boolean; focusedId: string }>) {
  const store = useCollectionsStore();
  const announcedRef = useRef(false);
  // Whether hydration has actually STARTED for this activation. Without it the
  // announcement fires at t0, when `loading` is false only because the closure
  // hydrator has not run its effect yet — the probe that found this read
  // `loading=false count=2`, then `loading=true count=2`, then
  // `loading=false count=15`. The first of those is the trap: "not started"
  // and "finished" are the same boolean.
  //
  // The true→false EDGE is deterministic rather than a settle heuristic,
  // because FlatClosureHydrator raises the flag unconditionally before it
  // fetches anything (see its effect) — so every activation passes through
  // true, including one with nothing left to load.
  const hydratingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      announcedRef.current = false;
      hydratingRef.current = false;
      return;
    }
    if (loading) {
      hydratingRef.current = true;
      return;
    }
    if (!hydratingRef.current || announcedRef.current) return;
    announcedRef.current = true;

    const items = flattenMediaOrder(
      store.getSnapshot().graph,
      parseNodeId(focusedId),
      MAX_SUBTREE_DEPTH,
    );
    if (items.length === 0) return;

    const parents = new Set(
      items.map((item) => item.collectionPath[item.collectionPath.length - 1] ?? focusedId),
    );
    const itemLabel = `${items.length} item${items.length === 1 ? "" : "s"}`;
    toast(
      parents.size > 1
        ? `Showing ${itemLabel} from ${parents.size} collections`
        : `Showing ${itemLabel} in order`,
      { id: "flat-run-announced" },
    );
  }, [enabled, loading, focusedId, store]);

  return null;
}

export function GraphTimelineView({
  projectId,
  bootstrap,
  bootstrapMissing,
}: {
  projectId: string;
  /** Server-read boot payloads (RSC layout). Null = no session at render
   *  time; the legacy fetch boot covers it. */
  bootstrap?: readonly GraphServerPayload[] | null;
  /**
   * Ids the server's closure walk could not resolve. Recorded before the
   * payloads are primed so anything asking "do I hold the whole closure?" can
   * tell a dangling reference from a document still in flight — only the server
   * knows the difference, and on a primed boot `ensureClosure` (its other
   * source) never runs.
   */
  bootstrapMissing?: readonly string[] | null;
}) {
  const pathname = usePathname();
  const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
  const urlPath = useMemo(
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
  // OPTIMISTIC FOCUS. A drill-in is `router.push`, and the App Router does not
  // commit the new pathname until the server answers the RSC request for that
  // segment — measured at ~270ms locally, which is exactly the "clicking into
  // a collection takes a beat" complaint. Nothing about the focus change
  // actually needs the server: the graph is already in memory, and the page
  // segment only PRIMES documents the client can fetch itself. So the
  // navigation callback publishes the path it is heading to, the view moves
  // on the next frame, and the URL catches up behind it.
  //
  // The URL stays the source of truth: this clears whenever the real path
  // changes (the push landing, Back/Forward, a deep link), and the two agree
  // by construction because the pending value IS what was pushed.
  const [pendingPath, setPendingPath] = useState<readonly string[] | null>(null);
  // Dropped DURING the render that sees a new URL (the documented
  // adjust-state-on-change pattern, as in the trash drawer) rather than in an
  // effect: an effect would render the pending path once more before clearing
  // it, and set-state-in-an-effect is a lint error here for exactly that
  // cascade. `urlPath` is memoized on the pathname, so this compares
  // identities and fires only on a real navigation.
  const [urlPathSeen, setUrlPathSeen] = useState(urlPath);
  if (urlPath !== urlPathSeen) {
    setUrlPathSeen(urlPath);
    setPendingPath(null);
  }
  const timelinePath = pendingPath ?? urlPath;
  const focusedId = timelinePath[timelinePath.length - 1] ?? projectId;
  // Documents the live-update poller watches: what is actually on screen, plus
  // the project root when focus has drilled past it. Deliberately NOT the whole
  // closure — a poll runs on a timer, and a clip arriving in a collection nobody
  // is looking at can wait until they open it.
  const remoteWatchIds = useMemo(
    () => [...new Set([projectId, focusedId])],
    [projectId, focusedId],
  );

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
  // OFF BY DEFAULT. A name stamped on the artwork covers the artwork, and on a
  // strip — where a clip's width IS its duration — the shortest clips lose the
  // most of themselves to it. Session state alongside `itemSize` rather than a
  // stored preference: neither persists today, and one of the two quietly
  // outliving the tab would be the surprise.
  const [clipNamesShown, setClipNamesShown] = useState(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_TIMELINE_PPS);
  // Decides whether trim handles are drawn on every clip or only the
  // selected one — see the prop below.
  const coarsePointer = useCoarsePointer();
  // Children timelines are OFF by default (the focused timeline is the
  // page's subject; the tree is opt-in) — the sidebar's children icon
  // mounts them.
  const [childrenShown, setChildrenShown] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [rulerOn, setRulerOn] = useState(false);
  // Waveform lane. Strip-only and flat-only for the same reason the ruler is:
  // it draws against a single continuous time axis.
  const [waveformOn, setWaveformOn] = useState(false);
  // Flat mode: every item in the focused closure, in order, no nesting.
  // Strip-only — grid has no equivalent, and leaving grid turns it off below.
  //
  // THE STRIP OPENS IN COLLECTIONS (PL15-003), and used to open FLAT. The
  // argument for flat was that the strip is a time axis and a run of every
  // shot in order is what a time axis is for — collections being a way to
  // ORGANISE that run rather than the default way to read it.
  //
  // What settled it against that was the cost the old comment already stated
  // and then accepted: flat mode refuses `move-nodes` (see `commandPolicy`),
  // so a strip that opened flat opened WITHOUT drag-to-reorder, and nothing on
  // screen said why. A default posture that quietly disables the board's main
  // gesture is the wrong default however good the reading is. Opening grouped
  // means the strip is reorderable on arrival and going flat is an explicit
  // trade.
  //
  // `false`, not `initialSurface !== "strip"`: flat is strip-only, so grid
  // arriving false is the same answer for its own reason, and one literal says
  // it once.
  const [flatOn, setFlatOn] = useState(false);
  const [flatLoading, setFlatLoading] = useState(false);
  const [timeChannel] = useState(createPreviewTimeChannel);
  // The sidebar owns the layout switch and the ruler toggle (its top icons /
  // tool cluster); it drives this state through request events…
  useEffect(() => {
    const onSurface = (event: Event) => {
      const detail = (event as CustomEvent<GraphSurface>).detail;
      if (detail === "strip" || detail === "grid") setSurface(detail);
    };
    const onFlatToggle = () => setFlatOn((current) => !current);
    const onPreviewToggle = () => setPreviewOn((current) => !current);
    window.addEventListener(GRAPH_SURFACE_EVENT, onSurface);
    window.addEventListener(GRAPH_FLAT_TOGGLE_EVENT, onFlatToggle);
    window.addEventListener(GRAPH_PREVIEW_TOGGLE_EVENT, onPreviewToggle);
    return () => {
      window.removeEventListener(GRAPH_SURFACE_EVENT, onSurface);
      window.removeEventListener(GRAPH_FLAT_TOGGLE_EVENT, onFlatToggle);
      window.removeEventListener(GRAPH_PREVIEW_TOGGLE_EVENT, onPreviewToggle);
    };
  }, []);

  // Neither the children toggle NOR the ruler toggle is in that list any more:
  // both controls moved into the board header, which is inside this
  // component's own tree, so they call straight down through props. The
  // window-event bridge exists only to reach the SIDEBAR across React trees —
  // a control that no longer lives there has no reason to pay for it.
  const toggleChildren = useCallback(() => setChildrenShown((current) => !current), []);
  // The board's header owns this control now (it used to be a rail tile that
  // reached in over the event bus). The bus listener above stays regardless —
  // the pane's own close button and the WebMCP `set_preview` tool both still
  // arrive that way, so this is a second caller, not a replacement.
  const togglePreview = useCallback(() => setPreviewOn((current) => !current), []);
  // Same move as preview: the control is in the board's controls row now, so
  // it calls down through a prop. The bus listener stays for the WebMCP tool.
  const toggleFlat = useCallback(() => setFlatOn((current) => !current), []);
  const toggleRuler = useCallback(() => setRulerOn((current) => !current), []);
  const toggleWaveform = useCallback(() => setWaveformOn((current) => !current), []);

  // …and this broadcast (on mount and every change) is what lets its
  // controls show the current surface, ruler, children, and preview state.
  useEffect(() => {
    broadcastGraphViewState({
      surface,
      rulerOn,
      childrenShown,
      previewOn,
      flatOn,
      flatLoading,
    });
  }, [surface, rulerOn, childrenShown, previewOn, flatOn, flatLoading]);

  // Flat mode is a STRIP reading. Leaving strip drops it rather than letting it
  // sit armed and re-apply invisibly on the way back — the grid never showed a
  // flat run, so returning to a flat strip the user did not ask for would be a
  // surprise. Adjusted during render (the repo's cascading-render-safe pattern)
  // rather than in an effect, which the set-state-in-effect lint forbids.
  const [prevSurface, setPrevSurface] = useState(surface);
  if (prevSurface !== surface) {
    setPrevSurface(surface);
    // Leaving the strip drops flat (grid has no flat run to show); arriving at
    // it restores the strip's default rather than whatever the grid left
    // behind. Both directions, so the strip is the same on every arrival.
    //
    // THE STRIP'S DEFAULT IS COLLECTIONS (PL15-003), so both directions now
    // land on the same value. It stays written as a reset rather than being
    // deleted: what this block guarantees is "the strip is the same on every
    // arrival", and that is a promise about arrivals, not about the constant
    // that currently satisfies it — a later default would have to be applied
    // here or grid → strip would carry the previous session's posture back in.
    setFlatOn(false);
  }

  // The ruler is scoped to flat mode (its toggle only mounts there), so flat
  // going off has to take the ruler with it — otherwise the control vanishes
  // while the ruler it armed stays painted on every strip, with no way back.
  // Watched on flatOn rather than folded into the toggle handler because the
  // block above turns flat off too; one watcher catches both paths.
  const [prevFlatOn, setPrevFlatOn] = useState(flatOn);
  if (prevFlatOn !== flatOn) {
    setPrevFlatOn(flatOn);
    if (!flatOn && rulerOn) setRulerOn(false);
    // Same rule for the waveform lane: its control lives behind flat mode, so
    // leaving flat must not strand a painted lane with no way to turn it off.
    if (!flatOn && waveformOn) setWaveformOn(false);
  }

  // The closure hydration flat mode needs runs in `FlatClosureHydrator`, which
  // is mounted INSIDE the provider below — the collections store only exists
  // there. This component owns the flag and the pending state; the hydrator
  // reports back through `setFlatLoading`.

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
  // so mount-order runs bind → prime → boot. The clipboard singleton holds
  // copied document snapshots and follows the same rule — a different user
  // must never paste the previous user's timelines.
  useEffect(() => {
    if (user) {
      graphDocumentsGateway.bindUser(user.uid);
      graphClipboard.bindUser(user.uid);
    }
  }, [user]);

  // The board this session is editing, so writes can carry it and the server
  // can stamp `projectId` (#458). Its own effect, keyed on the project rather
  // than the user: drilling into a different project changes this and nothing
  // else, and a re-bind must not reset the cache the way `bindUser` does.
  useEffect(() => {
    graphDocumentsGateway.bindProject(projectId);
  }, [projectId]);

  // RSC payloads prime the gateway (guarded inside it: only for the bound
  // user, never over local edits, never regressing the revision ledger).
  // `user` is a dep so payloads that arrived before the client-side auth
  // resolved get re-applied once the binding exists.
  useEffect(() => {
    graphDocumentsGateway.recordMissing(bootstrapMissing ?? []);
    for (const payload of bootstrap ?? []) {
      graphDocumentsGateway.prime(payload.document, payload.revision, payload.forUid);
    }
  }, [bootstrap, bootstrapMissing, user]);
  // Whether THIS mount booted from server payloads — captured once: the
  // boot effect must not re-run when later layout renders replace the
  // bootstrap array's identity.
  const [bootedFromServer] = useState(
    () => bootstrap !== null && bootstrap !== undefined && bootstrap.length > 0,
  );

  // The sidebar's trash drawer just PERMANENTLY emptied the bin on the
  // server. Every one of those items is still a node under this graph's trash
  // root, and the next commit that touches the trash would write the whole
  // stale list back — resurrecting what the user just destroyed. Drop the
  // cached documents and re-boot: the counter feeds the boot effect below AND
  // the session key, so `<DndCollections>` remounts and actually adopts the
  // rebuilt graph (`initialGraph` is initial-only by design). Undo history
  // goes with it, which is the honest outcome — a permanent delete is not
  // undoable, and history entries referencing those nodes could not replay.
  const [trashGeneration, setTrashGeneration] = useState(0);
  useEffect(() => {
    const onEmptied = () => {
      graphDocumentsGateway.refresh();
      setTrashGeneration((generation) => generation + 1);
    };
    window.addEventListener(GRAPH_TRASH_EMPTIED_EVENT, onEmptied);
    return () => window.removeEventListener(GRAPH_TRASH_EMPTIED_EVENT, onEmptied);
  }, []);

  useEffect(() => {
    if (trashDocumentId === null) return;

    // A server-primed boot IS fresh — re-marking the cache stale would just
    // refetch what the layout already read. The legacy path keeps its
    // don't-trust-the-session-cache refresh.
    if (!bootedFromServer) graphDocumentsGateway.refresh();
    let cancelled = false;
    void (async () => {
      // FILL THE CACHE FIRST, in one request: the project and every document
      // under it. Without it the cache fills a document at a time as cards
      // mount, and each of those reads walks its own subtree server-side —
      // measured at 58 requests and ~430 document reads for a 151-document
      // project (#437).
      //
      // ONLY on the legacy boot. A server-primed boot already arrives with the
      // whole closure in its payloads (`loadGraphBootstrapPayloads` ships what
      // it had to read anyway), and asking again here walked all 151 documents
      // a SECOND time — measured at 465 reads against the 237 it was meant to
      // beat. The fix for a duplicated walk is not a faster walk.
      //
      // AWAITED, which is the point of it: letting this race the hydration
      // below leaves both running, and the per-card reads mostly win.
      //
      // Best effort — it primes what it can and says nothing when it cannot (a
      // closure too large to walk, a network failure), because every document
      // it would have primed is one `ensure` fetches anyway.
      if (!bootedFromServer) {
        await graphDocumentsGateway.ensureClosure(projectId);
        if (cancelled) return;
      }

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
        sessionKey: bootSessionKey(uid, projectId, trashGeneration),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, trashDocumentId, uid, detailsStore, bootedFromServer, trashGeneration]);

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
  // Read live rather than closed over: the policy closure is handed to the
  // provider once, and a stale `flatOn` would let a reorder through the moment
  // the user toggled flat on.
  const flatOnRef = useRef(flatOn);
  useEffect(() => {
    flatOnRef.current = flatOn;
  }, [flatOn]);

  // FLAT drops: the flat STRIP publishes a boundary into the flat RUN, and
  // the intent names the focused collection — neither of which is where the
  // item belongs. `resolveFlatDropTarget` applies the rule the provenance
  // label makes readable: a drop lands in the LEFT NEIGHBOUR's collection,
  // right after it (at the very start, the head of the focused timeline).
  //
  // ONLY that container-level boundary is translated. A drop resolved
  // against a CARD is already parent-relative and already correct: dnd-kit's
  // collision pass deliberately prefers a node hit over its container ("a
  // node card always beats a container"), and `resolveDropIntent` reads that
  // card's real parent out of the graph — so dropping onto c2 in the flat run
  // resolves to Scene A directly, which IS the left-neighbour rule. Running
  // that command through the translator too treats a parent-relative index as
  // a flat-run boundary and lands the item in a different collection
  // entirely (it put a drop meant for Scene A into the project instead).
  //
  // The flat list is rebuilt from the graph the provider hands over rather
  // than shared from the board: it costs one walk per drop, and it can never
  // be the stale copy a shared reference would risk mid-drag.
  const handleMapDropCommand = useCallback(
    (
      command: MoveNodesCommand | AddNodesCommand,
      intent: DropIntent,
      graph: CollectionsGraph,
    ) => {
      const focused = parseNodeId(focusedId);
      // The focused surface's own boundary, and nothing else — every other
      // drop names its target directly and is already right.
      if (intent.type !== "insert-at-index" || intent.collectionId !== focused) return command;

      if (flatOn) {
        const target = resolveFlatDropTarget(
          graph,
          flattenMediaOrder(graph, focused, MAX_SUBTREE_DEPTH),
          focused,
          command.toIndex,
        );
        return { ...command, toParentId: target.parentId, toIndex: target.index };
      }

      // LANE TRANSLATION — the other view whose boundaries do not mean what
      // the intent assumes.
      //
      // A strip with lane rows is handed the PICTURE's children only, so the
      // boundary it publishes counts lane-0 cards, while `resolveCommandFromIntent`
      // reads it as an index into the collection's full child list. On any
      // board with a layer those disagree and the drop lands somewhere nobody
      // chose. The grid is unaffected: it shows every child, so its boundaries
      // already index the real list.
      //
      // Re-derived from the RAW boundary (`intent.index`) rather than patched
      // onto `command.toIndex`, which was computed against the wrong list —
      // the post-removal subtraction has to happen against the translated
      // position, not be carried over from the untranslated one.
      if (surface !== "strip") return command;
      const model = splitLaneRows(graph, detailsStore.read(), focusedId);
      if (model.layers.length === 0) return command;
      return {
        ...command,
        toIndex: laneDropIndex(
          model.pictureIds,
          getChildren(graph, focused),
          intent.index,
          command.type === "move-nodes" ? command.nodeIds : [],
        ),
      };
    },
    [flatOn, focusedId, surface, detailsStore],
  );

  // A clip dragged onto a lane gets the default inset, so the drop is visible
  // rather than silently sound-only. Here rather than in the engine because
  // the rectangle depends on the clip's aspect and the project's output size
  // — see graph-layer-frame.ts.
  const handleMapPlacementCommand = useCallback(
    (command: SetNodePlacementCommand, _intent: DropIntent, graph: CollectionsGraph) =>
      withDefaultLayerFrame(
        command,
        graph,
        (nodeId) => detailsStore.read()[nodeId as string]?.aspect,
      ),
    [detailsStore],
  );

  const commandPolicy = useCallback<CommandPolicy>(
    (command) => {
      // FLAT MODE refuses POSITION-based commands.
      //
      // Reordering: the owner's call, and the reason is the UI's — which
      // collection an item belongs to stops being visible in a flat run, so a
      // drag whose whole meaning is "put it here, among these" has no honest
      // reading.
      //
      // Adding: a correctness bar, not a design one, and it lifts once the
      // translation lands. The strip publishes boundaries into the FLAT list
      // while the drop intent still names the focused collection, so a drop
      // committed today would insert at a flat index inside the wrong parent.
      // `resolveFlatDropTarget` is the rule that fixes it; until it is wired,
      // refusing beats landing items somewhere nobody chose.
      if (flatOnRef.current && command.type === "move-nodes") {
        const message =
          "Reordering is off while every item is shown — open the collection to reorder inside it.";
        toast.error(message, { id: "flat-mode-blocked" });
        return { reason: "blocked-by-policy", blockedIds: [], message };
      }
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

  // Click-to-open (the pointer twin of the O key): the provider's
  // onOpenNode fires on a plain click on an open-target card — after the
  // package's gesture arbitration, so a drag, a hold-grab, or a pan never
  // opens. The actual focus logic lives in GraphViewNavProvider (it needs
  // the engine store, which only exists INSIDE <DndCollections>), so it
  // registers itself into this ref.
  const openNodeRef = useRef<(nodeId: NodeId) => void>(() => {});
  const handleOpenNode = useCallback((nodeId: NodeId) => openNodeRef.current(nodeId), []);
  // EVERY card is an open target now, and a plain click never selects.
  //
  //   a COLLECTION opens as a place — drill in.
  //   a CLIP opens as a thing — its edit overlay, over the board you are on.
  //
  // Which of those a node gets is decided in GraphViewNavProvider, where the
  // graph is; this predicate only answers "does a plain click on this open
  // something", and the answer is now yes for everything. Returning `true`
  // flatly rather than omitting the prop, because the package's default is
  // `node.kind === "collection"` and inheriting it would hide the decision.
  //
  // SELECTION IS A MODE. This is the trade, and it is worth naming: click used
  // to select, so Delete and the rest could act on what you had just clicked.
  // Picking things is now something you enter deliberately — press Select, then
  // tap — which is also the only way to pick several. Three escape hatches
  // survive for one-off work without the mode: the hover CHECKBOX toggles a
  // single card, Ctrl/Cmd+click toggles one from the keyboard-and-pointer
  // grammar, and Space on a focused card selects it (keyboard activation
  // reports `detail === 0`, which the policy never routes to open).
  const openOnClick = useCallback(() => true, []);
  // No `deferSelection`: it existed ONLY because a double-click drilled in, and
  // click 1's selection had to be held back so the user never watched a card
  // select and then unselect on its way into the collection. With a single
  // click there is no second click to wait for, and holding one back would add
  // SELECTION_DEFER_MS (250ms) of dead time to every collection click to buy
  // nothing.

  if (boot.status === "loading") {
    return <GraphViewLoadingSkeleton />;
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
      {/* `role="alert"` because this banner only ever appears for a document
          that failed to load or save — a state the user has to know about
          before they close the tab, and one they were previously only told
          about visually. */}
      {gatewayError !== null && (
        <p
          role="alert"
          className="rounded-md border border-blue-600/40 bg-blue-600/10 px-3 py-2 text-xs text-blue-300"
        >
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
        // ALWAYS ON WITH A POINTER, SELECTION-GATED WITH A THUMB.
        //
        // With a mouse the handles are worth having on every clip: the edge is
        // where you already are, and the ink is quiet until you approach it
        // (see `GraphTrimHandle`), so six of them across a strip cost nothing
        // to look at.
        //
        // Touch cannot have both. The reachable target there is 44px — this
        // app's own `[@media(pointer:coarse)]` size everywhere else — which is
        // a quarter of a 3s clip and more than half of a 1.2s one, so
        // always-on would turn a strip into adjacent trim zones with the clips
        // squeezed between them. Selection is already an explicit tap, so
        // gating on it means exactly one clip at a time carries thumb-sized
        // targets and nothing collides with its neighbour.
        trimRequiresSelection={coarsePointer}
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
        // Select mode is armed from the header, which is on screen whether or
        // not anything is selected — so the mode must survive an empty
        // selection. Without this the store disarms it the instant it is turned
        // on with nothing picked, and the first tap would drill in instead of
        // selecting. Exiting is the header's job (Done / Escape).
        keepMultiSelectModeWhenEmpty
        commandPolicy={commandPolicy}
        mapDropCommand={handleMapDropCommand}
        mapPlacementCommand={handleMapPlacementCommand}
        itemInstructions="Press O to open the focused collection, or F2 to rename it."
      >
          <PersistenceBridge onSync={onSync} />
          {/* Undo that survives a refresh (PL11-008). Keyed to the same boot
              session as the graph itself, so a different project or user
              never inherits a stack built against another graph. */}
          <HistoryPersistenceBridge sessionKey={boot.sessionKey} />
          {/* The whole graph route is the collection's screen, so clicking
              away ANYWHERE that is not a control deselects — not just inside a
              strip or grid box, which was the only place that worked and made
              "get back to nothing selected" a hunt for the right pixel. */}
          <ClearSelectionOnOutsideClick />
          <GraphItemActionsBridge trashId={boot.trashRootId} focusedId={focusedId} />
          <McpToolsBridge
            projectId={projectId}
            focusedId={focusedId}
            trashId={boot.trashRootId}
            onOpenNode={handleOpenNode}
            timeChannel={timeChannel}
          />
          {/* Clips can arrive from outside this session — an agent uploading a
              render through the remote MCP endpoint, or another tab. Polls for
              a revision bump and splices in anything new. */}
          <RemoteChangesBridge timelineIds={remoteWatchIds} />
          <GraphDetailsJanitor />
          <HydrationController
            projectId={projectId}
            segments={timelinePath}
            serverPrimed={bootedFromServer}
            onFocusError={setFocusError}
          />
          {/* Fills in the times the one-level board open cannot vouch for.
              Disabled while FLAT mode is on, which loads the same closure for
              its own reasons — two passes would race for the same documents. */}
          <BackgroundClosureHydrator projectId={projectId} enabled={!flatOn} />
          {/* Flat mode needs the WHOLE closure loaded, not just the focus
              chain — mounted here because the collections store lives only
              inside the provider. */}
          <FlatClosureHydrator
            enabled={flatOn}
            focusedId={focusedId}
            onLoadingChange={setFlatLoading}
          />
          <FlatRunAnnouncement
            enabled={flatOn}
            loading={flatLoading}
            focusedId={focusedId}
          />

          <GraphViewNavProvider
            projectId={projectId}
            focusedId={focusedId}
            openNodeRef={openNodeRef}
            onNavigateStart={setPendingPath}
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
                projectId={projectId}
                focusedId={focusedId}
                breadcrumb={
                  <GraphBreadcrumb projectId={projectId} timelinePath={timelinePath} />
                }
                surface={surface}
                itemSize={itemSize}
                onItemSizeChange={setItemSize}
                clipNamesShown={clipNamesShown}
                onClipNamesChange={setClipNamesShown}
                pixelsPerSecond={pixelsPerSecond}
                onPixelsPerSecondChange={setPixelsPerSecond}
                previewOn={previewOn}
                onPreviewToggle={togglePreview}
                rulerOn={rulerOn}
                onRulerToggle={toggleRuler}
                waveformOn={waveformOn}
                onWaveformToggle={toggleWaveform}
                flatOn={flatOn}
                flatLoading={flatLoading}
                onFlatToggle={toggleFlat}
                childrenShown={childrenShown}
                onChildrenToggle={toggleChildren}
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
