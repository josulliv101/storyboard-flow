import {
  getChildren,
  isVideoMedia,
  MIN_MEDIA_DURATION_SECONDS,
  parseNodeId,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/collections-core";

import { normalizeTags, tagsField } from "@storyboard/timeline-model/tags";
import { trackIndexOf } from "@storyboard/timeline-model/documents";
import { resolvePlacement } from "@storyboard/timeline-model/placement";
import { graphChildrenToClips } from "@storyboard/timeline-domain";

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
import {
  DEFAULT_LAYER_POSITION,
  DEFAULT_LAYER_SIZE,
  LAYER_FRAME_POSITIONS,
  LAYER_FRAME_SIZES,
  type LayerFramePosition,
  type LayerFrameSize,
} from "@storyboard/timeline-model/layer-frame";
import {
  defaultLayerFramePlacement,
  hasPicture,
  layerFrameForChoice,
} from "@/lib/default-layer-frame";

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
    parentId === null
      ? undefined
      : outcome.documents[parentId as string]?.clips.map((clip) => clip.id);

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

// --- set_lane ----------------------------------------------------------------

export type SetLaneArgs = Readonly<{
  timelineId: string;
  nodeId: string;
  lane: number;
}>;

/**
 * Move a clip between LANES: 0 is the picture, anything above runs under it.
 *
 * A detail-only write, like `set_tags` — `trackIndex` lives in the side table
 * because the engine does not model it, so the graph is genuinely unchanged and
 * there is no command to issue.
 *
 * BUT UNLIKE TAGS, THIS CHANGES PACKING. A tag alters nothing about where
 * anything sits; a lane re-packs the whole parent (every lane starts at zero,
 * so pulling a clip out of the picture closes the gap behind it) and can change
 * the parent's own SPAN — a 30s bed moved onto lane 1 no longer extends the
 * sequence, so the collection gets shorter, which changes the duration its own
 * parent stores for it, and so on up. So the write set is the parent AND its
 * ancestors, where `set_tags` correctly names only the parent.
 *
 * Getting that wrong would not fail loudly: the clip would move, and every
 * ancestor would keep a stale duration until something unrelated rewrote it.
 */
export async function handleSetLane(
  args: SetLaneArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  if (!Number.isInteger(args.lane) || args.lane < 0) {
    return toolError("`lane` must be a whole number, 0 or more. 0 is the picture.");
  }

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph, details) => {
      if (!graph.nodesById.has(nodeId)) {
        return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      }
      const parentId = graph.parentById.get(nodeId) ?? null;
      if (parentId === null) {
        return {
          ok: false,
          message: `"${args.nodeId}" is a timeline itself, not a clip inside one — no lane to put it on.`,
        } as const;
      }
      // ONE COMMAND. The ancestor write set comes from the patch now —
      // `collectAffectedCollectionIds` walks them for `nodes-updated`, which
      // is exactly the rule the hand-rolled walk here implemented: a lane
      // change moves the parent's span, and every ancestor stores a duration
      // for it. And because it is a command, it is undoable.
      //
      // Lane 0 CLEARS the fields rather than storing a 0 — absence is the
      // picture, everywhere else in the model. It clears the placement and the
      // inset too: the picture is a cut, so a placed start there means
      // nothing, and a frame describes where a clip sits INSIDE the picture,
      // which the picture cannot do. Leaving either would resurface the moment
      // the clip returned to a lane, in a place nobody chose.
      //
      // Going the other way, a clip with a picture gets the default inset —
      // the same one the drag stamps, so the two authoring routes land in the
      // same place rather than one producing a visible layer and the other a
      // silent one.
      return {
        ok: true,
        command: {
          type: "set-node-placement",
          nodeIds: [nodeId],
          placement:
            args.lane === 0
              ? { trackIndex: null, placedStart: null, layerFrame: null }
              : {
                  trackIndex: args.lane,
                  ...defaultLayerFramePlacement(graph.nodesById.get(nodeId), details[nodeId]),
                },
        },
      } as const;
    },
    ctx.requesterUid,
  );
  if (!outcome.ok) return reportFailure(outcome);
  return toolOk(
    args.lane === 0
      ? `Moved "${args.nodeId}" onto the picture.`
      : `Moved "${args.nodeId}" to lane ${args.lane} — it now plays under the picture.`,
    { nodeId: args.nodeId, lane: args.lane, written: outcome.affectedIds },
  );
}

