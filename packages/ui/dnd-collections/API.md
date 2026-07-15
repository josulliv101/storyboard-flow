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

// Media diverges by `mediaKind`; the ENGINE treats both as childless media.
// The distinction is domain/UI (trimming). `mediaKind` is OPTIONAL on image,
// so a plain `{ kind: "media", durationSeconds }` node is a valid image.
type ImageMediaNode = {
  id: NodeId; kind: "media"; mediaKind?: "image"; name: string;
  src?: string;                 // display-only
  durationSeconds: number;      // trimming an image sets this directly
};
type VideoMediaNode = {
  id: NodeId; kind: "media"; mediaKind: "video"; name: string;
  src?: string;
  posterSrcs?: readonly string[]; // display-only frames; cards show a few as a sequence
  fullDurationSeconds: number;  // the source clip's length
  trimInSeconds: number;        // trimmed off the START (0 = untrimmed)
  trimOutSeconds: number;       // trimmed off the END
};
type MediaNode = ImageMediaNode | VideoMediaNode;
type CollectionNode = { id: NodeId; kind: "collection"; name: string };
type CollectionItemNode = MediaNode | CollectionNode;

type CollectionsGraph = {
  nodesById: ReadonlyMap<NodeId, CollectionItemNode>;
  childrenById: ReadonlyMap<NodeId, readonly NodeId[]>; // every collection has an entry, possibly empty
  parentById: ReadonlyMap<NodeId, NodeId | null>;       // null = root
  rootIds: readonly NodeId[];                           // ordered top-level collections
};
```

### `mediaDurationSeconds(node: MediaNode): number`

The item's effective timeline duration: an image's `durationSeconds`, or a
video's `fullDurationSeconds - trimInSeconds - trimOutSeconds` (never below 0).
Use this everywhere a media item's on-timeline length is needed (card display,
`itemWidthFor`). `isVideoMedia(node)` narrows to `VideoMediaNode`.

### `videoFrameCount(durationSeconds: number, max?: number): number`

How many poster frames a video card shows: `~durationSeconds / SECONDS_PER_VIDEO_FRAME`,
at least 1, capped at `max` (default `MAX_VIDEO_FRAMES`). Longer clips show
more frames; a view can pass a tighter `max` (e.g. how many fit the card
width). Non-finite `max` values fall back to `MAX_VIDEO_FRAMES`; values below
1 clamp to 1. The card cycles the node's `posterSrcs` to fill this count — a video
card is a frame SEQUENCE, never a `<video>` element.

### `parseNodeId(id: string): NodeId`

Parse-or-throw for authoring-time-trusted ids (literals in stories, tests,
fixtures). Throws on empty/whitespace-only strings.

### `buildGraph(roots: readonly GraphNodeSpec[]): Result<CollectionsGraph, BuildGraphError>`

Denormalizes a nested author-friendly spec into the graph. Iterative walk —
pathological depth can't blow the call stack.

```ts
type GraphNodeSpec =
  | { kind: "media"; mediaKind?: "image"; id: string; name: string; src?: string; durationSeconds?: number } // default 4
  | { kind: "media"; mediaKind: "video"; id: string; name: string; src?: string; posterSrcs?: readonly string[];
      fullDurationSeconds: number; trimInSeconds?: number; trimOutSeconds?: number } // trims default 0
  | { kind: "collection"; id: string; name: string; children?: readonly GraphNodeSpec[] };

type BuildGraphError =
  | { reason: "duplicate-id"; id: string }   // anywhere in the tree — ids are the addressing scheme
  | { reason: "empty-id" }
  | { reason: "root-not-collection"; id: string }
  | { reason: "invalid-spec"; error: CollectionsValidationError };
