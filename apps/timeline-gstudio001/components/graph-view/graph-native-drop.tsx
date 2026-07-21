"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import {
  getChildren,
  parseNodeId,
  useCollectionsContainer,
  useCollectionsStore,
  type CollectionItemNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import type { ClipDetail } from "@storyboard/timeline-domain";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import {
  GRAPH_INSERT_TOOL_EVENT,
  isGraphInsertTool,
  type GraphInsertToolDetail,
} from "@/lib/graph-view-events";
import { probeVideoFile, uploadTimelineMedia } from "@/lib/timeline-media-client";

import { classifyDroppedMedia, type DroppedMediaKind } from "./graph-dropped-media";
import { parkPendingDetail, unparkPendingDetail } from "./graph-pending-details";

// The NATIVE drag-and-drop seam for the graph strips. dnd-kit owns
// in-graph drags (cards, palette thumbnails); this layer owns what dnd-kit
// cannot see — HTML5 drags:
//
//   - the sidebar tool icons (application/x-gstudio-type: collection /
//     image / video), which mint a fresh node at the drop position;
//   - OS FILE drops (images/videos, several at once), which upload through
//     the same /api/timeline-media pipeline the legacy views use and then
//     add one node per file — in a single undoable commit.
//
// Both paths land as an ordinary add-nodes dispatch through the store, so
// undo, the change feed, and the patch-scoped persistence all apply. Drops
// into un-hydrated collections are refused BEFORE they commit by the store's
// commandPolicy, so a refused add comes back from `dispatch` itself.
//
// The file pipeline is bounded on three axes, all of which were previously
// unbounded: each video is decoded ONCE (duration and poster frame off the
// same element, via probeVideoFile), at most MAX_CONCURRENT_MEDIA files are
// in flight, and every decode and upload carries an AbortSignal that unmount
// trips.

const TOOL_MIME = "application/x-gstudio-type";
// The demo clip the legacy views use for placeholder video content.
const PLACEHOLDER_VIDEO_SRC = "https://www.w3schools.com/html/mov_bbb.mp4";
const PLACEHOLDER_VIDEO_SECONDS = 10;

type SidebarTool = "collection" | "image" | "video";

function isSidebarTool(value: string): value is SidebarTool {
  return value === "collection" || value === "image" || value === "video";
}

function mintId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// How many dropped files are decoded/uploaded at once. `Promise.all` over the
// whole drop meant N video decoders, canvases, blobs, and uploads existing
// simultaneously — dropping a folder of large videos produced a burst that
// stalled the main thread. Small enough to bound the peak, big enough that
// network latency still overlaps.
const MAX_CONCURRENT_MEDIA = 3;

/** Default timeline seconds for a dropped image. */
const IMAGE_CLIP_SECONDS = 4;

/** Client-space geometry of one mounted card, measured once per drag. */
type CardGeometry = Readonly<{ nodeId: string; left: number; right: number; mid: number }>;

type DragGeometry = Readonly<{
  wrapperLeft: number;
  /** Mounted cards in DOM order, which mirrors child order. */
  cards: readonly CardGeometry[];
}>;

/**
 * A drop position expressed by its NEIGHBOURS rather than by a number.
 *
 * A file drop does not commit until its uploads finish, and the graph is
 * fully editable during that window — a bare index captured at drop time
 * silently comes to mean a different boundary. The neighbouring ids still
 * name the same gap after the rest of the strip moves around them.
 */
type DropAnchor = Readonly<{
  /** Child immediately before the gap at drop time, if any. */
  beforeId: string | null;
  /** Child immediately after it, if any. */
  afterId: string | null;
  /** Index at drop time — the last-resort fallback if neither survives. */
  index: number;
}>;

/**
 * Index of the child whose id equals `nodeId`. Matches by VALUE rather than
 * reconstructing a `NodeId` — an id may be any non-whitespace string, and
 * `NodeId` is structurally a string, so no cast is needed either side of the
 * comparison. Shared by every anchor resolver below instead of each closing
 * over its own copy.
 */
function indexOfChildId(children: readonly NodeId[], nodeId: string): number {
  return children.findIndex((childId) => childId === nodeId);
}

