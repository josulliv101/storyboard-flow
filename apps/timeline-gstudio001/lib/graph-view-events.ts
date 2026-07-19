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

/** The palette tools, mirrored by `isSidebarTool` on the graph side. */
export type GraphInsertTool = "collection" | "image" | "video";

export type GraphInsertToolDetail = Readonly<{ tool: GraphInsertTool }>;

export function isGraphInsertTool(value: string): value is GraphInsertTool {
  return value === "collection" || value === "image" || value === "video";
}

/** Ask the graph view to append a palette tool to the focused collection. */
export function requestGraphToolInsert(tool: GraphInsertTool): void {
  window.dispatchEvent(
    new CustomEvent<GraphInsertToolDetail>(GRAPH_INSERT_TOOL_EVENT, { detail: { tool } }),
  );
}
