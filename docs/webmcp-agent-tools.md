# WebMCP agent tools

**Status: design / planning — no code yet.** This is the agreed shape for
letting an AI agent (Claude, or any MCP client) edit the timeline while the
app is open side-by-side and updates in real time. Keep it current as
decisions land — see the decision log at the bottom.

## Goal

A **two-writer loop**: you edit in the browser, an agent edits through tools,
both hit the same timeline documents, and both views stay honest.

```
You    ─▶ Browser editor ─┐
                          ├─▶ CollectionsStore command ─▶ PersistenceBridge ─▶ Firestore (revision/CAS)
Agent  ─▶ WebMCP tools ───┘                                      │
   ▲                                                             │
   └──────────────── live re-render (same store) ◀──────────────┘
```

The headline requirement — *see changes in real time, side by side* — is why
WebMCP wins here over a server-side MCP: a WebMCP tool runs **in the page**
and mutates the **live in-memory graph** the UI already renders from, so the
open editor animates the change and `PersistenceBridge` writes it to
Firestore, both for free.

## Why the codebase is ready for this

- **The domain engine is headless.** `@storyboard/collections-core` (reducer,
  patches, graph) and `@storyboard/timeline-domain` (document ⇄ graph adapter)
  have no React/DOM deps, so a tool can run the *actual* command path and
  invariants — not a re-implementation.
- **One mutation path already exists.** Every edit is a `CollectionsCommand`
  through `store.dispatch`. A tool is a thin translator onto those commands.
- **Persistence + concurrency are already built.** `PersistenceBridge`
  (`components/graph-view/graph-persistence.tsx`) subscribes to committed
  patches and writes affected collections; `lib/firebase-timeline-store.ts`
  gives revision counters, `expectedRevision` compare-and-set, and atomic
  multi-document transactions. A second writer inherits all of it.

## The one shaping fact

Firestore access is **server-only and one-shot** (`lib/firebase-timeline-store.ts`
is `server-only`, Admin SDK, `.get()` — never `onSnapshot`). The client
`graphDocumentsGateway` is an in-memory cache. Consequence: a write that
bypasses the live client store would **not** show up in the open app — there
are no client listeners. WebMCP sidesteps this entirely by mutating the live
store, which is the whole reason to prefer it. (A future server-MCP transport
would need a live push — SSE — added; see "Durable transport".)

## Route: how the agent reaches the tools

Tools are registered **once** in the page via `navigator.modelContext.registerTool()`.
That single registry is reachable by three consumers, all hitting the same
handlers:

| Consumer | Route | Notes |
| --- | --- | --- |
| Agent (Claude) | `chrome-devtools-mcp` with `--categoryExperimentalWebmcp=true` | official Google MCP server over CDP; **primary route** |
| Manual | DevTools → **Application → WebMCP** panel | invoke tools by hand; appears once a tool is registered (Chrome 149+) |
| Manual / scripted | console: `navigator.modelContextTesting` | `listTools()` / `executeTool(name, input)` |

MCP client config for the primary route:

```jsonc
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--categoryExperimentalWebmcp=true"
      ]
    }
  }
}
```

Point `chrome-devtools-mcp` at the **visible** Chrome you're watching (its
browser-URL / CDP-endpoint option), not a spawned headless instance, or the
agent will edit a browser you can't see.

### Browser prerequisites

- Flags: `chrome://flags/#enable-webmcp-testing` (the API) **and**
  `chrome://flags/#devtools-webmcp-support` (the DevTools panel). Search
  "webmcp" in `chrome://flags` and enable all; relaunch.
- **Secure context required.** `localhost` / `127.0.0.1` / `::1` are exempt and
  work over plain `http`; a LAN IP (`192.168.x.x`) is **not** a secure context.
  Verify with `window.isSecureContext === true`. Production is HTTPS → secure
  automatically.
- Chrome ≥ 149 for the DevTools panel (the API predates it).

### Production reality

- Works against the deployed HTTPS origin exactly like localhost; it's an
  operator-side setup pointed at the deployed app.
