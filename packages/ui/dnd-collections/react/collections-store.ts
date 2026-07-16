"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import {
  type CollectionsGraph,
  type GraphNodeSpec,
  type GraphValidationError,
  type NodeId,
  type Result,
  validateGraph,
} from "../core/graph";
import { hydrateCollection, type HydrateRejection } from "../core/hydrate";
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
  /** True while ANY drag is live — node drags and palette drags alike. */
  isDragging: boolean;
  /** Ids being dragged, pressed id first (empty when idle; empty during palette drags). Multi-drag = the selection, pruned by the reducer. */
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

/** Thrown when store construction receives a malformed normalized graph. */
export class InvalidInitialGraphError extends Error {
  readonly validationError: GraphValidationError;

  constructor(validationError: GraphValidationError) {
    const detail =
      validationError.reason === "graph-invariant"
        ? `Graph invariant violation: ${JSON.stringify(validationError.violation)}`
        : validationError.message;
    super(`Invalid initial collections graph at ${validationError.path}: ${detail}`);
    this.name = "InvalidInitialGraphError";
    this.validationError = validationError;
  }
}

export type CollectionsStore = Readonly<{
  getSnapshot: () => CollectionsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /**
   * Subscribe to the COMMITTED-change feed — the same events (and ordering
   * guarantees) as the `onChange` option, as a multi-listener seam. For
   * views/tooling that need the PATCH of a commit (e.g. a virtual view
   * resizing exactly the nodes a `nodes-updated` patch touched), which the
   * snapshot deliberately doesn't carry. Fires for dispatch/undo/redo;
   * `replaceGraph` deliberately emits nothing here either.
   */
  subscribeToChanges: (listener: (change: CollectionsChange) => void) => () => void;

  dispatch: (command: CollectionsCommand) => Result<CollectionsPatch, CommandRejection>;
  undo: () => boolean;
  redo: () => boolean;
  /**
   * Swap in a new committed graph wholesale — the escape hatch for
   * async/server-loaded data that `initialGraph` (initial-only) can't handle.
   * Clears undo/redo history (patches were built against the old graph and
   * can't be replayed on this one) and any in-progress drag/preview, and
   * prunes the selection to ids that still exist. Does NOT fire `onChange`:
   * the caller pushed this state in, so echoing it back invites feedback
   * loops — this is a reset, not a recorded mutation.
   */
  replaceGraph: (graph: CollectionsGraph) => Result<void, GraphValidationError>;
  /**
   * Fill an EMPTY collection (a lazy-loaded placeholder) with a denormalized
   * subtree — `replaceGraph`'s incremental sibling for hydrate-on-focus.
   * Because hydration only ADDS nodes under a childless collection, every
   * history patch stays replayable, so — unlike `replaceGraph` — undo/redo
   * SURVIVES. Hydration is IO landing, not user intent: it pushes no history
   * entry and emits nothing on `onChange`/`subscribeToChanges` (undoing "the
   * data loaded", or writing it back to the storage it came from, would both
   * be nonsense). Snapshot subscribers are notified so views re-render.
   * Consumers keeping geometry caches keyed to `subscribeToChanges` should
   * also rebuild after a hydrate they issued.
   */
  hydrate: (
    collectionId: NodeId,
    children: readonly GraphNodeSpec[]
  ) => Result<void, HydrateRejection>;

  /** Replace selection with the supplied ids that exist in the current graph. */
  setSelection: (ids: readonly NodeId[]) => void;
  /** Toggle an existing graph node; missing ids are ignored. */
  toggleSelected: (id: NodeId) => void;
  clearSelection: () => void;

  /** Computes the drag set: the selection if the pressed node is in it, else just the pressed node. */
  beginDrag: (pressedId: NodeId) => void;
  /** Marks a palette (brand-new-node) drag live — no activeIds, but isDragging and intents flow. */
  beginPaletteDrag: () => void;
  setDropIntent: (intent: DropIntent | null) => void;
  endDrag: () => void;
  flashRejection: (ids: readonly NodeId[]) => void;
  /** Clears listeners and any pending rejection-flash timer. The provider calls this on unmount. */
  destroy: () => void;
}>;

const REJECTION_FLASH_MS = 600;

const EMPTY_IDS: readonly NodeId[] = [];
const EMPTY_SELECTION: ReadonlySet<NodeId> = new Set();

