"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { type CollectionsGraph, type NodeId, type Result } from "../core/graph";
import {
  applyCommand,
  type CollectionsCommand,
  type CommandRejection,
} from "../core/commands";
import { applyPatch, type CollectionsPatch } from "../core/patches";
import { createHistory, type HistoryEntry } from "../core/history";
import { isIntentInvalid, type DropIntent } from "../core/intents";

// The store is the single source of truth. It owns the committed graph
// (mutated ONLY by dispatching commands through the pure reducer) and the
// ephemeral interaction state (drag set, drop preview, selection, rejection
// flash) — kept separate so per-move churn never touches committed data.
// React reads it through `useCollectionsSelector`, whose per-hook
// `Object.is` bail means a component only re-renders when ITS selected
// slice changes. Combined with the reducer's structural sharing (untouched
// children arrays keep their identity), a drag over one collection leaves
// every uninvolved node's render untouched — that's the efficiency story.

export type CollectionsInteraction = Readonly<{
  /** Ids being dragged, in pick-up order (empty when idle). Multi-drag = the selection, pruned by the reducer. */
  activeIds: readonly NodeId[];
  /** Same ids as `activeIds`, as a Set — O(1) membership for per-card selectors. */
  activeIdSet: ReadonlySet<NodeId>;
  /** Live drop preview — what would happen if the user released now. */
  dropIntent: DropIntent | null;
  /** Whether the current dropIntent would be rejected (cycle) — drives the invalid overlay. */
  dropIntentInvalid: boolean;
  selectedIds: ReadonlySet<NodeId>;
  /** Ids briefly flashing a rejected-drop cue, as a Set for membership checks. */
  rejectedIdSet: ReadonlySet<NodeId>;
}>;

export type CollectionsSnapshot = Readonly<{
  graph: CollectionsGraph;
  interaction: CollectionsInteraction;
  canUndo: boolean;
  canRedo: boolean;
  historyEntries: readonly HistoryEntry[];
}>;

export type CollectionsChange = Readonly<{
  graph: CollectionsGraph;
  /** The originating command — present for direct dispatches, absent for undo/redo replays. */
  command?: CollectionsCommand;
  patch: CollectionsPatch;
  origin: "command" | "undo" | "redo";
}>;

export type CollectionsStore = Readonly<{
  getSnapshot: () => CollectionsSnapshot;
  subscribe: (listener: () => void) => () => void;

  dispatch: (command: CollectionsCommand) => Result<CollectionsPatch, CommandRejection>;
  undo: () => boolean;
  redo: () => boolean;

  setSelection: (ids: readonly NodeId[]) => void;
  toggleSelected: (id: NodeId) => void;
  clearSelection: () => void;

  /** Computes the drag set: the selection if the pressed node is in it, else just the pressed node. */
  beginDrag: (pressedId: NodeId) => void;
  setDropIntent: (intent: DropIntent | null) => void;
  endDrag: () => void;
  flashRejection: (ids: readonly NodeId[]) => void;
}>;

const REJECTION_FLASH_MS = 600;

const EMPTY_IDS: readonly NodeId[] = [];
const EMPTY_SELECTION: ReadonlySet<NodeId> = new Set();

