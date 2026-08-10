import { timingSafeEqual } from "node:crypto";

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import { MAX_TAGS_PER_CLIP } from "@storyboard/timeline-model/tags";

import { TIMELINE_APP_HTML } from "@storyboard/timeline-widget";

import { listFirebaseTimelineProjects } from "@/lib/firebase-timeline-store";
import type { ToolResult } from "@/lib/webmcp/types";
import { attachMedia, createUploadTicket } from "@/lib/mcp/upload";
import { createCollection } from "@/lib/mcp/create-collection";
import { handleReadTimeline } from "@/lib/mcp/read-timeline";
import {
  intoField,
  nameField,
  nodeIdField,
  placementFields,
  trimFields,
} from "@/lib/webmcp/tool-fields";
import { ProjectAssetScopeError } from "@/lib/project-asset-scope";
import {
  handleMoveClip,
  handleRemoveClip,
  handleRenameItem,
  handleTrimClip,
  NO_LIVE_PUSH_NOTE,
} from "@/lib/mcp/write-handlers";
import { MCP_SCOPE, getSigningSecret, verifyAccessToken } from "@/lib/oauth/core";
import { mcpResourceUrl, originFromRequest } from "@/lib/oauth/metadata";

// Remote MCP endpoint — the "give Claude a URL" surface, distinct from the
// in-page WebMCP tools (see docs/webmcp-agent-tools.md). Those run in the
// browser against the live CollectionsStore; these run server-side against
// Firestore, so an agent can read the project with no browser open.
//
// Started read-only on purpose — a publicly reachable endpoint over real user
// data proved transport + auth first. Writes were added on top of that once the
// auth path was settled; they go through `lib/mcp/apply-command.ts`, which runs
// the same collections reducer the browser does and persists with revision CAS.
//
// One behavioural difference worth knowing: this transport has NO real-time
// push, so a write here does not reach a tab that is already open until it
// reloads. Every write tool says so in its description.
//
// TWO auth paths, both yielding the uid the tools act as:
//   1. OAuth 2.1 access token (claude.ai custom connector) — uid from `sub`.
//   2. Static bearer token (Claude Code / mcp-remote) — uid from MCP_OWNER_UID.
// The static path stays because it's already wired up; it is only active when
// both its env vars are set, and OAuth is tried first.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The SAME UI bundle, registered twice because the two ecosystems disagree on
// the MIME type: MCP Apps uses `text/html;profile=mcp-app`, while ChatGPT only
// renders `text/html+skybridge` and requires its `openai/outputTemplate` to
// name a resource it can read. A resource carries one MIME type, so one URI
// can't satisfy both — two registrations over one HTML string is the cheapest
// honest fix, and each `_meta` key points at its own dialect.
const TIMELINE_APP_URI = "ui://storyboard/timeline.html";
const TIMELINE_APP_URI_OPENAI = "ui://storyboard/timeline-openai.html";

// MCP Apps constants, declared here rather than imported from
// `@modelcontextprotocol/ext-apps/server`. That package peer-requires SDK
// ^1.29 while `mcp-handler` pins exactly 1.26.0, so importing its server
// helpers drags in a SECOND copy of the SDK — and two SDK instances in one
// process is a real runtime hazard, not just a type error. The helpers only
// normalize these two values, so emitting them directly keeps a single SDK.
// The client bundle still uses ext-apps, but it lives in its own workspace
// (`@storyboard/timeline-widget`) and Vite resolves it in isolation, so the
// server never sees that dependency.
const UI_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const UI_RESOURCE_META_KEY = "ui/resourceUri";
/** ChatGPT's Apps SDK renders only this MIME type. */
const OPENAI_WIDGET_MIME_TYPE = "text/html+skybridge";

// Hosts render the widget in a sandboxed iframe whose CSP blocks external
// origins unless the resource declares them. Thumbnails come straight from the
// stored clip URLs, so without this every card renders as a broken image.
// `resourceDomains` covers scripts/styles/images; no connectDomains, because
// the view fetches data through the host bridge rather than the network.
const WIDGET_IMAGE_DOMAINS = ["https://res.cloudinary.com", "https://picsum.photos"];
const WIDGET_UI_META = {
  ui: { csp: { resourceDomains: WIDGET_IMAGE_DOMAINS } },
  // ChatGPT reads its own CSP key.
  "openai/widgetCSP": {
    resource_domains: WIDGET_IMAGE_DOMAINS,
    connect_domains: [],
  },
} as const;