/** The `DropAnchor` neighbour ids that bracket `index` within `children`. */
function neighborsAt(
  children: readonly NodeId[],
  index: number,
): Pick<DropAnchor, "beforeId" | "afterId"> {
  return {
    beforeId: index > 0 ? children[index - 1] : null,
    afterId: index < children.length ? children[index] : null,
  };
}

/** One live drop's contribution to the status line. */
type DropStatus =
  | Readonly<{ status: "uploading"; count: number }>
  /** `at` drives expiry — see ERROR_LINGER_MS. */
  | Readonly<{ status: "error"; message: string; at: number }>;

/** How long a failure stays on screen. An error with no expiry outlived its
 *  drop forever: the banner never went away and, because errors used to beat
 *  progress outright, every later upload was invisible behind it. */
const ERROR_LINGER_MS = 8000;

/** What the strip actually renders — composed in ONE place. */
type DropSummary = Readonly<{ tone: "progress" | "error"; message: string }>;

/**
 * Collapse every live drop into the single status line.
 *
 * Progress and failures are shown TOGETHER rather than one winning: several
 * drops can be live at once, so "errors win" hid active uploads behind a
 * stale failure, while "latest wins" hid failures behind a later success.
 * Counts sum, so "3 files" means three.
 */
function aggregateDropStatus(drops: ReadonlyMap<number, DropStatus>): DropSummary | null {
  const messages: string[] = [];
  let uploading = 0;
  for (const entry of drops.values()) {
    if (entry.status === "error") messages.push(entry.message);
    else uploading += entry.count;
  }
  const parts: string[] = [];
  if (uploading > 0) parts.push(`Uploading ${uploading} file${uploading === 1 ? "" : "s"}…`);
  parts.push(...new Set(messages));
  if (parts.length === 0) return null;
  return { tone: messages.length > 0 ? "error" : "progress", message: parts.join(" · ") };
}

/**
 * `Promise.all` with a worker pool. Results stay in INPUT order — the drop
 * adds nodes in file order, so completion order must not leak through.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}

/**
 * Mint-and-insert for the sidebar's tool palette, shared by the two ways a
 * tool can arrive: a native DRAG (which carries a pointer-derived index) and
 * plain ACTIVATION of the sidebar button (which appends). Extracted so the
 * keyboard path runs exactly the same code as the drop — an accessible route
 * that quietly diverges from the pointer one is how they drift apart.
 */
function useToolInsertion(collectionId: string) {
  const store = useCollectionsStore();

  const addNodes = useCallback(
    (nodes: readonly CollectionItemNode[], toIndex: number): boolean => {
      const result = store.dispatch({
        type: "add-nodes",
        nodes,
        toParentId: parseNodeId(collectionId),
        toIndex,
      });
      // Every refusal — including the un-hydrated-target veto — now comes
      // back from dispatch itself, because the policy runs BEFORE the commit.
      // Nothing landed in the graph, so there is no post-commit state to
      // inspect; just release the details parked for nodes that will never
      // exist.
      if (!result.ok) {
        for (const node of nodes) unparkPendingDetail(node.id as string);
        return false;
      }
      return true;
    },
    [store, collectionId],
  );

  /** Returns whether the tool actually landed, so callers can announce the
   *  truth rather than assuming success. */
  const insertTool = useCallback(
    (tool: SidebarTool, toIndex: number): boolean => {
      if (tool === "collection") {
        const childId = mintId("timeline");
        // hydrated: true — the collection is BRAND-NEW and empty, so drops
        // into it must not bounce and writes may touch its document.
        parkPendingDetail(childId, {
          alt: "New Timeline collection",
          aspect: 16 / 9,
          trackIndex: 0,
          itemCount: 0,
          duration: 3,
          sourceDuration: 3,
          trimIn: 0,
          trimOut: 0,
          hydrated: true,
        });
        const added = addNodes(
          [{ id: parseNodeId(childId), kind: "collection", name: "New Timeline" }],
          toIndex,
        );
        if (added) {
          // Create the child document itself: seed the cache (expected
          // revision 0 = compare-and-set create) and queue an empty write —
          // it joins the same atomic batch as the parent's update, so a
          // drill-in never 404s on a half-created collection.
          graphDocumentsGateway.seed({ id: childId, title: "New Timeline", clips: [] });
          graphDocumentsGateway.writeClips(childId, []);
        }
        return added;
      }

      const id = mintId(tool);
      const placeholder = `https://picsum.photos/seed/${id}/640/360`;
      if (tool === "image") {
        parkPendingDetail(id, {
          alt: "New Image",
          aspect: 16 / 9,
          trackIndex: 0,
          sourceDuration: 4,
          trimIn: 0,
          trimOut: 0,
        });
        return addNodes(
          [
            {
              id: parseNodeId(id),
              kind: "media",
              mediaKind: "image",
              name: "New Image",
              src: placeholder,
              durationSeconds: 4,
            },
          ],
          toIndex,
        );
      }

      parkPendingDetail(id, {
        alt: "New Video",
        aspect: 16 / 9,
        trackIndex: 0,
        poster: placeholder,
      });
      return addNodes(
        [
          {
            id: parseNodeId(id),
            kind: "media",
            mediaKind: "video",
            name: "New Video",
            src: PLACEHOLDER_VIDEO_SRC,
            posterSrcs: [placeholder],
            fullDurationSeconds: PLACEHOLDER_VIDEO_SECONDS,
            trimInSeconds: 0,
            trimOutSeconds: 0,
          },
        ],
        toIndex,
      );
    },
    [addNodes],
  );

  return { addNodes, insertTool };
}

