import type { App } from "@modelcontextprotocol/ext-apps";

import { parseToolJson } from "../types";
import type { Project, Timeline } from "../types";

// Everything that crosses the iframe boundary, in one place.
//
// The view is SELF-SUFFICIENT by necessity: the host's `ui/initialize` result
// carries only protocol and host info — never the arguments of the tool that
// opened it — so the view fetches its own data through `callServerTool` rather
// than waiting to be handed any.

/**
 * Call a server tool and return its JSON payload.
 *
 * Two failure modes, and they arrive differently: transport/protocol problems
 * THROW, while a tool that ran and failed returns `isError` on the result. Both
 * become one thrown Error here so callers have a single thing to catch.
 */
async function callJson(
  app: App,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) {
    const detail = result.content?.find((block) => block.type === "text");
    throw new Error(
      detail && "text" in detail ? `${name}: ${detail.text}` : `"${name}" failed.`,
    );
  }
  return parseToolJson(result);
}

export async function fetchProjects(app: App): Promise<Project[]> {
  const payload = await callJson(app, "list_projects");
  const projects = payload?.projects;
  return Array.isArray(projects) ? (projects as Project[]) : [];
}

export async function fetchTimeline(app: App, timelineId: string): Promise<Timeline | null> {
  const payload = await callJson(app, "read_timeline", { timelineId });
  return (payload?.timeline as Timeline | undefined) ?? null;
}

/**
 * Tell the model what the view is showing.
 *
 * Best-effort on purpose: this is enrichment, and a host that rejects it (or
 * doesn't support it) must not take the UI down with it.
 */
export async function reportViewToModel(app: App, description: string): Promise<void> {
  try {
    await app.updateModelContext({ content: [{ type: "text", text: description }] });
  } catch {
    // Non-fatal — the view keeps working without model context.
  }
}

// --- Session persistence ---------------------------------------------------
//
// Users refresh mid-flow, and hosts tear the iframe down and rebuild it. Losing
// which project was open and how deep the user had drilled makes the widget
// feel broken, so the small amount of state that costs nothing to keep is
// mirrored into sessionStorage.
//
// sessionStorage can throw outright in a sandboxed iframe (some hosts render
// with an opaque origin, where merely TOUCHING it is a SecurityError), so every
// access is guarded. Persistence is a nicety; it may never break the view.

const SESSION_KEY = "storyboard.timeline-widget.session";

export type PersistedSession = {
  projectId: string | null;
  stack?: unknown;
};

export function loadSession(): PersistedSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PersistedSession;
  } catch {
    return null;
  }
}

export function saveSession(session: PersistedSession): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable or full — the view carries on without it.
  }
}