/** Constant-time compare that can't leak length via early return. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function jsonResult(summary: string, payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: summary },
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Adapt a shared handler's `ToolResult` to what the MCP SDK accepts.
 *
 * `lib/webmcp/types.ts` declares `content` readonly on purpose — those results
 * are shared values and nothing should mutate one in place. The SDK's callback
 * type wants a mutable array, so copy it here rather than loosening the shared
 * type for every other caller.
 */
function fromToolResult(result: ToolResult) {
  // The SDK types `structuredContent` as a plain object; the shared ToolResult
  // types it `unknown` so in-page tools can return anything. Only forward it
  // when it actually is an object — a primitive or null would not survive the
  // JSON-RPC shape anyway.
  const structured =
    typeof result.structuredContent === "object" && result.structuredContent !== null
      ? (result.structuredContent as Record<string, unknown>)
      : undefined;
  return {
    content: result.content.map((block) => ({ type: block.type, text: block.text })),
    ...(result.isError === undefined ? {} : { isError: result.isError }),
    ...(structured === undefined ? {} : { structuredContent: structured }),
  };
}

/**
 * The uid this call acts as, taken from the verified token — never from tool
 * arguments, so one authenticated caller can't read another account's data.
 */
function uidFrom(extra: { authInfo?: { extra?: Record<string, unknown> } }): string | null {
  const uid = extra.authInfo?.extra?.uid;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

const NO_IDENTITY = "Could not determine the account for this token.";

/**
 * REMOTE-ONLY, and deliberately not in the shared field module.
 *
 * The in-page tools act on the focused timeline, which the browser already
 * knows. Server-side there is no focus, so every call must name the root whose
 * closure gets loaded — and that root must contain every node the call touches.
 */
const TIMELINE_ID_FIELD = z
  .string()
  .min(1)
  .describe("The timeline document that contains the item.");

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_projects",
      "List the owner's timeline projects: id, title, clip count, and last-updated time. Start here to find a project id for read_timeline.",
      {},
      async (_args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);

        const projects = await listFirebaseTimelineProjects(uid);
        const summary =
          projects.length === 0
            ? "No timeline projects."
            : `${projects.length} project${projects.length === 1 ? "" : "s"}: ${projects
                .slice(0, 10)
                .map((p) => `${p.title} (${p.clipCount} clips, id ${p.id})`)
                .join("; ")}${projects.length > 10 ? "…" : ""}`;
        return jsonResult(summary, { projects });
      },
    );

    server.tool(
      "read_timeline",
      "Read one timeline document by id — its title and full ordered clip list. Ids come from list_projects, or from a collection clip's childTimelineId when drilling into a nested timeline.",
      { timelineId: z.string().min(1).describe("Timeline document id.") },
      async ({ timelineId }, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);

        return fromToolResult(await handleReadTimeline({ timelineId }, { requesterUid: uid }));
      },
    );

    // --- Write tools --------------------------------------------------------
    //
    // Server-side edits against stored documents, via lib/mcp/apply-command.ts.
    // Every one takes an explicit `timelineId` because there is no "focused"
    // timeline without a browser — it is the root whose closure gets loaded, and
    // it must contain every node the call touches.

    server.tool(
      "move_clip",
      "Move a clip or collection: reorder it within its current collection, or put it inside another one. Give at most one of `after`, `before` or `position`." +
        NO_LIVE_PUSH_NOTE,
      {
        timelineId: TIMELINE_ID_FIELD,
        nodeId: nodeIdField,
        into: intoField,
        ...placementFields,
      },
      async (args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        return fromToolResult(await handleMoveClip(args, { requesterUid: uid }));
      },
    );

    server.tool(
      "trim_clip",
      "Change how much of a clip plays. Videos take `trimInSeconds`/`trimOutSeconds` (seconds REMOVED from each end — an untrimmed clip is 0/0); images take `durationSeconds`." +
        NO_LIVE_PUSH_NOTE,
      {
        timelineId: TIMELINE_ID_FIELD,
        nodeId: nodeIdField,
        ...trimFields,
      },
      async (args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        return fromToolResult(await handleTrimClip(args, { requesterUid: uid }));
      },
    );

    server.tool(
      "rename_item",
      "Rename a clip or a collection. Renaming a collection also retitles its own timeline document, so the board and the project list agree." +
        NO_LIVE_PUSH_NOTE,
      {
        timelineId: TIMELINE_ID_FIELD,
        nodeId: nodeIdField,
        name: nameField,
      },
      async (args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        return fromToolResult(await handleRenameItem(args, { requesterUid: uid }));
      },
    );

    server.tool(
      "remove_clip",
      "Move a clip OR a collection to the trash. This is recoverable — nothing is hard-deleted, so it can be restored from the bin." +
        NO_LIVE_PUSH_NOTE,
      {
        timelineId: TIMELINE_ID_FIELD,
        nodeId: nodeIdField,
        trashId: z
          .string()
          .min(1)
          .optional()
          .describe("Rarely needed — defaults to your own bin, which is where removals go."),
      },
      async (args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        return fromToolResult(await handleRemoveClip(args, { requesterUid: uid }));
      },
    );

    server.tool(
      "create_collection",
      "Create a new, empty collection (a nested timeline) inside a project or another collection. Returns its id — pass that as `timelineId` to put clips inside it. Give at most one of `after`, `before` or `position`." +
        NO_LIVE_PUSH_NOTE,
      {
        timelineId: z.string().min(1).describe("Timeline document to create it in."),
        name: z.string().min(1).describe("Name for the new collection."),
        into: z
          .string()
          .optional()
          .describe("Nest it inside this collection. Omit for the timeline itself."),
        after: z.string().optional().describe("Place directly after this sibling."),
        before: z.string().optional().describe("Place directly before this sibling."),
        position: z.enum(["start", "end"]).optional().describe("Place at the start or end."),
      },
      async (args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        return fromToolResult(await createCollection(args, uid));
      },
    );

    // --- Bringing a new file in ---------------------------------------------
    //
    // Two calls, and the bytes are in neither. `create_upload` mints a signed,
    // scoped ticket; the caller POSTs the file straight to Cloudinary; then
    // `attach_media` verifies it landed and mints the clip. See lib/mcp/upload.ts.

    server.tool(
      "create_upload",
      "Start uploading a local media file (mp4, webm, mov, jpg, png, webp). Returns a short-lived signed ticket: POST the file to `uploadUrl` as multipart/form-data with every field from `fields` plus the file itself as `file`. Then call attach_media with the returned publicId. The file's bytes never pass through this tool.",
      {
        projectId: z.string().min(1).describe("Project the asset belongs to."),
        filename: z.string().min(1).describe("Original filename, used to name the stored asset."),
      },
      async (args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        try {
          const ticket = await createUploadTicket(args, uid);
          return jsonResult(
            `Upload ticket for "${args.filename}" (${ticket.resourceType}). POST the file to ${ticket.uploadUrl} with the given fields, then call attach_media with publicId "${ticket.publicId}". Expires ${ticket.expiresAt}.`,
            ticket,
          );
        } catch (error) {
          if (error instanceof ProjectAssetScopeError) return errorResult(error.message);
          return errorResult(error instanceof Error ? error.message : "Could not create an upload.");
        }
      },
    );

    server.tool(
      "attach_media",
      "Add an already-uploaded file to a timeline as a clip. Verifies the upload landed, then places it — give at most one of `after`, `before` or `position`." +
        NO_LIVE_PUSH_NOTE,
      {
        timelineId: z.string().min(1).describe("Timeline document to add the clip to."),
        projectId: z.string().min(1).describe("Project the asset was uploaded under."),
        publicId: z.string().min(1).describe("`publicId` returned by create_upload."),
        into: z
          .string()
          .optional()
          .describe("Collection to place it in. Omit for the timeline itself."),
        name: z.string().optional().describe("Name for the clip. Defaults to the filename."),
        after: z.string().optional().describe("Place directly after this sibling."),
        before: z.string().optional().describe("Place directly before this sibling."),
        position: z.enum(["start", "end"]).optional().describe("Place at the start or end."),
        durationSeconds: z
          .number()
          .positive()
          .optional()
          .describe("How long it plays. Defaults to the video's full length, or 3s for a still."),
        tags: z
          .array(z.string())
          .max(MAX_TAGS_PER_CLIP)
          .optional()
          .describe(
            "Labels to file this clip under, for finding it again later — what generated it, " +
              "which checkpoint, which shot, its status. Free-form, e.g. " +
              '["scail-2", "wan2.1", "S02", "keeper"]. Duplicates, blanks and stray whitespace ' +
              "are cleaned up, and matching ignores case.",
          ),
      },
      async (args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        try {
          return fromToolResult(await attachMedia(args, uid));
        } catch (error) {
          if (error instanceof ProjectAssetScopeError) return errorResult(error.message);
          throw error;
        }
      },
    );

    // --- MCP Apps: an interactive timeline view -----------------------------
    //
    // The UI bundle is served as a ui:// resource and rendered by the host in a
    // sandboxed iframe. It is SELF-SUFFICIENT: the host's ui/initialize result
    // carries no tool arguments, so the view calls list_projects/read_timeline
    // itself over the bridge rather than being handed data.

    server.registerResource(
      "Storyboard timeline view",
      TIMELINE_APP_URI,
      { mimeType: UI_RESOURCE_MIME_TYPE },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: UI_RESOURCE_MIME_TYPE,
            text: TIMELINE_APP_HTML,
            _meta: WIDGET_UI_META,
          },
        ],
      }),
    );

    // Same bundle, ChatGPT's dialect.
    server.registerResource(
      "Storyboard timeline view (ChatGPT)",
      TIMELINE_APP_URI_OPENAI,
      {
        mimeType: OPENAI_WIDGET_MIME_TYPE,
        _meta: {
          "openai/widgetDescription":
            "A visual timeline of the storyboard's clips, sized by duration.",
        },
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: OPENAI_WIDGET_MIME_TYPE,
            text: TIMELINE_APP_HTML,
            _meta: WIDGET_UI_META,
          },
        ],
      }),
    );

    server.registerTool(
      "show_timeline",
      {
        description:
          "Show the storyboard timeline as an interactive visual strip — clips laid out proportionally by duration, with thumbnails. Use this when the user wants to SEE the timeline rather than read it.",
        inputSchema: {
          timelineId: z
            .string()
            .optional()
            .describe("Project or timeline id to open. Omit to let the view pick."),
        },
        _meta: {
          // All three spellings point at the same resource so one server
          // renders everywhere: hosts are required to accept both the nested
          // and flat forms of the standard key, and ChatGPT reads its own.
          ui: { resourceUri: TIMELINE_APP_URI },
          [UI_RESOURCE_META_KEY]: TIMELINE_APP_URI,
          // Must name the skybridge-typed resource, or ChatGPT won't render.
          "openai/outputTemplate": TIMELINE_APP_URI_OPENAI,
        },
      },
      async (_args, extra) => {
        const uid = uidFrom(extra);
        if (!uid) return errorResult(NO_IDENTITY);
        // The visual is the point, but return text too so the model still has
        // something to reason about without reading the iframe.
        const projects = await listFirebaseTimelineProjects(uid);
        return {
          content: [
            {
              type: "text" as const,
              text: `Opened the timeline view (${projects.length} project${
                projects.length === 1 ? "" : "s"
              } available).`,
            },
          ],
        };
      },
    );
  },
  {},
  { basePath: "/api", maxDuration: 60 },
);

