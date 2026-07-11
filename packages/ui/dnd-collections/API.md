# dnd-collections API reference

Every export of `index.ts`, grouped as the package is layered. For the
reasoning behind the design (source of truth, efficiency model, dnd-kit
decisions), read [ARCHITECTURE.md](./ARCHITECTURE.md) first.

Conventions used throughout:

- `Result<T, E>` = `{ ok: true; value: T } | { ok: false; error: E }`.
  Nothing throws for expected failures; every rejection is a typed reason.
- All exported object types are deeply `Readonly`.
- `NodeId` is a branded string: plain string at runtime, nominal at compile
  time. Produce one with `parseNodeId` (or receive them from the graph).

## Quickstart

```tsx
import {
  buildGraph,
  parseNodeId,
  DndCollections,
  CollectionPanels,
  UndoRedoControls,
} from "@storyboard/ui/dnd-collections";

const graph = buildGraph([
  {
    kind: "collection",
    id: "panel-a",
    name: "Panel A",
    children: [
      { kind: "media", id: "clip-1", name: "Clip 1", durationSeconds: 4 },
      { kind: "collection", id: "folder", name: "Folder", children: [] },
    ],
  },
]);
if (!graph.ok) throw new Error(graph.error.reason);

export function Board() {
  return (
    <DndCollections
      initialGraph={graph.value}
      onChange={(change) => console.log(change.origin, change.patch)}
    >
      <UndoRedoControls />
      <CollectionPanels />
    </DndCollections>
  );
}
```

---

## Core: graph (`core/graph.ts`)

Pure model. No React, no DOM.

### Types

```ts
type NodeId = string & { readonly [brand]: true };

type MediaNode = {
  id: NodeId; kind: "media"; name: string;
  src?: string;            // display-only; the graph doesn't care
  durationSeconds: number;
};
type CollectionNode = { id: NodeId; kind: "collection"; name: string };
type CollectionItemNode = MediaNode | CollectionNode;

type CollectionsGraph = {
  nodesById: ReadonlyMap<NodeId, CollectionItemNode>;
  childrenById: ReadonlyMap<NodeId, readonly NodeId[]>; // every collection has an entry, possibly empty
  parentById: ReadonlyMap<NodeId, NodeId | null>;       // null = root
  rootIds: readonly NodeId[];                           // ordered top-level collections
};
```

### `parseNodeId(id: string): NodeId`

Parse-or-throw for authoring-time-trusted ids (literals in stories, tests,
fixtures). Throws on empty/whitespace-only strings.

### `buildGraph(roots: readonly GraphNodeSpec[]): Result<CollectionsGraph, BuildGraphError>`

Denormalizes a nested author-friendly spec into the graph. Iterative walk —
pathological depth can't blow the call stack.

```ts
type GraphNodeSpec =
  | { kind: "media"; id: string; name: string; src?: string; durationSeconds?: number } // default 4
  | { kind: "collection"; id: string; name: string; children?: readonly GraphNodeSpec[] };

type BuildGraphError =
  | { reason: "duplicate-id"; id: string }   // anywhere in the tree — ids are the addressing scheme
  | { reason: "empty-id" }
  | { reason: "root-not-collection"; id: string };
```

### `EMPTY_GRAPH: CollectionsGraph`

The empty graph constant.

### Queries

| Export | Signature | Notes |
| --- | --- | --- |
| `isCollection` | `(node: CollectionItemNode) => node is CollectionNode` | Type guard. |
| `getChildren` | `(graph, collectionId) => readonly NodeId[]` | `[]` for unknown/media ids. Returned array is reference-stable across moves that don't touch this collection. |
| `isSameOrAncestor` | `(graph, possibleAncestorId, id) => boolean` | True if `possibleAncestorId` is `id` or an ancestor. O(depth), cycle-guarded. |
| `getDocumentOrder` | `(graph) => ReadonlyMap<NodeId, number>` | Depth-first reading-order index of every node. |

