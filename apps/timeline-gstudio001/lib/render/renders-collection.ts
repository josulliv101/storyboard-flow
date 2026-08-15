import type { TimelineClip } from "@storyboard/timeline-model/types";

/**
 * Where finished renders land: a collection named "Renders" at the top of the
 * project, which is the convention this project already follows for finished
 * cuts.
 *
 * Resolved BY NAME rather than by a configured id. A hardcoded id would tie
 * the app to one owner's project, and an env var would be one more thing to
 * set correctly before an export could work at all. A name is self-configuring
 * — it finds an existing Renders collection, and creates one if there is none.
 */
export const RENDERS_COLLECTION_NAME = "Renders";

/**
 * The child timeline id of the project's Renders collection, or null.
 *
 * Matches case-insensitively on the trimmed title, because this name is typed
 * by a human: "renders" and "Renders " are the same intent, and creating a
 * second collection because of a capital letter is the kind of thing that
 * quietly splits a project's output in two.
 *
 * OWNING PLACEMENTS ONLY. A collection clip whose id differs from its
 * `childTimelineId` is a duplicate REFERENCE to a collection that lives
 * somewhere else — writing renders into it would file them under a timeline
 * this project does not own, and the first one would look fine.
 *
 * Direct children only, not a recursive search: "the project's Renders
 * collection" is a specific place, and a nested one belonging to some scene is
 * a different thing that happens to share a name.
 */
export function findRendersCollectionId(clips: readonly TimelineClip[]): string | null {
  for (const clip of clips) {
    if (clip.kind !== "collection") continue;
    if (clip.childTimelineId !== clip.id) continue;
    if (clip.title.trim().toLowerCase() !== RENDERS_COLLECTION_NAME.toLowerCase()) continue;
    return clip.childTimelineId;
  }
  return null;
}

/**
 * A name for the finished file, as it will read on the card.
 *
 * The timestamp is the point: renders accumulate, they are all of the same
 * timeline, and "Render" repeated eleven times tells you nothing about which
 * one you just made. Sortable form (YYYY-MM-DD HH:MM) so the collection reads
 * in the order the cuts were made.
 */
export function renderClipName(timelineTitle: string, madeAtIso: string): string {
  const stamp = madeAtIso.slice(0, 16).replace("T", " ");
  const base = timelineTitle.trim() || "Timeline";
  return `${base} — ${stamp}`;
}
