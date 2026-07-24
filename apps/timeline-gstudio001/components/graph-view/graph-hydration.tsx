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

/**
 * Hydrate the focus path, then eagerly hydrate ONE level of inline child
 * timelines below the focus. That child level is already cache-warm (the RSC
 * layer primes it), so its graph hydration costs no extra fetch; it makes the
 * sub-rows' data present without a drill-in — collapsed rows STAY collapsed
 * (a row's strip is gated on its own `expanded` state, not on hydration).
 * Grandchildren and deeper stay lazy, hydrating on their row's first expand.
 */
export function HydrationController({
  projectId,
  segments,
  serverPrimed,
  onFocusError,
}: Readonly<{
  projectId: string;
  segments: readonly string[];
  /** True when this session booted from RSC payloads — the server also
   *  streams each navigation's focus-path documents, so hydration should
   *  WAIT for those primes instead of racing them with its own fetches. */
  serverPrimed: boolean;
  onFocusError: (error: string | null) => void;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  useEffect(() => {
    let cancelled = false;
    // `segments` IS the path. It used to be round-tripped through
    // `segments.join("/")` and split back apart to get a primitive effect
    // dependency — but a NodeId may contain any non-whitespace character, so
    // an id like "scene/a" was torn into two ids that address nothing: the
    // drill-in reported a nonexistent path and primed the wrong documents.
    // The parent memoizes this array, so it is already a stable dependency.
    const path = segments;

    // The page is streaming these documents right now: give the primes a
    // grace window so the RSC payload wins the race instead of every
    // segment being fetched twice. (Registered only for ids the cache
    // can't already serve.)
    if (serverPrimed && path.length > 0) {
      graphDocumentsGateway.expectPrimes(path);
    }

    void (async () => {
      const ensure = (timelineId: string) => hydrateTimeline(store, detailsStore, timelineId);
      const focusChain = [projectId, ...path];
      let error: string | null = null;
      let previous: string | null = null;

      // The FOCUS PATH is hydrated up front, in order.
      for (const segment of focusChain) {
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

      if (!cancelled) onFocusError(error);
      if (cancelled || error !== null) return;

      // Then eagerly hydrate ONE level below: the focused timeline's direct
      // child collections. That level is cache-warm (RSC-primed), so each is a
      // warm hit that just pulls the children into the graph — no drill-in
      // needed, so sub-rows carry live data and are addressable by tools/moves
      // straight away. Rows still render collapsed (strip gated on `expanded`);
      // grandchildren stay lazy. Best-effort per child: a failure reports its
      // own issue (see hydrateTimeline) and never blocks the focus view.
      const focusedId = focusChain[focusChain.length - 1];
      for (const childId of getChildren(store.getSnapshot().graph, parseNodeId(focusedId))) {
        if (cancelled) return;
        const child = store.getSnapshot().graph.nodesById.get(childId);
        if (child?.kind === "collection") await ensure(childId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [segments, projectId, store, detailsStore, serverPrimed, onFocusError]);

  return null;
}