/** Human label for an inserted tool, for the announcement. */
const TOOL_LABELS: Readonly<Record<SidebarTool, string>> = {
  collection: "collection",
  image: "image clip",
  video: "video clip",
};

/**
 * The KEYBOARD/click path for the sidebar tool palette. The sidebar is app
 * chrome living outside this provider, so it hands the tool off through a
 * window event (same pattern as the Assets launcher) and this appends it to
 * the focused collection.
 *
 * Mounted for BOTH surfaces, deliberately: `NativeDropStrip` only wraps the
 * strip, and an accessible control that silently does nothing in grid mode
 * would be worse than no control at all.
 */
export function SidebarToolInsertBridge({
  collectionId,
}: Readonly<{ collectionId: string }>) {
  const store = useCollectionsStore();
  const { insertTool } = useToolInsertion(collectionId);
  const { announce } = useCollectionsContainer();

  useEffect(() => {
    const handleInsert = (event: Event) => {
      const tool = (event as CustomEvent<GraphInsertToolDetail>).detail?.tool;
      if (!tool || !isGraphInsertTool(tool)) return;
      const parentId = parseNodeId(collectionId);
      const graph = store.getSnapshot().graph;
      // Append: with no pointer there is no position to read, and the end of
      // the timeline is the one spot that needs no explanation.
      const landed = insertTool(tool, getChildren(graph, parentId).length);
      const target = graph.nodesById.get(parentId)?.name ?? "the timeline";
      announce(
        landed
          ? `Added a ${TOOL_LABELS[tool]} to the end of "${target}".`
          : `Could not add a ${TOOL_LABELS[tool]} to "${target}".`,
      );
    };
    window.addEventListener(GRAPH_INSERT_TOOL_EVENT, handleInsert);
    return () => window.removeEventListener(GRAPH_INSERT_TOOL_EVENT, handleInsert);
  }, [store, collectionId, insertTool, announce]);

  return null;
}

function acceptsNativeDrag(event: DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer.types;
  return types.includes(TOOL_MIME) || types.includes("Files");
}

/**
 * The surface-agnostic native-drop ENGINE: sidebar TOOL insertion, OS FILE
 * upload, the parked-detail bookkeeping, and the aggregated status line. A
 * strip or a grid supplies only its own geometry, hit-testing, and indicator;
 * everything that talks to the store and the upload pipeline lives here so the
 * two surfaces cannot drift (the exact drift #30 was: only the strip ever
 * wired a drop target, so grid mode silently accepted nothing).
 *
 * `resolveAnchoredIndex` and the DropAnchor it consumes are children-based, so
 * they are shared unchanged: only turning a POINTER into an anchor (1-D for a
 * strip, 2-D for a grid) and drawing the indicator are surface-specific.
 */
