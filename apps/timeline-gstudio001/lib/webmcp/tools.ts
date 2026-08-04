import { z } from "zod";

import {
  getChildren,
  isVideoMedia,
  parseNodeId,
  type CollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import type { GraphDetailsStore } from "@/lib/graph-details-store";
import type { GraphViewStateDetail } from "@/lib/graph-view-events";

import { resolveMovePlacement } from "./placement";
import { describeDispatchRejection, toolError, toolOk } from "./results";
import {
  intoField,
  jsonSchemaFor,
  nameField,
  nodeIdField,
  placementFields,
  trimFields,
} from "./tool-fields";
import { buildTimelineTree, type TimelineTree } from "./timeline-tree";
import type { ToolDef } from "./types";

// The live session the tools act on. Injected once by <McpToolsBridge>; the
// handlers read `store.getSnapshot()` at call time so they always see current
// state. Only `focusedId` is captured — the bridge re-registers on change.
export type GraphToolContext = Readonly<{
  store: CollectionsStore;
  details: GraphDetailsStore;
  /** The project's root timeline id (focus/go_up resolve "root" to this). */
  projectId: string;
  focusedId: string;
  /** The project's trash root id, or null when it isn't loaded (remove_clip). */
  trashId: string | null;
  /** Open (drill into / focus) a timeline — the graph view's navigation. */
  openTimeline: (nodeId: NodeId) => void;
  /** The live view/session state (preview on, surface), read from the graph
   *  view's broadcast — for get_view_state and deterministic set_preview. */
  getViewState: () => GraphViewStateDetail;
  /** Flip the preview pane (fires the same event the sidebar's toggle does). */
  togglePreview: () => void;
  /** Move the preview clock to a time in seconds (clamped ≥ 0). */
  seek: (seconds: number) => void;
  /** Start (true) or stop (false) playback. Visible only while preview is on. */
  setPlaying: (playing: boolean) => void;
  /** Current playhead time (seconds) and whether playback is running. */
  getPlayback: () => Readonly<{ time: number; isPlaying: boolean }>;
}>;

/** The tool surface. Document-edit tools first, then view/session tools. */
export function createGraphTools(ctx: GraphToolContext): ToolDef[] {
  return [
    readTimelineTool(ctx),
    moveClipTool(ctx),
    trimClipTool(ctx),
    renameItemTool(ctx),
    removeClipTool(ctx),
    getViewStateTool(ctx),
    selectItemsTool(ctx),
    clearSelectionTool(ctx),
    focusTool(ctx),
    goUpTool(ctx),
    setPreviewTool(ctx),
    playTool(ctx),
    pauseTool(ctx),
    seekTool(ctx),
  ];
}

// ---- arg readers: agent input is `unknown`, never trusted ------------------

function record(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}
function readString(args: unknown, key: string): string | undefined {
  const value = record(args)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function readNumber(args: unknown, key: string): number | undefined {
  const value = record(args)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function readBoolean(args: unknown, key: string): boolean | undefined {
  const value = record(args)[key];
  return typeof value === "boolean" ? value : undefined;
}
function readStringArray(args: unknown, key: string): string[] {
  const value = record(args)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}
function readPosition(args: unknown): "start" | "end" | undefined {
  const value = readString(args, "position");
  return value === "start" || value === "end" ? value : undefined;
}
function optNodeId(value: string | undefined): NodeId | undefined {
  return value === undefined ? undefined : parseNodeId(value);
}

// ---- read_timeline ---------------------------------------------------------

function readTimelineTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "read_timeline",
    description:
      "Read the open timeline (or a given collection) as a structured, id-addressable tree of clips and nested collections. This is how you see what you can act on before editing.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        collectionId: {
          type: "string",
          description: "Collection node id to read. Omit for the currently focused timeline.",
        },
        depth: {
          type: "integer",
          minimum: 1,
          default: 1,
          description:
            "Levels of nested collections to expand. Deeper (or un-hydrated) collections appear as summaries with hydrated:false.",
        },
      },
      additionalProperties: false,
    },
    execute: (args) => {
      const graph = ctx.store.getSnapshot().graph;
      const idStr = readString(args, "collectionId") ?? ctx.focusedId;
      const id = parseNodeId(idStr);
      const node = graph.nodesById.get(id);
      if (!node) return toolError(`No node with id "${idStr}".`);
      if (node.kind !== "collection") {
        return toolError(`"${idStr}" is a clip, not a collection — nothing to read into.`);
      }
      const depth = Math.max(1, Math.floor(readNumber(args, "depth") ?? 1));
      const tree = buildTimelineTree(
        graph,
        id,
        ctx.focusedId,
        depth,
        (collectionId) => ctx.details.get(collectionId)?.hydrated !== false,
      );
      return toolOk(summarize(tree), tree);
    },
  };
}

