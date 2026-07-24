# WebMCP agent tools

**Status: shipped, and still growing.** Two surfaces are live — the in-page
**WebMCP** tools (11 tools; real-time, mutate the live store) and a **remote
MCP** endpoint at `/api/mcp` (read-only, OAuth 2.1 + PKCE, reachable by URL
with no browser open). The design below is what they were built from; the
decision log at the bottom is the running record of what actually shipped and
why. Keep it current as decisions land.

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

- **2026-07-24** — Increment 3: **view / session tools** — a new category
  distinct from the document-edit tools. These are *ephemeral* (no persistence,
  no undo): `get_view_state` (focus + selection + preview, read-only),
  `select_items` / `clear_selection` (→ `store.setSelection` / `clearSelection`),
  `focus` / `go_up` (→ the graph view's `openTimeline` navigation), and
  `set_preview` (→ the `GRAPH_PREVIEW_TOGGLE_EVENT` window event, made
  deterministic by reading the `GRAPH_VIEW_STATE_EVENT` broadcast). Motivation:
  driving the app previously required pixel-clicking for navigation/preview
  (brittle); these make it first-class. Wiring: selection is pure store; preview
  rides the sidebar's existing window-event bus (zero threading — the bridge
  mirrors the view-state broadcast into a ref); navigation is a router push, so
  `<McpToolsBridge>` gains `projectId` + `onOpenNode` (the `openTimeline` seam,
  same one the board's click-to-drill uses). Verified: 36 unit tests
  (handlers over a real store + injected nav/preview spies) and **live** in the
  real app via chrome-in-browser — `focus`/`go_up` moved the route, `set_preview`
  flipped the pane and `get_view_state` read it back. Navigation is async (the
  tool returns before the route commits — read_timeline to confirm).

- **2026-07-24** — Increment 3 (cont.): **playback tools** `play` / `pause` /
  `seek`, plus `isPlaying` + `currentTimeSeconds` on `get_view_state`. `play`
  turns the preview on first if it's off (so you see it), then starts. This
  needed a change to the **shared player**: `WorkbenchDisplaySurface`
  (`packages/ui/timeline`) gained optional controlled-playback props
  (`playing` + `onPlayingChange`) — supplied → it renders/reports play state
  through them; omitted → the previous uncontrolled behavior is unchanged (so
  every existing consumer is untouched). Play state now lives on the
  `PreviewTimeChannel` (`isPlaying`/`setPlaying`/`subscribePlaying`), above the
  pane's mount, so it survives preview toggling and can be set before the pane
  exists (that's what makes play-auto-shows-preview race-free). `PreviewShell`
  wires the surface's controlled props to the channel; `<McpToolsBridge>` gains
  the channel and derives `seek`/`setPlaying`/`getPlayback`. Verified: 41 unit
  tests, `packages/ui` typecheck + a `ControlledPlayback` story interaction
  test (the surface reflects the `playing` prop), and **live** — `play` opened
  the preview and advanced time 0→2.5s, `pause` froze it, `seek` jumped to 20s.

- **2026-07-24** — The **server-MCP transport** (the "durable hedge" above) is
  now real, alongside WebMCP rather than replacing it. `app/api/mcp/route.ts`
  mounts a remote MCP server via Vercel's `mcp-handler` (streamable HTTP) on the
  deployed origin, so an agent can reach the project by URL with **no browser
  open**. Deliberately a different execution path from the WebMCP tools: those
  mutate the live `CollectionsStore` in the page (real-time), these read
  Firestore server-side through the existing `firebase-timeline-store`
  functions. **Read-only** for this milestone — it's a publicly reachable
  endpoint over real user data, so transport + auth get proven before any write
  path exists. Tools: `list_projects`, `read_timeline`.

  **Auth is interim**: one static bearer token (`MCP_BEARER_TOKEN`) identifying
  a single `MCP_OWNER_UID`, gated by `withMcpAuth` — enough to drive from Claude
  Code / `mcp-remote`. claude.ai's custom-connector flow expects **OAuth 2.1 +
  PKCE**, so connecting there requires building that; at which point the fixed
  `ownerUid()` env var becomes a per-user derivation. The 401 already emits the
  correct `WWW-Authenticate` challenge with `resource_metadata` pointing at
  `/.well-known/oauth-protected-resource`, which is the discovery hook OAuth
  will use. Note the real-time property is **not** available on this transport —
  Firestore reads are one-shot and the browser holds no listeners, so a
  server-side write would not appear in an open tab without a live-push channel
  (see the top of this doc).

- **2026-07-24** — **OAuth 2.1 + PKCE** on the remote MCP endpoint, so
  claude.ai's custom-connector flow can attach. Built ON Firebase rather than
  adopting an auth vendor: `/oauth/authorize` is a PAGE (so the root layout's
  `AuthGate` handles sign-in) that validates the request and shows consent;
  `POST /api/oauth/authorize` re-validates server-side and issues a single-use
  code; `POST /api/oauth/token` verifies PKCE + client credentials and returns
  an HS256 access token plus a rotating refresh token. Discovery lives at
  `/.well-known/oauth-authorization-server` (RFC 8414) and
  `/.well-known/oauth-protected-resource` (RFC 9728), both deriving their
  origin from the request so localhost/preview/production need no config.

  **Security decisions worth keeping:** S256 only (a `plain` or absent method is
  refused, never defaulted — that's the PKCE downgrade); exact redirect-URI
  matching; an unknown `client_id`/`redirect_uri` is FATAL and renders an error
  rather than redirecting (redirecting to an unverified URI is how codes leak);
  codes are single-use via a Firestore transaction and stored hashed; `alg` is
  pinned to HS256 from our own header, never read from the token; access tokens
  are audience-bound to this deployment's MCP URL. `jose` is deliberately NOT
  used — HS256 is hand-rolled on `node:crypto` because jose@6's pure-ESM
  packaging is what broke the Vercel deploy (see vercel-production-deploy).

  **Dynamic Client Registration is intentionally omitted** — Claude also accepts
  operator-provided credentials, so a personal deployment avoids exposing an
  unauthenticated registration endpoint. New env: `MCP_OAUTH_CLIENT_ID`,
  `MCP_OAUTH_CLIENT_SECRET`, `MCP_OAUTH_REDIRECT_URIS`,
  `MCP_OAUTH_SIGNING_SECRET`. The static `MCP_BEARER_TOKEN` path remains for
  Claude Code / mcp-remote; OAuth is tried first and the uid now comes from the
  token's `sub` instead of a fixed env var.

  **Known gap:** signing in mid-flow returns to the app root and drops the
  authorization parameters, so an unauthenticated user must sign in and then
  restart the connection from Claude. Covered by 28 unit tests over the
  security-critical rules.
