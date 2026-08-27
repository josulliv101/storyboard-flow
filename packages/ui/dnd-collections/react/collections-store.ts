"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import {
  getChildren,
  type CollectionsGraph,
  type GraphNodeSpec,
  type GraphValidationError,
  type NodeId,
  type Result,
  validateGraph,
} from "@storyboard/collections-core/graph";
import { hydrateCollection, type HydrateRejection } from "@storyboard/collections-core/hydrate";
import {
  applyCommand,
  type CollectionsCommand,
  type CommandRejection,
} from "@storyboard/collections-core/commands";
import { applyPatch, verifyPatchApplies, type CollectionsPatch } from "@storyboard/collections-core/patches";
import { createHistory, type HistoryEntry } from "@storyboard/collections-core/history";
import { isIntentInvalid, type DropIntent } from "@storyboard/collections-core/intents";

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
  /**
   * The card the selection is "at" — the one most recently picked that is
   * still selected. Consumers hang UI on it (a toolbar rendered INSIDE that
   * card) and aim insert operations at it ("paste after the anchor").
   *
   * Stored rather than derived, and that is a deliberate reversal. It IS
   * derivable from `selectedIds` alone — a Set iterates insertion-first and
   * every mutator here appends — and it was derived while exactly one
   * consumer asked. Two things ended that:
   *
   *   - EVERY CARD now asks "am I the anchor?". Deriving it per card needs the
   *     memo that makes the answer stable across renders, and a memo per card
   *     can disagree with its neighbours — the toolbar drawn on one card while
   *     a paste lands after another.
   *   - `setAnchor` has no derived answer at all. Re-anchoring WITHOUT
   *     changing the selection (right-clicking a card that is already
   *     selected, to aim a paste) cannot be expressed as a function of the
   *     selection, because the selection does not change.
   *
   * Distinct from `selectionPivotId` below, which they are easy to conflate:
   * the anchor is the most recent pick and moves on every gesture; the pivot
   * is where a RANGE measures from and deliberately survives one.
   */
  anchorId: NodeId | null;
  /**
   * Where a RANGE extends FROM — the last card picked by a non-range gesture.
   *
   * Not the same thing as the card a consumer's toolbar points at, which is
   * simply the most recent pick and is derivable from `selectedIds` (a Set
   * iterates insertion-first, and every mutator here appends). This one is
   * not derivable: it must stay PUT across repeated shift+clicks, so that
   * overshooting a range and shift+clicking back shrinks it instead of
   * starting a new one from wherever the overshoot landed. That is the whole
   * reason shift+click exists, and the only reason this is state.
   *
   * Null when nothing has been picked yet; a range with no pivot falls back
   * to the clicked card, which selects just that card.
   */
  selectionPivotId: NodeId | null;
  /**
   * While true, a PLAIN click is additive — exactly as if Ctrl/Cmd were held.
   *
   * This exists for TOUCH, which has no modifier keys at all: without it,
   * multi-select and ranges are simply unreachable on a touchscreen. A mode is
   * the compromise. Long-press would have been the obvious gesture and is
   * already spent — a still press on a card marked `data-drag-activation="hold"`
   * starts a DRAG at 250ms (see `pointer-sensors.ts`), so a long-press to
   * multi-select would mean two different things on two surfaces.
   *
   * Not a policy prop: the policy is provider CONFIG, memoized on its fields,
   * so toggling it there would invalidate the context and re-render every card
   * that reads it. Here it rides the interaction slice the click handler
   * already consults.
   */
  multiSelectMode: boolean;
  /** Ids briefly flashing a rejected-drop cue, as a Set for membership checks. */
  rejectedIdSet: ReadonlySet<NodeId>;
}>;

