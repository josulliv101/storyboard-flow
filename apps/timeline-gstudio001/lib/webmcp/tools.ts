import {
  getChildren,
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
}>;

/** The v1 tool surface. Add tools here as they land (see docs). */
export function createGraphTools(ctx: GraphToolContext): ToolDef[] {
  return [readTimelineTool(ctx), moveClipTool(ctx)];
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
