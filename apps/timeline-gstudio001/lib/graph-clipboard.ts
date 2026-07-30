import type { TimelineDocument } from "@storyboard/timeline-model/types";
import type { CollectionItemNode, NodeId } from "@storyboard/ui/dnd-collections";
import type { ClipDetail } from "@storyboard/timeline-domain";

// The graph view's copy/cut clipboard: a module singleton, like
// `graphDocumentsGateway`, so BOTH React trees reach the same instance — the
// graph provider writes it (Copy/Cut) and reads it (Paste), while the sidebar
// (app chrome, a different tree) subscribes just for the "can paste" boolean
// that keeps its item-actions cluster available after the selection is gone.
//
// A clipboard entry is an id-agnostic SNAPSHOT taken at copy time: the source
// node + its detail, plus — for a collection — a deep copy of its whole
// document tree keyed by original id. Paste re-mints fresh ids from that
// snapshot each time (via the clone engine), so the copied item is independent
// of the source even if the source later changes or is deleted (Cut).

export type ClipboardEntry = Readonly<{
  /** The source node (kind, media props, name). */
  node: CollectionItemNode;
  /** The source's side-table entry, cloned onto the paste. */
  detail: ClipDetail | undefined;
  /** Deep-copied source document tree, keyed by ORIGINAL timeline id. Empty
   *  for a media clip (media has no document). */
  documents: Readonly<Record<string, TimelineDocument>>;
}>;

export type GraphClipboard = Readonly<{
  read: () => readonly ClipboardEntry[];
  /**
   * The nodes a Cut is waiting to move, still live in the graph.
   *
   * Cut used to trash its originals immediately and let Paste re-create them
   * from the snapshot above. It now leaves them in place, dimmed, until a paste
   * says where they are going — which is what makes cut+paste a MOVE rather
   * than a copy that happens to delete something.
   *
   * The snapshot is still captured, and is still what a paste falls back to
   * when a source has since been deleted or undone out of the graph. So this is
   * an optimisation of the common case, never a precondition.
   */
  pendingCutIds: () => ReadonlySet<NodeId>;
  /** Per-node, so a card can subscribe to its OWN pending state without every
   *  card re-rendering when the clipboard changes. */
  isPendingCut: (id: NodeId) => boolean;
  /** Arm the pending move. Call after a successful `set` — `set` clears it,
   *  since a fresh copy replaces whatever the clipboard was doing. */
  markPendingCut: (ids: Iterable<NodeId>) => void;
  /**
   * Install new contents. Pass the `generation()` observed BEFORE any async
   * capture work: if the clipboard was rebound to a different user (or
   * otherwise reset) while the capture ran, the stale write is refused and
   * `set` returns false — an in-flight Copy must never land another user's
   * data into the new session.
   */
  set: (entries: readonly ClipboardEntry[], atGeneration?: number) => boolean;
  clear: () => void;
  isEmpty: () => boolean;
  /** Monotonic reset counter — snapshot before async capture, hand to `set`. */
  generation: () => number;
  /**
   * Bind to an authenticated user. Same contract as the documents gateway's
   * `bindUser`: the module singleton outlives soft logout/login, so binding a
   * DIFFERENT uid wipes the contents — the next user must never paste the
   * previous user's timelines. First bind (or re-bind to the same uid) keeps
   * the contents; every wipe bumps the generation so stale captures die.
   */
  bindUser: (uid: string) => void;
  /** Change notifications, for the sidebar's `can paste` subscription. */
  subscribe: (listener: () => void) => () => void;
}>;

const NO_PENDING_CUT: ReadonlySet<NodeId> = new Set();

function createGraphClipboard(): GraphClipboard {
  let entries: readonly ClipboardEntry[] = [];
  let pendingCut: ReadonlySet<NodeId> = NO_PENDING_CUT;
  let boundUid: string | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    read: () => entries,
    pendingCutIds: () => pendingCut,
    isPendingCut: (id) => pendingCut.has(id),
    markPendingCut: (ids) => {
      pendingCut = new Set(ids);
      emit();
    },
    set: (next, atGeneration) => {
      if (atGeneration !== undefined && atGeneration !== generation) return false;
      entries = next;
      // A new copy (or a new cut, before it arms its own) replaces whatever the
      // clipboard was doing, so nothing stays dimmed waiting for a paste that
      // will never carry it.
      pendingCut = NO_PENDING_CUT;
      emit();
      return true;
    },
    clear: () => {
      if (entries.length === 0 && pendingCut.size === 0) return;
      entries = [];
      pendingCut = NO_PENDING_CUT;
      emit();
    },
    isEmpty: () => entries.length === 0,
    generation: () => generation,
    bindUser: (uid) => {
      if (boundUid === uid) return;
      const hadState = entries.length > 0 || pendingCut.size > 0;
      boundUid = uid;
      generation += 1;
      entries = [];
      pendingCut = NO_PENDING_CUT;
      if (hadState) emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const graphClipboard = createGraphClipboard();
