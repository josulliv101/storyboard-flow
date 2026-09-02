# @josulliv101/nested-collections

A typed, immutable engine for nested collections — a normalized graph, one
mutation path, reversible patches behind undo/redo, and memoized aggregates that
know what they do not know.

Framework-agnostic core with zero runtime dependencies. React bindings ship
behind a separate entry point so the core stays callable from a server route.

```bash
npm install @josulliv101/nested-collections
```

React is an **optional** peer dependency (`^19`), needed only for
`@josulliv101/nested-collections/react`.

---

## Why this and not a tree of objects

Four decisions do most of the work. Each exists because the alternative shipped
and cost something.

**A collection knows the difference between empty and unread.** `ChildrenState`
has four states, not a boolean: `loaded`, `unloaded`, `reference`, and `missing`
(storage confirmed gone). Collapsing "no children" into one state is what forces
every downstream consumer to thread an uncertainty flag it will eventually
forget to pass.

**Forward-incompatible data seals instead of failing the load.** A node whose
kind is unregistered, or whose `parse` failed, is held as a `SealedNode`: it
keeps its raw bytes, stays movable, removable and undoable, and re-emits
byte-exact. One refused node cannot make a document permanently unwritable.

**One mutation path.** Four commands (`move-nodes`, `insert-nodes`,
`remove-nodes`, `edit-nodes`) go through one reducer, which produces one patch,
which is the only thing that rewrites the indexes. Undo cannot drift from
forward application, because there is only one applier.

**Aggregates carry their own certainty.** A fold over a subtree containing an
unread branch returns `"estimated"` or `"partial"`, never a number that looks
measured. A subtree whose only gaps are confirmed-`missing` folds to `"exact"`,
because confirmed-gone is knowledge.

Nothing throws after construction. Every failure is a `Result` with a typed
code — `unknown-parent`, `would-create-cycle`, `duplicate-owner`,
`target-not-loaded`, and sixteen more.

---

## Quick start

### 1. Describe your kinds

A node type is everything the engine knows about one kind: how its opaque `Data`
is parsed, serialized and edited. `parse` runs on wire data *and* on values you
insert, so a normalizing node type normalizes both.

```ts
import {
  createEngine,
  defineNodeType,
  foldMonoid,
  parseNodeId,
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
} from "@josulliv101/nested-collections";

type Shot = Readonly<{ title: string; seconds: number }>;
type ShotEdit = Readonly<{ title?: string; seconds?: number }>;

const shot = defineNodeType<Shot, ShotEdit>()({
  kind: "shot",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Shot, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const { title, seconds } = raw as Partial<Shot>;
    if (typeof title !== "string" || title.trim() === "") {
      return { ok: false, error: [{ path: "$.title", message: "title required" }] };
    }
    if (typeof seconds !== "number" || seconds < 0) {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds >= 0" }] };
    }
    return { ok: true, value: { title: title.trim(), seconds } };
  },
  serialize(data) {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: { title: edit.title ?? data.title, seconds: edit.seconds ?? data.seconds },
    };
  },
});

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;

const folder = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    const name = (raw as Partial<Folder>)?.name;
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name required" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data) {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});
```

`defineNodeType<Data, Edit>()` is curried on purpose. `Edit` has exactly one
inference site, so an uncurried factory would let a node type whose `applyEdit`
ignores its edit argument silently infer `Edit = unknown` — at which point every
dispatched edit for that kind typechecks and the per-kind edit typing is dead.

### 2. Add a summary type and a fold

A **summary** is what an unread collection carries so it can still answer for
itself. A **fold** is how a subtree rolls up.

```ts
const types = [shot, folder] as const;
type Types = typeof types;

type Summary = Readonly<{ seconds: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    const seconds = (raw as Partial<Summary>)?.seconds;
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds required" }] };
    }
    return { ok: true, value: { seconds } };
  },
  serialize(value) {
    return { seconds: value.seconds };
  },
};

const secondsFold = foldMonoid<Types, Summary, number>({
  key: "seconds",
  empty: 0,
  leaf(node) {
    // The collection is heterogeneous, so the fold says what each kind
    // contributes. A folder contributes nothing, and says so here.
    return node.kind === "shot" ? node.data.seconds : 0;
  },
  concat(a, b) {
    return a + b;
  },
  placeholder(node) {
    // An unread collection reports its STORED number at certainty
    // "estimated". `undefined` means nothing was stored, which becomes
    // `empty` at "partial". Neither pretends to be a measurement.
    return node.summary === null ? undefined : node.summary.seconds;
  },
});
```

