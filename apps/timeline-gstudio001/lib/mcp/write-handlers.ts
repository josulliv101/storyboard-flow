import {
  getChildren,
  isVideoMedia,
  parseNodeId,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/collections-core";

import { describeDispatchRejection, toolError, toolOk } from "@/lib/webmcp/results";
import { resolveMovePlacement, type PlacementError } from "@/lib/webmcp/placement";
import type { ToolResult } from "@/lib/webmcp/types";

import { applyCollectionsCommand, type ApplyCommandOutcome } from "./apply-command";

// Remote (server-side) write tools. Each one translates arguments into a single
// CollectionsCommand and hands it to `applyCollectionsCommand`, which owns the
// load -> graph -> apply -> atomic-write round trip.
//
// These deliberately reuse the in-page tools' pure pieces — `resolveMovePlacement`
// for anchor math and `describeDispatchRejection` for refusal wording — so the
// two surfaces answer the same way. What they cannot share yet is the *apply*:
// WebMCP dispatches to the live store, this writes documents. Phase 4 unifies
// registration on top of these.
//
// Unlike the in-page tools there is no "focused" timeline server-side, so every
// tool takes an explicit `timelineId` — the root whose closure is loaded. It
// must contain every node the call touches.

/** Appended to every remote write tool's description. */
export const NO_LIVE_PUSH_NOTE =
  " Note: this writes to stored data. A browser tab that is already open will not " +
  "show the change until it reloads.";

function describePlacementError(error: PlacementError): string {
  return error.reason === "conflicting-anchors"
    ? "Give at most one of `after`, `before` or `position`."
    : `No sibling with id "${error.anchor}" in the target collection.`;
}

/** Turn an apply outcome into a tool result, so every handler reports alike. */
function reportFailure(outcome: Extract<ApplyCommandOutcome, { ok: false }>): ToolResult {
  return outcome.kind === "rejected"
    ? toolError(describeDispatchRejection(outcome.rejection))
    : toolError(outcome.message);
}

export type WriteContext = Readonly<{ requesterUid: string }>;

// --- move_clip ---------------------------------------------------------------

export type MoveClipArgs = Readonly<{
  timelineId: string;
  nodeId: string;
  into?: string;
  after?: string;
  before?: string;
  position?: "start" | "end";
}>;

export async function handleMoveClip(
  args: MoveClipArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  let placedIndex = -1;
  let placedParent: NodeId | null = null;

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph) => {
      if (!graph.nodesById.has(nodeId)) {
        return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      }
      // `into` when given, otherwise reorder within the node's current parent.
      const targetId = args.into
        ? parseNodeId(args.into)
        : (graph.parentById.get(nodeId) ?? null);
      if (targetId === null) {
        return { ok: false, message: `"${args.nodeId}" is a top-level timeline and can't be moved.` } as const;
      }
      const target = graph.nodesById.get(targetId);
      if (!target) return { ok: false, message: `No collection with id "${targetId}".` } as const;
      if (target.kind !== "collection") {
        return {
          ok: false,
          message: `Target "${targetId}" is a clip, not a collection — items can only go inside a collection.`,
        } as const;
      }

      const placement = resolveMovePlacement(graph, {
        nodeId,
        targetId,
        ...(args.before === undefined ? {} : { before: parseNodeId(args.before) }),
        ...(args.after === undefined ? {} : { after: parseNodeId(args.after) }),
        ...(args.position === undefined ? {} : { position: args.position }),
      });
      if (!placement.ok) {
        return { ok: false, message: describePlacementError(placement.error) } as const;
      }

      placedIndex = placement.toIndex;
      placedParent = placement.toParentId;
      return {
        ok: true,
        command: {
          type: "move-nodes",
          nodeIds: [nodeId],
          toParentId: placement.toParentId,
          toIndex: placement.toIndex,
        },
      } as const;
    },
    ctx.requesterUid,
  );

  if (!outcome.ok) return reportFailure(outcome);

  // Report the resulting order from the WRITTEN document rather than the graph —
  // it is what actually persisted, and it is the list the caller will see on a
  // subsequent read_timeline.
  const parentId = placedParent as NodeId | null;
  const newOrder =
    parentId && outcome.documents[parentId as string]
      ? outcome.documents[parentId as string].clips.map((clip) => clip.id)
      : undefined;

  return toolOk(`Moved "${args.nodeId}" into "${parentId}" at index ${placedIndex}.`, {
    movedId: args.nodeId,
    toParentId: parentId,
    toIndex: placedIndex,
    ...(newOrder === undefined ? {} : { newOrder }),
    written: outcome.affectedIds,
  });
}

// --- trim_clip ---------------------------------------------------------------

export type TrimClipArgs = Readonly<{
  timelineId: string;
  nodeId: string;
  trimInSeconds?: number;
  trimOutSeconds?: number;
  durationSeconds?: number;
}>;

