import { parseNodeId, type CollectionsGraph, type NodeId } from "@storyboard/collections-core";

import { CLOUDINARY_PROVIDER_ID } from "@/lib/assets/cloudinary-provider";
import {
  createCloudinaryUploadTicket,
  forgetCloudinaryAssetList,
  listCloudinaryAssets,
  type CloudinaryUploadTicket,
} from "@/lib/cloudinary-media-store";
import { requireProjectAssetScope } from "@/lib/project-asset-scope";
import { resolveMovePlacement } from "@/lib/webmcp/placement";
import { toolError, toolOk } from "@/lib/webmcp/results";
import type { ToolResult } from "@/lib/webmcp/types";

import { applyCollectionsCommand } from "./apply-command";

// Getting a locally-rendered file into the app, in two tool calls with the
// bytes in neither:
//
//   create_upload  -> a signed, SCOPED Cloudinary ticket
//   (caller POSTs the file straight to Cloudinary)
//   attach_media   -> verify it landed, mint the clip, place it
//
// Why not send the file through MCP: a render is tens of megabytes and a tool
// argument is JSON. Base64 would blow up the context and defeat the upload
// route's own size ceiling. Signing stays server-side, so the client never
// picks its own folder — see createCloudinaryUploadTicket.

const ALLOWED = /\.(mp4|webm|mov|jpe?g|png|webp)$/i;

export type CreateUploadArgs = Readonly<{ projectId: string; filename: string }>;

export async function createUploadTicket(
  args: CreateUploadArgs,
  requesterUid: string,
): Promise<CloudinaryUploadTicket> {
  const projectId = await requireProjectAssetScope(args.projectId, requesterUid);
  if (!ALLOWED.test(args.filename)) {
    throw new Error(
      `Unsupported file type "${args.filename}". Allowed: mp4, webm, mov, jpg, jpeg, png, webp.`,
    );
  }
  return createCloudinaryUploadTicket(args.filename, requesterUid, projectId);
}

// --- attach_media ------------------------------------------------------------

export type AttachMediaArgs = Readonly<{
  timelineId: string;
  projectId: string;
  publicId: string;
  into?: string;
  name?: string;
  after?: string;
  before?: string;
  position?: "start" | "end";
  durationSeconds?: number;
}>;

/** The app's own default on-screen time for a still. */
const DEFAULT_IMAGE_SECONDS = 3;
/** Fallback when Cloudinary reports no duration for a video (the Admin list
 *  endpoint omits it; only the Search API returns one). */
const DEFAULT_VIDEO_SECONDS = 5;

export async function attachMedia(
  args: AttachMediaArgs,
  requesterUid: string,
): Promise<ToolResult> {
  const projectId = await requireProjectAssetScope(args.projectId, requesterUid);

  // Verify the file actually landed and read its REAL url/duration rather than
  // trusting arguments. This is what catches a caller whose upload never ran or
  // whose ticket expired — otherwise we would mint a clip pointing at nothing.
  // Drop the cached listing first: nothing invalidated it, because the bytes
  // went straight to Cloudinary without passing through this server.
  forgetCloudinaryAssetList(requesterUid);
  const assets = await listCloudinaryAssets(requesterUid, projectId);
  const asset = assets.find((candidate) => candidate.pathname === args.publicId);
  if (!asset) {
    return toolError(
      `No uploaded asset "${args.publicId}" in project "${projectId}". Upload the file using the ticket from create_upload first, then retry.`,
    );
  }

  const isVideo = asset.resourceType === "video";
  const sourceSeconds = asset.duration ?? DEFAULT_VIDEO_SECONDS;
  const displayName =
    (args.name ?? asset.relativePath ?? asset.pathname).trim() || asset.pathname;

  // A fresh node id derived from the public id, which already carries an
  // upload timestamp — so it cannot collide with an existing node.
  const newNodeId = parseNodeId(`clip-${asset.pathname}`);
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
          message: `Target "${targetId}" is a clip, not a collection — clips can only go inside a collection.`,
        } as const;
      }
      if (graph.nodesById.has(newNodeId)) {
        return { ok: false, message: `"${asset.pathname}" is already on this timeline.` } as const;
      }

      const placement = resolveMovePlacement(graph, {
        nodeId: newNodeId,
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

      return {
        ok: true,
        command: {
          type: "add-nodes",
          toParentId: placement.toParentId,
          toIndex: placement.toIndex,
          nodes: [
            isVideo
              ? {
                  id: newNodeId,
                  kind: "media" as const,
                  mediaKind: "video" as const,
                  name: displayName,
                  src: asset.url,
                  fullDurationSeconds: sourceSeconds,
                  trimInSeconds: 0,
                  // Trims are AMOUNTS REMOVED from each end, not offsets into
                  // the source — `mediaDurationSeconds` computes
                  // `full - trimIn - trimOut`, so an untrimmed clip is 0/0.
                  // Passing the play length straight through as `trimOutSeconds`
                  // trimmed the whole clip away and packed it at zero width.
                  trimOutSeconds: Math.max(
                    0,
                    sourceSeconds - Math.min(args.durationSeconds ?? sourceSeconds, sourceSeconds),
                  ),
                }
              : {
                  id: newNodeId,
                  kind: "media" as const,
                  mediaKind: "image" as const,
                  name: displayName,
                  src: asset.url,
                  durationSeconds: args.durationSeconds ?? DEFAULT_IMAGE_SECONDS,
                },
          ],
        },
        // PROVENANCE — not optional. `graphChildrenToClips` reads sourceAsset
        // from details, not the node, so without this the clip is written with
        // no provenance, is never marked for reclaim, and its file leaks in
        // storage forever (docs/asset-providers.md).
        details: {
          [newNodeId as string]: {
            alt: displayName,
            aspect: 16 / 9,
            trackIndex: 0,
            sourceAsset: { providerId: CLOUDINARY_PROVIDER_ID, assetId: asset.pathname },
            ...(asset.thumbnailUrl ? { poster: asset.thumbnailUrl } : {}),
          },
        },
      } as const;
    },
    requesterUid,
  );

  if (!outcome.ok) {
    return toolError(
      outcome.kind === "rejected"
        ? `The edit was refused (${outcome.rejection.reason}).`
        : outcome.message,
    );
  }

  return toolOk(`Added "${displayName}" to ${placedParent} at index ${placedIndex}.`, {
    nodeId: newNodeId as string,
    toParentId: placedParent,
    toIndex: placedIndex,
    src: asset.url,
    sourceAsset: { providerId: CLOUDINARY_PROVIDER_ID, assetId: asset.pathname },
    written: outcome.affectedIds,
  });
}
