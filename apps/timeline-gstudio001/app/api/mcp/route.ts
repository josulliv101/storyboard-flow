import { timingSafeEqual } from "node:crypto";

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import { TIMELINE_APP_HTML } from "@/lib/mcp-apps/timeline-app-html";

import {
  getFirebaseTimelineDocument,
  listFirebaseTimelineProjects,
} from "@/lib/firebase-timeline-store";
import { MCP_SCOPE, getSigningSecret, verifyAccessToken } from "@/lib/oauth/core";
import { mcpResourceUrl, originFromRequest } from "@/lib/oauth/metadata";
import { TimelineAccessDeniedError } from "@/lib/timeline-ownership";

// Remote MCP endpoint — the "give Claude a URL" surface, distinct from the
// in-page WebMCP tools (see docs/webmcp-agent-tools.md). Those run in the
// browser against the live CollectionsStore; these run server-side against
// Firestore, so an agent can read the project with no browser open.
//
// READ-ONLY on purpose: a publicly reachable endpoint over real user data
// proves transport + auth before any write path exists.
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
// The client bundle still uses ext-apps (Vite resolves it in isolation).
const UI_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const UI_RESOURCE_META_KEY = "ui/resourceUri";
/** ChatGPT's Apps SDK renders only this MIME type. */
const OPENAI_WIDGET_MIME_TYPE = "text/html+skybridge";

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
 * The uid this call acts as, taken from the verified token — never from tool
 * arguments, so one authenticated caller can't read another account's data.
 */
function uidFrom(extra: { authInfo?: { extra?: Record<string, unknown> } }): string | null {
  const uid = extra.authInfo?.extra?.uid;
  return typeof uid === "string" && uid.length > 0 ? uid : null;
}

const NO_IDENTITY = "Could not determine the account for this token.";

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

        try {
          const document = await getFirebaseTimelineDocument(timelineId, uid);
          if (!document) return errorResult(`No timeline document with id "${timelineId}".`);

          const clips = document.clips ?? [];
          const summary = `"${document.title}" — ${clips.length} clip${
            clips.length === 1 ? "" : "s"
          }: ${
            clips
              .slice(0, 8)
              .map((clip) => (clip.kind === "collection" ? `${clip.title} (collection)` : clip.kind))
              .join(", ") || "(empty)"
          }${clips.length > 8 ? "…" : ""}`;
          return jsonResult(summary, { timeline: document });
        } catch (error) {
          // Ownership is enforced in the store; surface a refusal rather than
          // leaking whether the id exists under another account.
          if (error instanceof TimelineAccessDeniedError) {
            return errorResult(`Not authorized to read timeline "${timelineId}".`);
          }
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
          { uri: uri.href, mimeType: UI_RESOURCE_MIME_TYPE, text: TIMELINE_APP_HTML },
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
          { uri: uri.href, mimeType: OPENAI_WIDGET_MIME_TYPE, text: TIMELINE_APP_HTML },
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