export type CollectionsSnapshot = Readonly<{
  graph: CollectionsGraph;
  interaction: CollectionsInteraction;
  canUndo: boolean;
  canRedo: boolean;
  historyEntries: readonly HistoryEntry[];
  /**
   * Bumped by `replaceGraph` only — the one mutation after which every
   * derived cache (virtualizer measurements especially) is garbage. A
   * primitive, so views can subscribe to "the world was swapped" without
   * subscribing to every commit.
   */
  graphGeneration: number;
  /**
   * Per-PARENT data-change counters: the version for a collection bumps when
   * a `nodes-updated` patch touches one of ITS children (trim, rename —
   * commit, undo, or redo alike) or when the collection is hydrated. Moves,
   * adds, and removals deliberately do NOT bump — structure changes already
   * announce themselves through the children array's identity.
   *
   * This exists so a view can re-render when ITS OWN children's data changed
   * without subscribing to `graph.nodesById`, whose identity changes on
   * every data commit ANYWHERE — one trim used to re-render every mounted
   * virtual strip. Subscribe per key (`s.dataVersionByParent.get(id) ?? 0`
   * is a primitive); never select the MAP itself — its reference is stable
   * by design and will not trigger re-renders.
   */
  dataVersionByParent: ReadonlyMap<NodeId, number>;
}>;

export type CollectionsChange = Readonly<{
  graph: CollectionsGraph;
  /** The originating command — present for direct dispatches, absent for undo/redo replays. */
  command?: CollectionsCommand;
  patch: CollectionsPatch;
  /**
   * Where the change came from. `remote` is a change this session did not
   * make — another tab, or an agent writing through the server — applied via
   * `applyRemotePatch` and deliberately absent from local history.
   */
  origin: "command" | "undo" | "redo" | "remote";
}>;

/**
 * Rejection produced by a `commandPolicy` — kept OUT of the core's
 * `CommandRejection` union because the reducer never produces it: it is an
 * application veto, not a graph-validity failure.
 */
export type CommandPolicyRejection = Readonly<{
  reason: "blocked-by-policy";
  /** Ids the policy blames (e.g. the collections that refused the drop). */
  blockedIds: readonly NodeId[];
  /** Consumer-authored explanation, suitable for announcing to assistive tech. */
  message?: string;
}>;

/**
 * A consumer veto consulted BEFORE the reducer runs — the seam for
 * APPLICATION policy the pure command layer cannot know about ("this
 * collection's clips haven't loaded yet, so don't accept drops into it").
 * Return `null` to allow the command, or a rejection to block it.
 *
 * Must be a pure predicate over the command and the CURRENT committed graph;
 * it runs inside `dispatch`, so it must not dispatch reentrantly.
 *
 * This exists instead of the obvious "commit, inspect, undo if invalid"
 * because that sequence is NOT a no-op. `history.push` discards the redo
 * branch, so bouncing a drop that way destroys whatever the user had left to
 * redo AND leaves the refused command itself sitting on the redo stack,
 * ready to replay the very move that was just rejected. A refused command
 * must never reach history — which means it must never reach the reducer.
 */
export type CommandPolicy = (
  command: CollectionsCommand,
  graph: CollectionsGraph
) => CommandPolicyRejection | null;