function useNativeDrop(collectionId: string) {
  const store = useCollectionsStore();
  const { addNodes, insertTool } = useToolInsertion(collectionId);
  // Keyed BY DROP, not one shared slot. Several drops can be live at once
  // (the abort set below exists precisely for that), and a single value made
  // them clobber each other: whichever finished first cleared the banner
  // while another was still uploading, and a later success erased an earlier
  // drop's error. The rendered status is derived from all of them.
  const [drops, setDrops] = useState<ReadonlyMap<number, DropStatus>>(() => new Map());
  const dropTokenRef = useRef(0);

  const setDropStatus = useCallback((token: number, status: DropStatus | null) => {
    setDrops((current) => {
      if (status === null && !current.has(token)) return current;
      const next = new Map(current);
      if (status === null) next.delete(token);
      else next.set(token, status);
      return next;
    });
  }, []);

  const upload = useMemo(() => aggregateDropStatus(drops), [drops]);

  // Expire failures. The deadline is computed from each error's own `at`, not
  // from when this effect last ran, so a burst of unrelated drop activity
  // cannot keep resetting an error's clock and pin it on screen.
  useEffect(() => {
    const now = Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [token, entry] of drops) {
      if (entry.status !== "error") continue;
      timers.push(
        setTimeout(() => setDropStatus(token, null), Math.max(0, entry.at + ERROR_LINGER_MS - now)),
      );
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [drops, setDropStatus]);

  // Live drops, so unmount (drill-in, route change, surface toggle) can stop
  // their decodes and uploads instead of leaving media elements and requests
  // running for a view nobody is looking at. A Set, not one controller: a
  // second drop while the first is still uploading must not cancel the first.
  const dropAbortsRef = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const pending = dropAbortsRef.current;
    return () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    };
  }, []);

  /**
   * Where the anchor points NOW. A file drop commits after its uploads
   * finish, and the user can reorder, delete, or nest clips in the meantime —
   * a numeric index captured at drop time then names a different boundary
   * than the one they dropped at.
   */
  const resolveAnchoredIndex = useCallback(
    (anchor: DropAnchor): number => {
      const children = getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
      // Prefer the successor: "before whatever followed the gap" survives the
      // predecessor being removed, which is the commoner edit.
      if (anchor.afterId !== null) {
        const at = indexOfChildId(children, anchor.afterId);
        if (at >= 0) return at;
      }
      if (anchor.beforeId !== null) {
        const at = indexOfChildId(children, anchor.beforeId);
        if (at >= 0) return at + 1;
      }
      // Both neighbors are gone (or there were none): fall back to the
      // original index, clamped to what the collection holds now.
      return Math.max(0, Math.min(anchor.index, children.length));
    },
    [store, collectionId],
  );

  const dropFiles = useCallback(
    async (files: readonly File[], anchor: DropAnchor) => {
      // Classify each file to its media kind (or drop it). The kind is carried
      // forward so the upload path never re-derives it from the MIME type: a
      // supported file can arrive with an empty or `application/octet-stream`
      // type, which would misread a video as an image.
      type ClassifiedFile = Readonly<{ file: File; kind: DroppedMediaKind }>;
      const media: readonly ClassifiedFile[] = files.flatMap((file) => {
        const kind = classifyDroppedMedia(file);
        return kind ? [{ file, kind }] : [];
      });
      if (media.length === 0) return;
      const token = ++dropTokenRef.current;
      setDropStatus(token, { status: "uploading", count: media.length });

      const controller = new AbortController();
      const signal = controller.signal;
      dropAbortsRef.current.add(controller);

      try {
        type UploadResult = Readonly<{
          node: CollectionItemNode | null;
          detail: ClipDetail | null;
          error: string | null;
        }>;
        const results: readonly UploadResult[] = await mapWithConcurrency(
          media,
          MAX_CONCURRENT_MEDIA,
          async ({ file, kind }): Promise<UploadResult> => {
            const isVideo = kind === "video";
            // ONE decode per video: duration and poster frame together. The
            // probe is handed to the upload so it does not decode again.
            const probe = isVideo ? await probeVideoFile(file, { signal }) : null;
            const duration = probe?.durationSeconds ?? IMAGE_CLIP_SECONDS;
            let hosted: Awaited<ReturnType<typeof uploadTimelineMedia>>;
            try {
              hosted = await uploadTimelineMedia(file.name, file, undefined, {
                thumbnail: probe?.thumbnail ?? null,
                signal,
              });
            } catch {
              return { node: null, detail: null, error: `"${file.name}" could not be uploaded.` };
            }
            if (isVideo && !hosted.thumbnailUrl) {
              return { node: null, detail: null, error: `"${file.name}" has no video thumbnail.` };
            }

            const id = mintId(isVideo ? "video" : "image");
            if (isVideo) {
              const node: CollectionItemNode = {
                id: parseNodeId(id),
                kind: "media",
                mediaKind: "video",
                name: file.name,
                src: hosted.url,
                posterSrcs: hosted.thumbnailUrl ? [hosted.thumbnailUrl] : undefined,
                fullDurationSeconds: duration,
                trimInSeconds: 0,
                // Match the legacy drop: long videos start showing 12s.
                trimOutSeconds: Math.max(0, duration - 12),
              };
              return {
                node,
                detail: { alt: file.name, aspect: 16 / 9, trackIndex: 0, poster: hosted.thumbnailUrl },
                error: null,
              };
            }
            const node: CollectionItemNode = {
              id: parseNodeId(id),
              kind: "media",
              mediaKind: "image",
              name: file.name,
              src: hosted.url,
              durationSeconds: IMAGE_CLIP_SECONDS,
            };
            return {
              node,
              detail: {
                alt: file.name,
                aspect: 16 / 9,
                trackIndex: 0,
                sourceDuration: IMAGE_CLIP_SECONDS,
                trimIn: 0,
                trimOut: 0,
              },
              error: null,
            };
          },
        );

        // Navigated away or unmounted mid-drop: the nodes belong to a view
        // that is gone, so commit nothing and touch no state.
        if (signal.aborted) return;

        // Report every distinct upload failure, not just the first: a drop of
        // five files that fails three ways used to surface one message.
        const uploadErrors = [
          ...new Set(
            results.map((result) => result.error).filter((error): error is string => error !== null),
          ),
        ];
        const landed = results.filter(
          (result): result is UploadResult & { node: CollectionItemNode; detail: ClipDetail } =>
            result.node !== null && result.detail !== null,
        );
        // Park and dispatch in the SAME synchronous tick: a concurrent
        // palette drag clears every pending detail at drag start, so
        // parking during the (async) uploads left a window where completed
        // files lost their metadata before the commit could claim it.
        let commitError: string | null = null;
        if (landed.length > 0) {
          for (const result of landed) {
            parkPendingDetail(result.node.id as string, result.detail);
          }
          // ONE dispatch for the whole file set: a multi-file drop is a
          // single undoable step and a single persisted batch. The index is
          // resolved HERE, from the anchor, because the strip may have been
          // edited while the uploads ran.
          const added = addNodes(
            landed.map((result) => result.node),
            resolveAnchoredIndex(anchor),
          );
          // The dispatch can be REFUSED (the un-hydrated-target veto). Ignoring
          // it left the user with successfully uploaded files, no cards, and
          // no error — the upload silently went nowhere.
          if (!added) {
            commitError =
              landed.length === 1
                ? `"${landed[0].node.name}" uploaded but could not be added here.`
                : `${landed.length} files uploaded but could not be added here.`;
          }
        }
        // The commit failure dominates: it means NOTHING from this drop landed.
        const message = commitError ?? (uploadErrors.length > 0 ? uploadErrors.join(" · ") : null);
        setDropStatus(token, message ? { status: "error", message, at: Date.now() } : null);
      } catch {
        if (signal.aborted) return;
        setDropStatus(token, {
          status: "error",
          message: "The dropped files could not be added.",
          at: Date.now(),
        });
      } finally {
        dropAbortsRef.current.delete(controller);
      }
    },
    [addNodes, resolveAnchoredIndex, setDropStatus],
  );

  /** Commit a drop whose insert boundary the surface already resolved. Tools
   *  land synchronously; files hand the anchor over to the async upload. */
  const commitDrop = useCallback(
    (event: DragEvent<HTMLElement>, anchor: DropAnchor) => {
      const tool = event.dataTransfer.getData(TOOL_MIME);
      if (tool && isSidebarTool(tool)) {
        insertTool(tool, anchor.index);
        return;
      }
      const files = [...event.dataTransfer.files];
      if (files.length > 0) void dropFiles(files, anchor);
    },
    [insertTool, dropFiles],
  );

  return { commitDrop, upload };
}