### `findGraphInvariantViolation(graph): GraphInvariantViolation | null`

Development/testing check; returns the first violation or null. The
`reason` values: `missing-node`, `child-parent-mismatch`, `duplicate-child`,
`duplicate-root`, `root-not-collection`, `root-is-also-child`,
`parent-not-collection`, `collection-missing-children-entry`,
`media-with-children`, `unreachable-node` (each variant carries the
offending id(s)).

---

## Core: commands (`core/commands.ts`)

### `applyCommand(graph, command): Result<ApplyCommandSuccess, CommandRejection>`

The pure reducer — the ONLY way graph state changes. Validates, constructs a
reversible patch, applies it. One command covers every mutation: reorder,
cross-collection move, nest, and multi-node moves are all `move-nodes` with
different inputs.

```ts
type CollectionsCommand =
  | {
      type: "move-nodes";
      nodeIds: readonly NodeId[]; // any order; descendants of other dragged nodes are pruned
      toParentId: NodeId;
      toIndex: number;            // POST-REMOVAL index — see below
    }
  | {
      type: "add-nodes";          // palette drops: brand-new nodes
      nodes: readonly CollectionItemNode[]; // ids must not exist; new collections start empty
      toParentId: NodeId;
      toIndex: number;
    };

type ApplyCommandSuccess = { graph: CollectionsGraph; patch: CollectionsPatch };
```