/** Everything `dispatch` can refuse with: reducer rejections plus a policy veto. */
export type DispatchRejection = CommandRejection | CommandPolicyRejection;

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

  dispatch: (command: CollectionsCommand) => Result<CollectionsPatch, DispatchRejection>;
  undo: () => boolean;
  redo: () => boolean;
  /**
   * Reinstate an undo stack recorded earlier — the seam a consumer needs to
   * make undo survive a page reload (patches are serializable by design, and
   * this log doubles as a persistence journal).
   *
   * Entries are pushed oldest-first, so the last one becomes the next undo.
   * Nothing is verified here: `undo` already checks each entry against the
   * live graph before applying it and drops the unreachable side, which is
   * exactly the guard a restored stack needs — an entry that no longer fits
   * the graph is refused when reached rather than corrupting it.
   *
   * The REDO branch is deliberately not restorable: redo means "put back what
   * I just took away", and after a reload there is no "just".
   */
  restoreHistory: (entries: readonly HistoryEntry[]) => void;
  /**
   * Apply a change this session did NOT make — another tab, or an agent
   * writing through the server — WITHOUT recording it in local history.
   *
   * Undo must only walk back your own actions: a remote patch in the stack
   * lets the local user silently revert somebody else's edit, and the app
   * autosaves that reversion straight back. Verified before it is applied
   * (same rule as undo/redo); returns false when the patch no longer fits,
   * leaving the graph untouched so the caller can refetch instead.
   */
  applyRemotePatch: (patch: CollectionsPatch) => boolean;
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
   * Because hydration only ADDS nodes under a childless collection, history
   * ALMOST always stays replayable, so — unlike `replaceGraph` — undo/redo
   * SURVIVES. Almost: hydration can install an id a dormant redo also wants
   * to add, or fill a collection whose add a dormant undo would remove.
   * Undo/redo verify each entry against the live graph before applying
   * (`verifyPatchApplies`) and drop the side of history a refused entry
   * makes unreachable — returning false instead of corrupting the graph.
   * Hydration is IO landing, not user intent: it pushes no history
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

  /** Replace selection with the supplied ids that exist in the current graph.
   *  Moves the range pivot to the LAST of them — "select all" therefore
   *  extends from the end of the run, which is where it left the user. */
  setSelection: (ids: readonly NodeId[]) => void;
  /** Toggle an existing graph node; missing ids are ignored. Moves the pivot,
   *  including when it DESELECTS: the pivot is where the user last acted, not
   *  where the selection happens to be. */
  toggleSelected: (id: NodeId) => void;
  /**
   * Replace the selection with the inclusive run between the pivot and `toId`,
   * in the order their shared parent renders them — shift+click, and
   * shift+arrow.
   *
   * The pivot does NOT move, which is what makes a range correctable.
   *
   * Ids under DIFFERENT parents have no run between them: there is no single
   * order spanning two collections, and inventing one (walking the flattened
   * tree, say) would select cards the user cannot see between the two they
   * can. That case selects `toId` alone and re-pivots there, which is the
   * same thing a plain click would have done.
   */
  selectRange: (toId: NodeId) => void;
  /**
   * Point the anchor at an already-selected node WITHOUT touching the
   * selection — "act on all of this, but aim at that one".
   *
   * Ignored for a node that is not selected: an anchor outside the selection
   * would put a selection toolbar on a card the actions do not apply to.
   * Callers wanting both should `toggleSelected`/`setSelection` first.
   */
  setAnchor: (id: NodeId) => void;
  /** Turn additive-tap mode on or off. Turning it OFF keeps the selection —
   *  you stop adding in order to act on what you have. */
  setMultiSelectMode: (on: boolean) => void;
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
    /** Pre-commit application veto — see `CommandPolicy`. */
    commandPolicy?: CommandPolicy;
    /**
     * Let additive-tap mode stay armed while the selection is EMPTY.
     *
     * Off by default, because the mode's usual control is the anchor card's
     * menu — a surface that exists only while something is selected, so an
     * armed mode with nothing selected would be on, invisible, and quietly
     * making the next taps additive (see `setInteraction`).
     *
     * Turn it on when the consumer gives the mode a control that is ALWAYS
     * reachable — a toolbar toggle, say. Then "armed with nothing selected" is
     * not a dead end but the ordinary way in: arm the mode, THEN pick. Owning
     * that control means owning the way out of it too; nothing here will
     * disarm the mode for you.
     */
    keepMultiSelectModeWhenEmpty?: boolean;
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
    anchorId: null,
    selectionPivotId: null,
    multiSelectMode: false,
    rejectedIdSet: EMPTY_SELECTION,
  };
  const history = createHistory({ maxEntries: options?.maxHistoryEntries });
  const listeners = new Set<() => void>();
  const changeListeners = new Set<(change: CollectionsChange) => void>();
  const onChange = options?.onChange;
  const commandPolicy = options?.commandPolicy;
  const keepMultiSelectModeWhenEmpty = options?.keepMultiSelectModeWhenEmpty ?? false;
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

  // See the snapshot fields' doc comments. The map is deliberately ONE
  // stable instance mutated in place: re-allocating per commit would put a
  // per-collection cost back on every data commit, and per-key readers
  // return primitives so Object.is still bails correctly.
  let graphGeneration = 0;
  const dataVersionByParent = new Map<NodeId, number>();
  function bumpDataVersion(parentId: NodeId) {
    dataVersionByParent.set(parentId, (dataVersionByParent.get(parentId) ?? 0) + 1);
  }
  /** Bump the parents whose CHILDREN's data a patch changed. Reads the
   *  post-apply graph — updates never move nodes, so parents are unchanged. */
  function bumpDataVersionsFor(patch: CollectionsPatch) {
    if (patch.type !== "nodes-updated") return;
    for (const update of patch.updates) {
      const parent = graph.parentById.get(update.nodeId);
      if (parent !== undefined && parent !== null) bumpDataVersion(parent);
    }
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
      graphGeneration,
      dataVersionByParent,
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
    // ONE invariant, enforced centrally rather than at each of the four places
    // a selection can empty (clear, a toggle that removes the last item,
    // setSelection([]), and pruning after a delete): additive-tap mode cannot
    // outlive the selection. Its only control lives on a surface that exists
    // while something is selected, so an armed mode with an empty selection is
    // unreachable — on, invisible, and quietly making the next taps additive.
    //
    // Unless the consumer says otherwise: a mode with an ALWAYS-reachable
    // control is not unreachable when empty, and "arm it, then pick" is how
    // such a control is used (see `keepMultiSelectModeWhenEmpty`).
    if (!keepMultiSelectModeWhenEmpty && interaction.multiSelectMode && interaction.selectedIds.size === 0) {
      interaction = { ...interaction, multiSelectMode: false };
    }
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
    // A pivot pointing at a deleted node would measure the next range from
    // somewhere that no longer exists — `inclusiveSiblingRun` would find no
    // parent for it and silently degrade every shift+click to a plain click.
    const pivot = interaction.selectionPivotId;
    if (pivot !== null && !graph.nodesById.has(pivot)) {
      interaction = { ...interaction, selectionPivotId: null };
    }
    // The anchor must stay INSIDE the selection, so deleting it hands the role
    // on rather than leaving a toolbar pointed at a card that is gone. Grid
    // order again, for the reason `toggleSelected` gives.
    const anchor = interaction.anchorId;
    if (anchor !== null && !interaction.selectedIds.has(anchor)) {
      // The anchor must stay INSIDE the selection, so a departed one hands the
      // role on rather than leaving a toolbar pointed at a card that is gone.
      //
      // Grid order again, but it needs something to measure against, and the
      // departed node cannot supply it — when the node left the GRAPH (not
      // just the selection) its parent went with it. So the survivor's own
      // parent seeds the order instead, which is the same answer whenever the
      // selection sits in one collection, and a defensible one when it does
      // not. A selected ROOT has no parent at all, hence the last fallback.
      let survivor: NodeId | null = null;
      for (const id of interaction.selectedIds) survivor = id;
      const seed = graph.nodesById.has(anchor) ? anchor : survivor;
      interaction = {
        ...interaction,
        anchorId:
          seed === null
            ? null
            : (lastSelectedSiblingInGridOrder(graph, seed, interaction.selectedIds) ?? survivor),
      };
    }
    // This path writes `interaction` directly rather than through
    // `setInteraction`, so it repeats that function's mode invariant — opt-out
    // included. Deleting the last selected card is the ordinary way to arrive
    // here with an armed mode and nothing left to show its control.
    if (!keepMultiSelectModeWhenEmpty && interaction.multiSelectMode && interaction.selectedIds.size === 0) {
      interaction = { ...interaction, multiSelectMode: false };
    }
  }

  function dispatch(
    command: CollectionsCommand
  ): Result<CollectionsPatch, DispatchRejection> {
    // Pre-commit veto, BEFORE the reducer: a refused command must leave no
    // trace — no graph mutation, no history entry, and above all no cleared
    // redo branch (see `CommandPolicy`).
    const vetoed = commandPolicy?.(command, graph);
    if (vetoed) return { ok: false, error: vetoed };

    const result = applyCommand(graph, command);
    if (!result.ok) return { ok: false, error: result.error };

    graph = result.value.graph;
    history.push({ command, patch: result.value.patch, at: Date.now() });
    refreshHistoryEntries();
    bumpDataVersionsFor(result.value.patch);
    pruneMissingSelection();
    notify({ graph, command, patch: result.value.patch, origin: "command" });
    return { ok: true, value: result.value.patch };
  }

  // History assumed every dormant patch stays applicable. That holds under
  // pure linear history and breaks the moment `hydrate` grows the graph while
  // entries sleep on either stack: redoing an add whose id was hydrated in
  // meanwhile put one node in two collections, and undoing the add of a
  // collection that was hydrated AFTER being added orphaned its children.
  // So replay VERIFIES before it commits — and when the top entry no longer
  // applies, that whole side of history is unreachable (entries replay in
  // order) and is dropped rather than left as a button that corrupts.
  function undo(): boolean {
    const inverse = history.peekUndo();
    if (!inverse) return false;
    if (!verifyPatchApplies(graph, inverse).ok) {
      history.clearPast();
      refreshHistoryEntries();
      notify();
      return false;
    }
    history.undo();
    graph = applyPatch(graph, inverse);
    refreshHistoryEntries();
    bumpDataVersionsFor(inverse);
    pruneMissingSelection();
    notify({ graph, patch: inverse, origin: "undo" });
    return true;
  }

  /**
   * Apply a change this session did NOT make — another tab, or an agent
   * writing through the server — without touching local history.
   *
   * History is deliberately skipped. A remote patch in the undo stack means
   * the local user can press Ctrl+Z and silently revert somebody else's edit,
   * and (because the app autosaves) persist that reversion. Undo should only
   * ever walk back your OWN actions.
   *
   * Verifies first, like `undo`/`redo` do: a patch built against a graph this
   * session has since changed may no longer fit, and the package's rule is
   * that `applyPatch` is never called on a patch that has not been checked.
   * Returns false when it does not apply, leaving the graph untouched — the
   * caller's fallback is to refetch rather than to force it.
   */
  function applyRemotePatch(patch: CollectionsPatch): boolean {
    if (!verifyPatchApplies(graph, patch).ok) return false;
    graph = applyPatch(graph, patch);
    bumpDataVersionsFor(patch);
    pruneMissingSelection();
    notify({ graph, patch, origin: "remote" });
    return true;
  }

  function restoreHistory(entries: readonly HistoryEntry[]): void {
    if (entries.length === 0) return;
    for (const entry of entries) history.push(entry);
    refreshHistoryEntries();
    notify();
  }

  function redo(): boolean {
    const patch = history.peekRedo();
    if (!patch) return false;
    if (!verifyPatchApplies(graph, patch).ok) {
      history.clearFuture();
      refreshHistoryEntries();
      notify();
      return false;
    }
    history.redo();
    graph = applyPatch(graph, patch);
    refreshHistoryEntries();
    bumpDataVersionsFor(patch);
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
    // Every derived cache (virtualizer measurements above all) is garbage
    // after a wholesale swap; the generation is the views' one signal for it.
    // Per-parent versions reset with the world they described.
    graphGeneration += 1;
    dataVersionByParent.clear();
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
      anchorId: interaction.anchorId,
      selectionPivotId: interaction.selectionPivotId,
      multiSelectMode: interaction.multiSelectMode,
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
    // The hydrated collection's children went from none to some without a
    // change-feed event — its data version is how views keyed off it learn.
    bumpDataVersion(collectionId);
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
    restoreHistory,
    applyRemotePatch,
    replaceGraph,
    hydrate,

    setSelection: (ids) => {
      const next = new Set<NodeId>();
      for (const id of ids) {
        if (graph.nodesById.has(id)) next.add(id);
      }
      let pivot: NodeId | null = null;
      for (const id of next) pivot = id;
      // Re-selecting the exact same set (e.g. clicking an already-selected
      // node) must not notify — a no-op state "change" would force every
      // subscriber to re-run its selector for nothing. The pivot is checked
      // too: re-clicking the last card of a multi-selection changes nothing
      // about the set but DOES move where a range would extend from.
      if (
        sameSet(interaction.selectedIds, next) &&
        interaction.selectionPivotId === pivot &&
        interaction.anchorId === pivot
      ) {
        return;
      }
      setInteraction({ selectedIds: next, anchorId: pivot, selectionPivotId: pivot });
    },
    toggleSelected: (id) => {
      if (!graph.nodesById.has(id)) return;
      const next = new Set(interaction.selectedIds);
      const removing = next.has(id);
      if (removing) next.delete(id);
      else next.add(id);
      // Adding makes the new card the anchor. REMOVING the anchor hands it to
      // the last remaining card in GRID order, not in click order: what is
      // left last by insertion is whichever card happened to be picked before
      // it, an order the user cannot see. Removing a card that is not the
      // anchor leaves the anchor where it is.
      const anchorId = !removing
        ? id
        : interaction.anchorId === id
          ? lastSelectedSiblingInGridOrder(graph, id, next)
          : interaction.anchorId;
      setInteraction({ selectedIds: next, anchorId, selectionPivotId: id });
    },
    selectRange: (toId) => {
      if (!graph.nodesById.has(toId)) return;
      const fromId = interaction.selectionPivotId;
      const run =
        fromId === null || fromId === toId ? null : inclusiveSiblingRun(graph, fromId, toId);
      if (run === null) {
        // No shared parent (or no pivot yet): fall back to the plain-click
        // answer rather than guessing at an order across collections.
        const single = new Set<NodeId>([toId]);
        if (sameSet(interaction.selectedIds, single) && interaction.selectionPivotId === toId) {
          return;
        }
        setInteraction({ selectedIds: single, anchorId: toId, selectionPivotId: toId });
        return;
      }
      const next = new Set(run);
      // Pivot deliberately UNTOUCHED: the next shift+click must measure from
      // the same origin, so overshooting and coming back shrinks the range.
      // The ANCHOR does move — it is the most recent pick, and the card just
      // shift-clicked is exactly that.
      if (sameSet(interaction.selectedIds, next) && interaction.anchorId === toId) return;
      setInteraction({ selectedIds: next, anchorId: toId });
    },
    setAnchor: (id) => {
      // Only within the selection: an anchor outside it would host a toolbar
      // whose actions do not apply to the card it sits on.
      if (!interaction.selectedIds.has(id)) return;
      if (interaction.anchorId === id) return;
      setInteraction({ anchorId: id });
    },
    setMultiSelectMode: (on) => {
      if (interaction.multiSelectMode === on) return;
      setInteraction({ multiSelectMode: on });
    },
    clearSelection: () => {
      if (
        interaction.selectedIds.size === 0 &&
        interaction.anchorId === null &&
        interaction.selectionPivotId === null &&
        // A mode that is ALLOWED to be armed while empty is not something
        // clearing has to undo, so it must not defeat this early return
        // either — otherwise every clear on an already-empty selection hands
        // out a fresh interaction identity and re-renders for nothing.
        (keepMultiSelectModeWhenEmpty || !interaction.multiSelectMode)
      ) {
        return;
      }
      // `setInteraction` drops the mode with it, unless the consumer opted to
      // keep it (see the invariant there) — in which case clearing empties the
      // selection and LEAVES the user in select mode, ready to pick again.
      // Getting out is then the toolbar's job, not this one's.
      setInteraction({ selectedIds: EMPTY_SELECTION, anchorId: null, selectionPivotId: null });
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

/**
 * The last SELECTED sibling of `nodeId`, in the order its parent renders them.
 *
 * The anchor's fallback when it leaves the selection. GRID order, not click
 * order: what remains last by insertion is whichever card happened to be
 * picked before the departing one, which is an order the user cannot see. A
 * selection can span parents; only the departing anchor's own parent is
 * consulted, because "the next one along" means nothing across two timelines —
 * and null there is the honest answer, not a bug.
 */
function lastSelectedSiblingInGridOrder(
  graph: CollectionsGraph,
  nodeId: NodeId,
  selectedIds: ReadonlySet<NodeId>
): NodeId | null {
  const parentId = graph.parentById.get(nodeId) ?? null;
  if (parentId === null) return null;
  let last: NodeId | null = null;
  for (const childId of getChildren(graph, parentId)) {
    if (selectedIds.has(childId)) last = childId;
  }
  return last;
}

/**
 * The inclusive run between two SIBLINGS, in their parent's child order.
 *
 * Null when they do not share a parent — including when either is a root,
 * which has none. Callers treat that as "no range", not as an error.
 */
function inclusiveSiblingRun(
  graph: CollectionsGraph,
  fromId: NodeId,
  toId: NodeId
): readonly NodeId[] | null {
  const parentId = graph.parentById.get(fromId) ?? null;
  if (parentId === null || parentId !== (graph.parentById.get(toId) ?? null)) return null;
  const siblings = getChildren(graph, parentId);
  const from = siblings.indexOf(fromId);
  const to = siblings.indexOf(toId);
  if (from === -1 || to === -1) return null;
  // Direction-agnostic: dragging a range backwards is the same range.
  return from <= to ? siblings.slice(from, to + 1) : siblings.slice(to, from + 1);
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
    case "place-at-time":
      return (
        b.type === "place-at-time" &&
        a.collectionId === b.collectionId &&
        a.lane === b.lane &&
        // A placement moves CONTINUOUSLY, so equality here is what keeps a
        // drag from re-rendering on every sub-pixel pointer move.
        a.startSeconds === b.startSeconds
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