/** The shared drop status line — a live region mounted at all times so its
 *  text is announced when it appears. Empty and invisible while idle. */
function NativeDropStatus({ upload }: Readonly<{ upload: DropSummary | null }>) {
  return (
    <p
      data-native-drop-status
      role="status"
      aria-live="polite"
      className={[
        "pointer-events-none absolute bottom-1 left-1 z-20 rounded px-2 py-1 text-[10px]",
        upload === null
          ? "sr-only"
          : upload.tone === "progress"
            ? "bg-zinc-900/90 text-zinc-200"
            : "bg-red-950/90 text-red-200",
      ].join(" ")}
    >
      {upload?.message ?? ""}
    </p>
  );
}

/**
 * Wraps a strip and accepts native drops into the given collection.
 * Insertion position follows the legacy midpoint rule, resolved against the
 * MOUNTED cards (virtualization: DOM order matches child order, but indexes
 * must come from the graph, not the DOM position).
 */
export function NativeDropStrip({
  collectionId,
  children,
}: Readonly<{ collectionId: string; children: ReactNode }>) {
  const store = useCollectionsStore();
  const { commitDrop, upload } = useNativeDrop(collectionId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [indicatorX, setIndicatorX] = useState<number | null>(null);

  // Drag-session geometry (see measureDragGeometry) plus the rAF coalescing
  // state for the drop indicator. All refs: none of it should drive a render.
  const dragGeometryRef = useRef<DragGeometry | null>(null);
  const dragSessionRef = useRef(false);
  const pointerXRef = useRef(0);
  const indicatorFrameRef = useRef<number | null>(null);
  const indicatorXRef = useRef<number | null>(null);

  /**
   * Measure the wrapper and every mounted card ONCE per drag session.
   *
   * `dragover` fires continuously, and reading `getBoundingClientRect` per
   * card per event forces layout on each one. Cards do not move while a
   * native drag is in progress — nothing commits until drop — so the geometry
   * is stable, and the only things that invalidate it are scrolling (which
   * also swaps which cards are virtualized in) and resizing.
   */
  const measureDragGeometry = useCallback((): DragGeometry | null => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const wrapperLeft = wrapper.getBoundingClientRect().left;
    const cards = [...wrapper.querySelectorAll<HTMLElement>("[data-node-id]")].map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        nodeId: card.dataset.nodeId ?? "",
        left: rect.left,
        right: rect.right,
        mid: rect.left + rect.width / 2,
      };
    });
    return { wrapperLeft, cards };
  }, []);

  /** Graph child index for a drop at clientX, via mounted-card midpoints. */
  const resolveDropAnchor = useCallback(
    (clientX: number): DropAnchor => {
      const children = getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
      // Reuse the drag session's measurements; fall back to measuring for a
      // drop that arrived without a preceding dragover (programmatic drops).
      const geometry = dragGeometryRef.current ?? measureDragGeometry();
      const indexOfCard = (card: CardGeometry) => indexOfChildId(children, card.nodeId);

      let index = children.length;
      if (geometry) {
        let resolved = -1;
        for (const card of geometry.cards) {
          if (clientX < card.mid) {
            const at = indexOfCard(card);
            if (at >= 0) {
              resolved = at;
              break;
            }
          }
        }
        if (resolved < 0) {
          const last = geometry.cards[geometry.cards.length - 1];
          const at = last ? indexOfCard(last) : -1;
          if (at >= 0) resolved = at + 1;
        }
        if (resolved >= 0) index = resolved;
      }

      return { index, ...neighborsAt(children, index) };
    },
    [store, collectionId, measureDragGeometry],
  );

  const invalidateDragGeometry = useCallback(() => {
    dragGeometryRef.current = null;
  }, []);

  /** Resolve and paint the indicator for the latest pointer x, once a frame. */
  const flushIndicator = useCallback(() => {
    indicatorFrameRef.current = null;
    const geometry = (dragGeometryRef.current ??= measureDragGeometry());
    if (!geometry) return;
    const clientX = pointerXRef.current;
    // Snap to the resolved insertion edge when a card anchors it, else follow
    // the pointer (empty strip / trailing whitespace).
    let x = clientX - geometry.wrapperLeft;
    for (const card of geometry.cards) {
      if (clientX < card.mid) {
        x = card.left - geometry.wrapperLeft - 3;
        break;
      }
      x = card.right - geometry.wrapperLeft + 3;
    }
    // Most frames of a drag resolve to the SAME edge — re-rendering for them
    // is pure waste.
    if (indicatorXRef.current === x) return;
    indicatorXRef.current = x;
    setIndicatorX(x);
  }, [measureDragGeometry]);

  const endDragSession = useCallback(() => {
    if (!dragSessionRef.current) return;
    dragSessionRef.current = false;
    window.removeEventListener("scroll", invalidateDragGeometry, true);
    window.removeEventListener("resize", invalidateDragGeometry);
    if (indicatorFrameRef.current !== null) {
      cancelAnimationFrame(indicatorFrameRef.current);
      indicatorFrameRef.current = null;
    }
    dragGeometryRef.current = null;
    indicatorXRef.current = null;
    setIndicatorX(null);
  }, [invalidateDragGeometry]);

  // A drag can end anywhere (dropped on another target, cancelled with Esc),
  // and `dragend` fires on the drag SOURCE — which is the sidebar, not us. A
  // window-level listener is what actually guarantees the session closes.
  useEffect(() => endDragSession, [endDragSession]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (!dragSessionRef.current) {
      dragSessionRef.current = true;
      // Capture phase: the strip scrolls in its own container, not the window.
      window.addEventListener("scroll", invalidateDragGeometry, true);
      window.addEventListener("resize", invalidateDragGeometry);
      window.addEventListener("dragend", endDragSession, { once: true });
    }
    // Coalesce to one resolve+paint per frame, no matter the event rate.
    pointerXRef.current = event.clientX;
    if (indicatorFrameRef.current === null) {
      indicatorFrameRef.current = requestAnimationFrame(flushIndicator);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Only clear when the pointer truly left the wrapper (dragleave fires
    // for every child boundary crossing).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    endDragSession();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    // Resolve BEFORE ending the session: the index comes from the same
    // measurements the indicator was drawn from, so where the user saw the
    // line is where the node lands.
    const anchor = resolveDropAnchor(event.clientX);
    endDragSession();
    commitDrop(event, anchor);
  };

  return (
    <div
      ref={wrapperRef}
      data-native-drop={collectionId}
      className="relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {indicatorX !== null && (
        <div
          data-native-drop-indicator
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 z-20 w-0.5 rounded bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
          style={{ transform: `translateX(${indicatorX}px)` }}
        />
      )}
      <NativeDropStatus upload={upload} />
    </div>
  );
}

