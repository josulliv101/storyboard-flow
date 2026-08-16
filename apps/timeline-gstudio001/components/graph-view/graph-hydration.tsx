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
import { hydrationDocumentId } from "@/lib/hydration-target";

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

  // WHICH DOCUMENT, which is not always this id.
  //
  // Callers hand this a graph NODE id, and for an ordinary collection that is
  // also its timeline id — which is why passing it straight to the gateway
  // worked until someone made a duplicate. A duplicate placement is minted as
  // `dup:<parent>:<clip>`: a node here, a document nowhere. It went to the
  // gateway as-is and produced `GET /api/timelines/dup%3A…` → 400 Invalid
  // timeline id, once per duplicate on every hydration pass.
  //
  // A REFERENCE DOES NOT HYDRATE HERE, and did not before — it just used to
  // announce that by 400ing. Loading one would mean building specs from
  // another document and attaching them under this node, whose child ids may
  // already exist in the graph under the original placement; that is a real
  // change to the duplicate model and wants real data to verify, not a
  // late-night guess. So the behaviour is exactly what it was, minus a request
  // that could never have succeeded.
  const documentId = hydrationDocumentId(detailsStore.get(timelineId), timelineId);
  if (documentId !== timelineId) {
    // NOT AN ERROR, and saying so out loud was a regression of its own.
    //
    // A duplicate reference card does not hydrate here — deliberately, and it
    // never did. Removing the request that could not succeed was right; giving
    // its absence a red banner was not. A board with five duplicate cards on
    // it grew five alarms describing routine behaviour, which is worse than
    // the 400 in the network tab it replaced: that at least stayed out of the
    // way of the work.
    //
    // The two cases still differ, and the difference belongs in the console
    // rather than on the board. A recorded reference means the card is doing
    // exactly what a reference card does. A MISSING one means stored data
    // nobody can resolve — worth a developer's attention, still not worth
    // interrupting the person editing.
    if (documentId === null) {
      console.warn(
        `[GSTUDIO_HYDRATION] "${timelineId}" is a duplicate placement with no recorded reference; its card cannot load contents.`,
      );
    }
    // Clear any banner this id left behind, so a card that WAS unresolvable
    // and now is not stops being reported.
    reportHydrationIssue(timelineId, null);
    return;
  }

  const document = await graphDocumentsGateway.ensure(documentId);
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
      // Inside the async body, AFTER every hook — an early return placed above
      // a hook is a rules-of-hooks violation, which is how the first attempt
      // at this guard broke lint.
      if (focusedId === undefined) return;
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

/**
 * Hydrate the WHOLE closure under `rootId` — every nested collection, to any
 * depth — and resolve once nothing is left unhydrated.
 *
 * Flat mode needs this and the nested board does not: a strip showing one
 * collection's children only ever needs that collection loaded, but a flat run
 * IS the closure, so an unhydrated branch is not a collapsed row the user can
 * open — it is items silently missing from a list that claims to be complete.
 *
 * A LOOP rather than one pass, because hydrating a level is what reveals the
 * next: a placeholder's children only exist after its own document lands. Each
 * round hydrates every placeholder it can currently see, then re-reads the
 * graph and looks again; it ends when a round finds none.
 *
 * Rounds are bounded. Hydration can legitimately fail (a missing document, or
 * another user's) — `hydrateTimeline` reports that and returns, leaving the
 * collection unhydrated forever, so an unbounded loop would spin on it. The
 * cap also covers a graph deeper than any real timeline.
 *
 * `onProgress` fires after each round so a caller can show what has landed so
 * far; the gateway dedupes concurrent `ensure`s for the same id, so hydrating a
 * level in parallel costs one request per document, not one per reference.
 */
export async function hydrateClosure(
  store: CollectionsStore,
  detailsStore: GraphDetailsStore,
  rootId: string,
  { maxRounds = 16, onProgress }: Readonly<{
    maxRounds?: number;
    onProgress?: () => void;
  }> = {},
): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    const graph = store.getSnapshot().graph;
    const details = detailsStore.read();
    const pending: string[] = [];

    // Collect every unhydrated collection under the root, this round.
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const childId of getChildren(graph, parseNodeId(id))) {
        const node = graph.nodesById.get(childId);
        if (!node || node.kind !== "collection") continue;
        const childKey = childId as string;
        if (details[childKey]?.hydrated === true) visit(childKey);
        else pending.push(childKey);
      }
    };
    visit(rootId);

    if (pending.length === 0) return;
    // Parallel within a round: these are independent documents, and the
    // gateway collapses duplicate ids for us.
    await Promise.all(pending.map((id) => hydrateTimeline(store, detailsStore, id)));
    onProgress?.();

    // A round that hydrated nothing NEW would loop forever — every id in
    // `pending` failed to load and will keep failing. Stop and let their
    // reported errors stand.
    const after = detailsStore.read();
    if (!pending.some((id) => after[id]?.hydrated === true)) return;
  }
}

/**
 * Loads the whole closure while FLAT mode is on.
 *
 * Mounted inside the provider (the collections store lives only there) and
 * reports its pending state up, because the flag itself belongs to the view
 * state the sidebar mirrors.
 *
 * Re-runs on focus change as well as on entry: drilling into a different
 * collection while flat is on makes a different closure the subject.
 */
export function FlatClosureHydrator({
  enabled,
  focusedId,
  onLoadingChange,
}: Readonly<{
  enabled: boolean;
  focusedId: string;
  onLoadingChange: (loading: boolean) => void;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  useEffect(() => {
    if (!enabled) {
      onLoadingChange(false);
      return;
    }
    let cancelled = false;
    onLoadingChange(true);
    void hydrateClosure(store, detailsStore, focusedId).finally(() => {
      // A focus change or a flat-mode exit already superseded this run; its
      // "finished" would clear a flag the NEXT run had just raised.
      if (!cancelled) onLoadingChange(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, focusedId, store, detailsStore, onLoadingChange]);

  return null;
}