export function createCollectionsStore(
  initialGraph: CollectionsGraph,
  options?: Readonly<{
    onChange?: (change: CollectionsChange) => void;
    /** Cap the undo stack (oldest entries fall off). Positive integer; default unbounded. */
    maxHistoryEntries?: number;
  }>
): CollectionsStore {
  const initialValidation = validateGraph(initialGraph);
  if (!initialValidation.ok) {
    throw new InvalidInitialGraphError(initialValidation.error);
  }
  let graph = initialGraph;
  let interaction: CollectionsInteraction = {
    isDragging: false,
    activeIds: EMPTY_IDS,
    activeIdSet: EMPTY_SELECTION,
    dropIntent: null,
    dropIntentInvalid: false,
    selectedIds: EMPTY_SELECTION,
    rejectedIdSet: EMPTY_SELECTION,
  };
  const history = createHistory({ maxEntries: options?.maxHistoryEntries });
  const listeners = new Set<() => void>();
  const changeListeners = new Set<(change: CollectionsChange) => void>();
  const onChange = options?.onChange;
  const pendingChanges: CollectionsChange[] = [];
  let notificationDepth = 0;
  let emittingChanges = false;
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

  function flushPendingChanges() {
    if ((!onChange && changeListeners.size === 0) || emittingChanges) return;
    emittingChanges = true;
    try {
      let change = pendingChanges.shift();
      while (change) {
        onChange?.(change);
        for (const listener of changeListeners) listener(change);
        change = pendingChanges.shift();
      }
    } finally {
      emittingChanges = false;
    }
  }

  function notify(change?: CollectionsChange) {
    if (change && (onChange || changeListeners.size > 0)) pendingChanges.push(change);
    snapshot = buildSnapshot();
    notificationDepth += 1;
    try {
      listeners.forEach((listener) => listener());
    } finally {
      notificationDepth -= 1;
      // A listener may dispatch synchronously. Defer the change feed until
      // the outermost notification completes so nested commits are emitted
      // in commit order, each with the graph captured for its own patch.
      if (notificationDepth === 0) flushPendingChanges();
    }
  }

  function setInteraction(next: Partial<CollectionsInteraction>) {
    interaction = { ...interaction, ...next };
    notify();
  }

  // Nodes can leave the graph (undoing a palette add inverts to a removal);
  // ephemeral ids must not outlive them. A stale selected id would poison
  // the next multi-drag: the reducer rejects the whole command with
  // missing-node and the drop does nothing. Identity contract holds: the
  // selection set keeps its reference when nothing was pruned.
  function pruneMissingSelection() {
    const selected = interaction.selectedIds;
    if (selected.size === 0) return;
    let next: Set<NodeId> | null = null;
    for (const id of selected) {
      if (!graph.nodesById.has(id)) {
        (next ??= new Set(selected)).delete(id);
      }
    }
    if (next) interaction = { ...interaction, selectedIds: next };
  }

  function dispatch(
    command: CollectionsCommand
  ): Result<CollectionsPatch, CommandRejection> {
    const result = applyCommand(graph, command);
    if (!result.ok) return { ok: false, error: result.error };

    graph = result.value.graph;
    history.push({ command, patch: result.value.patch, at: Date.now() });
    refreshHistoryEntries();
    pruneMissingSelection();
    notify({ graph, command, patch: result.value.patch, origin: "command" });
    return { ok: true, value: result.value.patch };
  }

  function undo(): boolean {
    const inverse = history.undo();
    if (!inverse) return false;
    graph = applyPatch(graph, inverse);
    refreshHistoryEntries();
    pruneMissingSelection();
    notify({ graph, patch: inverse, origin: "undo" });
    return true;
  }

  function redo(): boolean {
    const patch = history.redo();
    if (!patch) return false;
    graph = applyPatch(graph, patch);
    refreshHistoryEntries();
    pruneMissingSelection();
    notify({ graph, patch, origin: "redo" });
    return true;
  }

  function replaceGraph(
    nextGraph: CollectionsGraph
  ): Result<void, GraphValidationError> {
    const validation = validateGraph(nextGraph);
    if (!validation.ok) return validation;

    graph = nextGraph;
    // Old patches were built against the old graph — they can't be replayed
    // on this one, so undo/redo starts fresh.
    history.clear();
    refreshHistoryEntries();
    // A wholesale swap invalidates every transient interaction. Reset drag,
    // preview, and any pending rejection flash; keep the selection but prune
    // it to ids the new graph still contains (pruneMissingSelection reads the
    // current `interaction`, so seed it first).
    if (rejectionTimer !== null) {
      clearTimeout(rejectionTimer);
      rejectionTimer = null;
    }
    interaction = {
      isDragging: false,
      activeIds: EMPTY_IDS,
      activeIdSet: EMPTY_SELECTION,
      dropIntent: null,
      dropIntentInvalid: false,
      selectedIds: interaction.selectedIds,
      rejectedIdSet: EMPTY_SELECTION,
    };
    pruneMissingSelection();
    notify();
    // Deliberately no onChange: the caller supplied this graph, so echoing it
    // back would invite feedback loops. replaceGraph is a reset, not a
    // recorded mutation, and carries no patch.
    return { ok: true, value: undefined };
  }

  function hydrate(
    collectionId: NodeId,
    children: readonly GraphNodeSpec[]
  ): Result<void, HydrateRejection> {
    const result = hydrateCollection(graph, collectionId, children);
    if (!result.ok) return result;
    // Empty spec list: hydrateCollection returned the same graph — nothing
    // to notify anyone about.
    if (result.value === graph) return { ok: true, value: undefined };
    graph = result.value;
    // Nothing was removed and nothing moved: history, selection, and any
    // live drag/preview all remain valid — notify with no change payload
    // (no history entry, no change-feed event; see the type's doc comment).
    notify();
    return { ok: true, value: undefined };
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeToChanges: (listener) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },

    dispatch,
    undo,
    redo,
    replaceGraph,
    hydrate,

    setSelection: (ids) => {
      const next = new Set<NodeId>();
      for (const id of ids) {
        if (graph.nodesById.has(id)) next.add(id);
      }
      // Re-selecting the exact same set (e.g. clicking an already-selected
      // node) must not notify — a no-op state "change" would force every
      // subscriber to re-run its selector for nothing.
      if (sameSet(interaction.selectedIds, next)) return;
      setInteraction({ selectedIds: next });
    },
    toggleSelected: (id) => {
      if (!graph.nodesById.has(id)) return;
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
      // Pressed id FIRST: it is the primary drag-overlay item. (Set spread
      // would put the earliest-selected node first — dragging B from a
      // selection made A-then-B would ghost A.) The reducer re-sorts into
      // document order at commit, so this only affects the preview.
      const activeIds = interaction.selectedIds.has(pressedId)
        ? [pressedId, ...[...interaction.selectedIds].filter((id) => id !== pressedId)]
        : [pressedId];
      setInteraction({
        isDragging: true,
        activeIds,
        activeIdSet: new Set(activeIds),
        dropIntent: null,
        dropIntentInvalid: false,
      });
    },
    beginPaletteDrag: () =>
      setInteraction({ isDragging: true, dropIntent: null, dropIntentInvalid: false }),
    setDropIntent: (intent) => {
      // Intents are only meaningful while a drag is live. The dnd-kit gesture
      // can outlive the store's drag state — replaceGraph (async data landing
      // mid-drag) resets it, and a palette drag whose factory failed never set
      // it — but its collision loop keeps resolving and publishing. An ungated
      // write would repaint drop indicators for a drag the store says is over.
      // Clearing (null) is always allowed.
      if (intent !== null && !interaction.isDragging) return;
      if (intentEqual(interaction.dropIntent, intent)) return; // per-move noise gate
      // Validity is computed ONCE per intent change (not per card per
      // frame). The reducer enforces the same rule at commit, so this
      // preview can never disagree with the drop's actual outcome.
      const invalid = intent ? isIntentInvalid(graph, intent, interaction.activeIds) : false;
      setInteraction({ dropIntent: intent, dropIntentInvalid: invalid });
    },
    endDrag: () =>
      setInteraction({
        isDragging: false,
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

    destroy: () => {
      if (rejectionTimer !== null) clearTimeout(rejectionTimer);
      rejectionTimer = null;
      // The cancelled timer would have cleared this; don't strand a live
      // flash in a store that outlives destroy() (Activity-style hide runs
      // effect cleanup while retaining component state — on reveal the cards
      // would still render data-rejected).
      if (interaction.rejectedIdSet.size > 0) {
        interaction = { ...interaction, rejectedIdSet: EMPTY_SELECTION };
        snapshot = buildSnapshot();
      }
      listeners.clear();
      changeListeners.clear();
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
    case "insert-at-index":
      return (
        b.type === "insert-at-index" &&
        a.collectionId === b.collectionId &&
        a.index === b.index
      );
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
