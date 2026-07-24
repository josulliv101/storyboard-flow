import { timingSafeEqual } from "node:crypto";

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import {
  getFirebaseTimelineDocument,
  listFirebaseTimelineProjects,
} from "@/lib/firebase-timeline-store";
import { TimelineAccessDeniedError } from "@/lib/timeline-ownership";

// Remote MCP endpoint — the "give Claude a URL" surface, distinct from the
// in-page WebMCP tools (see docs/webmcp-agent-tools.md). Those run in the
// browser against the live CollectionsStore; these run server-side against
// Firestore, so an agent can read the project with no browser open.
//
// READ-ONLY on purpose. This is a publicly reachable endpoint over real user
// data, so the first milestone proves transport + auth without exposing any
// write path. Mutations wait until the auth story is finished (see below).
//
// AUTH IS INTERIM. A single static bearer token identifying ONE owner uid,
// which is enough to drive from Claude Code / mcp-remote and prove the loop.
// claude.ai's custom-connector flow expects OAuth 2.1 + PKCE, so connecting
// there needs that built first — at which point `ownerUid()` stops being a
// fixed env var and starts being derived per authenticated user.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Constant-time compare that can't leak length via early return. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so gate on it — the length of
  // a rejected token is not itself sensitive.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The uid every tool reads as. Fixed while auth is a shared bearer token. */
function ownerUid(): string | undefined {
  return process.env.MCP_OWNER_UID?.trim() || undefined;
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

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_projects",
      "List the owner's timeline projects: id, title, clip count, and last-updated time. Start here to find a project id for read_timeline.",
      {},
      async () => {
        const uid = ownerUid();
        if (!uid) return errorResult("MCP_OWNER_UID is not configured on the server.");

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
      async ({ timelineId }) => {
        const uid = ownerUid();
        if (!uid) return errorResult("MCP_OWNER_UID is not configured on the server.");

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
  },
  {},
  { basePath: "/api", maxDuration: 60 },
);

/**
 * Bearer gate. Returning `undefined` denies the request; mcp-handler answers
 * with a 401 carrying the WWW-Authenticate challenge. A server missing either
 * env var denies everything rather than falling open.
 */
const authedHandler = withMcpAuth(
  handler,
  (_request, bearerToken) => {
    const expected = process.env.MCP_BEARER_TOKEN?.trim();
    const uid = ownerUid();
    if (!expected || !uid) return undefined;
    if (!bearerToken || !secretsMatch(bearerToken, expected)) return undefined;

    return {
      token: bearerToken,
      clientId: "storyboard-flow-mcp",
      scopes: ["timelines:read"],
      extra: { uid },
    };
  },
  { required: true, requiredScopes: ["timelines:read"] },
);

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
