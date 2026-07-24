"use client";

import { useEffect } from "react";

import { useCollectionsStore } from "@storyboard/ui/dnd-collections";

import { createGraphTools } from "@/lib/webmcp/tools";
import { registerWebMcpTools } from "@/lib/webmcp/webmcp-adapter";

import { useGraphDetailsStore } from "./graph-details-context";

/**
 * Registers the WebMCP agent tools for the open graph session.
 *
 * Rendered INSIDE `<DndCollections>` (next to PersistenceBridge) so it can
 * reach the live store and the details side-table. Registration is tied to
 * this mount via `registerWebMcpTools`' AbortController: the bridge remounts
 * with a fresh store whenever the graph session key changes, so tools can't
 * outlive their session — the same session-lifetime discipline the async
 * item-action handlers use. `focusedId` re-registers the tools (they default
 * reads and placement to the open collection); the store is stable within a
 * session, so intra-session reads always see current state via getSnapshot.
 */
export function McpToolsBridge({
  focusedId,
  trashId,
}: Readonly<{ focusedId: string; trashId: string | null }>) {
  const store = useCollectionsStore();
  const details = useGraphDetailsStore();

  useEffect(
    () => registerWebMcpTools(createGraphTools({ store, details, focusedId, trashId })),
    [store, details, focusedId, trashId],
  );

  return null;
}
