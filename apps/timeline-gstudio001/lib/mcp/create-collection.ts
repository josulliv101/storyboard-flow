import { parseNodeId, type CollectionsGraph, type NodeId } from "@storyboard/collections-core";
import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { resolveMovePlacement } from "@/lib/webmcp/placement";
import { describeDispatchRejection, toolError, toolOk } from "@/lib/webmcp/results";
import type { ToolResult } from "@/lib/webmcp/types";

import { applyCollectionsCommand } from "./apply-command";

// create_collection — a new, empty collection inside a timeline.
//
// A collection is TWO records: a collection clip in the parent's list, and its
// own timeline document holding the children. Both are written in one atomic
// batch (see `newDocuments` on CommandBuilder) so a drill-in can never 404 on a
// half-created collection — the same reason the in-page path puts the seed and
// the parent update in a single batch.

/** Same shape the board mints (`graph-native-drop.tsx`), so ids from either
 *  path are indistinguishable. */
function mintTimelineId(): string {
  return `timeline-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Defaults for a brand-new empty collection's detail entry.
 *
 * `hydrated: true` is the load-bearing one: it says "this collection's children
 * are known", which is true — it has none. A placeholder instead reports the
 * STORED summary, so an unhydrated empty collection would keep claiming
 * whatever count it was last told rather than deriving 0 from live children.
 */
const NEW_COLLECTION_DETAIL = {
  aspect: 16 / 9,
  trackIndex: 0,
  itemCount: 0,
  duration: 3,
  sourceDuration: 3,
  trimIn: 0,
  trimOut: 0,
  hydrated: true,
} as const;

export type CreateCollectionArgs = Readonly<{
  timelineId: string;
  name: string;
  into?: string;
  after?: string;
  before?: string;
  position?: "start" | "end";
}>;

export async function createCollection(
  args: CreateCollectionArgs,
  requesterUid: string,
): Promise<ToolResult> {
  const name = args.name.trim();
  if (name.length === 0) return toolError("A collection needs a name.");

  const childId = mintTimelineId();
  const childNodeId = parseNodeId(childId);
  let placedIndex = -1;
  let placedParent: NodeId | null = null;

  const outcome = await applyCollectionsCommand(
    args.timelineId,
    (graph: CollectionsGraph) => {
      const targetId = parseNodeId(args.into ?? args.timelineId);
      const target = graph.nodesById.get(targetId);
      if (!target) return { ok: false, message: `No collection with id "${targetId}".` } as const;
      if (target.kind !== "collection") {
        return {
          ok: false,
          message: `Target "${targetId}" is a clip, not a collection — a collection can only go inside another collection.`,
        } as const;
      }

      const placement = resolveMovePlacement(graph, {
        nodeId: childNodeId,
        targetId,
        ...(args.before === undefined ? {} : { before: parseNodeId(args.before) }),
        ...(args.after === undefined ? {} : { after: parseNodeId(args.after) }),
        ...(args.position === undefined ? {} : { position: args.position }),
      });
      if (!placement.ok) {
        return {
          ok: false,
          message:
            placement.error.reason === "conflicting-anchors"
              ? "Give at most one of `after`, `before` or `position`."
              : `No sibling with id "${placement.error.anchor}" in the target collection.`,
        } as const;
      }

      placedIndex = placement.toIndex;
      placedParent = placement.toParentId;

      const childDocument: TimelineDocument = { id: childId, title: name, clips: [] };

      return {
        ok: true,
        command: {
          type: "add-nodes",
          toParentId: placement.toParentId,
          toIndex: placement.toIndex,
          // New collections start EMPTY — children arrive through their own
          // document, not inline here.
          nodes: [{ id: childNodeId, kind: "collection" as const, name }],
        },
        details: { [childId]: { ...NEW_COLLECTION_DETAIL, alt: `${name} collection` } },
        newDocuments: [childDocument],
      } as const;
    },
    requesterUid,
  );

  if (!outcome.ok) {
    return outcome.kind === "rejected"
      ? toolError(describeDispatchRejection(outcome.rejection))
      : toolError(outcome.message);
  }

  return toolOk(
    `Created collection "${name}" in ${placedParent} at index ${placedIndex}.`,
    {
      collectionId: childId,
      name,
      toParentId: placedParent,
      toIndex: placedIndex,
      // The id to pass as `timelineId` when putting things INSIDE it.
      childTimelineId: childId,
      written: outcome.affectedIds,
    },
  );
}
