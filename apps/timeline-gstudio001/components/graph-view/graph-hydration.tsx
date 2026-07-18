"use client";

import { useEffect } from "react";

import {
  getChildren,
  parseNodeId,
  useCollectionsStore,
  type CollectionsStore,
} from "@storyboard/ui/dnd-collections";
import { buildHydrationSpecs, type ClipDetail } from "@storyboard/timeline-domain";

import type { GraphDetailsStore } from "@/lib/graph-details-store";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

import { useGraphDetailsStore } from "./graph-details-context";
import { FALLBACK_DETAIL } from "./graph-view-config";

/** A hydration failure is a DOCUMENT problem the user must see — a silent
 *  return here once left a collection showing "9 items" with an empty
 *  drill-in for a whole debugging session. Keyed apart from the gateway's
 *  own load/save errors for the same id. */
function reportHydrationIssue(timelineId: string, message: string | null) {
  graphDocumentsGateway.reportIssue(
    `hydrate:${timelineId}`,
    message === null ? null : `Timeline "${timelineId}" could not load its clips: ${message}`,
  );
}

/** Fetch and hydrate one placeholder timeline, including its app-side detail entries. */
export async function hydrateTimeline(
  store: CollectionsStore,
  detailsStore: GraphDetailsStore,
  timelineId: string,
): Promise<void> {
  if (detailsStore.get(timelineId)?.hydrated === true) return;

  const document = await graphDocumentsGateway.ensure(timelineId);
  if (!document) return; // the gateway surfaced the load failure itself

  const current = store.getSnapshot().graph;
  const collectionId = parseNodeId(timelineId);
  if (!current.nodesById.has(collectionId)) return;

  if (getChildren(current, collectionId).length > 0) {
    const payload = buildHydrationSpecs(graphDocumentsGateway.read(), timelineId, 0);
    if (!payload.ok) {
      reportHydrationIssue(timelineId, payload.error);
      return;
    }

    const details = detailsStore.read();
    const merged: Record<string, ClipDetail> = {};
    for (const [id, detail] of Object.entries(payload.value.details)) {
      if (details[id] === undefined && current.nodesById.has(parseNodeId(id))) {
        merged[id] = detail;
      }
    }
    const own = details[timelineId];
    merged[timelineId] = own ? { ...own, hydrated: true } : { ...FALLBACK_DETAIL, hydrated: true };
    detailsStore.merge(merged);
    reportHydrationIssue(timelineId, null);
    return;
  }

  const payload = buildHydrationSpecs(
    graphDocumentsGateway.read(),
    timelineId,
    0,
    current.nodesById.keys(),
  );
  if (!payload.ok) {
    reportHydrationIssue(timelineId, payload.error);
    return;
  }

  const applied = store.hydrate(collectionId, payload.value.specs);
  if (!applied.ok) {
    reportHydrationIssue(timelineId, JSON.stringify(applied.error));
    return;
  }

  const merged: Record<string, ClipDetail> = { ...payload.value.details };
  const own = detailsStore.get(timelineId);
  merged[timelineId] = own ? { ...own, hydrated: true } : { ...FALLBACK_DETAIL, hydrated: true };
  detailsStore.merge(merged);
  reportHydrationIssue(timelineId, null);
}

/** Hydrate the focus path plus the shallow inline timelines rendered below it. */
export function HydrationController({
  projectId,
  segments,
  onFocusError,
}: Readonly<{
  projectId: string;
  segments: readonly string[];
  onFocusError: (error: string | null) => void;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const pathKey = segments.join("/");

  useEffect(() => {
    let cancelled = false;
    const path = pathKey === "" ? [] : pathKey.split("/");
    const focusedId = path[path.length - 1] ?? projectId;

    void (async () => {
      const ensure = (timelineId: string) => hydrateTimeline(store, detailsStore, timelineId);
      let error: string | null = null;
      let previous: string | null = null;

      for (const segment of [projectId, ...path]) {
        if (cancelled) return;
        const graph = store.getSnapshot().graph;
        const node = graph.nodesById.get(parseNodeId(segment));
        if (node === undefined || node.kind !== "collection") {
          error = `This project has no timeline "${segment}".`;
          break;
        }
        if (
          previous !== null &&
          graph.parentById.get(parseNodeId(segment)) !== parseNodeId(previous)
        ) {
          error = `Timeline "${segment}" is not inside "${previous}".`;
          break;
        }
        await ensure(segment);
        previous = segment;
      }

      if (error === null && !cancelled) {
        const collectionChildrenOf = (id: string) => {
          const graph = store.getSnapshot().graph;
          return getChildren(graph, parseNodeId(id))
            .filter((childId) => graph.nodesById.get(childId)?.kind === "collection")
            .map((childId) => childId as string);
        };
        const children = collectionChildrenOf(focusedId);
        await Promise.all(children.map(ensure));
        if (!cancelled) {
          const grandchildren = children.flatMap(collectionChildrenOf);
          await Promise.all(grandchildren.map(ensure));
        }
      }

      if (!cancelled) onFocusError(error);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathKey, projectId, store, detailsStore, onFocusError]);

  return null;
}