/** Client-space geometry of one mounted GRID cell, measured once per drag. */
type GridCellGeometry = Readonly<{
  nodeId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  midX: number;
}>;

type GridDragGeometry = Readonly<{
  wrapperLeft: number;
  wrapperTop: number;
  cells: readonly GridCellGeometry[];
}>;

/** Where the grid indicator draws — a vertical bar at the resolved boundary. */
type GridIndicator = Readonly<{ x: number; y: number; height: number }>;

/**
 * Wraps a GRID and accepts the same native drops the strip does — which grid
 * mode used to swallow, having no drop target at all (#30). The insert index
 * comes from 2-D hit-testing: the boundary falls before the first mounted cell
 * that follows the pointer in reading order (a row below the pointer, or the
 * pointer's own row and to the pointer's right). Indexes still come from the
 * GRAPH, matched to mounted cells by id, exactly as the strip does.
 */
export function NativeDropGrid({
  collectionId,
  children,
}: Readonly<{ collectionId: string; children: ReactNode }>) {
  const store = useCollectionsStore();
  const { commitDrop, upload } = useNativeDrop(collectionId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<GridIndicator | null>(null);

  const dragGeometryRef = useRef<GridDragGeometry | null>(null);
  const dragSessionRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const indicatorFrameRef = useRef<number | null>(null);

  const measureDragGeometry = useCallback((): GridDragGeometry | null => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const wrapperRect = wrapper.getBoundingClientRect();
    const cells = [...wrapper.querySelectorAll<HTMLElement>("[data-node-id]")].map((cell) => {
      const rect = cell.getBoundingClientRect();
      return {
        nodeId: cell.dataset.nodeId ?? "",
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        midX: rect.left + rect.width / 2,
      };
    });
    return { wrapperLeft: wrapperRect.left, wrapperTop: wrapperRect.top, cells };
  }, []);

  /** The mounted cell the insertion boundary sits BEFORE, or null to append. */
  const cellBeforeWhichPointerFalls = useCallback(
    (geometry: GridDragGeometry, x: number, y: number): GridCellGeometry | null => {
      for (const cell of geometry.cells) {
        // Reading order: a cell FOLLOWS the pointer if it starts on a row below
        // the pointer, or shares the pointer's row and lies to its right.
        const rowBelow = y < cell.top;
        const sameRow = y >= cell.top && y <= cell.bottom;
        const follows = rowBelow || (sameRow && x < cell.midX);
        if (follows) return cell;
      }
      return null;
    },
    [],
  );

  const resolveDropAnchor = useCallback(
    (clientX: number, clientY: number): DropAnchor => {
      const children = getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
      const geometry = dragGeometryRef.current ?? measureDragGeometry();

      let index = children.length;
      if (geometry) {
        const before = cellBeforeWhichPointerFalls(geometry, clientX, clientY);
        if (before) {
          const at = indexOfChildId(children, before.nodeId);
          if (at >= 0) index = at;
        }
      }
      return { index, ...neighborsAt(children, index) };
    },
    [store, collectionId, measureDragGeometry, cellBeforeWhichPointerFalls],
  );

  const invalidateDragGeometry = useCallback(() => {
    dragGeometryRef.current = null;
  }, []);

  const flushIndicator = useCallback(() => {
    indicatorFrameRef.current = null;
    const geometry = (dragGeometryRef.current ??= measureDragGeometry());
    if (!geometry || geometry.cells.length === 0) {
      setIndicator(null);
      return;
    }
    const { x: clientX, y: clientY } = pointerRef.current;
    const before = cellBeforeWhichPointerFalls(geometry, clientX, clientY);
    // Draw at the left edge of the cell the boundary precedes, else at the
    // right edge of the last cell (append). Spans that cell's row height.
    const anchorCell = before ?? geometry.cells[geometry.cells.length - 1];
    const x =
      (before ? anchorCell.left - 3 : anchorCell.right + 3) - geometry.wrapperLeft;
    const y = anchorCell.top - geometry.wrapperTop;
    const height = anchorCell.bottom - anchorCell.top;
    setIndicator((current) =>
      current && current.x === x && current.y === y && current.height === height
        ? current
        : { x, y, height },
    );
  }, [measureDragGeometry, cellBeforeWhichPointerFalls]);

  const endDragSession = useCallback(() => {
    if (!dragSessionRef.current) return;
    dragSessionRef.current = false;
    window.removeEventListener("scroll", invalidateDragGeometry, true);
    window.removeEventListener("resize", invalidateDragGeometry);
    if (indicatorFrameRef.current !== null) {
      cancelAnimationFrame(indicatorFrameRef.current);
      indicatorFrameRef.current = null;
    }
    dragGeometryRef.current = null;
    setIndicator(null);
  }, [invalidateDragGeometry]);

  useEffect(() => endDragSession, [endDragSession]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (!dragSessionRef.current) {
      dragSessionRef.current = true;
      window.addEventListener("scroll", invalidateDragGeometry, true);
      window.addEventListener("resize", invalidateDragGeometry);
      window.addEventListener("dragend", endDragSession, { once: true });
    }
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (indicatorFrameRef.current === null) {
      indicatorFrameRef.current = requestAnimationFrame(flushIndicator);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    endDragSession();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    const anchor = resolveDropAnchor(event.clientX, event.clientY);
    endDragSession();
    commitDrop(event, anchor);
  };

  return (
    <div
      ref={wrapperRef}
      data-native-drop={collectionId}
      className="relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {indicator !== null && (
        <div
          data-native-drop-indicator
          aria-hidden="true"
          className="pointer-events-none absolute z-20 w-0.5 rounded bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
          style={{
            transform: `translate(${indicator.x}px, ${indicator.y}px)`,
            height: `${indicator.height}px`,
          }}
        />
      )}
      <NativeDropStatus upload={upload} />
    </div>
  );
}
