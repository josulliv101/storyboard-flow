import {
  getChildren,
  isVideoMedia,
  parseNodeId,
  type CollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import type { GraphDetailsStore } from "@/lib/graph-details-store";

import { resolveMovePlacement } from "./placement";
import { describeDispatchRejection, toolError, toolOk } from "./results";
import { buildTimelineTree, type TimelineTree } from "./timeline-tree";
import type { ToolDef } from "./types";

// The live session the tools act on. Injected once by <McpToolsBridge>; the
// handlers read `store.getSnapshot()` at call time so they always see current
// state. Only `focusedId` is captured — the bridge re-registers on change.
export type GraphToolContext = Readonly<{
  store: CollectionsStore;
  details: GraphDetailsStore;
  focusedId: string;
  /** The project's trash root id, or null when it isn't loaded (remove_clip). */
  trashId: string | null;
}>;

/** The v1 tool surface. Add tools here as they land (see docs). */
export function createGraphTools(ctx: GraphToolContext): ToolDef[] {
  return [
    readTimelineTool(ctx),
    moveClipTool(ctx),
    trimClipTool(ctx),
    renameItemTool(ctx),
    removeClipTool(ctx),
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
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: {
        nodeId: { type: "string" },
        into: {
          type: "string",
          description: "Target collection id. Omit to reorder within the current parent.",
        },
        after: { type: "string", description: "Place immediately after this sibling id." },
        before: { type: "string", description: "Place immediately before this sibling id." },
        position: { type: "string", enum: ["start", "end"] },
        select: {
          type: "boolean",
          description: "Select the moved node afterward so it's visible. Default true.",
        },
      },
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: {
        nodeId: { type: "string" },
        trimInSeconds: { type: "number", minimum: 0, description: "Video only." },
        trimOutSeconds: { type: "number", minimum: 0, description: "Video only." },
        durationSeconds: { type: "number", exclusiveMinimum: 0, description: "Image only." },
      },
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      required: ["nodeId", "name"],
      properties: {
        nodeId: { type: "string" },
        name: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
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
    inputSchema: {
      type: "object",
      required: ["nodeId"],
      properties: { nodeId: { type: "string" } },
      additionalProperties: false,
    },
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
