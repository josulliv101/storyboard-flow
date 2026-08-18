"use client";

import { useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";

import {
  useCollectionsSelector,
  useCollectionsStore,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  collectionSubtreeHydrated,
  hydratedCollectionPlayableDuration,
  hydratedCollectionPreviews,
  resolveCollectionPreviews,
  type CollectionPreviewFrame,
  type CollectionPreviewsResult,
  type DetailsById,
} from "@storyboard/timeline-domain";

import { createDerivedCache } from "@/lib/derived-cache";
import { graphClipboard } from "@/lib/graph-clipboard";
import { graphPasteFlash } from "@/lib/graph-paste-flash";
import { resolveCardProvenance } from "@/lib/card-provenance";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

import { useGraphDetailsStore, useTimelineTitle } from "./graph-details-context";
import { isDisabledByAncestor } from "./graph-playhead-model";
import { GraphViewNavContext } from "./graph-navigation";
import { enabledChildCount, firstChildIsAudio } from "./graph-card-model";

/**
 * What a card SUBSCRIBES to — every `useSyncExternalStore` derivation the two
 * card kinds share.
 *
 * One theme runs through all of them, and it is the package's render-efficiency
 * model rather than a style choice: the collections store notifies for
 * INTERACTION updates too — drag begin/end, every distinct drop intent — not
 * only for commits. A bare selector therefore re-runs its walk on every one of
 * those notifications, and primitive equality stops the re-RENDER without ever
 * stopping the WALK. `snapshot.graph` keeps its reference until a commit, so
 * each derivation below is memoized on that identity (`createDerivedCache`) and
 * is a pure reference check for the length of a drag.
 *
 * The pure halves live in `graph-card-model` (and `lib/`), where the app's
 * vitest can reach them; these hooks own only the subscriptions.
 */

const NO_PREVIEWS: readonly CollectionPreviewFrame[] = [];
/** Stable identity for the disabled path — a fresh object each call would
 *  make useSyncExternalStore loop. */
const NO_PREVIEW_RESULT: CollectionPreviewsResult = {
  frames: NO_PREVIEWS,
  firstFrameUncertain: false,
};

/**
 * A hydrated collection card's preview frames, derived from its LIVE graph
 * children so a child edit (add, delete, reorder) refreshes the parent card
 * immediately — exactly as its live child COUNT already does — instead of
 * showing the stored frames until a reload. Disabled (empty) for media and
 * for un-hydrated placeholders, which keep their stored summary.
 *
 * On a commit the walk runs once, and the content-key layer keeps the returned
 * reference stable when this collection wasn't the one that changed —
 * bystander cards don't re-render, per the package's efficiency model.
 * Delimiters: \0 between fields, \x01 between entries — node ids are
 * arbitrary strings, so printable separators could collide.
 */
export function useHydratedCollectionPreviews(
  id: string,
  enabled: boolean,
): CollectionPreviewsResult {
  const store = useCollectionsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      compute: (graph: CollectionsGraph, nodeId: string) =>
        hydratedCollectionPreviews(graph, nodeId),
      // The flag JOINS the key. A walk can go from "ran into an unloaded
      // sub-collection" to "did not" while the frames it found stay identical
      // (both empty) — and those two resolve to different rendered frames. Key
      // on the frames alone and the cache hands back the stale reference, so
      // the card never repaints when its children finish loading.
      contentKey: (result) =>
        `${result.firstFrameUncertain ? 1 : 0}\x02` +
        result.frames
          .map((p) => `${p.id}\0${p.poster ?? p.src}\0${p.trimIn ?? 0}`)
          .join("\x01"),
    }),
  );
  const getSnapshot = useCallback(() => {
    if (!enabled) return NO_PREVIEW_RESULT;
    return derive(store.getSnapshot().graph, id);
  }, [store, derive, id, enabled]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Whether this collection LEADS with audio — see `firstChildIsAudio` for why
 * the FIRST child is the right question.
 *
 * Hydrated collections only. A placeholder has no graph children to read and
 * its stored summary carries no preview entry for audio, so it keeps the
 * leader — visibly wrong-ish, but inventing an answer from no data is worse.
 */
export function useFirstChildIsAudio(id: NodeId): boolean {
  const store = useCollectionsStore();
  const getSnapshot = useCallback(
    () => firstChildIsAudio(store.getSnapshot().graph, id),
    [store, id],
  );
  // A boolean, so the selector's identity is stable by construction — the
  // package's render-efficiency model requires selectors not to allocate.
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * A collection's ENABLED child count, from its live graph children.
 *
 * Exported because the sub-timeline ROW shows the same number as the card —
 * two copies of "enabled children" would drift, and the two sit on screen
 * together.
 */
export function useEnabledChildCount(id: NodeId): number {
  const store = useCollectionsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      compute: enabledChildCount,
      contentKey: (count: number) => String(count),
    }),
  );
  const getSnapshot = useCallback(
    () => derive(store.getSnapshot().graph, id),
    [store, derive, id],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * The frames a collection PRESENTS: live once hydrated, and the stored summary
 * until then.
 *
 * Exported because the sub-timeline ROW shows the same frames as the card.
 * Two copies of this rule would drift the moment either changed, and the two
 * sit on screen together — the row is the tree view of the very cards beside
 * it, so a disagreement would be visible rather than theoretical.
 */
export function useCollectionPreviewFrames(
  id: string,
  hydrated: boolean,
  stored: readonly CollectionPreviewFrame[] | undefined,
): readonly CollectionPreviewFrame[] {
  const live = useHydratedCollectionPreviews(id, hydrated);
  // Live frames win, EXCEPT when the walk came up empty because a
  // sub-collection was not loaded — there the server's stored summary knows
  // more. See resolveCollectionPreviews.
  const all = hydrated ? resolveCollectionPreviews(live, stored) : (stored ?? NO_PREVIEWS);
  // ONE frame, full width (PL13-003). It used to be a first/last PAIR, which
  // at card size meant two ~80px slots: too narrow to recognize a face, and the
  // crop turned a composition into a slice of one. The item count beside the
  // duration already says how many, so the pair was not carrying that either.
  //
  // KNOWN LIMITATION, deliberate and worth revisiting: this is the FIRST
  // child's frame, and in a video project a first frame is very often a slate,
  // a logo or a fade from black — this repo's own demo renders "A Universal
  // Picture" for one collection. A representative frame (the midpoint of the
  // collection's own duration) is the better answer and needs the preview
  // machinery to resolve a time, which is its own change.
  // `slice(0, 1)` rather than `[all[0]]`: it yields the same one-frame list
  // without constructing an array that could hold `undefined`.
  return useMemo(() => (all.length > 1 ? all.slice(0, 1) : all), [all]);
}

/**
 * A hydrated collection card's TOTAL content duration, derived from its live
 * graph children (recursively) so it tracks child edits immediately — the same
 * live-over-stored treatment the count and preview frames already get.
 * Disabled (null) for media and un-hydrated placeholders, which fall back to
 * the stored `detail.duration`.
 *
 * Memoized on the identities of BOTH inputs: the committed graph is replaced
 * only by a commit, and the details table's `read()` returns a stable object
 * until an entry actually changes — so the recursive descendant walk runs only
 * when one of them really did. The rounded content key keeps sub-millisecond
 * recompute jitter from churning the value.
 */
/**
 * Whether this collection's readouts can be VOUCHED for — it and everything
 * under it loaded.
 *
 * Separate from the card's `hydrated` flag, which only says its own children
 * arrived. `useHydratedCollectionSeconds` will happily answer for a partly
 * loaded tree by substituting stored summaries for the missing parts, and those
 * summaries drift (58.4% of collection clips carry at least one stale field).
 * This is what lets the card decline to show that answer.
 *
 * Recomputed on every graph or details change rather than cached: it is a walk
 * of nodes already in memory, and it must flip the moment a branch finishes
 * loading — that flip IS the number appearing.
 */
export function useCollectionSubtreeHydrated(id: string): boolean {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const getSnapshot = useCallback(
    () =>
      collectionSubtreeHydrated(
        store.getSnapshot().graph,
        detailsStore.read(),
        id as NodeId,
        // The gateway is the only place that knows a document is GONE rather
        // than merely unloaded — the server reports it and `ensureClosure`
        // keeps the list.
        graphDocumentsGateway.isKnownMissing,
      ),
    [store, detailsStore, id],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubStore = store.subscribe(onChange);
      const unsubDetails = detailsStore.subscribe(onChange);
      return () => {
        unsubStore();
        unsubDetails();
      };
    },
    [store, detailsStore],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useHydratedCollectionSeconds(id: string, enabled: boolean): number | null {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      // PLAYABLE seconds, not the layout span: this is the card's readout, and
      // it should say what a viewer would sit through. The layout twin
      // (`hydratedCollectionDuration`) still drives the clip's duration in the
      // projection, where the disabled slot has to survive.
      compute: (graph: CollectionsGraph, details: DetailsById, nodeId: NodeId) =>
        hydratedCollectionPlayableDuration(graph, details, nodeId),
      contentKey: (seconds) => String(Math.round(seconds * 1000)),
    }),
  );
  const getSnapshot = useCallback(() => {
    if (!enabled) return null;
    return derive(store.getSnapshot().graph, detailsStore.read(), id as NodeId);
  }, [store, detailsStore, derive, id, enabled]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubStore = store.subscribe(onChange);
      const unsubDetails = detailsStore.subscribe(onChange);
      return () => {
        unsubStore();
        unsubDetails();
      };
    },
    [store, detailsStore],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Whether a COLLECTION above this card is disabled. The walk itself is
 * `isDisabledByAncestor` in graph-playhead-model, shared with the seek rail so
 * the card and the rail can never disagree about what is off.
 */
