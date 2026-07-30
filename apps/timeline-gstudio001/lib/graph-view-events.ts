// The sidebar (app chrome) and the graph view (route-scoped) live in different
// React trees, so the rail asks the board for things through window events
// rather than props. The Assets launcher used to be one of them; media now
// enters by being dropped on the board itself, so there is nothing to launch.

/** True for /timeline/<projectId>/graph[/...] routes. */
export function isGraphViewRoute(pathname: string): boolean {
  return /^\/timeline\/[^/]+\/graph(\/|$)/.test(pathname);
}

// The sidebar's tool palette hands off the same way. Dragging a tool onto a
// strip is a POINTER-only gesture (native HTML5 drag carrying a custom
// DataTransfer), which left keyboard and assistive-tech users — and touch —
// with no way to insert anything at all. Activating the tool now appends it
// to the open timeline through this event; the drag stays as the way to
// choose a POSITION.

export const GRAPH_INSERT_TOOL_EVENT = "graph-view:insert-tool";

/** The palette tools, mirrored by `isSidebarTool` on the graph side.
 *  Collection only: the old image/video placeholder tools were removed —
 *  media enters through the Assets drawer or OS file drops. */
export type GraphInsertTool = "collection";

export type GraphInsertToolDetail = Readonly<{ tool: GraphInsertTool }>;

export function isGraphInsertTool(value: string): value is GraphInsertTool {
  return value === "collection";
}

/** Ask the graph view to append a palette tool to the focused collection. */
export function requestGraphToolInsert(tool: GraphInsertTool): void {
  window.dispatchEvent(
    new CustomEvent<GraphInsertToolDetail>(GRAPH_INSERT_TOOL_EVENT, { detail: { tool } }),
  );
}

// The sidebar's top two icons ARE the graph's layout switch (grid first —
// the initial-load default — then strip), and the ruler toggle lives under
// the tool palette in strip mode. Same seam as the tools: the sidebar sets
// state through request events, and the graph view broadcasts its state back
// (on mount and on every change) so the sidebar controls can reflect it.

export const GRAPH_SURFACE_EVENT = "graph-view:set-surface";
// No ruler-toggle event either, for the same reason as the children one below:
// that control moved into the board header and calls a prop.
/** Strip only: show every item in the focused closure in playback order, with
 *  no collections and no nesting. */
export const GRAPH_FLAT_TOGGLE_EVENT = "graph-view:toggle-flat";
// No children-toggle event: that control moved into the board header, which
// renders inside the graph provider's own tree, so it calls a prop instead.
// This bridge is for the SIDEBAR — app chrome in a different React tree — and
// nothing else should pay for it. `childrenShown` below is still published:
// the STATE is part of what the view reports, only the command is gone.
export const GRAPH_PREVIEW_TOGGLE_EVENT = "graph-view:toggle-preview";
export const GRAPH_VIEW_STATE_EVENT = "graph-view:view-state";

/** Mirrors `FocusSurface` in graph-view-config (grid is the load default). */
export type GraphSurface = "strip" | "grid";

export type GraphViewStateDetail = Readonly<{
  surface: GraphSurface;
  rulerOn: boolean;
  childrenShown: boolean;
  previewOn: boolean;
  /** Strip's flat mode. Strip-only, like the ruler — grid has no equivalent. */
  flatOn: boolean;
  /** True while flat mode is loading the closure it needs (every nested
   *  collection has to be hydrated before the flat run is complete). The
   *  sidebar shows it as a pending state rather than a silently short list. */
  flatLoading: boolean;
}>;

/** Ask the graph view to switch its layout surface. */
export function requestGraphSurface(surface: GraphSurface): void {
  window.dispatchEvent(
    new CustomEvent<GraphSurface>(GRAPH_SURFACE_EVENT, { detail: surface }),
  );
}

/** Ask the strip to toggle flat mode (all items in order, no nesting). */
export function requestGraphFlatToggle(): void {
  window.dispatchEvent(new Event(GRAPH_FLAT_TOGGLE_EVENT));
}

/** Ask the graph view to toggle the preview pane. */
export function requestGraphPreviewToggle(): void {
  window.dispatchEvent(new Event(GRAPH_PREVIEW_TOGGLE_EVENT));
}