export function createCollectionsStore(
  initialGraph: CollectionsGraph,
  options?: Readonly<{ onChange?: (change: CollectionsChange) => void }>
): CollectionsStore {
  let graph = initialGraph;
  let interaction: CollectionsInteraction = {
    activeIds: EMPTY_IDS,
    activeIdSet: EMPTY_SELECTION,
    dropIntent: null,
    dropIntentInvalid: false,
    selectedIds: EMPTY_SELECTION,
    rejectedIdSet: EMPTY_SELECTION,
  };
  const history = createHistory();
  const listeners = new Set<() => void>();
  let rejectionTimer: ReturnType<typeof setTimeout> | null = null;

  // history.entries() allocates a fresh array per call, so it must NOT be
  // read inside buildSnapshot (which runs on every interaction notify) —
  // that would hand historyEntries a new identity on every drag move and
  // break the "fields keep their identity unless they changed" contract the
  // selector hooks rely on. Cache it; refresh only on dispatch/undo/redo.
  let historyEntries: readonly HistoryEntry[] = history.entries();
  function refreshHistoryEntries() {
    historyEntries = history.entries();
  }

  // The snapshot is rebuilt (new identity) on every notify so
  // useSyncExternalStore consumers re-run their selectors; the FIELDS keep
  // their identities unless they actually changed, which is what lets those
  // selectors bail.
  let snapshot: CollectionsSnapshot = buildSnapshot();

  function buildSnapshot(): CollectionsSnapshot {
    return {
      graph,
      interaction,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      historyEntries,
    };
  }

  function notify() {
    snapshot = buildSnapshot();
    listeners.forEach((listener) => listener());
  }

  function setInteraction(next: Partial<CollectionsInteraction>) {
    interaction = { ...interaction, ...next };
    notify();
  }

  function dispatch(
    command: CollectionsCommand
  ): Result<CollectionsPatch, CommandRejection> {
    const result = applyCommand(graph, command);
    if (!result.ok) return { ok: false, error: result.error };

    graph = result.value.graph;
    history.push({ command, patch: result.value.patch, at: Date.now() });
    refreshHistoryEntries();
    notify();
    options?.onChange?.({ graph, command, patch: result.value.patch, origin: "command" });
    return { ok: true, value: result.value.patch };
  }

  function undo(): boolean {
    const inverse = history.undo();
    if (!inverse) return false;
    graph = applyPatch(graph, inverse);
    refreshHistoryEntries();
    notify();
    options?.onChange?.({ graph, patch: inverse, origin: "undo" });
    return true;
  }

  function redo(): boolean {
    const patch = history.redo();
    if (!patch) return false;
    graph = applyPatch(graph, patch);
    refreshHistoryEntries();
    notify();
    options?.onChange?.({ graph, patch, origin: "redo" });
    return true;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispatch,
    undo,
    redo,

    setSelection: (ids) => {
      const next = new Set(ids);
      // Re-selecting the exact same set (e.g. clicking an already-selected
      // node) must not notify — a no-op state "change" would force every
      // subscriber to re-run its selector for nothing.
      if (sameSet(interaction.selectedIds, next)) return;
      setInteraction({ selectedIds: next });
    },
    toggleSelected: (id) => {
      const next = new Set(interaction.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setInteraction({ selectedIds: next });
    },
    clearSelection: () => {
      if (interaction.selectedIds.size === 0) return;
      setInteraction({ selectedIds: EMPTY_SELECTION });
    },

    beginDrag: (pressedId) => {
      const activeIds = interaction.selectedIds.has(pressedId)
        ? [...interaction.selectedIds]
        : [pressedId];
      setInteraction({
        activeIds,
        activeIdSet: new Set(activeIds),
        dropIntent: null,
        dropIntentInvalid: false,
      });
    },
    setDropIntent: (intent) => {
      if (intentEqual(interaction.dropIntent, intent)) return; // per-move noise gate
      // Validity is computed ONCE per intent change (not per card per
      // frame). The reducer enforces the same rule at commit, so this
      // preview can never disagree with the drop's actual outcome.
      const invalid = intent ? isIntentInvalid(graph, intent, interaction.activeIds) : false;
      setInteraction({ dropIntent: intent, dropIntentInvalid: invalid });
    },
    endDrag: () =>
      setInteraction({
        activeIds: EMPTY_IDS,
        activeIdSet: EMPTY_SELECTION,
        dropIntent: null,
        dropIntentInvalid: false,
      }),

    flashRejection: (ids) => {
      if (rejectionTimer !== null) clearTimeout(rejectionTimer);
      setInteraction({ rejectedIdSet: new Set(ids) });
      rejectionTimer = setTimeout(() => {
        rejectionTimer = null;
        setInteraction({ rejectedIdSet: EMPTY_SELECTION });
      }, REJECTION_FLASH_MS);
    },
  };
}

function sameSet(a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function intentEqual(a: DropIntent | null, b: DropIntent | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  switch (a.type) {
    case "insert-adjacent":
      return b.type === "insert-adjacent" && a.side === b.side && a.targetId === b.targetId;
    case "nest-inside":
      return b.type === "nest-inside" && a.collectionId === b.collectionId;
    case "append-to-collection":
      return b.type === "append-to-collection" && a.collectionId === b.collectionId;
  }
}

// --- React bindings ----------------------------------------------------------

const CollectionsStoreContext = createContext<CollectionsStore | null>(null);
export const CollectionsStoreProvider = CollectionsStoreContext.Provider;

export function useCollectionsStore(): CollectionsStore {
  const store = useContext(CollectionsStoreContext);
  if (!store) {
    throw new Error("dnd-collections hooks must be used within <DndCollections>");
  }
  return store;
}

/**
 * Subscribe to a slice of the snapshot. The selector must return a primitive
 * or a reference that's stable while the slice is unchanged (graph arrays
 * qualify — the reducer shares structure); React skips the re-render when
 * consecutive results are `Object.is`-equal.
 */
export function useCollectionsSelector<T>(selector: (snapshot: CollectionsSnapshot) => T): T {
  const store = useCollectionsStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot())
  );
}
