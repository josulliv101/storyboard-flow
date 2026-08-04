import { describeTimelineForAgent } from "@/lib/mcp-timeline-summary";
import { serveTimelineDocument } from "@/lib/serve-timeline";
import { TimelineAccessDeniedError } from "@/lib/timeline-ownership";
import type { ToolResult } from "@/lib/webmcp/types";

// read_timeline — one stored timeline document, as an agent should see it.
//
// SERVE, DON'T READ RAW. Collection summaries — `itemCount`, `previewItems`,
// `duration` — are denormalized onto the PARENT's collection clip, and writes
// are patch-scoped: editing a child never touches the parent that summarizes
// it. `serveTimelineDocument` recomputes them across the whole closure, which
// is exactly what the app's own GET route and the RSC loaders do.
//
// `derive-collection-summaries.ts` justifies "served, never persisted" with
// "every view loads through the same GET route, so no reader ever sees a stale
// summary". That stopped being true the moment this endpoint became a SECOND
// reader. Reading the stored document directly showed an agent whatever was
// last written: a collection whose children are all collections reported
// `previewItems: []` (nothing ever writes preview frames that far up) and an
// `itemCount` left over from an earlier shape of the tree.
//
// Kept as its own module, like every other tool in this directory, so it can be
// tested without standing up the MCP handler — and so the serve path can't be
// quietly swapped back for a raw store read.

/** Both text blocks the tool returns: the sentence a model reads, then the
 *  machine-readable payload. Split out so the route stays a wiring layer. */
function readResult(summary: string, payload: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function readError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * @param requesterUid the uid from the verified token — never from tool args.
 */
export async function handleReadTimeline(
  { timelineId }: { timelineId: string },
  { requesterUid }: { requesterUid: string },
): Promise<ToolResult> {
  try {
    const served = await serveTimelineDocument(timelineId, requesterUid);
    if (!served) return readError(`No timeline document with id "${timelineId}".`);

    const document = served.document;
    return readResult(describeTimelineForAgent(document), { timeline: document });
  } catch (error) {
    // Ownership is enforced in the store; surface a refusal rather than
    // leaking whether the id exists under another account.
    if (error instanceof TimelineAccessDeniedError) {
      return readError(`Not authorized to read timeline "${timelineId}".`);
    }
    throw error;
  }
}