// --- set_start ---------------------------------------------------------------

export type SetStartArgs = Readonly<{
  timelineId: string;
  nodeId: string;
  /** Seconds from the start of the collection, or null to re-queue the clip. */
  startSeconds: number | null;
}>;

/**
 * Place a clip at an explicit time on its lane — what makes a lane a TIMELINE
 * rather than a parallel queue. Audio starts when it starts; a voiceover at
 * 7.5s should not need 7.5s of something in front of it.
 *
 * A detail-only write, like `set_lane`: `placedStart` lives in the side table
 * because the engine models neither lanes nor time, so the graph is genuinely
 * unchanged and there is no command to issue. It carries the same ancestor
 * write set for the same reason — a placement moves the parent's span, and
 * every ancestor stores a duration for it.
 *
 * REFUSES THE PICTURE. Lane 0 is a cut: trimming a shot closes the gap behind
 * it and reordering repacks, and a hole there is not silence — the player
 * holds the last frame. Placing a shot is a different feature; this says so
 * rather than writing a field that packing would ignore anyway.
 *
 * ON A COLLISION IT BUMPS rather than failing. Placing a clip on top of
 * something already on its lane moves it to the first lane above with room,
 * and the result says where it landed. See `resolvePlacement` for why that is
 * decided by packing rather than by comparing against current positions.
 */
export async function handleSetStart(
  args: SetStartArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  const start = args.startSeconds;
  if (start !== null && (!Number.isFinite(start) || start < 0)) {
    return toolError("`startSeconds` must be a number of seconds, 0 or more — or null to re-queue.");
  }

  let requestedLane = 0;
  let landedLane = 0;
  let wasBumped = false;

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph, details) => {
      if (!graph.nodesById.has(nodeId)) {
        return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      }
      const parentId = graph.parentById.get(nodeId) ?? null;
      if (parentId === null) {
        return {
          ok: false,
          message: `"${args.nodeId}" is a timeline itself, not a clip inside one — nothing to place.`,
        } as const;
      }
      // From the NODE — lane and placement are engine-carried now.
      const lane = trackIndexOf({ trackIndex: graph.nodesById.get(nodeId)?.trackIndex ?? 0 });
      if (lane === 0) {
        return {
          ok: false,
          message:
            `"${args.nodeId}" is on the picture, which is a cut — its clips pack end to end and ` +
            `a gap in it holds the last frame rather than going silent. Put it on a lane first ` +
            `with set_lane, then place it.`,
        } as const;
      }

      // Judged against the layout this write would PRODUCE — see
      // `resolvePlacement`. The clips come from the same projection the board
      // and the player read, so "does it collide" means the same thing here as
      // it will on screen.
      const placement =
        start === null
          ? { lane, bumped: false }
          : resolvePlacement(
              graphChildrenToClips(graph, details, parentId as string),
              // The projection reports a demoted duplicate under its STORED
              // clip id, so match on that where there is one.
              details[nodeId as string]?.sourceClipId ?? (nodeId as string),
              lane,
              start,
            );
      requestedLane = lane;
      landedLane = placement.lane;
      wasBumped = placement.bumped;

      // ONE COMMAND, so the change rides the patch path: it lands in undo
      // history, and `collectAffectedCollectionIds` walks the ancestors a
      // `nodes-updated` patch implies — which is the same write set the
      // hand-rolled walk here used to compute, for the same reason (a
      // placement moves the parent's span, and every ancestor stores a
      // duration for it).
      //
      // `null` CLEARS the placement, because absence IS the queued state.
      return {
        ok: true,
        command: {
          type: "set-node-placement",
          nodeIds: [nodeId],
          placement: { trackIndex: placement.lane, placedStart: start },
        },
      } as const;
    },
    ctx.requesterUid,
  );
  if (!outcome.ok) return reportFailure(outcome);

  if (start === null) {
    return toolOk(
      `"${args.nodeId}" is queued again — it now follows the clip before it on lane ${landedLane}.`,
      { nodeId: args.nodeId, lane: landedLane, placedStart: null, written: outcome.affectedIds },
    );
  }
  return toolOk(
    wasBumped
      ? `Placed "${args.nodeId}" at ${start}s. Lane ${requestedLane} was already busy at that ` +
          `moment, so it moved to lane ${landedLane}.`
      : `Placed "${args.nodeId}" at ${start}s on lane ${landedLane}.`,
    {
      nodeId: args.nodeId,
      lane: landedLane,
      placedStart: start,
      bumped: wasBumped,
      written: outcome.affectedIds,
    },
  );
}

