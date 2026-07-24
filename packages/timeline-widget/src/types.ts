import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DisplayClip } from "@storyboard/timeline-model";

// What the view receives over the host bridge.
//
// The clip display contract comes from `@storyboard/timeline-model`. An earlier
// version of this file deliberately avoided that import to keep the bundle
// standalone — a sound instinct, but the cost landed elsewhere: this view
// re-derived what a clip LOOKS like (its thumbnail, its label) and drifted away
// from the app's own cards, and the widget's copy was the one that was wrong.
// The package is pure types and pure functions with ZERO dependencies, so
// importing it drags in no workspace graph and adds nothing to the bundle that
// the view wasn't already going to ship.
//
// These stay deliberately LOOSE about required fields: the payload arrives as
// JSON from a server route, so a field the stored model calls mandatory can
// still be missing on an old document. Display code must degrade, not throw.

export type { DisplayClip, DisplayPreviewItem } from "@storyboard/timeline-model";

export type Project = Readonly<{
  id: string;
  title: string;
  clipCount?: number;
  thumbnailUrl?: string;
  updatedAt?: string;
}>;

/** A clip as it arrives from `read_timeline`: the display contract plus the
 *  identity and navigation fields this view needs to drill into collections. */
export type TimelineClip = DisplayClip &
  Readonly<{
    id?: string;
    childTimelineId?: string;
    itemCount?: number;
    startTime?: number;
  }>;

export type Timeline = Readonly<{
  id: string;
  title: string;
  description?: string;
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
