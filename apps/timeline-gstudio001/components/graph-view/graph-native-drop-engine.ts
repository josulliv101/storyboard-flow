"use client";

import { aspectFromDimensions } from "@storyboard/timeline-model/documents";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";

import {
  getChildren,
  parseNodeId,
  useCollectionsStore,
  type CollectionItemNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import { resolveFlatDropTarget, type ClipDetail } from "@storyboard/timeline-domain";

import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { probeVideoFile, uploadTimelineMedia } from "@/lib/timeline-media-client";
import { GRAPH_ADD_ITEM_EVENT, type GraphAddItemDetail } from "@/lib/graph-view-events";

import { useFlatItems } from "./graph-preview";
import { classifyDroppedMedia, type DroppedMediaKind } from "./graph-dropped-media";
import { parkPendingDetail } from "./graph-pending-details";
import { useToolInsertion, mintId } from "./graph-native-drop-insertion";
import {
  ERROR_LINGER_MS,
  IMAGE_CLIP_SECONDS,
  MAX_CONCURRENT_MEDIA,
  TOOL_MIME,
  aggregateDropStatus,
  isAddItemTool,
  isSidebarTool,
  resolveAnchorIndex,
  type DropAnchor,
  type DropStatus,
  type DropSummary,
} from "./graph-native-drop-model";

/**
 * A drop that has landed but not decided: WHERE it landed, and where on screen
 * to ask WHAT it should be.
 *
 * The anchor is the same id-based `DropAnchor` a file drop carries, and for the
 * same reason — it names its gap by the cards either side of it, so it still
 * points at the place you dropped even if the board changes while the menu is
 * open. That property was built for uploads finishing late; a menu waiting on a
 * human is the same shape of wait, only longer and more likely.
 */
export type PendingAddChoice = Readonly<{
  anchor: DropAnchor;
  /** Viewport coordinates of the drop, for positioning the menu. */
  clientX: number;
  clientY: number;
}>;

/**
 * The surface-agnostic native-drop ENGINE: sidebar TOOL insertion, OS FILE
 * upload, the parked-detail bookkeeping, and the aggregated status line. A
 * strip or a grid supplies only its own geometry, hit-testing, and indicator;
 * everything that talks to the store and the upload pipeline lives here so the
 * two surfaces cannot drift (the exact drift #30 was: only the strip ever
 * wired a drop target, so grid mode silently accepted nothing).
 *
 * The DropAnchor it consumes is id-based, so it is shared unchanged: only
 * turning a POINTER into an anchor (1-D for a strip, 2-D for a grid) and
 * drawing the indicator are surface-specific, and both of those are pure
 * functions in `graph-native-drop-model`.
 */
export function useNativeDrop(collectionId: string, projectId: string) {
  const store = useCollectionsStore();
  // Non-null only inside the focused FLAT strip — see useFlatItems.
  const flatItems = useFlatItems();
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
        setTimeout(
          () => setDropStatus(token, null),
          Math.max(0, entry.at + ERROR_LINGER_MS - now),
        ),
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
   * Where the anchor points NOW, as a parent and an index.
   *
   * A file drop commits after its uploads finish, and the user can reorder,
   * delete, or nest clips in the meantime — a numeric index captured at drop
   * time then names a different boundary than the one they dropped at. So the
   * anchor is re-read against the CURRENT graph, by neighbour id
   * (`resolveAnchorIndex`, which is unit-tested).
   *
   * In a FLAT RUN it is re-read against the flat list instead, and translated.
   * Both halves matter:
   *
   * - The neighbours are flat cards, which are mostly NOT this collection's
   *   children, so looking them up among the children finds nothing — except
   *   for the occasional card that happens to be a direct child too, which
   *   yields a wrong number that looks right. That is what made a file
   *   dropped after `c2` land between `c1` and `c2`.
   * - A flat boundary is not a parent-relative index, so `resolveFlatDropTarget`
   *   converts it — the same rule the dnd-kit path applies in `mapDropCommand`
   *   (graph-timeline-view). A native drop never reaches that seam: it
   *   dispatches straight to the store, which is why this path stayed unfixed
   *   when the palette's was fixed.
   *
   * Returning the PARENT as well as the index is what keeps the translation
   * here rather than deeper: `addNodes` receives a real parent and never has to
   * guess whether the number it was handed is a flat boundary.
   */
  const resolveAnchoredTarget = useCallback(
    (anchor: DropAnchor): Readonly<{ parentId: NodeId; index: number }> => {
      const own = parseNodeId(collectionId);
      const graph = store.getSnapshot().graph;

      if (flatItems !== null) {
        const ids = flatItems.map((item) => item.nodeId);
        return resolveFlatDropTarget(graph, flatItems, own, resolveAnchorIndex(ids, anchor));
      }

      return { parentId: own, index: resolveAnchorIndex(getChildren(graph, own), anchor) };
    },
    [store, collectionId, flatItems],
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
            //
            // Guarded to satisfy the pool's contract, not to fix a live
            // failure: `probeVideoFile` swallows its own decode errors and
            // resolves a null thumbnail (which the upload route then refuses,
            // so an unreadable video already fails per-file, below). The one
            // rejection it still lets through is an ABORT — and an abort has
            // by definition already cancelled the siblings, so nothing is
            // stranded today. What this guard buys is that the invariant no
            // longer depends on that: a worker that cannot reject is one that
            // cannot take `Promise.all` down while its siblings upload on into
            // a drop the caller has stopped awaiting.
            let probe: Awaited<ReturnType<typeof probeVideoFile>> | null;
            try {
              probe = isVideo ? await probeVideoFile(file, { signal }) : null;
            } catch {
              return { node: null, detail: null, error: `"${file.name}" could not be read.` };
            }
            const duration = probe?.durationSeconds ?? IMAGE_CLIP_SECONDS;
            let hosted: Awaited<ReturnType<typeof uploadTimelineMedia>>;
            try {
              hosted = await uploadTimelineMedia(file.name, file, projectId, undefined, {
                thumbnail: probe?.thumbnail ?? null,
                signal,
              });
            } catch (error) {
              const reason =
                error instanceof Error
                  ? error.message.replace(/^Media upload failed:\s*/i, "").trim()
                  : "";
              const detail = reason ? ` ${reason.slice(0, 220)}` : "";
              return {
                node: null,
                detail: null,
                error: `"${file.name}" could not be uploaded.${detail}`,
              };
            }
            if (isVideo && !hosted.thumbnailUrl) {
              return { node: null, detail: null, error: `"${file.name}" has no video thumbnail.` };
            }

            const id = mintId(isVideo ? "video" : "image");
            const sourceAsset =
              hosted.providerId && hosted.assetId
                ? { providerId: hosted.providerId, assetId: hosted.assetId }
                : undefined;
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
                detail: {
                  alt: file.name,
                  aspect: aspectFromDimensions(hosted.width, hosted.height) ?? 16 / 9,
                  poster: hosted.thumbnailUrl,
                  ...(sourceAsset === undefined ? {} : { sourceAsset }),
                },
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
                aspect: aspectFromDimensions(hosted.width, hosted.height) ?? 16 / 9,
                sourceDuration: IMAGE_CLIP_SECONDS,
                trimIn: 0,
                trimOut: 0,
                ...(sourceAsset === undefined ? {} : { sourceAsset }),
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
            results
              .map((result) => result.error)
              .filter((error): error is string => error !== null),
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
          const target = resolveAnchoredTarget(anchor);
          const added = addNodes(
            landed.map((result) => result.node),
            target.index,
            target.parentId,
          );
          // The dispatch can be REFUSED (the un-hydrated-target veto). Ignoring
          // it left the user with successfully uploaded files, no cards, and
          // no error — the upload silently went nowhere.
          if (!added) {
            commitError =
              landed.length === 1 && landed[0] !== undefined
                ? `"${landed[0].node.name}" uploaded but could not be added here.`
                : `${landed.length} files uploaded but could not be added here.`;
          }
        }
        // The commit failure dominates: it means NOTHING from this drop landed.
        const message = commitError ?? (uploadErrors.length > 0 ? uploadErrors.join(" · ") : null);
        setDropStatus(token, message ? { status: "error", message, at: Date.now() } : null);
      } catch {
        // Reaching here means the POOL failed, not a file — every expected
        // per-file failure comes back as an UploadResult. Sibling workers may
        // then still be mid-upload with nothing awaiting them, so cancel
        // before the controller leaves the ref set: after that delete nothing
        // can reach them, and an upload completing unobserved would put an
        // object in storage that no node points at. Read `aborted` FIRST — the
        // abort below would otherwise look like the unmount case and swallow a
        // genuine error.
        const cancelled = signal.aborted;
        controller.abort();
        if (cancelled) return;
        setDropStatus(token, {
          status: "error",
          message: "The dropped files could not be added.",
          at: Date.now(),
        });
      } finally {
        dropAbortsRef.current.delete(controller);
      }
    },
    [addNodes, resolveAnchoredTarget, setDropStatus, projectId],
  );

  // A dropped ADD ITEM, waiting on the user to say which kind. Null the rest
  // of the time, which is what the surfaces render nothing from.
  const [pendingChoice, setPendingChoice] = useState<PendingAddChoice | null>(null);
  const cancelChoice = useCallback(() => setPendingChoice(null), []);

  /** Commit a drop whose insert boundary the surface already resolved. Tools
   *  land synchronously; files hand the anchor over to the async upload; an
   *  ADD ITEM drop lands nothing yet and opens its menu instead. */
  const commitDrop = useCallback(
    (event: DragEvent<HTMLElement>, anchor: DropAnchor) => {
      const tool = event.dataTransfer.getData(TOOL_MIME);
      if (tool && isSidebarTool(tool)) {
        insertTool(tool, anchor.index);
        return;
      }
      if (tool && isAddItemTool(tool)) {
        // Park the position and ASK. Nothing is dispatched here — the graph is
        // untouched until the menu is answered, so dismissing it leaves no
        // trace, which is what makes Escape a real cancel rather than an undo.
        setPendingChoice({ anchor, clientX: event.clientX, clientY: event.clientY });
        return;
      }
      const files = [...event.dataTransfer.files];
      if (files.length > 0) void dropFiles(files, anchor);
    },
    [insertTool, dropFiles],
  );

  /**
   * Answer a pending choice with COLLECTION, at the position it was dropped.
   *
   * Re-resolves the anchor through `resolveAnchoredTarget` rather than reusing
   * `anchor.index` the way the immediate tool path does. Both halves matter and
   * neither is optional here:
   *
   * - TIME PASSED. A menu sat open while the board stayed live; a raw index
   *   captured at drop time can name a different gap by the time it is used.
   * - FLAT MODE. A flat boundary is not a parent-relative index, and
   *   `resolveAnchoredTarget` is what converts it (see its own note). The
   *   immediate path skipping that step is pre-existing behaviour this does not
   *   touch — but a NEW path has no reason to inherit it.
   *
   * The insert runs OUTSIDE the state updater, reading the current choice from
   * the closure. An updater must be pure — React calls it twice in StrictMode —
   * and inserting from inside one adds two collections for one click.
   */
  const chooseCollection = useCallback(() => {
    if (pendingChoice === null) return;
    const target = resolveAnchoredTarget(pendingChoice.anchor);
    setPendingChoice(null);
    insertTool("collection", target.index, target.parentId);
  }, [pendingChoice, insertTool, resolveAnchoredTarget]);

  /**
   * Answer a pending choice with MEDIA: the files go through the very same
   * `dropFiles` an OS drop uses, at the parked anchor. One decode per video,
   * bounded concurrency, per-file failure reporting, and ONE undoable commit
   * all come along — none of it is reimplemented for this route.
   *
   * Outside the updater for the same reason as above: a StrictMode double-call
   * would upload and insert every chosen file twice.
   */
  const chooseMedia = useCallback(
    (files: readonly File[]) => {
      if (pendingChoice === null) return;
      const { anchor } = pendingChoice;
      setPendingChoice(null);
      if (files.length > 0) void dropFiles(files, anchor);
    },
    [pendingChoice, dropFiles],
  );

  /**
   * Add files WITHOUT a drag — the file picker's route in (PL14-011).
   *
   * Appends, because a picker has no pointer and therefore no boundary: the
   * user chose files, not a position. `resolveAnchoredTarget` still resolves
   * it at commit time, so a strip edited while the uploads run still lands
   * them at its real end.
   *
   * Deliberately the SAME `dropFiles` the drop path calls, rather than a
   * second upload route. Everything that makes a drop behave — one decode per
   * video, bounded concurrency, per-file failure reporting, detail parking,
   * and ONE undoable commit for the whole selection — lives in there, and a
   * picker that reimplemented any of it would drift from the drag.
   */
  const appendFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const children = getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
      void dropFiles(files, {
        beforeId: children.length > 0 ? (children[children.length - 1] as string) : null,
        afterId: null,
        index: children.length,
      });
    },
    [dropFiles, store, collectionId],
  );

  /**
   * Append a collection to the end — the click half of "Add item".
   *
   * Reads the child count LIVE rather than taking an index from the caller: the
   * button is in the controls row, several components away, and "the end" it
   * meant when it rendered is not necessarily the end by the time it is
   * pressed.
   */
  const appendCollection = useCallback(() => {
    const children = getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
    insertTool("collection", children.length);
  }, [store, collectionId, insertTool]);

  // The controls row's Add item button, reaching down into this engine. See
  // GRAPH_ADD_ITEM_EVENT for why it is ADDRESSED and not broadcast: every
  // sub-timeline row mounts one of these, and an unaddressed event would add
  // one item per row on screen.
  useEffect(() => {
    const onAddItem = (event: Event) => {
      const detail = (event as CustomEvent<GraphAddItemDetail>).detail;
      if (!detail || detail.collectionId !== collectionId) return;
      if (detail.kind === "collection") appendCollection();
      else appendFiles(detail.files);
    };
    window.addEventListener(GRAPH_ADD_ITEM_EVENT, onAddItem);
    return () => window.removeEventListener(GRAPH_ADD_ITEM_EVENT, onAddItem);
  }, [collectionId, appendCollection, appendFiles]);

  return {
    commitDrop,
    upload,
    appendFiles,
    pendingChoice,
    chooseCollection,
    chooseMedia,
    cancelChoice,
  };
}

/**
 * The surface's file-append entry, for anything rendered INSIDE it that has
 * files but no drag — currently the trailing slot's picker.
 *
 * A context because the slot is passed to the virtual surface as
 * `trailingSlot` and renders within this provider, while being constructed far
 * away in the board. Null outside a native-drop surface, which is the honest
 * answer: there is no timeline to append to.
 */
export const AppendFilesContext = createContext<((files: readonly File[]) => void) | null>(null);

export function useAppendFiles(): ((files: readonly File[]) => void) | null {
  return useContext(AppendFilesContext);
}

export type { DropSummary };