- For **flag-on users**, no origin-trial token is needed. To reach users
  *without* the flag, register the WebMCP Chrome Origin Trial and ship the
  token — unnecessary once WebMCP is on-by-default (projected late 2026).
- The DevTools/console manual paths need **no** bridge or MCP client at all.

### Durable transport (later)

Keep tool handlers **transport-agnostic**. If headless/automation/multi-user is
ever needed, add a server-MCP front-end onto the *same* handlers (running the
same headless engine) plus an SSE push to re-hydrate open browsers. WebMCP
stays the interactive surface; the server transport is the durable hedge
against the experimental API shifting.

## Registry design

```ts
type ToolDef = {
  name: string;
  description: string;
  inputSchema: JSONSchema;            // agent-facing arg contract
  annotations?: { readOnlyHint?: boolean };
  execute(input, client): Promise<ToolResult>;
};

// Injected once, via closure — the live session handles:
type ToolCtx = {
  store;            // useCollectionsStore() — the live graph
  details;          // useGraphDetailsStore()
  gateway;          // graphDocumentsGateway (ensure / peek / seed)
  projectId; focusedId; trashId;
  mintId;
  parkPendingDetail; unparkPendingDetail;   // graph-pending-details
  ensureDocumentTree;                        // async subtree load
  sessionAlive;     // the ref from the async-Duplicate fix
};
```

**`<McpToolsBridge>`** renders **inside `<DndCollections>`**, next to
`PersistenceBridge`/`GraphItemActionsBridge` (that is where the live store is).
On mount: feature-detect `navigator.modelContext`, then `registerTool(def, { signal })`
per tool with an `AbortController` tied to the effect; cleanup aborts →
unregisters. This ties tool lifetime to the store's mount, so a tool closure
can't outlive its session and dispatch into a dead store — the **same
session-lifetime discipline** as the async-Duplicate fix in
`graph-item-actions.tsx`.

Three shared helpers every tool uses:

- **`resolvePlacement(graph, { into?, before?, after?, position? }) → { toParentId, toIndex }`**
  — extend `resolveInsertPlacement` so the agent expresses placement
  *semantically* and the handler does the **post-removal** `toIndex` math
  (`toIndex` is the target's children index *after* the moved nodes are
  removed — the reducer's convention; never reinvent it elsewhere).
- **`ensureTarget(collectionId)`** — `ensureDocumentTree` before any structural
  op into a nested collection, or the `commandPolicy` refuses a drop into an
  un-hydrated placeholder. Re-check `sessionAlive` after this await.
- **`toToolResult(Result)`** — map `store.dispatch`'s `Result` to MCP output:
  ok → summary + `structuredContent`; `!ok` → `isError` with the rejection
  `reason`.

### Rules every tool inherits

- **Address by `NodeId`** (the ids `read_timeline` returns). Treat ids as
  **opaque** — never split/parse them (the `NodeId is any string` rule);
  only look them up in `graph.nodesById` / `graph.parentById`.
- **Mutations dispatch to the live store** → UI animates (FLIP) and
  `PersistenceBridge` persists. No separate write path.
- **Read-only tools carry `readOnlyHint: true`.**
- **Any tool with an `await` re-checks `sessionAlive` before dispatch.**

## Command surface (what tools translate into)

From `packages/collections-core/commands.ts`:

```
move-nodes    { nodeIds, toParentId, toIndex }   ← reorder / move / nest / multi
add-nodes     { nodes, toParentId, toIndex }     ← brand-new nodes (empty collections OK)
update-media  { nodeId, update }                 ← trim (video) / duration (image)
rename-node   { nodeId, name }                   ← media or collection
```

`MediaUpdate` is `{ mediaKind:"image", durationSeconds }` or
`{ mediaKind:"video", trimInSeconds?, trimOutSeconds? }` (omitted trim keeps the
current end). There is **no delete command**: delete = `move-nodes` into the
trash root (recoverable). Rejections are typed (`missing-node`,
`target-not-collection`, `would-create-cycle`, `cannot-move-root`,
`duplicate-node-id`, `invalid-node-id`, `invalid-node`) and become the agent's
error feedback.

## Tool contracts (v1 surface)

Two read tools (graph + assets) and six mutations.

### `read_timeline` — the agent's eyes (build first)

```jsonc
// input
{ "type": "object", "properties": {
  "collectionId": { "type": "string", "description": "Collection node id. Omit for the focused timeline." },
  "depth": { "type": "integer", "minimum": 1, "default": 1 },
  "hydrate": { "type": "boolean", "default": false,
    "description": "Lazy-load placeholders within depth; else report hydrated:false." }
}, "additionalProperties": false }
```
`readOnlyHint: true`. **Output:** `{ timeline:{id,title,focused}, nodes:[ {id, kind, name,
mediaKind?, src?, durationSeconds?, trimInSeconds?, trimOutSeconds?, hydrated?, childCount?,
children?} ] }` + a compact text summary.
**Handler:** resolve id (default `focusedId`) → walk `getChildren` to `depth`;
collections read `details[id].hydrated` (summary if placeholder + `hydrate:false`);
if `hydrate:true`, `ensureTarget` placeholders, re-check `sessionAlive`, re-read
snapshot. **Guards:** opaque ids; dedupe by id per branch (shared references);
`missing-node` / not-a-collection.

### `list_assets` — eyes on the palette (companion to `add_clip`)

```jsonc
// input
{ "type": "object", "properties": {
  "folder": { "type": "string" }, "tags": { "type": "array", "items": { "type": "string" } },
  "query": { "type": "string" }, "limit": { "type": "integer", "default": 30 }
}, "additionalProperties": false }
```
`readOnlyHint: true`. Maps to the asset-provider seam (`lib/assets/*`,
`docs/asset-providers.md`). **Output:** `{ assets: [ {id, name, mediaKind, src, poster?,
durationSeconds?, folder, tags} ] }` — the shape `add_clip` consumes. Ignores
query fields outside the active provider's capabilities.

### `move_clip` → `move-nodes`

```jsonc
// input
{ "type": "object", "required": ["nodeId"], "properties": {
  "nodeId": { "type": "string" },
  "into": { "type": "string", "description": "Target collection; omit to reorder within current parent." },
  "after": { "type": "string" }, "before": { "type": "string" },
  "position": { "type": "string", "enum": ["start", "end"] }
}, "additionalProperties": false }
```
At most one of `after`/`before`/`position` (default `end`). **Handler:** validate
node (`missing-node`, `cannot-move-root`); `targetId = into ?? parentById.get(nodeId)`
(must be a collection); `ensureTarget`; `resolvePlacement` with post-removal
adjustment; `dispatch(move-nodes)`; optionally `setSelection([nodeId])` so the
move is visible. **Output:** `{ movedId, toParentId, toIndex, newOrder }`.
**Free:** cross-collection move persists both documents in one atomic
transaction with revision/CAS.

### `trim_clip` → `update-media`

```jsonc
// input
{ "type": "object", "required": ["nodeId"], "properties": {
  "nodeId": { "type": "string" },
  "trimInSeconds": { "type": "number", "minimum": 0 },
  "trimOutSeconds": { "type": "number", "minimum": 0 },
  "durationSeconds": { "type": "number", "exclusiveMinimum": 0 }
}, "additionalProperties": false }
```
**Handler:** discriminate on the node's own `mediaKind` (video → trims, image →
duration); reject the wrong field for the kind; validate `trimIn < trimOut` and
source bounds (reject out-of-range with the bounds in the message, don't
silently clamp); `dispatch(update-media)`. **Output:**
`{ nodeId, mediaKind, effectiveDurationSeconds }`.

### `rename_item` → `rename-node`

```jsonc
// input
{ "type": "object", "required": ["nodeId", "name"], "properties": {
  "nodeId": { "type": "string" }, "name": { "type": "string", "minLength": 1 }
}, "additionalProperties": false }
```
Trim `name`, reject blank; `dispatch(rename-node)`. **Free:** a collection rename
persists the child-document title via `PersistenceBridge` (`renameTimeline`),
so graph and stored title can't diverge (including through undo/redo).