`toIndex` is the insertion index in the target's children **after the moved
nodes have been removed from it**. `resolveCommandFromIntent` and
`resolveKeyboardCommand` produce this convention for you; construct commands
directly only if you apply the same math. Multi-node moves are re-sorted
into document order (selection order doesn't matter), and the index is
clamped to the valid range.

Rejections (`CommandRejection.reason`):

| Reason | Meaning |
| --- | --- |
| `missing-node` | A dragged id or `toParentId` isn't in the graph (or is unindexed). |
| `target-not-collection` | `toParentId` is a media node. |
| `cannot-move-root` | A dragged id is a top-level collection — roots are structural anchors. |
| `duplicate-node-id` | An id appears twice in `nodeIds`, or (add-nodes) an added id already exists / repeats in the batch. |
| `invalid-node-id` | (add-nodes) An added node's id is empty or whitespace-only — it can't be addressed or encoded as a droppable. |
| `nothing-to-add` | `add-nodes` with an empty `nodes` array. |
| `invalid-index` | `toIndex` is not an integer (NaN/±Infinity splice at 0; a fraction desyncs forward apply from patch replay). |
| `would-create-cycle` | A node would move into itself or its own descendant. |
| `nothing-to-move` | Every dragged id was pruned (all descendants of other dragged ids). |
| `same-position` | The move would leave every children array identical — treated as a no-op, nothing is pushed to history. |

---

## Core: patches (`core/patches.ts`)

Patches are the reversible, serializable record of every mutation — the
same primitive backs undo/redo, the `onChange` feed, and persistence.

```ts
type NodeMove = {
  nodeId: NodeId;
  fromParentId: NodeId; fromIndex: number; // index in the PRE-patch state
  toParentId: NodeId;   toIndex: number;   // index in the POST-patch state
};
type NodeAdd = {
  node: CollectionItemNode; // the FULL node — what makes removal restorable
  parentId: NodeId;
  index: number;
};

type CollectionsPatch =
  | { type: "nodes-moved"; moves: readonly NodeMove[] }
  | { type: "nodes-added"; adds: readonly NodeAdd[] }
  | { type: "nodes-removed"; removals: readonly NodeAdd[] }; // only from inverting adds
```

### `invertPatch(patch): CollectionsPatch`

Swaps each move's endpoints; applying the result undoes the original.

### `applyPatch(graph, patch): CollectionsGraph`

The only code that rewrites graph indexes (forward apply, undo, and redo all
run through it). Structural sharing: only affected parents' children arrays
are re-allocated; `nodesById` and `rootIds` are reused untouched. Does not
validate — apply patches only to the graph state they were produced against
(or its inverse-adjacent state).

---

## Core: intents (`core/intents.ts`)

Geometry → semantics, separate from legality (the reducer's job).

```ts
type DropTarget =
  | { type: "node"; nodeId: NodeId }
  | { type: "panel"; collectionId: NodeId };

type DropIntent =
  | { type: "insert-adjacent"; side: "before" | "after"; targetId: NodeId }
  | { type: "nest-inside"; collectionId: NodeId }
  | { type: "append-to-collection"; collectionId: NodeId }
  | { type: "insert-at-index"; collectionId: NodeId; index: number };

type RectLike = { left: number; top: number; width: number; height: number };
type PanelChildRect = { id: NodeId; rect: RectLike };
```

### `encodeDropTarget(target): string` / `decodeDropTarget(id): DropTarget | null`

The droppable-id string protocol (`"node:<id>"` / `"panel:<id>"`) shared
with the React layer's dnd-kit registrations. `decode` returns null for
malformed ids.

### `resolveDropIntent(args): DropIntent | null`

```ts
resolveDropIntent(args: {
  graph: CollectionsGraph;
  target: DropTarget;
  targetRect: RectLike;
  point: { x: number; y: number };
  activeIds: readonly NodeId[];
  panelChildRects?: readonly PanelChildRect[]; // panel targets only
}): DropIntent | null
```

Resolution rules:

- **Node target, media card**: left half → insert `before`, right half →
  `after`.
- **Node target, collection card**: the central 25–75% horizontal band →
  `nest-inside`; the outer edges → insert-adjacent.
- **Panel target**: if `panelChildRects` are provided and the pointer shares
  a horizontal row with a card, resolves insert-adjacent against the nearest
  card in that row (gap drops land between cards; dragged cards are not
  anchors). Otherwise `append-to-collection`.
- Returns `null` only when hovering a dragged node's own card. Descendants
  of a dragged collection DO resolve intents — flag them with
  `isIntentInvalid` for the "cannot drop" preview; the reducer rejects them
  at commit regardless.
- **`insert-at-index`** is produced by virtualized views (not by
  `resolveDropIntent`): pointer offset → index from virtualizer
  measurements, since neighbor cards may be unmounted. `index` is a
  VISIBLE boundary (0..children.length) over the full children list;
  `resolveCommandFromIntent` converts it to the post-removal convention.

### `intentDestination(graph, intent): NodeId | null`

The collection that would receive the nodes if the intent committed
(adjacent inserts resolve to the target's parent); null if the target
vanished.

### `isIntentInvalid(graph, intent, activeIds): boolean`

True when committing would be rejected as a cycle. Same rule the reducer
enforces, so a preview built on this can never disagree with the outcome.

### `resolveCommandFromIntent(graph, intent, draggedIds): Result<CollectionsCommand, IntentRejection>`

Intent → command, doing the post-removal index math (the off-by-one class
lives here, nowhere else). `IntentRejection` is
`{ reason: "missing-node"; nodeId: NodeId }` — the adjacency target
vanished.

### `resolveAddCommandFromIntent(graph, intent, nodes): Result<CollectionsCommand, IntentRejection>`

Intent → `add-nodes` for BRAND-NEW nodes (palette drops). Placement math is
a move with an empty drag set — palette drops land anywhere a move can.

---

## Core: history (`core/history.ts`)

### `createHistory(options?): CollectionsHistory`

Linear undo/redo as a pair of patch stacks. A new `push` clears the redo
branch. `options.maxEntries` caps the undo stack (oldest entries fall off
and stop being undoable); default unbounded.

```ts
type HistoryEntry = {
  command: CollectionsCommand; // WHAT the user did, for devtools/log display
  patch: CollectionsPatch;
  at: number;                  // ms since epoch, display-only
};

type CollectionsHistory = {
  push(entry: HistoryEntry): void;
  undo(): CollectionsPatch | null; // returns the INVERTED patch — apply it forward
  redo(): CollectionsPatch | null;
  canUndo(): boolean;
  canRedo(): boolean;
  entries(): readonly HistoryEntry[]; // oldest-first, undone entries excluded; fresh array per call
};
```

The store wraps this — reach for it directly only outside a store.

---

## Core: keyboard (`core/keyboard.ts`)

### `resolveKeyboardCommand(graph, nodeId, action): Result<CollectionsCommand, KeyboardRejection>`

Semantic keyboard operations for a single focused node, resolving to the
same `move-nodes` command as pointer drags (shared validation, history,
announcements).

```ts
type KeyboardMoveAction =
  | "move-prev" | "move-next"       // swap with the previous/next sibling
  | "move-home" | "move-end"        // to the start/end of the collection
  | "nest-in-neighbor"              // into the nearest sibling collection (next first, then previous)
  | "move-out";                     // to the grandparent, landing right after the parent's card
```

`KeyboardRejection.reason`: `missing-node`, `cannot-move-root`, and the
boundary no-ops `no-previous-sibling`, `no-next-sibling`,
`no-neighbor-collection`, `no-parent-to-move-out-to`.

### `resolveGridRowMoveCommand(graph, nodeId, direction, columns): Result<CollectionsCommand, GridRowMoveRejection>`

Grid keyboard semantics: one row up/down (± `columns`), landing in the
same column; a shorter last row clamps to the end. Pure graph math — the
view supplies its live column count. Rejections: `missing-node`,
`cannot-move-root`, `invalid-columns`, `already-first-row`,
`already-last-row`.

---

## React: provider (`react/DndCollections.tsx`)

### `<DndCollections>`

```ts
type DndCollectionsProps = {
  initialGraph: CollectionsGraph;
  onChange?: (change: CollectionsChange) => void;
  maxHistoryEntries?: number; // cap the undo stack; positive integer, default unbounded
  children: ReactNode;
};
```

`maxHistoryEntries` is initial-only (like `initialGraph`): the oldest undo
entries fall off past the cap. Any non-positive-integer value is treated as
unbounded.

Creates one store per component lifetime and wires the full dnd-kit stack:
PointerSensor (4px activation distance) + KeyboardSensor, pointer-priority
collision detection, drag lifecycle → intent → command dispatch, the
`DragOverlay` ghost, an `aria-live` announcer, and the Alt-key semantic
keyboard bindings.

The provider owns the whole accessibility surface: it silences dnd-kit's
built-in announcer (whose defaults would speak raw droppable ids like
`node:alpha` alongside this package's human-named channel) and blanks its
screen-reader instructions in favour of one description element referenced by
every card.

`initialGraph` is intentionally initial-only — the store is the source of
truth thereafter; later prop changes are ignored. `onChange` is NOT frozen
with it: the latest callback prop is always the one invoked, so closures
over current parent state behave as expected.

Keyboard grammar (on a focused card). dnd-kit's KeyboardSensor is restricted
to **Enter** (grab/drop) so **Space** stays free for selection; the Alt-key
layer is a separate, always-available set of quick semantic moves:

| Keys | Action |
| --- | --- |
| Space | Select this card (replaces the selection) |
| Ctrl/Cmd + Space | Toggle this card in a multi-selection |
| Enter | Grab for a free-form drag (Arrow keys move, Enter drops, Escape cancels) |
| Alt+ArrowLeft / Alt+ArrowRight | `move-prev` / `move-next` |
| Alt+Home / Alt+End | `move-home` / `move-end` |
| Alt+ArrowDown | `nest-in-neighbor` |
| Alt+ArrowUp | `move-out` |

Inside a `VirtualGrid`, Alt+ArrowUp / Alt+ArrowDown become row moves (± the
column count); Alt+Enter / Alt+Backspace are the grid-safe synonyms for
`nest-in-neighbor` / `move-out`.

---

## React: store (`react/collections-store.ts`)

### `createCollectionsStore(initialGraph, options?): CollectionsStore`

`options.onChange` receives every committed change; `options.maxHistoryEntries`
(positive integer, default unbounded) caps the undo stack. `<DndCollections>`
calls this for you; create a store directly only for headless/test use.

```ts
type CollectionsChange = {
  graph: CollectionsGraph;      // post-change
  command?: CollectionsCommand; // present for dispatches, absent for undo/redo replays
  patch: CollectionsPatch;      // undo's patch arrives already inverted — apply forward
  origin: "command" | "undo" | "redo";
};
```

### `CollectionsStore`

| Member | Signature | Notes |
| --- | --- | --- |
| `getSnapshot` | `() => CollectionsSnapshot` | Snapshot identity changes per notify; FIELD identities change only when the field did. |
| `subscribe` | `(listener: () => void) => () => void` | Returns unsubscribe. |
| `dispatch` | `(command) => Result<CollectionsPatch, CommandRejection>` | Reduce + push history + notify + `onChange`. |
| `undo` / `redo` | `() => boolean` | False when the respective stack is empty. |
| `setSelection` | `(ids: readonly NodeId[]) => void` | No-op (no notify) when the set is unchanged. |
| `toggleSelected` | `(id: NodeId) => void` | |
| `clearSelection` | `() => void` | No-op when already empty. |
| `beginDrag` | `(pressedId: NodeId) => void` | Drag set = the selection if it contains `pressedId` (pressed id first — it's the overlay primary), else just `pressedId`. Sets `isDragging`. |
| `beginPaletteDrag` | `() => void` | Marks a palette drag live (`isDragging` without `activeIds`). Ends via `endDrag`. |
| `setDropIntent` | `(intent: DropIntent \| null) => void` | Deduplicates equal intents; computes `dropIntentInvalid` once per change. |
| `endDrag` | `() => void` | Clears drag state; never mutates the graph. |
| `flashRejection` | `(ids: readonly NodeId[]) => void` | Sets `rejectedIdSet` for 600ms (re-flash resets the timer). |
| `destroy` | `() => void` | Clears listeners and any pending flash timer; the provider calls it on unmount. |

```ts
type CollectionsSnapshot = {
  graph: CollectionsGraph;
  interaction: CollectionsInteraction;
  canUndo: boolean;
  canRedo: boolean;
  historyEntries: readonly HistoryEntry[]; // cached; new identity only on dispatch/undo/redo
};

type CollectionsInteraction = {
  isDragging: boolean;                 // any live drag — node or palette
  activeIds: readonly NodeId[];        // pressed id first; empty when idle and during palette drags
  activeIdSet: ReadonlySet<NodeId>;    // same ids, O(1) membership
  dropIntent: DropIntent | null;       // live preview of a release right now
  dropIntentInvalid: boolean;          // would that preview be a cycle rejection
  selectedIds: ReadonlySet<NodeId>;
  rejectedIdSet: ReadonlySet<NodeId>;  // cards currently flashing a rejection
};
```

### `useCollectionsStore(): CollectionsStore`

The context store. Throws outside `<DndCollections>` (or a manual
`CollectionsStoreProvider`).

### `useCollectionsSelector<T>(selector: (snapshot: CollectionsSnapshot) => T): T`

Subscribe to a slice. **Contract:** the selector must return a primitive or
a reference that is stable while the slice is unchanged (graph children
arrays and the interaction sets qualify). React skips the re-render when
consecutive results are `Object.is`-equal — this is the package's render-
efficiency mechanism, so a selector that allocates per call defeats it.

---

## React: views (`react/node-views.tsx`, `react/history-views.tsx`)

Default views — usable as-is, or as reference implementations for custom
ones (everything they do goes through the store API above).

| Component | Props | Notes |
| --- | --- | --- |
| `CollectionPanels` | `collectionIds?: readonly NodeId[]`, `animateMoves?: boolean` | One panel per id (default: the graph's roots). `animateMoves` (default `true`) enables the post-commit FLIP sweep; honors `prefers-reduced-motion`. |
| `CollectionPanel` | `collectionId: NodeId` | One droppable panel with its cards. |
| `NodeCard` | `id: NodeId`, `className?: string`, `dragActivation?: "body" \| "handle" \| "hold"` | Memoized; id-only state by design — everything dynamic arrives via selectors. `className` is tailwind-merged onto wrapper AND button (sizing overrides beat the `h-24 w-32` defaults; virtual views pass `"h-full w-full"`). `dragActivation`: `"body"` (default) drags instantly from anywhere; `"handle"` renders a top grip bar as the only activator; `"hold"` requires a 250ms press (fast movement is handed to surface gestures). Body clicks always select; ghosts stay card-sized. Draggable + droppable. |
| `NodeCardGhost` | `node: CollectionItemNode`, `extraCount: number` | The drag-overlay ghost; renders a `+N` badge when `extraCount > 0`. |
| `UndoRedoControls` | — | Buttons bound to `store.undo`/`store.redo`, disabled off `canUndo`/`canRedo`. |
| `HistoryLog` | — | Human-readable command log over `historyEntries`. |
| `PaletteItem` | `paletteId: string`, `createNode: () => CollectionItemNode`, `children?` | External drag source; the factory runs at drag START (fresh ids per drag), the drop commits `add-nodes` through the standard intent pipeline. |
| `TrashTarget` | `trashId: NodeId` | Styled panel droppable for a (usually hidden) trash root; drops are ordinary moves — subtrees ride along, undo restores, nothing is deleted. |

### DOM/test hooks

The default views expose stable data attributes (the story and e2e suites
key off these):

| Attribute / testid | Element | Meaning |
| --- | --- | --- |
| `data-node-id`, `data-node-kind` | card button | Node identity/kind. |
| `data-selected`, `data-rejected` | card button | Present (`"true"`) while selected / flashing a rejection. |
| `data-render-count` | card button | Increments per render — the efficiency probe. |
| `data-panel-id` / `data-panel-droppable` | panel section / its drop zone | Collection identity. |
| `data-nest-state` | overlay on a collection card | `"valid"` or `"invalid"` while it's the live nest target. |
| `data-drop-indicator` | indicator bar | `"before"` or `"after"` on the adjacency target. |
| `data-testid="drag-ghost"` / `"drag-ghost-count"` | overlay | The ghost and its `+N` badge. |
| `data-testid="history-log"` / `"history-empty"`, `data-history-entry` | history log | Log container / empty marker / entries. |

---

## Extension seams

For building custom cards, panels, or virtualized containers that plug into
the same store, FLIP scope, and collision pipeline as the built-ins:

| Export | From | Use |
| --- | --- | --- |
| `CollectionsStoreProvider` | `react/collections-store` | Wrap a subtree in a store you created with `createCollectionsStore` (headless/custom hosting). |
| `useCollectionsContainer` / `CollectionsContainerContext` / `CollectionsContainerValue` | `react/container-context` | Read the instance's wrapper ref (FLIP scope) and the `aria-describedby` instructions id. |
| `VIRTUAL_INSERT_DATA_KEY` / `VirtualInsertTarget` | `react/virtual-droppable` | The droppable-`data` contract a custom virtualized container carries so collision detection resolves pointer → boundary index through its own layout math. |
| `useEdgeAutoScroll` | `react/use-edge-autoscroll` | Deterministic edge auto-scroll for a custom virtualized scroll container (pairs with `usePanWithMomentum`). |

`applyPatch` (Core) is the one deliberately unchecked primitive: it rewrites
indexes without validation, so apply patches only to the graph state they
were produced against (or its inverse-adjacent state).