// --- set_layer_frame ---------------------------------------------------------

export type SetLayerFrameArgs = Readonly<{
  timelineId: string;
  nodeId: string;
  /** A named corner, or `"none"` to go back to sound only. */
  position?: LayerFramePosition | "none";
  size?: LayerFrameSize;
}>;

/**
 * Move a layered clip's INSET — where it draws inside the picture.
 *
 * PRESETS, not four numbers, for the same reason the picker offers them: the
 * useful range is narrow, and a preset stores exactly the rectangle a drag
 * would, so the two authoring routes cannot diverge.
 *
 * The two refusals both describe something that cannot exist rather than
 * something disallowed. A clip on lane 0 IS the picture, so there is no frame
 * for it to sit inside. Audio has no picture to draw — and a frame on one is
 * worse than useless, because a normalised audio segment carries a synthesised
 * BLACK video stream that would paint over the shot.
 */
export async function handleSetLayerFrame(
  args: SetLayerFrameArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const nodeId = parseNodeId(args.nodeId);
  const position = args.position ?? DEFAULT_LAYER_POSITION;
  const size = args.size ?? DEFAULT_LAYER_SIZE;
  if (position !== "none" && !LAYER_FRAME_POSITIONS.includes(position)) {
    return toolError(
      `\`position\` must be one of ${LAYER_FRAME_POSITIONS.join(", ")}, or "none" for sound only.`,
    );
  }
  if (!LAYER_FRAME_SIZES.includes(size)) {
    return toolError(`\`size\` must be one of ${LAYER_FRAME_SIZES.join(", ")}.`);
  }

  let landedWidth = 0;

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph, details) => {
      const node = graph.nodesById.get(nodeId);
      if (!node) return { ok: false, message: `No node with id "${args.nodeId}".` } as const;
      if ((graph.parentById.get(nodeId) ?? null) === null) {
        return {
          ok: false,
          message: `"${args.nodeId}" is a timeline itself, not a clip inside one.`,
        } as const;
      }
      if ((node.trackIndex ?? 0) === 0) {
        return {
          ok: false,
          message:
            `"${args.nodeId}" is on the picture, so there is no frame for it to sit inside — ` +
            `an inset is where a clip draws WITHIN the picture. Put it on a lane with set_lane first.`,
        } as const;
      }
      if (!hasPicture(node)) {
        return {
          ok: false,
          message:
            `"${args.nodeId}" has no picture to place — it is audio, and it is already mixed ` +
            `under the picture. Only video, images and collections can be inset.`,
        } as const;
      }

      if (position === "none") {
        return {
          ok: true,
          command: { type: "set-node-placement", nodeIds: [nodeId], placement: { layerFrame: null } },
        } as const;
      }
      const layerFrame = layerFrameForChoice(position, size, details[nodeId as string]?.aspect);
      landedWidth = layerFrame.width;
      return {
        ok: true,
        command: { type: "set-node-placement", nodeIds: [nodeId], placement: { layerFrame } },
      } as const;
    },
    ctx.requesterUid,
  );
  if (!outcome.ok) return reportFailure(outcome);
  return toolOk(
    position === "none"
      ? `"${args.nodeId}" is sound only now — it plays under the picture without being drawn.`
      : `"${args.nodeId}" now draws ${position.replace("-", " ")}, at ${Math.round(landedWidth * 100)}% of the frame's width.`,
    { nodeId: args.nodeId, position, size, written: outcome.affectedIds },
  );
}
