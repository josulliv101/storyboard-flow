import type { TimelineDocument } from "@storyboard/timeline-model/types";
import type { CollectionItemNode } from "@storyboard/ui/dnd-collections";
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
  set: (entries: readonly ClipboardEntry[]) => void;
  clear: () => void;
  isEmpty: () => boolean;
  /** Change notifications, for the sidebar's `can paste` subscription. */
  subscribe: (listener: () => void) => () => void;
}>;

function createGraphClipboard(): GraphClipboard {
  let entries: readonly ClipboardEntry[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    read: () => entries,
    set: (next) => {
      entries = next;
      emit();
    },
    clear: () => {
      if (entries.length === 0) return;
      entries = [];
      emit();
    },
    isEmpty: () => entries.length === 0,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const graphClipboard = createGraphClipboard();