`foldMonoid` is the ergonomic path for sums and counts. Write
`ConsumerDefinedFold` by hand when you need a non-commutative concat, an
empty-collection floor that differs from the identity, or position-sensitive
certainty.

### 3. Build the engine

`Ts`, `S` and `F` all infer — you never restate the registry tuple.

```ts
const engine = createEngine({
  types,
  summary,
  folds: { seconds: secondsFold },
});
```

`createEngine` is pure: no React, no DOM, no `"use client"`. It is safe to call
from a route handler, and that is enforced by the package's own build rather
than by convention.

### 4. Load a document and mutate it

The wire format is a **flat node list** — no recursion, no depth limit, and a
sealed container's children stay addressable.

```ts
const loaded = engine.deserialize({
  formatVersion: 1,
  schemaVersions: { folder: 1, shot: 1 },
  rootIds: ["reel"],
  nodes: [
    { id: "reel", kind: "folder", data: { name: "Reel" }, children: ["s1"] },
    { id: "s1", kind: "shot", data: { title: "Wide", seconds: 4 } },
  ],
});

if (!loaded.ok) throw new Error(loaded.error.message);
const store = engine.createStore(loaded.value.graph);

const inserted = store.dispatch({
  type: "insert-nodes",
  toParentId: parseNodeId("reel"),
  toIndex: 1,
  seeds: [{ kind: "shot", data: { title: "Close", seconds: 2 } }],
});

if (!inserted.ok) {
  console.error(inserted.error.code, inserted.error.message);
}

const total = store.aggregate("seconds", parseNodeId("reel"));
console.log(total?.value, total?.certainty); // 6 "exact"

store.undo();
```

`loaded.value.report` is worth reading even on success: `ok: true` is not the
same as "every node arrived intact", because sealing is a success path. Check
`report.sealed` before telling a user the document loaded.

Ids are **engine-minted**. `insert-nodes` takes seeds carrying values, never
ids, which is what makes "an insert is undoable" true by construction.

---

## Drag and drop

`resolveDrop` is the only place a post-removal insertion index is computed.
Views measure in pre-removal coordinates — the numbers they can actually see —
and this converts once.

```ts
const command = store.resolveDrop({
  type: "move",
  nodeIds: [parseNodeId("s1")],
  toParentId: parseNodeId("reel"),
  toIndexBefore: 1,
});

if (command.ok) store.dispatch(command.value);
```

It runs the structural checks — unknown node, unknown parent, not-a-container,
target-not-loaded, cycles, root moves — so an illegal gesture is refused while
it is still a gesture. It deliberately does **not** run the ceilings; those are
a trust boundary and refuse at the command door.

---

## Persistence

```ts
const unsubscribe = store.subscribeToChanges((change) => {
  change.patch;             // what changed, reversibly
  change.source;            // "command" | "undo" | "redo"
  change.detachedSubtrees;  // removed containers whose subtrees were never read
});
```

`detachedSubtrees` is how you avoid orphaning storage you never loaded. IO
landing paths — `load`, `markMissing`, `applyNonUndoableWrite` — emit nothing
here by design: echoing a write back to the consumer that just performed it is
how a persistence loop starts.

Save with `engine.serialize(graph)`, or `engine.serializeChecked(graph)` to
refuse writing a document that would not load back.

---

## React

Bindings are a factory, not module exports, because `createContext` cannot be
generic — a module-scope context has nowhere to get `Ts` from, and `useNode`
would hand back `GraphNode<never[], never>`.

Call it **once**, at module scope.

```tsx
import { createReactBindings } from "@josulliv101/nested-collections/react";

export const {
  Provider,
  NodeSlot,
  useChildren,
  useFold,
  useDispatch,
  useHistory,
  useIsSelected,
  useSelectionActions,
  defineNodeView,
} = createReactBindings(engine);
```

Register one view per kind. Each receives its own kind's `Data`, fully typed —
no casting, no `switch` in your component.

