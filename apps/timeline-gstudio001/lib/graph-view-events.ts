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
