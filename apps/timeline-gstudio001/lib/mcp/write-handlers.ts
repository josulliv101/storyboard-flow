import {
  getChildren,
  isVideoMedia,
  MIN_MEDIA_DURATION_SECONDS,
  parseNodeId,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/collections-core";

import { normalizeTags, tagsField } from "@storyboard/timeline-model/tags";

import { checkUserScopedId } from "@/lib/timeline-ownership";
import { describeDispatchRejection, toolError, toolOk } from "@/lib/webmcp/results";
import { resolveMovePlacement, type PlacementError } from "@/lib/webmcp/placement";
import type { ToolResult } from "@/lib/webmcp/types";

import {
  applyCollectionsCommand,
  trashDocumentIdFor,
  type ApplyCommandOutcome,
} from "./apply-command";
import type { DetailsById } from "@storyboard/timeline-domain";

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
    // A move EMPTIES ITS SOURCE whenever it takes the last clip out, and that
    // is as deliberate as a removal — the same exemption `remove_clip` has
    // carried since it hit this. Without it the store refused the write with
    // "Refusing to save an empty timeline over an existing non-empty
    // document", which the catch in apply-command rethrew, so the tool did not
    // even fail politely.
    //
    // Safe to pass unconditionally: apply-command scopes the flag to the
    // documents this command actually emptied, so the DESTINATION — which is
    // gaining a clip, not losing one — never receives it.
    { allowEmptying: true },
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
        if (!(args.durationSeconds >= MIN_MEDIA_DURATION_SECONDS)) {
          return {
            ok: false,
            message: `\`durationSeconds\` must be at least ${MIN_MEDIA_DURATION_SECONDS}s.`,
          } as const;
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
      // Reported against the SHARED floor rather than a local "> 0", so this
      // guard and the reducer's clamp cannot drift into disagreeing about the
      // same edit — which is what #341 was.
      const longestTrim = node.fullDurationSeconds - MIN_MEDIA_DURATION_SECONDS;
      if (!(trimIn + trimOut <= longestTrim)) {
        return {
          ok: false,
          message: `Trims would leave less than ${MIN_MEDIA_DURATION_SECONDS}s showing: this source is ${node.fullDurationSeconds}s long, so \`trimInSeconds\` + \`trimOutSeconds\` must be at most ${longestTrim}.`,
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

// --- set_tags ----------------------------------------------------------------

export type SetTagsArgs = Readonly<{
  timelineId: string;
  nodeId: string;
  tags: readonly string[];
}>;

/**
 * Replace an item's tags — the first write that touches ONLY the detail
 * side-table.
 *
 * There is no command for it, and that is correct rather than a gap: tags exist
 * because the engine does not model them, so the graph is genuinely unchanged.
 * The builder therefore omits `command` and names the document to rewrite
 * instead. See CommandBuilder in apply-command.ts for why a manufactured no-op
 * command is not an option (`applyRename` rejects a same-name rename outright).
 *
 * REPLACE, not merge. Add-one and remove-one both reduce to "here is the new
 * set", which keeps the tool idempotent and lets a caller clear tags by passing
 * `[]` — with a merge-only tool there would be no way to remove anything.
 */
export async function handleSetTags(
  args: SetTagsArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  const tags = normalizeTags(args.tags);

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph, details) => {
      if (!graph.nodesById.has(nodeId)) {
        return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      }
      // A ROOT has no parent, so it is not a clip in anyone's document and has
      // nowhere for tags to live. Reject rather than write into the void.
      const parentId = graph.parentById.get(nodeId) ?? null;
      if (parentId === null) {
        return {
          ok: false,
          message: `"${args.nodeId}" is a timeline itself, not a clip inside one — tag a clip in it instead.`,
        } as const;
      }
      const existing = details[nodeId as string];
      return {
        ok: true,
        // Spread the WHOLE existing entry: `graphChildrenToClips` rebuilds the
        // clip from this record, so dropping `sourceAsset`, `poster` or `alt`
        // here would erase them from the stored clip on save.
        details: {
          [nodeId as string]: { ...existing, ...tagsField(tags) } as DetailsById[string],
        },
        // Exactly the parent — a clip is stored in its parent's `clips` array,
        // and a tag changes no ancestor's summary.
        affectedCollectionIds: [parentId as string],
      } as const;
    },
    ctx.requesterUid,
  );
  if (!outcome.ok) return reportFailure(outcome);
  return toolOk(
    tags.length === 0
      ? `Cleared the tags on "${args.nodeId}".`
      : `Tagged "${args.nodeId}": ${tags.join(", ")}.`,
    { nodeId: args.nodeId, tags, written: outcome.affectedIds },
  );
}

// --- remove_clip -------------------------------------------------------------

export type RemoveClipArgs = Readonly<{
  timelineId: string;
  nodeId: string;
  /** Optional and normally omitted — the caller's own bin is derived. */
  trashId?: string;
}>;

/**
 * Delete is a MOVE into the trash root — there is no delete command, and that
 * is deliberate: everything the agent removes stays recoverable from the bin.
 *
 * The bin is DERIVED from the verified uid rather than supplied. It used to be
 * a required argument sourced "from read_timeline", which no tool could
 * actually provide: the trash is a sibling root, never a collection clip inside
 * a project, so it never appeared in a project read and never landed in the
 * loaded closure. Every call failed. `includeTrash` loads it as a second graph
 * root so the move has somewhere to go.
 */
export async function handleRemoveClip(
  args: RemoveClipArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  // A SUPPLIED trashId must actually be a bin, and the requester's own.
  // `checkUserScopedId` only ever accepts `trash-<requesterUid>` — the rule
  // apply-command.ts already documents, which this path was not applying.
  // Membership in the loaded graph is not enough on its own: any collection
  // under the root passes that, so `remove_clip` would quietly become a move
  // into it, exempt from the empty-collection guard by `allowEmptying`, and
  // still report `recoverable: true` for an item that never reached the bin.
  if (args.trashId !== undefined && checkUserScopedId(args.trashId, ctx.requesterUid) !== true) {
    return toolError("`trashId` must be your own trash bin — omit it to use the default.");
  }
  const trashId = parseNodeId(args.trashId ?? trashDocumentIdFor(ctx.requesterUid));

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph, details) => {
      if (!graph.nodesById.has(nodeId)) {
        return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      }
      if (!graph.nodesById.has(trashId)) {
        return {
          ok: false,
          message: `Could not reach the trash ("${trashId as string}").`,
        } as const;
      }
      const existing = details[nodeId as string];
      // Read the parent BEFORE the move — afterwards it IS the trash. `title`
      // is the SOURCE TIMELINE's name, not the clip's, and both fields are
      // required, so an unnamed parent means no stamp at all rather than half
      // of one (identical to the in-page path in graph-navigation.tsx).
      const parentId = graph.parentById.get(nodeId) ?? null;
      const parentTitle = parentId === null ? undefined : graph.nodesById.get(parentId)?.name;
      return {
        ok: true,
        command: {
          type: "move-nodes",
          nodeIds: [nodeId],
          toParentId: trashId,
          toIndex: getChildren(graph, trashId).length,
        },
        // Provenance for the bin's row caption ("trashed 5 minutes ago, from
        // Scene one"), matching what the in-page path stamps before dispatch.
        // It rides the details side-table, not the graph node — the engine
        // never reads it. MERGED onto the existing entry: a detail is the whole
        // clip's stored shape, and replacing it would drop src/poster/provenance.
        ...(existing
          ? {
              details: {
                [nodeId as string]: {
                  ...existing,
                  trashedAt: new Date().toISOString(),
                  ...(parentId !== null && parentTitle
                    ? { trashedFrom: { timelineId: parentId as string, title: parentTitle } }
                    : {}),
                },
              },
            }
          : {}),
      } as const;
    },
    ctx.requesterUid,
    // A removal is the one command that legitimately empties a collection —
    // taking the last clip out of a lane is the whole point of the call, not a
    // stale client about to erase work.
    { includeTrash: true, allowEmptying: true },
  );

  if (!outcome.ok) return reportFailure(outcome);
  return toolOk(`Moved "${args.nodeId}" to the trash — it can be restored.`, {
    removedId: args.nodeId,
    recoverable: true,
    written: outcome.affectedIds,
  });
}