export function useDisabledByAncestor(id: NodeId): boolean {
  const store = useCollectionsStore();
  const [derive] = useState(() =>
    createDerivedCache({
      compute: (graph: CollectionsGraph, nodeId: NodeId) =>
        isDisabledByAncestor(graph, nodeId as string),
      contentKey: String,
    }),
  );
  const getSnapshot = useCallback(
    () => derive(store.getSnapshot().graph, id),
    [store, derive, id],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Where a card's item actually LIVES, when that is not the timeline you are
 * looking at — the flat strip's answer to the context it gives up.
 *
 * Returns null in the ordinary nested strip, and it needs no mode flag to do
 * so: there, every card's parent IS the focused collection, so the comparison
 * is false by construction. In a flat run the cards drawn from nested
 * collections differ, and exactly those get a label. Direct children of the
 * focused timeline stay unlabelled in both readings, which is right — their
 * collection is the one on screen.
 */
export function useCardProvenance(
  id: NodeId,
): Readonly<{ parentId: NodeId; name: string }> | null {
  const nav = useContext(GraphViewNavContext);
  const focusedId = nav?.focusedId ?? null;
  // Primitive returns, per the store's selector contract.
  const parentId = useCollectionsSelector(
    (snapshot) => snapshot.graph.parentById.get(id) ?? null,
  );
  const nodeName = useCollectionsSelector((snapshot) => {
    const parent = snapshot.graph.parentById.get(id);
    return parent ? (snapshot.graph.nodesById.get(parent)?.name ?? null) : null;
  });
  // The document title is the source of truth for a collection's name (the
  // graph node is the optimistic fallback until it loads) — same resolution
  // the collection card and the breadcrumb use, so a rename shows here too.
  const title = useTimelineTitle((parentId ?? "") as string);

  // The DECISION lives in lib/card-provenance (unit-tested); this hook owns
  // only the three subscriptions above.
  const resolved = resolveCardProvenance({
    parentId: (parentId as string | null) ?? null,
    focusedId,
    title: title ?? null,
    nodeName,
  });
  return resolved === null ? null : { parentId: resolved.parentId as NodeId, name: resolved.name };
}

/**
 * This card's two clipboard states, each subscribed PER NODE.
 *
 * Narrowed on purpose. Both stores publish a set of ids, and reading the set
 * would re-render every card on the board whenever anything anywhere was cut or
 * pasted — the package's render-efficiency invariant, and the mistake the
 * context menu's state hook already exists to avoid. Asking "is it me?" returns
 * a boolean that does not move for an uninvolved card.
 */
export function useCardClipboardState(id: NodeId): Readonly<{
  pendingCut: boolean;
  flashing: boolean;
}> {
  const pendingCut = useSyncExternalStore(
    graphClipboard.subscribe,
    () => graphClipboard.isPendingCut(id),
    () => false,
  );
  const flashing = useSyncExternalStore(
    graphPasteFlash.subscribe,
    () => graphPasteFlash.isFlashing(id),
    () => false,
  );
  return { pendingCut, flashing };
}