/**
 * Returning `undefined` denies; mcp-handler answers 401 with the
 * WWW-Authenticate challenge pointing at the protected-resource metadata,
 * which is how a client discovers the OAuth server. Unconfigured servers deny
 * rather than falling open.
 */
const authedHandler = withMcpAuth(
  handler,
  (request, bearerToken) => {
    if (!bearerToken) return undefined;

    // 1. OAuth access token. Audience is bound to THIS deployment's MCP URL,
    //    so a token minted for another resource can't be replayed here.
    const signingSecret = getSigningSecret();
    if (signingSecret) {
      const audience = mcpResourceUrl(originFromRequest(request));
      const verified = verifyAccessToken(bearerToken, signingSecret, audience);
      if (verified.ok) {
        return {
          token: bearerToken,
          clientId: verified.claims.client_id,
          scopes: verified.claims.scope.split(/\s+/).filter(Boolean),
          extra: { uid: verified.claims.sub },
        };
      }
    }

    // 2. Static bearer fallback (Claude Code / mcp-remote).
    const staticToken = process.env.MCP_BEARER_TOKEN?.trim();
    const staticUid = process.env.MCP_OWNER_UID?.trim();
    if (staticToken && staticUid && secretsMatch(bearerToken, staticToken)) {
      return {
        token: bearerToken,
        clientId: "storyboard-flow-mcp",
        scopes: [MCP_SCOPE],
        extra: { uid: staticUid },
      };
    }

    return undefined;
  },
  { required: true, requiredScopes: [MCP_SCOPE] },
);

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