```tsx
defineNodeView("shot", function ShotCard({ id, data }) {
  const selected = useIsSelected(id);
  const selection = useSelectionActions();
  return (
    <button type="button" aria-pressed={selected} onClick={() => selection.toggle(id)}>
      {data.title} · {data.seconds}s
    </button>
  );
});

defineNodeView("folder", function FolderCard({ id, data }) {
  const children = useChildren(id);
  const total = useFold("seconds", id);
  return (
    <section>
      <h3>
        {data.name} · {total?.value ?? 0}s
        {total?.certainty === "estimated" ? " (estimated)" : null}
      </h3>
      {children.map((childId) => (
        <NodeSlot key={childId} id={childId} />
      ))}
    </section>
  );
});
```

`NodeSlot` takes `{ id }` and nothing else, which is what makes `memo` actually
work: there is no render prop for a parent's re-render to hand in fresh.

Every node-scoped hook subscribes to that node's `subtreeRev`, which is bumped
along the ancestor chain by every mutation — so an ancestor holding a rollup is
woken by a deep edit, while uninvolved siblings are not.

```tsx
function Toolbar() {
  const { canUndo, canRedo, undo, redo } = useHistory();
  return (
    <div>
      <button type="button" disabled={!canUndo} onClick={undo}>Undo</button>
      <button type="button" disabled={!canRedo} onClick={redo}>Redo</button>
    </div>
  );
}

export function App({ store }) {
  return (
    <Provider store={store}>
      <Toolbar />
      <NodeSlot id={parseNodeId("reel")} />
    </Provider>
  );
}
```

Selection is its own subscription slice — engine-owned because `selectRange` is
inclusive in **document** order, but never in the graph, never in a patch, never
undoable. A selection change does not notify graph subscribers.

---

## Handling every node shape

`GraphNode` is closed and deliberately includes `SealedNode`, so an exhaustive
switch does not compile until forward-incompatible data is handled.

Discriminate on `sealed` **first**, then `container` — `container` alone cannot
do it, because on the sealed arm it is a plain `boolean` off the wire and is not
disjoint from the literals on the other two.

```ts
if (node.sealed) {
  // SealedNode — raw bytes, still movable and removable
} else if (node.container) {
  // CollectionNode — has `children: ChildrenState` and `summary`
} else {
  // LeafNode — has `data` typed by its kind
}
```

---

## Ceilings

Four, because a document arrives from storage or the wire and its size is
hostile input rather than a known quantity. Each refuses loudly rather than
truncating, and names the config to raise.

| Config | Default | What it bounds |
| --- | --- | --- |
| `maxNodes` | `100_000` | Nodes in one document |
| `maxNodeIdLength` | `1024` | Length of one node id (`null` opts out) |
| `maxDepth` | unbounded | Nesting depth — yours to set, since only you know your data |
| `historyLimit` | `1_000` | Undo entries (`null` opts out) |

`foldCacheLimit` defaults to `8 × 16384` entries. It is a **cost** dial only:
cache keys carry the subtree revision, so a stale entry is unreachable rather
than wrong, and eviction can never change an answer. If `stats().evictions`
climbs while `hits` stays flat, the table is too small for your graph and the
memo table has silently stopped helping.

`historyLimit` bounds a stack whose entries hold two whole copies of the edited
node's `Data`, so it is a **depth**, not a memory bound. Size it against your
own value if your nodes carry more than a scalar.

Set `devChecks: true` in development. It adds deep-freezing of parsed values, a
`parse(serialize(d))` round trip, an `invertEdit` verification, a shadow cold
refold on cache hits, and a full graph invariant audit after every commit — all
reported through `console.error`, never thrown, and never able to change what
the engine stores.

---

## Entry points

| Import | Contains |
| --- | --- |
| `@josulliv101/nested-collections` | The engine. Pure — no React, no DOM. |
| `@josulliv101/nested-collections/react` | `createReactBindings`. Carries `"use client"`. |

The split is load-bearing rather than tidy. If one barrel covered both, a
consumer's `export const engine = createEngine(...)` would land in a
`"use client"` module, a server route would import it, it would typecheck clean,
and it would 500 at request time. The `exports` map gives the core entry no
route to the React half, and the package's tests assert it.

The barrel is curated, not `export *`. `buildGraph` is deliberately not
exported — assembling a graph from already-parsed nodes is an ingress author's
tool, and the sanctioned ingress is `deserialize`. `emptyGraph` covers the one
case a consumer legitimately needs.

---

## Status

`0.1.0`, and the API may still move. The engine, the React bindings and the wire
format are covered by the package's own suite; `formatVersion` is checked before
anything else on ingress, so a future format change refuses cleanly rather than
misreading.

## License

MIT — see [LICENSE](./LICENSE).