/**
 * Where the sidebar lets the graph mount its board-options menu (PL14-005).
 *
 * The one seam here that is NOT an event, and deliberately so. Everything
 * above is state the SIDEBAR renders — a toggle it can draw from a boolean.
 * The board menu is a radio group plus a zoom slider whose values live in the
 * graph's own tree, so mirroring them across would mean publishing two more
 * fields and adding two commands to move them. Instead the sidebar publishes
 * an ADDRESS and the graph portals the real component into it, keeping its
 * props and its Radix context where they already work.
 *
 * The graph rendering it also scopes it for free: nothing portals in when the
 * graph is not mounted, so the slot needs no route guard.
 */
export const GRAPH_BOARD_MENU_SLOT_ID = "graph-board-menu-slot";

/** Graph → sidebar: the current view state, for control highlighting. */
export function broadcastGraphViewState(detail: GraphViewStateDetail): void {
  window.dispatchEvent(
    new CustomEvent<GraphViewStateDetail>(GRAPH_VIEW_STATE_EVENT, { detail }),
  );
}

// Selection ↔ item actions. The engine's selection lives in the graph
// provider's tree; the sidebar is app chrome. Same seam again: the graph
// broadcasts how many items are selected (so the sidebar can switch its
// contextual cluster to item actions), and the sidebar dispatches the action
// the user picked back for the graph to perform on the live selection.

export const GRAPH_SELECTION_EVENT = "graph-view:selection";
export const GRAPH_ITEM_ACTION_EVENT = "graph-view:item-action";

/** Graph → sidebar: how many items are currently selected, and whether an
 *  async item action (copy/cut/duplicate loading documents) is in flight —
 *  the sidebar disables the cluster while busy so actions can't double-fire. */
export type GraphSelectionDetail = Readonly<{
  count: number;
  busy: boolean;
  /** True when EVERY selected item is already disabled, which is what flips
   *  the toggle's label from "Disable" to "Enable". A mixed selection reads
   *  as false: the toggle then disables the rest, so one press always leaves
   *  the selection in a single, predictable state. */
  allDisabled: boolean;
}>;

/** The per-item actions a selection surface can request. */
export type GraphItemAction =
  | "copy"
  | "cut"
  /** Paste into the collection on screen. Lives in the HEADER, not the
   *  selection toolbar: every other verb here acts ON the selection, while
   *  paste needs a destination, and a selection is not a destination. */
  | "paste"
  /** Paste INSIDE the one selected collection, rather than beside it. */
  | "paste-into"
  | "duplicate"
  | "delete"
  | "cancel"
  /** Open the inline name editor on the selected item's card. */
  | "rename"
  /** Skip (or un-skip) the selection in playback, counts and time totals. */
  | "toggle-disabled"
  /** Open the details view for the selection. Meaningful for exactly ONE
   *  selected item — the view is about a single clip's frames, in/out points
   *  and name, and there is no honest way to render it for six. The sidebar
   *  disables the control past one; the graph side refuses as well, because a
   *  window event is not a promise about what sent it. */
  | "details";

/** Graph → sidebar: the live selection size, so the sidebar can enter/exit
 *  item-actions mode and enable/disable the selection-dependent buttons. */
export function broadcastGraphSelection(detail: GraphSelectionDetail): void {
  window.dispatchEvent(
    new CustomEvent<GraphSelectionDetail>(GRAPH_SELECTION_EVENT, { detail }),
  );
}

/** Sidebar → graph: perform an item action on the current selection (or, for
 *  paste, on the clipboard). */
export function requestGraphItemAction(action: GraphItemAction): void {
  window.dispatchEvent(
    new CustomEvent<GraphItemAction>(GRAPH_ITEM_ACTION_EVENT, { detail: action }),
  );
}

// Keyboard rename hand-off. F2 on a focused collection card is caught at the
// board's keyboard boundary (OpenKeyBoundary), but inline-rename state is LOCAL
// to each rename site (card, breadcrumb, sub-row — all via useInlineRename).
// This event carries the node id so the matching site opens its editor: the
// keyboard twin of double-clicking the label.
//
// The SITE is part of the address, not decoration. One node id routinely names
// three mounted sites at once — a collection at the focused level has a card, a
// sub-timeline row, and (when focused) a breadcrumb. Broadcasting the id alone
// opened an editor in every one of them, and because each editor focuses itself
// on mount and commits on blur, they knocked each other out and ALL of them
// closed: F2 appeared to do nothing at all.

