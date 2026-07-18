import type { CollectionsPatch, CollectionsSnapshot } from "@storyboard/ui/dnd-collections";
import type { ClipDetail, DetailsById } from "@storyboard/timeline-domain";

// The graph view's details side-table (app-only clip fields: alt, aspect,
// poster, trims, hydrated flags…) as an EXTERNAL subscribe/snapshot store —
// the same shape as the documents gateway — instead of React state threaded
// through context. Two reasons (both review findings):
//
//   - Rerender scope. With details in context, EVERY commit (each hydration
//     step, each palette claim) invalidated the context value and re-rendered
//     every card on the board. Here a card subscribes to ITS entry via
//     `useSyncExternalStore` (see `useClipDetail` in the view), so a detail
//     commit re-renders exactly the cards it touched.
//   - Synchronous reads. Hydration and the persistence bridge read details
//     mid-async-flow; React state made those reads stale-by-a-render and
//     forced ref-mirroring dances. `read()` is always current, so the
//     accumulator/ref workarounds disappear.
//
// One store per view session (created with the provider, in component
// state) — NOT a module singleton: details are scoped to a project's graph
// session exactly like the engine store they annotate.

export type GraphDetailsStore = Readonly<{
  /** Current side-table snapshot. Entry references are stable until that
   *  entry itself changes — selector hooks rely on this. */
  read: () => DetailsById;
  /** One entry, or undefined. Safe to call imperatively in event handlers. */
  get: (id: string) => ClipDetail | undefined;
  /** Merge entries in (the only grow path). No-op (and no notify) when every
   *  entry is reference-identical to what's stored. */
  merge: (entries: Readonly<Record<string, ClipDetail>>) => void;
  /** Replace the whole table (boot). */
  replaceAll: (entries: DetailsById) => void;
  /** Drop every entry whose id is not in `keep` (lifecycle cleanup — see
   *  collectReachableDetailIds). No notify when nothing was dropped. */
  prune: (keep: ReadonlySet<string>) => void;
  subscribe: (listener: () => void) => () => void;
}>;

export function createGraphDetailsStore(initial: DetailsById = {}): GraphDetailsStore {
  let details: DetailsById = initial;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    read: () => details,
    get: (id) => details[id],
    merge: (entries) => {
      let changed = false;
      for (const [id, detail] of Object.entries(entries)) {
        if (details[id] !== detail) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      details = { ...details, ...entries };
      notify();
    },
    replaceAll: (entries) => {
      details = entries;
      notify();
    },
    prune: (keep) => {
      let dropped = false;
      const next: Record<string, ClipDetail> = {};
      for (const [id, detail] of Object.entries(details)) {
        if (keep.has(id)) next[id] = detail;
        else dropped = true;
      }
      if (!dropped) return;
      details = next;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Every node id a patch mentions — added, removed, moved, or updated. */
function nodeIdsInPatch(patch: CollectionsPatch): string[] {
  switch (patch.type) {
    case "nodes-moved":
      return patch.moves.map((move) => move.nodeId as string);
    case "nodes-added":
      return patch.adds.map((add) => add.node.id as string);
    case "nodes-removed":
      return patch.removals.map((removal) => removal.node.id as string);
    case "nodes-updated":
      return patch.updates.map((update) => update.nodeId as string);
  }
}

/**
 * The ids whose details must SURVIVE a prune: everything in the live graph,
 * plus everything any undo-stack patch mentions — undoing a removal
 * resurrects its node, and a resurrected node without its detail would bake
 * fallback alt/aspect/poster into the next write that touches its document.
 *
 * The redo stack is NOT visible in the snapshot, so callers must only prune
 * while `canRedo` is false (an undone add could otherwise resurrect a node
 * whose detail was just dropped). Any fresh command clears the redo branch,
 * so the deferral window is short in practice. Entries that fall off the
 * capped history stop being reachable and become prunable — which is
 * exactly the leak this exists to plug.
 */
export function collectReachableDetailIds(
  snapshot: Pick<CollectionsSnapshot, "graph" | "historyEntries">,
): Set<string> {
  const keep = new Set<string>();
  for (const id of snapshot.graph.nodesById.keys()) keep.add(id as string);
  for (const entry of snapshot.historyEntries) {
    for (const id of nodeIdsInPatch(entry.patch)) keep.add(id);
  }
  return keep;
}
