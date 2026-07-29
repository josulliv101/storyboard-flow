"use client";

import { useEffect, useRef } from "react";

import { useCollectionsStore, type NodeId } from "@storyboard/ui/dnd-collections";

import {
  GRAPH_VIEW_STATE_EVENT,
  requestGraphPreviewToggle,
  type GraphViewStateDetail,
} from "@/lib/graph-view-events";
import { createGraphTools } from "@/lib/webmcp/tools";
import { registerWebMcpTools } from "@/lib/webmcp/webmcp-adapter";

import { useGraphDetailsStore } from "./graph-details-context";
import type { PreviewTimeChannel } from "./graph-preview";

// The graph view broadcasts this on mount and every change; until the first
// one lands we assume the load defaults (grid, everything off).
const INITIAL_VIEW_STATE: GraphViewStateDetail = {
  surface: "grid",
  rulerOn: false,
  childrenShown: false,
  previewOn: false,
  assetsOpen: false,
    flatOn: false,
    flatLoading: false,
};

/**
 * Registers the WebMCP agent tools for the open graph session.
 *
 * Rendered INSIDE `<DndCollections>` (next to PersistenceBridge) so it can
 * reach the live store and the details side-table. Registration is tied to
 * this mount via `registerWebMcpTools`' AbortController — the bridge remounts
 * with a fresh store whenever the graph session key changes, so tools can't
 * outlive their session.
 *
 * View/session tools need a little more than the store: navigation is a router
 * push exposed by `onOpenNode` (the same `openTimeline` seam the board uses),
 * and the preview/view state rides the sidebar's window-event bus — we mirror
 * the broadcast into a ref so `get_view_state` / `set_preview` read it live.
 */
export function McpToolsBridge({
  projectId,
  focusedId,
  trashId,
  onOpenNode,
  timeChannel,
}: Readonly<{
  projectId: string;
  focusedId: string;
  trashId: string | null;
  onOpenNode: (nodeId: NodeId) => void;
  timeChannel: PreviewTimeChannel;
}>) {
  const store = useCollectionsStore();
  const details = useGraphDetailsStore();
  const viewStateRef = useRef<GraphViewStateDetail>(INITIAL_VIEW_STATE);

  useEffect(() => {
    const onState = (event: Event) => {
      viewStateRef.current = (event as CustomEvent<GraphViewStateDetail>).detail;
    };
    window.addEventListener(GRAPH_VIEW_STATE_EVENT, onState);
    return () => window.removeEventListener(GRAPH_VIEW_STATE_EVENT, onState);
  }, []);

  useEffect(
    () =>
      registerWebMcpTools(
        createGraphTools({
          store,
          details,
          projectId,
          focusedId,
          trashId,
          openTimeline: onOpenNode,
          getViewState: () => viewStateRef.current,
          togglePreview: requestGraphPreviewToggle,
          seek: (seconds) => timeChannel.set(Math.max(0, seconds)),
          setPlaying: timeChannel.setPlaying,
          getPlayback: () => ({ time: timeChannel.get(), isPlaying: timeChannel.isPlaying() }),
        }),
      ),
    [store, details, projectId, focusedId, trashId, onOpenNode, timeChannel],
  );

  return null;
}