function summarize(tree: TimelineTree): string {
  const head = `${tree.timeline.title} — ${tree.nodes.length} item${tree.nodes.length === 1 ? "" : "s"}`;
  if (tree.nodes.length === 0) return `${head} (empty).`;
  const parts = tree.nodes.slice(0, 6).map((n) =>
    n.kind === "collection"
      ? `${n.name} (collection, ${n.childCount ?? 0})`
      : `${n.name} (${(n.durationSeconds ?? 0).toFixed(1)}s)`,
  );
  return `${head}: ${parts.join(", ")}${tree.nodes.length > 6 ? "…" : ""}`;
}

// ---- move_clip -------------------------------------------------------------

function moveClipTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "move_clip",
    description:
      "Move or reorder a clip or collection. Give the node id and where it should land: into a collection (omit to reorder within its current parent) and one of before/after a sibling, or position start/end.",
    // `select` is in-page only — the remote transport has no viewport to
    // reveal anything in. Everything else comes from the shared fields.
    inputSchema: jsonSchemaFor({
      nodeId: nodeIdField,
      into: intoField,
      ...placementFields,
      select: z
        .boolean()
        .optional()
        .describe("Select the moved node afterward so it's visible. Default true."),
    }),
    execute: (args) => {
      const nodeIdStr = readString(args, "nodeId");
      if (!nodeIdStr) return toolError("move_clip requires a nodeId.");
      const graph = ctx.store.getSnapshot().graph;
      const nodeId = parseNodeId(nodeIdStr);
      const node = graph.nodesById.get(nodeId);
      if (!node) return toolError(`No node with id "${nodeIdStr}".`);

      const intoStr = readString(args, "into");
      const parent = graph.parentById.get(nodeId) ?? null;
      const targetStr = intoStr ?? (parent !== null ? String(parent) : undefined);
      if (targetStr === undefined) {
        return toolError(`"${nodeIdStr}" is a top-level timeline and can't be moved.`);
      }
      const targetId = parseNodeId(targetStr);

      const placement = resolveMovePlacement(graph, {
        nodeId,
        targetId,
        before: optNodeId(readString(args, "before")),
        after: optNodeId(readString(args, "after")),
        position: readPosition(args),
      });
      if (!placement.ok) {
        return toolError(
          placement.error.reason === "conflicting-anchors"
            ? "Give only one of before / after / position."
            : `No sibling "${placement.error.anchor}" in the target collection.`,
        );
      }

      const result = ctx.store.dispatch({
        type: "move-nodes",
        nodeIds: [nodeId],
        toParentId: targetId,
        toIndex: placement.toIndex,
      });
      if (!result.ok) return toolError(describeDispatchRejection(result.error));

      if (readBoolean(args, "select") !== false) ctx.store.setSelection([nodeId]);
      const newOrder = getChildren(ctx.store.getSnapshot().graph, targetId).map(String);
      return toolOk(`Moved "${node.name}" into "${targetStr}" at index ${placement.toIndex}.`, {
        movedId: nodeIdStr,
        toParentId: targetStr,
        toIndex: placement.toIndex,
        newOrder,
      });
    },
  };
}

// ---- trim_clip -------------------------------------------------------------

function trimClipTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "trim_clip",
    description:
      "Set a media clip's trim or duration. Video: trimInSeconds / trimOutSeconds (omitted ones keep their current value). Image: durationSeconds.",
    inputSchema: jsonSchemaFor({ nodeId: nodeIdField, ...trimFields }),
    execute: (args) => {
      const nodeIdStr = readString(args, "nodeId");
      if (!nodeIdStr) return toolError("trim_clip requires a nodeId.");
      const graph = ctx.store.getSnapshot().graph;
      const nodeId = parseNodeId(nodeIdStr);
      const node = graph.nodesById.get(nodeId);
      if (!node) return toolError(`No node with id "${nodeIdStr}".`);
      if (node.kind !== "media") {
        return toolError(`"${node.name}" is a collection, not a clip — only clips can be trimmed.`);
      }

      const trimIn = readNumber(args, "trimInSeconds");
      const trimOut = readNumber(args, "trimOutSeconds");
      const duration = readNumber(args, "durationSeconds");

      if (isVideoMedia(node)) {
        if (duration !== undefined) {
          return toolError(
            "Video clips are trimmed with trimInSeconds / trimOutSeconds, not durationSeconds.",
          );
        }
        const nextIn = trimIn ?? node.trimInSeconds;
        const nextOut = trimOut ?? node.trimOutSeconds;
        if (nextIn < 0 || nextOut < 0 || nextIn + nextOut >= node.fullDurationSeconds) {
          return toolError(
            `Trim out of range: the source is ${node.fullDurationSeconds}s, so trimIn + trimOut must be under that (got ${nextIn} + ${nextOut}).`,
          );
        }
        const result = ctx.store.dispatch({
          type: "update-media",
          nodeId,
          update: { mediaKind: "video", trimInSeconds: nextIn, trimOutSeconds: nextOut },
        });
        if (!result.ok) return toolError(describeDispatchRejection(result.error));
        const effective = Math.max(0, node.fullDurationSeconds - nextIn - nextOut);
        return toolOk(`Trimmed "${node.name}" to ${effective.toFixed(2)}s (in ${nextIn}s, out ${nextOut}s).`, {
          nodeId: nodeIdStr,
          mediaKind: "video",
          trimInSeconds: nextIn,
          trimOutSeconds: nextOut,
          effectiveDurationSeconds: effective,
        });
      }

      // Image.
      if (trimIn !== undefined || trimOut !== undefined) {
        return toolError("Image clips take a durationSeconds, not trimInSeconds / trimOutSeconds.");
      }
      if (duration === undefined) return toolError("trim_clip on an image needs a durationSeconds.");
      if (duration <= 0) return toolError("durationSeconds must be greater than 0.");
      const result = ctx.store.dispatch({
        type: "update-media",
        nodeId,
        update: { mediaKind: "image", durationSeconds: duration },
      });
      if (!result.ok) return toolError(describeDispatchRejection(result.error));
      return toolOk(`Set "${node.name}" duration to ${duration}s.`, {
        nodeId: nodeIdStr,
        mediaKind: "image",
        effectiveDurationSeconds: duration,
      });
    },
  };
}

// ---- rename_item -----------------------------------------------------------

function renameItemTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "rename_item",
    description:
      "Rename a clip or collection. Renaming a collection also updates its child document's title.",
    inputSchema: jsonSchemaFor({ nodeId: nodeIdField, name: nameField }),
    execute: (args) => {
      const nodeIdStr = readString(args, "nodeId");
      if (!nodeIdStr) return toolError("rename_item requires a nodeId.");
      const rawName = readString(args, "name");
      if (!rawName) return toolError("rename_item requires a non-blank name.");
      const name = rawName.trim();
      const graph = ctx.store.getSnapshot().graph;
      const nodeId = parseNodeId(nodeIdStr);
      if (!graph.nodesById.get(nodeId)) return toolError(`No node with id "${nodeIdStr}".`);
      const result = ctx.store.dispatch({ type: "rename-node", nodeId, name });
      if (!result.ok) return toolError(describeDispatchRejection(result.error));
      return toolOk(`Renamed to "${name}".`, { nodeId: nodeIdStr, name });
    },
  };
}

// ---- remove_clip -----------------------------------------------------------

function removeClipTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "remove_clip",
    description: "Move a clip or collection to the trash. Recoverable — not a hard delete.",
    inputSchema: jsonSchemaFor({ nodeId: nodeIdField }),
    execute: (args) => {
      const nodeIdStr = readString(args, "nodeId");
      if (!nodeIdStr) return toolError("remove_clip requires a nodeId.");
      if (ctx.trashId === null) return toolError("The trash isn't loaded in this project.");
      const graph = ctx.store.getSnapshot().graph;
      const nodeId = parseNodeId(nodeIdStr);
      const node = graph.nodesById.get(nodeId);
      if (!node) return toolError(`No node with id "${nodeIdStr}".`);
      const trashRoot = parseNodeId(ctx.trashId);
      const result = ctx.store.dispatch({
        type: "move-nodes",
        nodeIds: [nodeId],
        toParentId: trashRoot,
        toIndex: getChildren(graph, trashRoot).length,
      });
      if (!result.ok) return toolError(describeDispatchRejection(result.error));
      return toolOk(`Moved "${node.name}" to the trash (recoverable).`, {
        removedId: nodeIdStr,
        recoverable: true,
      });
    },
  };
}

// ---- view / session tools (ephemeral — no persistence) ---------------------

function getViewStateTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "get_view_state",
    description:
      "The current view state: which timeline is focused, which items are selected, and whether the preview pane is on. Use this to see where you are before navigating or selecting.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const snapshot = ctx.store.getSnapshot();
      const focusNode = snapshot.graph.nodesById.get(parseNodeId(ctx.focusedId));
      const selectedIds = [...snapshot.interaction.selectedIds].map(String);
      const selectedNames = selectedIds.map(
        (id) => snapshot.graph.nodesById.get(parseNodeId(id))?.name ?? id,
      );
      const view = ctx.getViewState();
      const playback = ctx.getPlayback();
      return toolOk(
        `Focused: "${focusNode?.name ?? ctx.focusedId}". Selected: ${selectedIds.length}. Preview: ${view.previewOn ? "on" : "off"}${playback.isPlaying ? ", playing" : ""} at ${playback.time.toFixed(1)}s.`,
        {
          focusedId: ctx.focusedId,
          focusedTitle: focusNode?.name ?? null,
          isRoot: ctx.focusedId === ctx.projectId,
          selectedIds,
          selectedNames,
          previewOn: view.previewOn,
          surface: view.surface,
          isPlaying: playback.isPlaying,
          currentTimeSeconds: playback.time,
        },
      );
    },
  };
}

function selectItemsTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "select_items",
    description:
      "Select one or more clips/collections by id (replaces the current selection). Selecting shows an item's controls and is what some edits act on.",
    inputSchema: {
      type: "object",
      required: ["nodeIds"],
      properties: { nodeIds: { type: "array", items: { type: "string" }, minItems: 1 } },
      additionalProperties: false,
    },
    execute: (args) => {
      const idStrs = readStringArray(args, "nodeIds");
      if (idStrs.length === 0) return toolError("select_items requires a non-empty nodeIds array.");
      const graph = ctx.store.getSnapshot().graph;
      const known = idStrs.map(parseNodeId).filter((id) => graph.nodesById.has(id));
      if (known.length === 0) return toolError("None of those ids are in the current graph.");
      ctx.store.setSelection(known);
      const skipped = idStrs.length - known.length;
      return toolOk(
        `Selected ${known.length} item${known.length === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} unknown id${skipped === 1 ? "" : "s"} skipped)` : ""}.`,
        { selectedIds: known.map(String) },
      );
    },
  };
}

function clearSelectionTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "clear_selection",
    description: "Clear the current selection (deselect everything).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const had = ctx.store.getSnapshot().interaction.selectedIds.size;
      ctx.store.clearSelection();
      return toolOk(
        had === 0 ? "Nothing was selected." : `Deselected ${had} item${had === 1 ? "" : "s"}.`,
        { cleared: had },
      );
    },
  };
}

function focusTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "focus",
    description:
      "Open (drill into / focus) a timeline or collection by id, so later reads and edits act on it. Omit nodeId, or pass the project id, to return to the top-level project. Navigation is async — the view updates a moment later, so read_timeline to confirm.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Collection/timeline id to open. Omit for the project root." },
      },
      additionalProperties: false,
    },
    execute: (args) => {
      const targetStr = readString(args, "nodeId") ?? ctx.projectId;
      const graph = ctx.store.getSnapshot().graph;
      const target = parseNodeId(targetStr);
      const node = graph.nodesById.get(target);
      if (!node) return toolError(`No node with id "${targetStr}".`);
      if (node.kind !== "collection") {
        return toolError(`"${node.name}" is a clip, not a timeline you can open.`);
      }
      if (targetStr === ctx.focusedId) {
        return toolOk(`Already focused on "${node.name}".`, { focusedId: targetStr, changed: false });
      }
      ctx.openTimeline(target);
      return toolOk(`Opening "${node.name}"… (navigation is async — read_timeline to confirm)`, {
        focusedId: targetStr,
        changed: true,
      });
    },
  };
}

function goUpTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "go_up",
    description:
      "Go up one level — focus the parent of the current timeline. No-op at the project root. Async, like focus.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      if (ctx.focusedId === ctx.projectId) {
        return toolOk("Already at the project root.", { focusedId: ctx.projectId, changed: false });
      }
      const graph = ctx.store.getSnapshot().graph;
      const parent = graph.parentById.get(parseNodeId(ctx.focusedId)) ?? null;
      const targetStr = parent === null ? ctx.projectId : String(parent);
      ctx.openTimeline(parseNodeId(targetStr));
      const name = graph.nodesById.get(parseNodeId(targetStr))?.name ?? targetStr;
      return toolOk(`Going up to "${name}"…`, { focusedId: targetStr, changed: true });
    },
  };
}

function setPreviewTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "set_preview",
    description: "Turn the preview pane on or off. The preview plays the focused timeline.",
    inputSchema: {
      type: "object",
      required: ["on"],
      properties: { on: { type: "boolean" } },
      additionalProperties: false,
    },
    execute: (args) => {
      const on = readBoolean(args, "on");
      if (on === undefined) return toolError("set_preview requires `on` (true or false).");
      if (ctx.getViewState().previewOn === on) {
        return toolOk(`Preview is already ${on ? "on" : "off"}.`, { previewOn: on, changed: false });
      }
      ctx.togglePreview();
      return toolOk(`Turned preview ${on ? "on" : "off"}.`, { previewOn: on, changed: true });
    },
  };
}

function playTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "play",
    description:
      "Start playback of the focused timeline. Turns the preview pane on first if it's off, so you can see it play.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const openedPreview = !ctx.getViewState().previewOn;
      if (openedPreview) ctx.togglePreview();
      ctx.setPlaying(true);
      return toolOk(openedPreview ? "Opened the preview and started playing." : "Playing.", {
        playing: true,
        openedPreview,
      });
    },
  };
}

function pauseTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "pause",
    description: "Stop playback of the focused timeline. The playhead stays where it is (seek to move it).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const wasPlaying = ctx.getPlayback().isPlaying;
      ctx.setPlaying(false);
      return toolOk(wasPlaying ? "Paused." : "Already paused.", {
        playing: false,
        changed: wasPlaying,
      });
    },
  };
}

function seekTool(ctx: GraphToolContext): ToolDef {
  return {
    name: "seek",
    description:
      "Move the playhead to a time (in seconds) in the focused timeline. Clamped to ≥ 0 (and to the timeline's end by the player).",
    inputSchema: {
      type: "object",
      required: ["seconds"],
      properties: { seconds: { type: "number", minimum: 0 } },
      additionalProperties: false,
    },
    execute: (args) => {
      const seconds = readNumber(args, "seconds");
      if (seconds === undefined) return toolError("seek requires a numeric `seconds`.");
      const clamped = Math.max(0, seconds);
      ctx.seek(clamped);
      return toolOk(`Moved the playhead to ${clamped.toFixed(1)}s.`, { seconds: clamped });
    },
  };
}
