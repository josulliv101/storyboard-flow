import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Minimal local shapes for what the tools return. Deliberately NOT imported
// from the app's timeline-model: this bundle is a standalone artifact rendered
// in someone else's iframe, and coupling it to the domain package would drag
// the workspace graph into a build that only needs a few display fields.

export type Project = Readonly<{
  id: string;
  title: string;
  clipCount?: number;
  thumbnailUrl?: string;
  updatedAt?: string;
}>;

export type PreviewItem = Readonly<{
  id?: string;
  kind?: string;
  src?: string;
  poster?: string;
  alt?: string;
}>;

export type TimelineClip = Readonly<{
  id?: string;
  kind: string;
  title?: string;
  alt?: string;
  src?: string;
  poster?: string;
  duration?: number;
  startTime?: number;
  itemCount?: number;
  previewItems?: readonly PreviewItem[];
}>;

export type Timeline = Readonly<{
  id: string;
  title: string;
  clips?: readonly TimelineClip[];
}>;

/**
 * The tools return a human summary as the first text block and the machine
 * payload as JSON in a later one. Parse the LAST block that is valid JSON, so
 * adding or rewording the summary can't break the view.
 */
export function parseToolJson(result: CallToolResult): Record<string, unknown> | null {
  const blocks = (result.content ?? []).filter(
    (block): block is { type: "text"; text: string } => block.type === "text",
  );
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(blocks[index].text) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // Not the JSON block — keep looking backwards.
    }
  }
  return null;
}
