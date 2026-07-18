"use client";

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";

import {
  getChildren,
  parseNodeId,
  useCollectionsStore,
  type CollectionItemNode,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { uploadTimelineMedia } from "@/lib/timeline-media-client";

import { parkPendingDetail } from "./graph-pending-details";

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
// undo, the change feed, and the patch-scoped persistence all apply. The
// PersistenceBridge's bounce policy stays the gate for un-hydrated targets:
// a bounced add is undone with a rejection flash, and this layer detects
// the bounce (the node is gone) and skips its follow-up work.

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

/** Duration probe for dropped video files (images default to 4s). */
function mediaFileDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("video/")) {
      resolve(4);
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    const sourceUrl = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(sourceUrl);
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const duration =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(5);
    };
    video.src = sourceUrl;
  });
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [indicatorX, setIndicatorX] = useState<number | null>(null);
  const [upload, setUpload] = useState<
    | Readonly<{ status: "uploading"; count: number }>
    | Readonly<{ status: "error"; message: string }>
    | null
  >(null);

  const acceptsDrag = (event: DragEvent) => {
    const types = event.dataTransfer.types;
    return types.includes(TOOL_MIME) || types.includes("Files");
  };

  /** Graph child index for a drop at clientX, via mounted-card midpoints. */
  const resolveInsertIndex = useCallback(
    (clientX: number): number => {
      const wrapper = wrapperRef.current;
      const children_ = getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
      if (!wrapper) return children_.length;
      const cards = [...wrapper.querySelectorAll<HTMLElement>("[data-node-id]")];
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) {
          const index = children_.indexOf(parseNodeId(card.dataset.nodeId ?? ""));
          if (index >= 0) return index;
        }
      }
      const last = cards[cards.length - 1];
      if (last) {
        const index = children_.indexOf(parseNodeId(last.dataset.nodeId ?? ""));
        if (index >= 0) return index + 1;
      }
      return children_.length;
    },
    [store, collectionId],
  );

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // Indicator: snap to the resolved insertion edge when a card anchors it,
    // else follow the pointer (empty strip / trailing whitespace).
    const rect = wrapper.getBoundingClientRect();
    const cards = [...wrapper.querySelectorAll<HTMLElement>("[data-node-id]")];
    let x = event.clientX - rect.left;
    for (const card of cards) {
      const cardRect = card.getBoundingClientRect();
      if (event.clientX < cardRect.left + cardRect.width / 2) {
        x = cardRect.left - rect.left - 3;
        break;
      }
      x = cardRect.right - rect.left + 3;
    }
    setIndicatorX(x);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Only clear when the pointer truly left the wrapper (dragleave fires
    // for every child boundary crossing).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIndicatorX(null);
  };

  const addNodes = useCallback(
    (nodes: readonly CollectionItemNode[], toIndex: number): boolean => {
      const result = store.dispatch({
        type: "add-nodes",
        nodes,
        toParentId: parseNodeId(collectionId),
        toIndex,
      });
      if (!result.ok) return false;
      // The PersistenceBridge may have BOUNCED the add (un-hydrated target):
      // it undoes reentrantly, so by now the nodes are gone again.
      const graph = store.getSnapshot().graph;
      return nodes.every((node) => graph.nodesById.has(node.id));
    },
    [store, collectionId],
  );

  const dropTool = useCallback(
    (tool: SidebarTool, toIndex: number) => {
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
        return;
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
        addNodes(
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
        return;
      }

      parkPendingDetail(id, {
        alt: "New Video",
        aspect: 16 / 9,
        trackIndex: 0,
        poster: placeholder,
      });
      addNodes(
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

  const dropFiles = useCallback(
    async (files: readonly File[], toIndex: number) => {
      const media = files.filter(
        (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
      );
      if (media.length === 0) return;
      setUpload({ status: "uploading", count: media.length });

      try {
        const results: readonly { node: CollectionItemNode | null; error: string | null }[] =
          await Promise.all(
            media.map(async (file) => {
            const isVideo = file.type.startsWith("video/");
            const duration = await mediaFileDuration(file);
            let hosted: Awaited<ReturnType<typeof uploadTimelineMedia>>;
            try {
              hosted = await uploadTimelineMedia(file.name, file);
            } catch {
              return { node: null, error: `"${file.name}" could not be uploaded.` };
            }
            if (isVideo && !hosted.thumbnailUrl) {
              return { node: null, error: `"${file.name}" has no video thumbnail.` };
            }

            const id = mintId(isVideo ? "video" : "image");
            if (isVideo) {
              parkPendingDetail(id, {
                alt: file.name,
                aspect: 16 / 9,
                trackIndex: 0,
                poster: hosted.thumbnailUrl,
              });
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
              return { node, error: null };
            }
            parkPendingDetail(id, {
              alt: file.name,
              aspect: 16 / 9,
              trackIndex: 0,
              sourceDuration: 4,
              trimIn: 0,
              trimOut: 0,
            });
            const node: CollectionItemNode = {
              id: parseNodeId(id),
              kind: "media",
              mediaKind: "image",
              name: file.name,
              src: hosted.url,
              durationSeconds: 4,
            };
            return { node, error: null };
          }),
        );

        const failure = results.find((result) => result.error)?.error ?? null;
        const nodes = results
          .map((result) => result.node)
          .filter((node): node is CollectionItemNode => node !== null);
        // ONE dispatch for the whole file set: a multi-file drop is a single
        // undoable step and a single persisted batch.
        if (nodes.length > 0) addNodes(nodes, toIndex);
        setUpload(failure ? { status: "error", message: failure } : null);
      } catch {
        setUpload({ status: "error", message: "The dropped files could not be added." });
      }
    },
    [addNodes],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrag(event)) return;
    event.preventDefault();
    setIndicatorX(null);
    const toIndex = resolveInsertIndex(event.clientX);

    const tool = event.dataTransfer.getData(TOOL_MIME);
    if (tool && isSidebarTool(tool)) {
      dropTool(tool, toIndex);
      return;
    }
    const files = [...event.dataTransfer.files];
    if (files.length > 0) void dropFiles(files, toIndex);
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
      {upload !== null && (
        <p
          data-native-drop-status
          className={[
            "pointer-events-none absolute bottom-1 left-1 z-20 rounded px-2 py-1 text-[10px]",
            upload.status === "uploading"
              ? "bg-zinc-900/90 text-zinc-200"
              : "bg-red-950/90 text-red-200",
          ].join(" ")}
        >
          {upload.status === "uploading"
            ? `Uploading ${upload.count} file${upload.count === 1 ? "" : "s"}…`
            : upload.message}
        </p>
      )}
    </div>
  );
}