```

`buildGraph` validates the complete runtime spec before normalization, so
malformed JavaScript or parsed data returns `invalid-spec` instead of placing
invalid fields into the graph.

### Runtime validation

Use these pure boundaries for JavaScript values, parsed JSON, palette output,
or normalized graphs received from outside the package:

```ts
parseCollectionItemNode(value: unknown): Result<CollectionItemNode, CollectionsValidationError>;
parseGraphSpec(value: unknown): Result<readonly GraphNodeSpec[], CollectionsValidationError>;
validateGraph(value: unknown): Result<void, GraphValidationError>;
```

Node and spec parsing rejects invalid discriminants, IDs, field types,
non-finite or negative durations/trims, invalid poster arrays, and video trims
whose total exceeds the full duration. `validateGraph` checks those runtime
fields plus every normalized index invariant. Validation errors include a
JSONPath-like `path` to the rejected value.

### `EMPTY_GRAPH: CollectionsGraph`

The empty graph constant.

### Queries

| Export | Signature | Notes |
| --- | --- | --- |
| `isCollection` | `(node: CollectionItemNode) => node is CollectionNode` | Type guard. |
| `getChildren` | `(graph, collectionId) => readonly NodeId[]` | `[]` for unknown/media ids (a shared constant, so even the miss case is reference-stable — safe in selectors). Returned array is reference-stable across moves that don't touch this collection. |
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
    }
  | {
      type: "update-media";        // the one DATA mutation: image duration / video trim
      nodeId: NodeId;
      update: MediaUpdate;
    };

// Discriminated to match the node. Video omitted trim fields keep their value
// (drag one handle at a time); trims are clamped so effective duration >= 0.
type MediaUpdate =
  | { mediaKind: "image"; durationSeconds: number }
  | { mediaKind: "video"; trimInSeconds?: number; trimOutSeconds?: number };

type ApplyCommandSuccess = { graph: CollectionsGraph; patch: CollectionsPatch };
```

`move-nodes` and `add-nodes` change STRUCTURE; `update-media` changes node
DATA only (structure untouched, `nodesById` re-allocated with structural
sharing). It's reversible like the rest — its patch is `nodes-updated`
(carries before/after; invert swaps them).

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
| `invalid-node` | (add-nodes) A node failed runtime validation. Includes its batch `index` and a `validationError` with the precise value path. |
| `not-media-node` | (update-media) `nodeId` is a collection, not a media node. |
| `invalid-media-update` | (update-media) The payload's `mediaKind` doesn't match the node, or it carries non-finite values. |
| `nothing-to-add` | `add-nodes` with an empty `nodes` array. |
| `invalid-index` | `toIndex` is not an integer (NaN/±Infinity splice at 0; a fraction desyncs forward apply from patch replay). |
| `would-create-cycle` | A node would move into itself or its own descendant. |
| `nothing-to-move` | Every dragged id was pruned (all descendants of other dragged ids). |
| `same-position` | The command would leave the graph identical (a move that lands where it started, or a trim to the current value) — a no-op, nothing pushed to history. |

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
type NodeUpdate = {
  nodeId: NodeId;
  before: CollectionItemNode; // full node before/after — invert swaps them
  after: CollectionItemNode;
};

type CollectionsPatch =
  | { type: "nodes-moved"; moves: readonly NodeMove[] }
  | { type: "nodes-added"; adds: readonly NodeAdd[] }
  | { type: "nodes-removed"; removals: readonly NodeAdd[] } // only from inverting adds
  | { type: "nodes-updated"; updates: readonly NodeUpdate[] }; // media trim/duration
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
- Returns `null` when geometry is malformed or when hovering a dragged node's own card. Descendants
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
lives here, nowhere else). `IntentRejection` is `missing-node` when the
adjacency target vanished, or `invalid-index` when a virtual boundary is
fractional or non-finite.

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
  clear(): void;                      // drop both stacks (used by store.replaceGraph)
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

### `resolveTrimCommand(graph, nodeId, action, stepSeconds): Result<UpdateMediaCommand, KeyboardTrimRejection>`

Keyboard trim for a focused media node, resolving to the same `update-media`
command the pointer trim handles dispatch. `extend` lengthens the clip at
that edge, `reduce` shortens it; the resolver steps the RAW value by
`stepSeconds` and the reducer owns the clamp (a boundary comes back from
`applyCommand`/`dispatch` as `same-position`).

