import { z } from "zod/v4";
import type { App } from "@modelcontextprotocol/ext-apps";

import type { Timeline } from "../types";
import type { ViewAction } from "../app/view-state";

// Tools the VIEW implements and the model calls — the other direction from
// `callServerTool`. The model can drive the strip: open a scene, select a clip,
// switch projects, and the iframe responds without a round trip to the server.
//
// These are strictly VIEW-STATE tools. They move the user's viewport around;
// none of them writes to a timeline document. The MCP endpoint backing this
// widget is read-only by design, and that boundary should be obvious from the
// tool list rather than buried in a handler.
//
// Zod v4 is imported from `zod/v4` to match the copy `ext-apps` validates
// against; the App constructor puts Zod in jitless mode so schema parsing works
// under the sandbox CSP, which forbids the `new Function()` its JIT would use.

/** Everything the tools need from the running view, read fresh on each call so
 *  a handler never closes over a stale timeline. */
export type ViewToolContext = {
  dispatch: (action: ViewAction) => void;
  getTimeline: () => Timeline | null;
};

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function failed(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

/**
 * Register the view's tools on the app.
 *
 * Called from `onAppCreated`, i.e. BEFORE `connect()`. That timing matters: the
 * handshake advertises the tool list, so registering afterwards can leave the
 * host unaware the tools exist.
 */
export function registerViewTools(app: App, context: ViewToolContext): void {
  app.registerTool(
    "open_collection",
    {
      title: "Open a collection",
      description:
        "Drill into a collection clip in the timeline view, by its title or clip id. Use when the user wants to look inside a scene.",
      inputSchema: z.object({
        collection: z
          .string()
          .describe("Title or clip id of the collection to open."),
      }),
    },
    ({ collection }) => {
      const clips = context.getTimeline()?.clips ?? [];
      const needle = collection.trim().toLowerCase();
      const match = clips.find(
        (clip) =>
          clip.kind === "collection" &&
          (clip.id === collection ||
            clip.childTimelineId === collection ||
            (clip.title ?? "").trim().toLowerCase() === needle),
      );

      if (!match) {
        const available = clips
          .filter((clip) => clip.kind === "collection")
          .map((clip) => clip.title)
          .filter(Boolean);
        return failed(
          available.length > 0
            ? `No collection named "${collection}". Available: ${available.join(", ")}.`
            : `No collection named "${collection}" — this timeline has none.`,
        );
      }
      if (!match.childTimelineId) {
        return failed(`"${match.title}" has no child timeline to open.`);
      }

      context.dispatch({
        type: "open-collection",
        timelineId: match.childTimelineId,
        title: match.title ?? "Collection",
      });
      return ok(`Opened "${match.title}" in the timeline view.`);
    },
  );

  app.registerTool(
    "focus_clip",
    {
      title: "Select a clip",
      description:
        "Highlight a clip in the timeline view by its title, alt text, or clip id. Use to point the user at a specific clip.",
      inputSchema: z.object({
        clip: z.string().describe("Title, alt text, or id of the clip to select."),
      }),
    },
    ({ clip }) => {
      const clips = context.getTimeline()?.clips ?? [];
      const needle = clip.trim().toLowerCase();
      const match = clips.find(
        (candidate) =>
          candidate.id === clip ||
          (candidate.title ?? "").trim().toLowerCase() === needle ||
          (candidate.alt ?? "").trim().toLowerCase() === needle,
      );

      if (!match?.id) return failed(`No clip matching "${clip}" in the current view.`);

      context.dispatch({ type: "focus-clip", clipId: match.id });
      return ok(`Selected "${match.title ?? match.alt ?? match.id}".`);
    },
  );

  app.registerTool(
    "show_strip",
    {
      title: "Return to the timeline",
      description:
        "Leave any open collection and return to the top-level timeline strip in the view.",
    },
    () => {
      context.dispatch({ type: "reset-to-strip" });
      return ok("Returned to the top-level timeline.");
    },
  );
}