### `add_clip` → `add-nodes`

```jsonc
// input
{ "type": "object", "required": ["asset", "into"], "properties": {
  "asset": { "type": "object", "required": ["src", "mediaKind", "name"], "properties": {
    "id": { "type": "string" }, "src": { "type": "string" },
    "mediaKind": { "type": "string", "enum": ["image", "video"] }, "name": { "type": "string" },
    "poster": { "type": "string" }, "durationSeconds": { "type": "number" },
    "trimInSeconds": { "type": "number" }, "trimOutSeconds": { "type": "number" } } },
  "into": { "type": "string" }, "after": { "type": "string" },
  "before": { "type": "string" }, "position": { "type": "string", "enum": ["start", "end"] }
}, "additionalProperties": false }
```
**Handler:** `ensureTarget(into)` (must be a collection); `mintId(mediaKind)` →
fresh media `CollectionItemNode`; **park** the `ClipDetail` (`sourceClipId =
asset.id`, `poster`, provenance) *before* dispatch; `resolvePlacement` (default
`end`); `dispatch(add-nodes)`; **on refusal, unpark** and return the reason;
`setSelection([newId])`. **Output:** `{ nodeId, into, toIndex }`.

### `remove_clip` → `move-nodes` (trash root)

```jsonc
// input
{ "type": "object", "required": ["nodeId"], "properties": { "nodeId": { "type": "string" } },
  "additionalProperties": false }
```
Reject if `trashId` is null; reject a root (`cannot-move-root`);
`moveSelectionToTrash(store, trashId, [nodeId])`. **Output:** `{ removedId,
recoverable: true }`. Recoverable by design — no hard delete exposed to the
agent.

### `duplicate_clip` → `buildClone` + `insertClones` (async, build last)

```jsonc
// input
{ "type": "object", "required": ["nodeId"], "properties": {
  "nodeId": { "type": "string" }, "after": { "type": "string" },
  "before": { "type": "string" }, "position": { "type": "string", "enum": ["start", "end"] }
}, "additionalProperties": false }
```
**Handler:** `built = await buildClone(...)` (collections `ensureDocumentTree`
and deep-clone the subtree into independent documents); **re-check
`sessionAlive`** (this is the async-Duplicate guard path — do not bypass);
placement default `after: nodeId`; `insertClones(...)`; `setSelection(newIds)`.
**Output:** `{ sourceId, newIds }`.

> Sibling for later: **`create_collection`** — `add-nodes` with one empty
> collection node whose id is a fresh timeline id, plus `gateway.seed(emptyDoc)`.

## Build order

1. **`read_timeline`** — proves the route end-to-end, zero mutation risk.
2. **`move_clip`** — first mutation; proves live render + persistence + CAS
   through one tool ("Claude moves a clip, you watch it slide into place").
3. **`trim_clip` / `rename_item` / `add_clip` / `list_assets` / `remove_clip`**.
4. **`duplicate_clip`** last — the only tool that spans documents *and* awaits.

## Open decisions

- **Placement API** — semantic anchors (`after`/`before`/`position`, chosen
  here) vs raw indices. Semantic keeps the agent from doing post-removal math;
  revisit only if a caller needs raw control.
- **Auto-select on mutate** — default on for single-node `move`/`add`/
  `duplicate` (aids the "watch it" UX); needs a `select:false` escape hatch.
- ~~`navigator.modelContextTesting` method names~~ — **RESOLVED (Chrome 150):**
  `listTools()` and `executeTool(name, input)` (it's a `ModelContextTesting`
  extending `EventTarget`, also exposing `getCrossDocumentScriptToolResult`
  and an `ontoolchange` event).

## Decision log

