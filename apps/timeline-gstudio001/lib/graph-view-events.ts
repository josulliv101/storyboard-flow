// The sidebar's Assets launcher and the graph view live in different React
// trees (the sidebar is app chrome; the graph provider is route-scoped), so
// on graph routes the launcher hands off through a window event instead of
// opening the legacy drawer — whose media-strip drags can't land on
// dnd-collections timelines.

export const GRAPH_ASSETS_TOGGLE_EVENT = "graph-view:toggle-assets";

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
export const GRAPH_RULER_TOGGLE_EVENT = "graph-view:toggle-ruler";
export const GRAPH_CHILDREN_TOGGLE_EVENT = "graph-view:toggle-children";
export const GRAPH_PREVIEW_TOGGLE_EVENT = "graph-view:toggle-preview";
export const GRAPH_VIEW_STATE_EVENT = "graph-view:view-state";

/** Mirrors `FocusSurface` in graph-view-config (grid is the load default). */
export type GraphSurface = "strip" | "grid";

export type GraphViewStateDetail = Readonly<{
  surface: GraphSurface;
  rulerOn: boolean;
  childrenShown: boolean;
  previewOn: boolean;
}>;

/** Ask the graph view to switch its layout surface. */
export function requestGraphSurface(surface: GraphSurface): void {
  window.dispatchEvent(
    new CustomEvent<GraphSurface>(GRAPH_SURFACE_EVENT, { detail: surface }),
  );
}

/** Ask the graph view to toggle the strip's time ruler. */
export function requestGraphRulerToggle(): void {
  window.dispatchEvent(new Event(GRAPH_RULER_TOGGLE_EVENT));
}

/** Ask the graph view to toggle the children-timelines tree. */
export function requestGraphChildrenToggle(): void {
  window.dispatchEvent(new Event(GRAPH_CHILDREN_TOGGLE_EVENT));
}

/** Ask the graph view to toggle the preview pane. */
export function requestGraphPreviewToggle(): void {
  window.dispatchEvent(new Event(GRAPH_PREVIEW_TOGGLE_EVENT));
}

/** Graph → sidebar: the current view state, for control highlighting. */
export function broadcastGraphViewState(detail: GraphViewStateDetail): void {
  window.dispatchEvent(
    new CustomEvent<GraphViewStateDetail>(GRAPH_VIEW_STATE_EVENT, { detail }),
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