```ts
type KeyboardTrimAction =
  | "trim-end-extend" | "trim-end-reduce"     // the END edge every media has: image duration / video trim-out
  | "trim-start-extend" | "trim-start-reduce"; // the video START edge: trim-in (image rejects)
```

`stepSeconds` must be finite and greater than zero. `KeyboardTrimRejection.reason`:
`missing-node`, `not-media-node`, `invalid-step`, and `no-start-edge` (a
start-edge action on an image). Wired in the default views
as **Alt+Shift+Arrow** (horizontal = end edge, vertical = video start edge).

### `resolveTrashCommand(graph, nodeId, trashId): Result<MoveNodesCommand, KeyboardTrashRejection>`

Keyboard "move to trash" for a focused node, resolving to the same
`move-nodes` (append-to-trash) command a pointer drop on `<TrashTarget>`
produces — subtrees ride along, undo restores, nothing is deleted.
`KeyboardTrashRejection.reason`: `missing-node`, `cannot-move-root`,
`no-trash-collection` (the id is absent or not a collection), and
`already-in-trash`. Trashing a collection that contains trash resolves to a
command the reducer then rejects as `would-create-cycle`. Wired in the default
views as **Alt+Delete**, active only while a `<TrashTarget>` is mounted (it
registers its id for the controller).

---

## React: provider (`react/DndCollections.tsx`)

### `<DndCollections>`

```ts
type DndCollectionsProps = {
  initialGraph: CollectionsGraph;
  onChange?: (change: CollectionsChange) => void;
  maxHistoryEntries?: number; // cap the undo stack; positive integer, default unbounded
  animateMoves?: boolean;     // post-commit FLIP sweep, default true; one sweep for ALL views
  components?: CollectionsComponents; // consumer pixels: ItemContent / GhostContent (see "Custom item content")
  children: ReactNode;
};
```

`animateMoves` is owned here at the provider (not per view), so a single FLIP
sweep animates every card under the instance — panels, virtual, and custom
views — on each commit (drop/undo/redo). It honors `prefers-reduced-motion`.

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
truth thereafter; later prop changes are ignored. To push a new graph in
later (async/server load), call `store.replaceGraph(next)` (grab the store
via `useCollectionsStore`). `onChange` is NOT frozen with it: the latest
callback prop is always the one invoked, so closures over current parent
state behave as expected.

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
| Alt+Shift+ArrowLeft / Alt+Shift+ArrowRight | Trim the end edge shorter / longer (image duration / video trim-out) |
| Alt+Shift+ArrowUp / Alt+Shift+ArrowDown | Trim the video start edge (trim-in); images reject |
| Alt+Delete | Move to trash (only while a `<TrashTarget>` is mounted) |

Alt+Enter / Alt+Backspace are always-available synonyms for
`nest-in-neighbor` / `move-out` — they matter inside a `VirtualGrid`, where
Alt+ArrowUp / Alt+ArrowDown become row moves (± the column count) and the
arrow bindings are therefore unavailable for nesting.

The pointer trim handles and the source-window overview are `aria-hidden`
visual affordances — the accessible way to trim is a focused card plus the
Alt+Shift bindings above. (Sliding a video's source window without changing
its duration remains pointer-only; a keyboard equivalent is a known gap.)

---

## React: store (`react/collections-store.ts`)

### `createCollectionsStore(initialGraph, options?): CollectionsStore`