- **2026-07-24** — Initial design. Chose WebMCP (in-page `registerTool`) over
  server-side MCP for v1 because tools mutate the live store, making real-time
  side-by-side the default and eliminating the external-write reconciliation
  problem. Primary agent route: `chrome-devtools-mcp
  --categoryExperimentalWebmcp=true`; manual routes via the DevTools WebMCP
  panel and `navigator.modelContextTesting`. Accepted the experimental,
  flag-on-per-user constraint. Tool handlers to stay transport-agnostic so a
  server-MCP + SSE transport can back them later. v1 surface = `read_timeline`,
  `list_assets`, `move_clip`, `trim_clip`, `rename_item`, `add_clip`,
  `remove_clip`, `duplicate_clip`.

- **2026-07-24** — Increment 1 built: the registry + `read_timeline` +
  `move_clip`, the minimal proving loop. Code lives in
  `apps/timeline-gstudio001/lib/webmcp/` (`types`, `results`, `placement`,
  `timeline-tree`, `tools`, `webmcp-adapter`) with
  `components/graph-view/graph-mcp-tools.tsx` (`<McpToolsBridge>`) wired next
  to `PersistenceBridge`. Verified API facts, now relied on: commands are
  `move-nodes` / `add-nodes` / `update-media` / `rename-node`
  (`packages/collections-core/commands.ts`); `store.dispatch` returns
  `Result<CollectionsPatch, DispatchRejection>` where `DispatchRejection =
  CommandRejection | CommandPolicyRejection` and the policy rejection is
  `{ reason: "blocked-by-policy", blockedIds, message? }`; a collection's
  hydration is `details.get(id)?.hydrated !== false`; `registerTool(tool,
  { signal })` on `navigator.modelContext`, abort to unregister.
  **v1 deferrals** (revisit as later tools land): no programmatic
  `ensureTarget` — a move into an un-hydrated collection is left to the
  `commandPolicy` to refuse, and the rejection is surfaced to the agent;
  `read_timeline`'s `hydrate` option is dropped (placeholders reported as
  `hydrated:false`, no lazy-load); both v1 tools are synchronous, so no
  `sessionAlive` guard is needed yet (it returns with `duplicate_clip`/
  `add_clip`). Covered by unit tests in `lib/webmcp/*.test.ts` (pure placement
  + tree projection, and handler-over-a-real-store for read/move).

- **2026-07-24** — Eager one-level hydration (app behavior, decoupled from
  WebMCP; requested so tools see hydrated data without a drill-in).
  `HydrationController` (`components/graph-view/graph-hydration.tsx`) now, after
  the focus path, hydrates the focused timeline's **direct child collections**.
  That level is cache-warm (RSC-primed), so it costs no extra fetch. Rows still
  render collapsed — a sub-row's strip is gated on its own `expanded` state,
  not on hydration (`graph-sub-timelines.tsx`), so the collapse/expand UX is
  unchanged. Effect on the tools: `read_timeline` now returns the focused
  timeline's child collections as `hydrated:true` with a real `childCount`, and
  `move_clip` into them works without drilling in. **The "refused into
  un-hydrated" behavior now only applies to grandchild+ collections** (still
  lazy). Verified: full graph-view e2e (61) green — including the collapsed-row
  and un-hydrated-drop-bounce tests. Console signature confirmed:
  `navigator.modelContextTesting.listTools()` and
  `executeTool(name, jsonArgsString)` (args are a JSON **string**).

- **2026-07-24** — Increment 2: the synchronous mutation trio `trim_clip`
  (`update-media` — video trims / image duration, validated against the source
  length), `rename_item` (`rename-node`), and `remove_clip` (`move-nodes` into
  the trash root, recoverable). All are direct command translators — no
  async/ensure. `ToolCtx` gained `trashId` (threaded from `boot.trashRootId`
  through `<McpToolsBridge>`) for `remove_clip`. Covered by
  handler-over-a-real-store tests in `tools.test.ts` (trim mutates the node,
  wrong-field/out-of-range rejected; rename trims + rejects blank; remove
  relocates to trash and errors when trash is absent). Remaining v1 surface:
  `list_assets` + `add_clip` (asset-provider seam), then `duplicate_clip`
  (async → brings in the `sessionAlive` guard).