export const GRAPH_RENAME_ITEM_EVENT = "graph-view:rename-item";

/** Which rename surface a request is addressed to. */
export type GraphRenameSite = "card" | "sub-row" | "breadcrumb" | "item-details";

export type GraphRenameRequest = Readonly<{ nodeId: string; site: GraphRenameSite }>;

/** Ask ONE rename site to open its inline editor. */
export function requestGraphRenameItem(nodeId: string, site: GraphRenameSite): void {
  window.dispatchEvent(
    new CustomEvent<GraphRenameRequest>(GRAPH_RENAME_ITEM_EVENT, { detail: { nodeId, site } }),
  );
}

// The reverse hand-off: when a drag drops into the graph's sidebar trash
// target (which lives in the graph provider's tree), the sidebar's own trash
// DRAWER button — plain app chrome — plays an arrival animation. Same
// window-event seam, opposite direction.

export const GRAPH_TRASH_ARRIVAL_EVENT = "graph-view:trash-arrival";

/** Announce that a drag just landed one or more items in the trash. */
export function announceGraphTrashArrival(): void {
  window.dispatchEvent(new CustomEvent(GRAPH_TRASH_ARRIVAL_EVENT));
}

// While a dragged card hovers the breadcrumb's "Move to trash" zone, the
// sidebar's trash icon plays an attention animation — the drop target lives in
// the graph tree, the icon is app chrome, so the state crosses the same
// window-event seam. Detail is the hover on/off boolean.

export const GRAPH_TRASH_HOVER_EVENT = "graph-view:trash-hover";

/** Tell the sidebar's trash icon whether a card is currently over the trash
 *  drop zone (so it can animate for attention). */
export function setGraphTrashDropHover(hovering: boolean): void {
  window.dispatchEvent(
    new CustomEvent<boolean>(GRAPH_TRASH_HOVER_EVENT, { detail: hovering }),
  );
}

// Restore: the trash DRAWER lists what was deleted, but putting an item back
// is a graph move (trash root → the open collection), and the graph lives in
// the route tree. The drawer asks; the bridge inside the provider performs it
// and answers, so the drawer can drop the row it just restored — or say why
// it couldn't.

export const GRAPH_RESTORE_ITEM_EVENT = "graph-view:restore-item";
export const GRAPH_RESTORE_RESULT_EVENT = "graph-view:restore-result";

/** Identifies a trashed item by its stored CLIP id — what the drawer has.
 *  The graph may know it under a different node id (a collection is keyed by
 *  its child timeline; a duplicate media id is demoted), so the bridge
 *  resolves it against the trash root's children. */
export type GraphRestoreResultDetail = Readonly<{
  clipId: string;
  ok: boolean;
  message: string;
}>;

/** Drawer → graph: put this trashed item back into the open timeline. */
export function requestGraphRestoreItem(clipId: string): void {
  window.dispatchEvent(new CustomEvent<string>(GRAPH_RESTORE_ITEM_EVENT, { detail: clipId }));
}

/** Graph → drawer: what happened. */
export function broadcastGraphRestoreResult(detail: GraphRestoreResultDetail): void {
  window.dispatchEvent(
    new CustomEvent<GraphRestoreResultDetail>(GRAPH_RESTORE_RESULT_EVENT, { detail }),
  );
}

// Emptying the bin is the one action that removes items the graph is HOLDING.
// The drawer is app chrome and talks to the server directly, so a graph view
// mounted behind it would keep the deleted nodes in its store — and write them
// straight back on the next commit that touches the trash. The drawer
// announces the empty here and the graph view rebuilds from the server.

export const GRAPH_TRASH_EMPTIED_EVENT = "graph-view:trash-emptied";

/** Announce that the trash document was permanently emptied on the server. */
export function announceGraphTrashEmptied(): void {
  window.dispatchEvent(new CustomEvent(GRAPH_TRASH_EMPTIED_EVENT));
}