`options.onChange` receives every committed change; `options.maxHistoryEntries`
(positive integer, default unbounded) caps the undo stack. `<DndCollections>`
calls this for you; create a store directly only for headless/test use.
The initial graph is runtime-validated before any store state is created;
malformed input throws `InvalidInitialGraphError`, whose `validationError`
identifies the failing path or graph invariant.

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
| `subscribeToChanges` | `(listener: (change: CollectionsChange) => void) => () => void` | The committed-change feed as a multi-listener seam — same events and ordering as the `onChange` option. For consumers that need the PATCH of a commit (e.g. `VirtualStrip` resizes exactly the slots a `nodes-updated` patch touched). Fires for dispatch/undo/redo; `replaceGraph` emits nothing. |
| `dispatch` | `(command) => Result<CollectionsPatch, CommandRejection>` | Reduce + push history + notify + `onChange`. |
| `undo` / `redo` | `() => boolean` | False when the respective stack is empty. |
| `replaceGraph` | `(graph: CollectionsGraph) => Result<void, GraphValidationError>` | Runtime-validates then swaps the committed graph wholesale — the escape hatch for async/server-loaded data (`initialGraph` is initial-only). Invalid input is rejected without changing or notifying the store. A successful swap clears undo/redo history (old patches can't replay on a new graph) and any in-progress drag/preview, prunes the selection to surviving ids, and — deliberately — does NOT fire `onChange` (the caller supplied this state; echoing it risks feedback loops). |
| `setSelection` | `(ids: readonly NodeId[]) => void` | No-op (no notify) when the set is unchanged. |
| `toggleSelected` | `(id: NodeId) => void` | |
| `clearSelection` | `() => void` | No-op when already empty. |
| `beginDrag` | `(pressedId: NodeId) => void` | Drag set = the selection if it contains `pressedId` (pressed id first — it's the overlay primary), else just `pressedId`. Sets `isDragging`. |
| `beginPaletteDrag` | `() => void` | Marks a palette drag live (`isDragging` without `activeIds`). Ends via `endDrag`. |
| `setDropIntent` | `(intent: DropIntent \| null) => void` | Deduplicates equal intents; computes `dropIntentInvalid` once per change. Non-null intents are IGNORED while no drag is live (`isDragging` false) — a dnd-kit gesture can outlive the store's drag state (`replaceGraph` mid-drag, failed palette factory) and must not repaint indicators. `null` always clears. |
| `endDrag` | `() => void` | Clears drag state; never mutates the graph. |
| `flashRejection` | `(ids: readonly NodeId[]) => void` | Sets `rejectedIdSet` for 600ms (re-flash resets the timer). |
| `destroy` | `() => void` | Clears listeners, any pending flash timer, AND live flash state (a store can outlive effect cleanup — Activity-style hide — and must not stay flagged); the provider calls it on unmount. |

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

## React: custom item content (`react/collections-components.tsx`)

The consumer-content seam: the package owns BEHAVIOR and GEOMETRY (drag
wiring, selection, trim gestures, aria, indicators, measurement, the card
box); consumers own PIXELS. `NodeCard` is a visually transparent interaction
shell that renders a content component inside its button surface —
`DefaultItemContent` (the stock look, also exported as the reference
implementation) unless one is registered.

```ts
type CollectionItemContentProps = Readonly<{
  id: NodeId;
  node: CollectionItemNode;   // stable reference — new identity ONLY on a data commit
  childCount: number;         // collections; 0 for media
  selected: boolean;
  rejected: boolean;          // rejection flash — style it or ignore it
  isDragSource: boolean;      // dimmed-in-place under the drag ghost
  dragActivation: NodeCardDragActivation; // "handle" overlays an 18px grip bar — leave room
  trimEnabled: boolean;       // the shell renders trim handles on this card
}>;
type CollectionItemContentComponent = ComponentType<CollectionItemContentProps>;

type CollectionGhostContentProps = Readonly<{ node: CollectionItemNode; extraCount: number }>;
type CollectionGhostContentComponent = ComponentType<CollectionGhostContentProps>;

type CollectionTrimHandleContentProps = Readonly<{
  side: "left" | "right";     // left = video trim-in; right = image duration / video trim-out
  node: MediaNode;
  selected: boolean;
}>;
type CollectionTrimHandleContentComponent = ComponentType<CollectionTrimHandleContentProps>;

type CollectionsComponents = Readonly<{
  ItemContent?: CollectionItemContentComponent;  // every card, all views
  GhostContent?: CollectionGhostContentComponent; // the drag-overlay ghost
  TrimHandleContent?: CollectionTrimHandleContentComponent; // pixels INSIDE the trim hit zones
}>;
```

**Trim handles** follow the same split: the shell keeps each handle's HIT
ZONE — positioning, width, cursor, the pointer gesture, and the
sibling-of-the-button DOM shape (load-bearing for gesture arbitration) —
while `TrimHandleContent` fills it (default: the amber grip bar,
`DefaultTrimHandleContent`). Duration readouts are CARD content, not handle
chrome: the showing/full pill and the live preview bubble live in
`DefaultItemContent`, gated on `trimEnabled`, so custom content never fights
a shell-drawn pill.

### `useLiveTrim(nodeId): LiveTrim | null`

Live trim values for consumer readouts (a pill that tracks the drag). Live
trims deliberately never touch the store and the shell doesn't re-render
mid-gesture, so live values can't arrive as props — this hook subscribes to
a provider-level emitter instead. It returns the gesture's `LiveTrim` split
per pointer move and `null` when the gesture settles (abort, no-op, or
commit — the committed node then carries the same values, so there is no
flash). Opt-in cost: the CALLING component re-renders per move — scope it to
a leaf readout, not your whole card (see `DefaultTrimReadout` /
`LiveTrimReadout` story); every other card stays frozen.

Register once at the provider (`<DndCollections components={{ ItemContent }}>`)
— that is what keeps cards and the drag ghost in sync from one place — or per
view via the `itemContent` prop (which overrides the registry). Resolution:
per-view `itemContent` → provider registry → `DefaultItemContent`.

Rules, all load-bearing for the efficiency model:

- **Identity-stable**: define components at module scope and wrap them in
  `React.memo`. An inline definition is a NEW component type per render —
  React remounts every card's content subtree (development builds warn once
  per provider instance, including for entries appearing/disappearing). The
  `components` object literal itself may be inline; only the fields must be
  stable.
- **Presentational only**: content renders inside a `<button>` — no
  interactive elements (buttons, links, inputs). Interactivity (selection,
  drag, trim) is the shell's job; compound primitives for custom interactive
  placement are a planned escape hatch.
- Nothing per-frame ever reaches content: every prop is a rarely-changing
  primitive plus the structurally-shared `node`. Content may subscribe to
  its own stores — that re-renders only the subscribed content, never the
  shells (`CustomContentRenderEfficiency` asserts both directions).

## React: views (`react/node-views.tsx`, `react/history-views.tsx`)

Default views — usable as-is, or as reference implementations for custom
ones (everything they do goes through the store API above).

| Component | Props | Notes |
| --- | --- | --- |
| `CollectionPanels` | `collectionIds?: readonly NodeId[]`, `itemContent?` | One panel per id (default: the graph's roots). FLIP animation is owned by `<DndCollections animateMoves>`, not here. `itemContent` overrides the provider registry for these panels' cards. |
| `CollectionPanel` | `collectionId: NodeId`, `itemContent?` | One droppable panel with its cards. |
| `NodeCard` | `id: NodeId`, `className?: string`, `dragActivation?: NodeCardDragActivation` (`"body" \| "handle" \| "hold"`), `rovingTabIndex?: number`, `trimPixelsPerSecond?: number`, `itemContent?: CollectionItemContentComponent` | A visually transparent interaction shell — pixels come from `itemContent` → the provider registry → `DefaultItemContent` (see "Custom item content"). Memoized; id-only state by design — everything dynamic arrives via selectors. `className` is tailwind-merged onto wrapper AND button (sizing overrides beat the `h-24 w-32` defaults; virtual views pass `"h-full w-full"`). `dragActivation`: `"body"` (default) drags instantly from anywhere; `"handle"` renders a top grip bar as the only POINTER activator — the keyboard grab (Enter) stays on the card button in every mode; `"hold"` requires a 250ms press (fast movement is handed to surface gestures). `rovingTabIndex` (0 or -1) is for virtualized views' single-tab-stop roving focus: exactly one mounted card is `0`; it also demotes the grip to `-1` (pointer-only). A finite, positive `trimPixelsPerSecond` enables edge trim handles on media (right = image duration / video trim-out; left = video trim-in); invalid scales are treated as omitted. The card resizes LIVE during the drag when the view provides a `TrimPreview` (VirtualStrip does, via targeted `resizeItem`); without one it still trims, just without live resize. Body clicks always select; ghosts stay card-sized. Draggable + droppable. |
| `NodeCardGhost` | `node: CollectionItemNode`, `extraCount: number` | The drag-overlay ghost; renders a `+N` badge when `extraCount > 0`. |
| `UndoRedoControls` | — | Buttons bound to `store.undo`/`store.redo`, disabled off `canUndo`/`canRedo`. Announces "Change undone." / "Change redone." through the instance live region (best-effort: silent under bare `CollectionsStoreProvider` hosting). |
| `HistoryLog` | — | Human-readable command log over `historyEntries`. |
| `PaletteItem` | `paletteId: string`, `createNode: () => CollectionItemNode`, `children?` | External drag source; the factory runs at drag START (fresh ids per drag). Its runtime result is validated and copied before drag state is published; throws or malformed values cancel with one announcement. The drop commits `add-nodes` through the standard intent pipeline. `aria-describedby` points at palette-specific keyboard instructions (Enter picks up, arrows aim, Enter drops) rather than dnd-kit's blanked default. |
| `TrashTarget` | `trashId: NodeId` | Styled panel droppable (`role="group"`, which supports `aria-disabled`) for a (usually hidden) trash root; drops are ordinary moves — subtrees ride along, undo restores, nothing is deleted. The id must resolve to a live collection; invalid targets stay disabled. Focusable at `tabIndex` -1: Alt+Delete on a collection's LAST child lands keyboard focus here when no sibling (and no rendered trash card) can take it. |

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
| `data-trim-handle` | media edge handle hit zone | `"left"` or `"right"` (left is video-only). Its pixels are the `TrimHandleContent` slot. |
| `data-trim-pill` | `DefaultItemContent` readout | Showing/full duration pill (trim-enabled media cards; absent with custom content). |
| `data-trim-preview` | `DefaultItemContent` readout | The previewed effective duration (seconds) while a handle is dragged (via `useLiveTrim`). |
| `data-trim-overview` | overview filmstrip (`VirtualStrip` only) | The selected video's node id. Renders directly above its clip; absent unless a video is selected AND mounted. Dragging its body MOVES the source window (trim-in/out shift together, duration constant). |
| `data-trim-overview-window` | amber "showing" window | Its left/right edges are pixel-aligned with the clip's own rendered edges (see the trim overview section below). |
| `data-trim-overview-handle` | overview window grip | `"left"` (trim-in) or `"right"` (trim-out); dragging trims the clip, same `update-media` as the card edge handles. |
| `data-testid="drag-ghost"` / `"drag-ghost-count"` | overlay | The ghost and its `+N` badge. |
| `data-testid="history-log"` / `"history-empty"`, `data-history-entry` | history log | Log container / empty marker / entries. |

---

## React: virtualized views (`virtual/`)

TanStack-Virtual projections of a single collection: only the visible cards
(plus overscan) mount, so a collection of thousands stays a bounded DOM. Cards
are the standard `NodeCard` — virtualization changes WHICH ids render, not how
a card works, so selection, drag-source dimming, and store subscriptions come
along unchanged. Drops over gaps and unmounted regions resolve through the
container droppable (`insert-at-index`), not neighbor rects. Both drive their
own edge auto-scroll (dnd-kit's never engaged for these containers).

**Keyboard navigation.** Each view is `role="grid"` and a single roving tab
stop: bare **arrow keys** move a focused index through the WHOLE collection —
strip is 1D (Left/Right/Home/End), grid is 2D (arrows + Home/End) — scrolling
offscreen items into view and focusing them, so a keyboard user reaches item
500 of 1000 that was never in the DOM. `aria-rowcount`/`aria-colcount` and
per-cell `aria-rowindex`/`aria-colindex` report the true position under
virtualization. This is distinct from the two other arrow uses: **Alt+arrow**
still MOVES the item (§ keyboard grammar) and dnd-kit's grabbed-arrows fire
only after Enter — navigation stands down while a drag is live.

### `<VirtualStrip>` — horizontal, variable width

```ts
type VirtualStripProps = {
  collectionId: NodeId;
  pixelsPerSecond?: number;                              // THE timeline scale: media widths = durationToWidth(duration, pps), and trim handles inherit it — one scale, no drift. The recommended sizing for duration-mapped strips
  itemWidth?: number;                                    // default 128; collections and non-duration fallbacks
  itemWidthFor?: (node: CollectionItemNode) => number | undefined; // ADVANCED per-node width override (beats pixelsPerSecond); memoized by node id
  itemHeight?: number;                                   // default 96
  gap?: number;                                          // default 8
  overscan?: number;                                     // default 4
  panToScroll?: boolean;                                 // default true — drag the surface to scroll, with momentum
  itemDragActivation?: "handle" | "hold";                // default "handle" (grip bar); "hold" = press-and-hold the body. Ignored when panToScroll is off (bodies drag instantly)
  trimPixelsPerSecond?: number;                          // override the trim conversion; DEFAULTS to pixelsPerSecond. Handles render when either is set; commits update-media on release. LIVE resize follows the strip's OWN width resolution (a synthesized node with the live trims runs through itemWidthFor/pixelsPerSecond) — so consumer floors hold mid-drag, and a fixed-width strip's card keeps its width (data trims, geometry doesn't)
  itemContent?: CollectionItemContentComponent;          // per-view card pixels; overrides the provider registry
  overlay?: ReactNode;                                   // content-coordinate layer over the strip (playhead, markers): rides scroll + live-trim transform; aria-hidden, pointer-events none
  className?: string;
};
type VirtualStripHandle = {
  scrollToNode: (id: NodeId) => void;  // scrolls the slot into view (works for unmounted nodes)
  focusNode: (id: NodeId) => void;     // scroll to, then focus once the virtualizer mounts it
  remeasure: () => void;               // drop cached widths and re-run itemWidthFor (metadata/zoom changed)
};
```

Numeric layout options are normalized before reaching the virtualizer:
`pixelsPerSecond`, base widths/heights, and the trim scale must be finite
and positive, `gap` is finite and non-negative, and `overscan` is a
non-negative integer. Invalid values use the documented defaults;
`itemWidthFor` may return zero for a fully trimmed clip, while
negative/non-finite results use `itemWidth`. All duration-derived widths run
through the exported `durationToWidth(seconds, pps, min = MIN_ITEM_WIDTH)` —
committed layout, live trim preview, and virtualizer measurement share the
one conversion, so they cannot drift; use it for overlay/playhead math too.

Slot widths reconcile at COMMIT cadence through `store.subscribeToChanges`:
a `nodes-updated` patch resizes exactly the touched slots (targeted
`resizeItem`); a full re-measure happens only for `replaceGraph`, scale/
layout prop changes, and the `remeasure()` handle.

When `trimPixelsPerSecond` is set and a mounted video is selected,
`VirtualStrip` renders the source-window overview (`TrimOverviewStrip`) as a
floating tooltip directly above that clip — there is no separate component
to mount and no layout band that displaces the row. The overview's amber
window is pixel-aligned to the clip's rendered edges at rest and during a live
trim because its position is derived from the mounted clip rect.

`itemWidthFor` is evaluated lazily per index (never by rendering the node) and
the virtualizer memoizes its measurements, so it runs once per layout, not per
render. With `panToScroll` on, item drags move to a grip bar or behind a
press-and-hold so the body is free to pan; with it off, `touchAction` stays
`auto` so native horizontal touch scrolling still works.

### `<VirtualGrid>` — vertical, fixed cells

```ts
type VirtualGridProps = {
  collectionId: NodeId;
  cellWidth?: number;   // default 128
  cellHeight?: number;  // default 96
  gap?: number;         // default 8
  columns?: number;     // fixed count; omit to derive responsively from width. Non-positive-integer values fall back to responsive
  overscan?: number;    // default 2 (rows)
  height?: number;      // default 480 — scroll viewport height
  itemContent?: CollectionItemContentComponent; // per-view card pixels; overrides the provider registry
  className?: string;
};
type VirtualGridHandle = {
  scrollToNode: (id: NodeId) => void;
  focusNode: (id: NodeId) => void;
};
```

Grid sizes and viewport height must be finite and positive; `gap` is finite
and non-negative; `overscan` is a non-negative integer. Invalid values use
the documented defaults, while an invalid fixed `columns` value falls back
to responsive measurement.

Row-virtualized (one virtual item per row; columns are index arithmetic).
Inside a grid, Alt+ArrowUp/Down are row moves (± the column count) — the grid
publishes its live column count on `data-grid-columns` for the keyboard layer.
Cross-row moves recreate the card's DOM element because rows own their cells.
The provider's unambiguous node fallback preserves the visual FLIP and the
keyboard layer restores focus after the new card mounts, but DOM/component
state local to the old card does not survive that hop; reusable cards should
keep durable state in the collection store.

### Virtual DOM/test hooks

| Attribute | Element | Meaning |
| --- | --- | --- |
| `data-virtual-strip` / `data-virtual-grid` | scroll container | Collection identity. |
| `data-virtual-overlay` | overlay layer (strip) | The consumer `overlay` slot's content-coordinate wrapper (aria-hidden, pointer-events none). |
| `data-grid-columns` | grid container | Live column count (keyboard row-move scope). |
| `data-virtual-index` / `data-virtual-row` | slot / row wrapper | Virtualizer index. |
| `data-drop-indicator="virtual"` / `"virtual-grid"` | indicator line | The resolved insert boundary, in content coordinates. |

---

## Extension seams

For building custom cards, panels, or virtualized containers that plug into
the same store, FLIP scope, and collision pipeline as the built-ins:

| Export | From | Use |
| --- | --- | --- |
| `CollectionsStoreProvider` | `react/collections-store` | Wrap a subtree in a store you created with `createCollectionsStore` (headless/custom hosting). |
| `useCollectionsContainer` / `CollectionsContainerContext` / `CollectionsContainerValue` | `react/container-context` | Read the instance's wrapper ref (FLIP scope), the card and palette `aria-describedby` instruction ids (`instructionsId` / `paletteInstructionsId`), the `trashRef` slot a mounted `<TrashTarget>` registers into (Alt+Delete scope), and `announce` — the instance's aria-live channel. |
| `VIRTUAL_INSERT_DATA_KEY` / `VirtualInsertTarget` / `isVirtualInsertTarget` | `react/virtual-droppable` | The droppable-`data` contract a custom virtualized container carries so collision detection resolves pointer → boundary index through its own layout math. The collection must exist and the resolver must return an integer; thrown errors and invalid results reject the target. `isVirtualInsertTarget` is the runtime guard that narrows an unknown droppable-`data` entry to the contract. |
| `useEdgeAutoScroll` | `react/use-edge-autoscroll` | Deterministic edge auto-scroll for a custom virtualized scroll container (pairs with `usePanWithMomentum`). |
| `usePanWithMomentum` / `PanWithMomentumOptions` | `react/use-pan-with-momentum` | Surface pan with optional inertial glide. Invalid slop/velocity/friction values use safe defaults; friction is constrained to the open interval `(0, 1)` and max velocity never falls below the stop threshold. |

`useEdgeAutoScroll` likewise normalizes its edge band to a finite positive
value and its maximum speed to a finite non-negative value before starting
the animation loop.

`applyPatch` (Core) is the one deliberately unchecked primitive: it rewrites
indexes without validation, so apply patches only to the graph state they
were produced against (or its inverse-adjacent state).
