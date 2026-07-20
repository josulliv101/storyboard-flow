"use client";

import { useEffect } from "react";

import { useCollectionsStore, type CollectionsChange } from "@storyboard/ui/dnd-collections";
import {
  collectAffectedCollectionIds,
  graphChildrenToClips,
} from "@storyboard/timeline-domain";

import { collectReachableDetailIds } from "@/lib/graph-details-store";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

import { claimPendingPaletteDetails } from "./graph-pending-details";
import { useGraphDetailsStore } from "./graph-details-context";

export type SyncEntry = Readonly<{
  at: number;
  origin: CollectionsChange["origin"];
  patchType: CollectionsChange["patch"]["type"];
  collections: readonly string[];
  bounced?: boolean;
}>;

/**
 * Persist committed graph patches.
 *
 * Drops into un-hydrated collections are NOT handled here — they are refused
 * before they commit, by the `commandPolicy` in graph-timeline-view.tsx.
 * This bridge used to bounce them post-commit with `store.undo()`, which
 * looked equivalent but silently destroyed the user's redo branch (the
 * commit clears it) and left the refused command itself redoable. Anything
 * reaching this subscriber is a change that is meant to stick.
 */
export function PersistenceBridge({
  onSync,
}: Readonly<{
  onSync: (entry: SyncEntry) => void;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  useEffect(
    () =>
      store.subscribeToChanges((change) => {
        const claimed = claimPendingPaletteDetails(change.patch);
        if (claimed) detailsStore.merge(claimed);

        // A rename rides a `nodes-updated` patch. The child document is the
        // source of truth for a collection's title (the server derives every
        // parent's collection-clip title from it), so the graph rename is
        // persisted as a TITLE write here — including when it arrives via
        // undo/redo, which is what keeps the two representations from
        // diverging again the moment someone undoes a rename.
        if (change.patch.type === "nodes-updated") {
          for (const update of change.patch.updates) {
            if (update.after.kind !== "collection") continue;
            if (update.after.name === update.before.name) continue;
            void graphDocumentsGateway.renameTimeline(update.nodeId as string, update.after.name);
          }
        }

        const current = detailsStore.read();
        const affected = collectAffectedCollectionIds(change.graph, change.patch).filter(
          (id) =>
            graphDocumentsGateway.peek(id) !== null &&
            current[id]?.hydrated !== false &&
            // A conflicted document's graph is stale: `writeClips` refuses it
            // anyway, and filtering here keeps the sync log from reporting a
            // write that did not happen.
            !graphDocumentsGateway.isConflicted(id),
        );
        for (const id of affected) {
          graphDocumentsGateway.writeClips(id, graphChildrenToClips(change.graph, current, id));
        }
        onSync({
          at: Date.now(),
          origin: change.origin,
          patchType: change.patch.type,
          collections: affected,
        });
      }),
    [store, detailsStore, onSync],
  );

  return null;
}

/** Prune detail entries only after they leave both the graph and undo history. */
export function GraphDetailsJanitor() {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  useEffect(
    () =>
      store.subscribeToChanges(() => {
        const snapshot = store.getSnapshot();
        if (snapshot.canRedo) return;
        detailsStore.prune(collectReachableDetailIds(snapshot));
      }),
    [store, detailsStore],
  );

  return null;
}

export function SyncPanel({ entries }: { entries: readonly SyncEntry[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Patch-scoped document writes
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          No writes yet — reorder, trim, nest, or undo and watch which timeline documents are
          queued for persistence. Hydration never appears here because loading data is not a
          change worth writing back.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-zinc-400">
          {entries.map((entry) => (
            <li key={entry.at} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-zinc-100">{entry.origin}</span>
              <span>{entry.patchType}</span>
              <span aria-hidden="true">→</span>
              {entry.bounced ? (
                <span className="text-amber-400">
                  reverted — {entry.collections.join(", ")} still loading
                </span>
              ) : (
                <span className="text-sky-400">
                  {entry.collections.length === 0
                    ? "(nothing stored)"
                    : entry.collections.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