export async function handleTrimClip(
  args: TrimClipArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  let describedKind = "";

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph) => {
      const node = graph.nodesById.get(nodeId);
      if (!node) return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      if (node.kind !== "media") {
        return { ok: false, message: `"${args.nodeId}" is a collection, not a clip — collections have no trim.` } as const;
      }
      // `mediaKind` is optional on the node — absent means image.
      describedKind = isVideoMedia(node) ? "video" : "image";

      // Discriminate on the node's OWN kind and reject the wrong field rather
      // than silently ignoring it, so a mistaken call is visible.
      if (!isVideoMedia(node)) {
        if (args.trimInSeconds !== undefined || args.trimOutSeconds !== undefined) {
          return { ok: false, message: `"${args.nodeId}" is an image — set \`durationSeconds\`, not trims.` } as const;
        }
        if (args.durationSeconds === undefined) {
          return { ok: false, message: "Give `durationSeconds` for an image clip." } as const;
        }
        if (!(args.durationSeconds > 0)) {
          return { ok: false, message: "`durationSeconds` must be greater than 0." } as const;
        }
        return {
          ok: true,
          command: {
            type: "update-media",
            nodeId,
            update: { mediaKind: "image", durationSeconds: args.durationSeconds },
          },
        } as const;
      }

      if (args.durationSeconds !== undefined) {
        return { ok: false, message: `"${args.nodeId}" is a video — set \`trimInSeconds\`/\`trimOutSeconds\`, not \`durationSeconds\`.` } as const;
      }
      const trimIn = args.trimInSeconds ?? node.trimInSeconds;
      const trimOut = args.trimOutSeconds ?? node.trimOutSeconds;
      // Trims are AMOUNTS REMOVED from each end, matching
      // `mediaDurationSeconds` (`full - trimIn - trimOut`) and what the UI
      // writes — an untrimmed clip is 0/0, NOT 0/fullDuration.
      // Report the bounds rather than clamping — a silent clamp hides a mistake
      // in the caller's own numbers.
      if (trimIn < 0 || trimOut < 0) {
        return { ok: false, message: "Trims cannot be negative — they are seconds removed from each end." } as const;
      }
      if (!(trimIn + trimOut < node.fullDurationSeconds)) {
        return {
          ok: false,
          message: `Trims remove the whole clip: this source is ${node.fullDurationSeconds}s long, so \`trimInSeconds\` + \`trimOutSeconds\` must be less than ${node.fullDurationSeconds}.`,
        } as const;
      }
      return {
        ok: true,
        command: {
          type: "update-media",
          nodeId,
          update: { mediaKind: "video", trimInSeconds: trimIn, trimOutSeconds: trimOut },
        },
      } as const;
    },
    ctx.requesterUid,
  );

  if (!outcome.ok) return reportFailure(outcome);
  return toolOk(`Trimmed ${describedKind} clip "${args.nodeId}".`, {
    nodeId: args.nodeId,
    mediaKind: describedKind,
    written: outcome.affectedIds,
  });
}

// --- rename_item -------------------------------------------------------------

export type RenameItemArgs = Readonly<{ timelineId: string; nodeId: string; name: string }>;

export async function handleRenameItem(
  args: RenameItemArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const name = args.name.trim();
  if (name.length === 0) return toolError("A name can't be blank.");

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    { type: "rename-node", nodeId: parseNodeId(args.nodeId), name },
    ctx.requesterUid,
  );
  if (!outcome.ok) return reportFailure(outcome);
  return toolOk(`Renamed "${args.nodeId}" to "${name}".`, {
    nodeId: args.nodeId,
    name,
    written: outcome.affectedIds,
  });
}

// --- remove_clip -------------------------------------------------------------

export type RemoveClipArgs = Readonly<{ timelineId: string; nodeId: string; trashId: string }>;

/**
 * Delete is a MOVE into the trash root — there is no delete command, and that
 * is deliberate: everything the agent removes stays recoverable from the bin.
 */
export async function handleRemoveClip(
  args: RemoveClipArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  const trashId = parseNodeId(args.trashId);

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph) => {
      if (!graph.nodesById.has(nodeId)) {
        return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      }
      if (!graph.nodesById.has(trashId)) {
        return { ok: false, message: `No trash collection with id "${args.trashId}".` } as const;
      }
      return {
        ok: true,
        command: {
          type: "move-nodes",
          nodeIds: [nodeId],
          toParentId: trashId,
          toIndex: getChildren(graph, trashId).length,
        },
      } as const;
    },
    ctx.requesterUid,
  );

  if (!outcome.ok) return reportFailure(outcome);
  return toolOk(`Moved "${args.nodeId}" to the trash — it can be restored.`, {
    removedId: args.nodeId,
    recoverable: true,
    written: outcome.affectedIds,
  });
}
