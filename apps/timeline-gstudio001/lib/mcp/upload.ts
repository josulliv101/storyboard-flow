import { aspectFromDimensions } from "@storyboard/timeline-model/documents";
import { randomUUID } from "node:crypto";

import { parseNodeId, type CollectionsGraph, type NodeId } from "@storyboard/collections-core";
import { tagsField } from "@storyboard/timeline-model/tags";

import { CLOUDINARY_PROVIDER_ID } from "@/lib/assets/cloudinary-provider";
import {
  isAudioAsset,
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

const ALLOWED = /\.(mp4|webm|mov|jpe?g|png|webp|flac|wav|mp3|m4a|aac|ogg|oga|opus)$/i;

export type CreateUploadArgs = Readonly<{
  projectId: string;
  /** One file. Mutually exclusive with `filenames`. */
  filename?: string;
  /** A BATCH. Filing 24 images took 24 tickets and 24 attach calls — 48 round
   *  trips — so both halves of the pair take a list now. */
  filenames?: readonly string[];
}>;

/** Every ticket a `create_upload` call minted, in the order asked for. */
export async function createUploadTickets(
  args: CreateUploadArgs,
  requesterUid: string,
): Promise<CloudinaryUploadTicket[]> {
  const filenames = args.filenames ?? (args.filename === undefined ? [] : [args.filename]);
  if (filenames.length === 0) throw new Error("Give `filename` or a non-empty `filenames`.");

  // Scope-checked ONCE for the whole batch rather than per file.
  const projectId = await requireProjectAssetScope(args.projectId, requesterUid);
  const unsupported = filenames.filter((name) => !ALLOWED.test(name));
  if (unsupported.length > 0) {
    // ALL of them, not the first: a caller fixing one name at a time pays a
    // round trip per mistake, which is the cost this whole change is about.
    throw new Error(
      `Unsupported file type(s): ${unsupported.map((name) => `"${name}"`).join(", ")}. ` +
        `Allowed: mp4, webm, mov, jpg, jpeg, png, webp, flac, wav, mp3, m4a, aac, ogg, opus.`,
    );
  }
  return Promise.all(
    filenames.map((filename) => createCloudinaryUploadTicket(filename, requesterUid, projectId)),
  );
}

export async function createUploadTicket(
  args: CreateUploadArgs,
  requesterUid: string,
): Promise<CloudinaryUploadTicket> {
  const [ticket] = await createUploadTickets(args, requesterUid);
  if (!ticket) throw new Error("Give `filename` or a non-empty `filenames`.");
  return ticket;
}

// --- attach_media ------------------------------------------------------------

/** One file to land. The per-clip half of a batch attach. */
export type AttachMediaItem = Readonly<{
  publicId: string;
  name?: string;
  durationSeconds?: number;
  tags?: readonly string[];
}>;

export type AttachMediaArgs = Readonly<{
  timelineId: string;
  projectId: string;
  /** One file. Mutually exclusive with `items`. */
  publicId?: string;
  /** A BATCH, landed in ONE write. Attaching 24 images one at a time rewrote
   *  the timeline document 24 times — 24 chances to lose a revision race with
   *  another writer — and re-listed the project's assets 24 times to verify
   *  them. Placement applies to the group: they land consecutively from the
   *  resolved index, in the order given. */
  items?: readonly AttachMediaItem[];
  into?: string;
  name?: string;
  after?: string;
  before?: string;
  position?: "start" | "end";
  durationSeconds?: number;
  /** Labels to file this clip under — generator, checkpoint, shot, status.
   *  Cleaned by `normalizeTags`, so a caller may pass duplicates, blanks or
   *  odd whitespace without corrupting the document. */
  tags?: readonly string[];
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
  const items: readonly AttachMediaItem[] =
    args.items ??
    (args.publicId === undefined
      ? []
      : [
          {
            publicId: args.publicId,
            ...(args.name === undefined ? {} : { name: args.name }),
            ...(args.durationSeconds === undefined
              ? {}
              : { durationSeconds: args.durationSeconds }),
            ...(args.tags === undefined ? {} : { tags: args.tags }),
          },
        ]);
  if (items.length === 0) return toolError("Give `publicId` or a non-empty `items`.");

  const projectId = await requireProjectAssetScope(args.projectId, requesterUid);

  // ONE listing for the whole batch. Verify the files actually landed and read
  // their REAL url/duration rather than trusting arguments — this is what
  // catches a caller whose upload never ran or whose ticket expired, otherwise
  // we would mint a clip pointing at nothing. Drop the cached listing first:
  // nothing invalidated it, because the bytes went straight to Cloudinary
  // without passing through this server.
  forgetCloudinaryAssetList(requesterUid);
  // `wait: true` — the cold-listing timeout resolves to an EMPTY list, and an
  // empty list here is indistinguishable from "the upload never happened". A
  // render can afford that; a verification cannot.
  const assets = await listCloudinaryAssets(requesterUid, projectId, { wait: true });
  const byPathname = new Map(assets.map((asset) => [asset.pathname, asset]));

  // EVERY missing id, not just the first. A batch that reports one failure per
  // round trip costs exactly what batching was meant to save.
  const missing = items.filter((item) => !byPathname.has(item.publicId));
  if (missing.length > 0) {
    return toolError(
      `No uploaded asset${missing.length > 1 ? "s" : ""} ` +
        `${missing.map((item) => `"${item.publicId}"`).join(", ")} in project "${projectId}". ` +
        `Upload the file using the ticket from create_upload first, then retry.`,
    );
  }

  const prepared = items.map((item) => {
    const asset = byPathname.get(item.publicId)!;
    // Cloudinary serves AUDIO under resourceType "video" — there is no separate
    // audio type — so the clip kind comes from the FORMAT, never from
    // resourceType. Reading resourceType here would file every voice take as a
    // video clip with a broken poster.
    //
    // NOT `pathname`: a Cloudinary public_id has no extension ("brian-take-6s",
    // not "brian-take-6s.flac"), so testing it always says "not audio".
    // `format` is the field that carries it; the secure_url is the fallback for
    // a listing that omitted it.
    const isAudio = isAudioAsset(asset.format ?? asset.url);
    const isVideo = !isAudio && asset.resourceType === "video";
    const sourceSeconds = asset.duration ?? DEFAULT_VIDEO_SECONDS;
    const displayName =
      (item.name ?? asset.relativePath ?? asset.pathname).trim() || asset.pathname;

    // A freshly MINTED id, not one derived from the public id. Deriving it made
    // the id a function of the asset, so attaching one asset twice produced two
    // nodes with the same id — which node ids, being the addressing scheme,
    // cannot allow. Asset identity lives in `sourceAsset`, which is what every
    // reader actually uses to recover it; the id only has to be unique. Same
    // prefixes as the drag-drop path so both mint alike.
    const kindPrefix = isAudio ? "audio" : isVideo ? "video" : "image";
    const nodeId = parseNodeId(`${kindPrefix}-${randomUUID().slice(0, 8)}`);

    const node =
      isVideo || isAudio
        ? {
            id: nodeId,
            kind: "media" as const,
            // Both WINDOWED kinds mint identically — same source length, same
            // trims. Audio simply has no posterSrcs.
            mediaKind: isAudio ? ("audio" as const) : ("video" as const),
            name: displayName,
            src: asset.url,
            fullDurationSeconds: sourceSeconds,
            trimInSeconds: 0,
            // Trims are AMOUNTS REMOVED from each end, not offsets into the
            // source — `mediaDurationSeconds` computes `full - trimIn -
            // trimOut`, so an untrimmed clip is 0/0. Passing the play length
            // straight through as `trimOutSeconds` trimmed the whole clip away
            // and packed it at zero width.
            trimOutSeconds: Math.max(
              0,
              sourceSeconds - Math.min(item.durationSeconds ?? sourceSeconds, sourceSeconds),
            ),
          }
        : {
            id: nodeId,
            kind: "media" as const,
            mediaKind: "image" as const,
            name: displayName,
            src: asset.url,
            durationSeconds: item.durationSeconds ?? DEFAULT_IMAGE_SECONDS,
          };

    const detail = {
      alt: displayName,
      // An explicit `name` argument is an AUTHORED title, so record it as one.
      // Cards render `title` and never `alt` — deliberately, so a library of
      // machine-named clips does not read as a rename backlog — which meant a
      // caller-supplied name was accepted, stored as `alt`, and shown nowhere.
      //
      // It matters most for AUDIO: an audio card has no thumbnail, so the title
      // is the only thing distinguishing one take from another.
      ...(item.name?.trim() ? { title: item.name.trim() } : {}),
      // MEASURED, not assumed. The listing has carried `width`/`height` all
      // along; this asked for neither and stamped 16:9 on everything.
      // Audio has no dimensions, so it keeps the default — nothing reads a
      // sound's aspect, and a card still needs a box.
      aspect: aspectFromDimensions(asset.width, asset.height) ?? 16 / 9,
      trackIndex: 0,
      sourceAsset: { providerId: CLOUDINARY_PROVIDER_ID, assetId: asset.pathname },
      // Tagged at mint time so agent-uploaded media arrives filed. This is the
      // only chance to do it automatically — a clip that lands untagged stays
      // untagged until someone opens it by hand.
      ...tagsField(item.tags),
      // No poster for audio: Cloudinary would mint a still-frame jpg URL for a
      // resource that has no frames, and it renders broken.
      ...(!isAudio && asset.thumbnailUrl ? { poster: asset.thumbnailUrl } : {}),
    };

    return { nodeId, node, detail, displayName, asset };
  });

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
      // Placement is resolved for the FIRST node; `add-nodes` inserts the whole
      // array at that index, so a batch lands consecutively in the order given
      // rather than reversed or scattered.
      const placement = resolveMovePlacement(graph, {
        nodeId: prepared[0]!.nodeId,
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
          nodes: prepared.map((entry) => entry.node),
        },
        // PROVENANCE — not optional. `graphChildrenToClips` reads sourceAsset
        // from details, not the node, so without this a clip is written with no
        // provenance, is never marked for reclaim, and its file leaks in
        // storage forever (docs/asset-providers.md).
        details: Object.fromEntries(
          prepared.map((entry) => [entry.nodeId as string, entry.detail]),
        ),
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

  const attached = prepared.map((entry, offset) => ({
    nodeId: entry.nodeId as string,
    toIndex: placedIndex + offset,
    src: entry.asset.url,
    sourceAsset: { providerId: CLOUDINARY_PROVIDER_ID, assetId: entry.asset.pathname },
  }));

  // The single-file response shape is UNCHANGED, so every existing caller keeps
  // reading the same fields; a batch adds `attached` alongside them.
  const first = prepared[0]!;
  return toolOk(
    prepared.length === 1
      ? `Added "${first.displayName}" to ${placedParent} at index ${placedIndex}.`
      : `Added ${prepared.length} clips to ${placedParent} from index ${placedIndex}.`,
    {
      nodeId: first.nodeId as string,
      toParentId: placedParent,
      toIndex: placedIndex,
      src: first.asset.url,
      sourceAsset: { providerId: CLOUDINARY_PROVIDER_ID, assetId: first.asset.pathname },
      ...(prepared.length === 1 ? {} : { attached }),
      written: outcome.affectedIds,
    },
  );
}
