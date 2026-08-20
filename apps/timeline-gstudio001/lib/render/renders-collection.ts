import type { TimelineClip } from "@storyboard/timeline-model/types";

/**
 * The name a Renders collection is CREATED with, and the one the fallback
 * below recognises.
 *
 * Not a configured id and not an env var, for the reasons that have always
 * applied: a hardcoded id would tie the app to one owner's project, and an env
 * var would be one more thing to set correctly before an export could work at
 * all. Self-configuring is the property worth keeping.
 *
 * WHAT CHANGED IS THAT THE NAME IS NO LONGER THE IDENTITY. It is a default and
 * a legacy fallback; `role: "renders"` on the clip is what actually resolves
 * the collection now. So this string may be renamed by a person without
 * anything breaking, which is the whole point (#464).
 */
export const RENDERS_COLLECTION_NAME = "Renders";

/** The marker that identifies the collection, independent of what it is
 *  called. See `CollectionTimelineClip["role"]`. */
export const RENDERS_COLLECTION_ROLE = "renders" as const;

/**
 * How the collection was identified — which is worth reporting rather than
 * hiding, because it is what the caller needs to decide whether to stamp.
 *
 * `"role"` is the answer this function wants to give. `"title"` means it fell
 * back, and the caller should mark the clip so the next lookup does not have
 * to (see `attachRenderOutput`).
 */
export type RendersCollectionMatch = Readonly<{
  id: string;
  matchedBy: "role" | "title";
}>;

/**
 * The project's Renders collection, or null.
 *
 * TWO PASSES, AND THE ORDER IS THE FIX. The role marker wins outright; the
 * title is consulted only when nothing carries one. That ordering is what
 * makes a rename safe — a marked collection keeps receiving renders under any
 * name — and it has to be two full passes rather than one loop preferring a
 * role, because a project mid-migration can hold both: the real (marked)
 * Renders collection sitting after some other collection a person happened to
 * name "Renders". Deciding on the first match in document order would hand
 * that project's output to the impostor, which is one of the two bugs this
 * exists to close.
 *
 * The title pass keeps matching case-insensitively on the trimmed name,
 * because that name was typed by a human: "renders" and "Renders " are the
 * same intent, and creating a second collection over a capital letter is the
 * kind of thing that quietly splits a project's output in two.
 *
 * OWNING PLACEMENTS ONLY, in both passes. A collection clip whose id differs
 * from its `childTimelineId` is a duplicate REFERENCE to a collection that
 * lives somewhere else — writing renders into it would file them under a
 * timeline this project does not own, and the first one would look fine.
 *
 * Direct children only, not a recursive search: "the project's Renders
 * collection" is a specific place, and a nested one belonging to some scene is
 * a different thing that happens to share a name.
 */
export function findRendersCollection(
  clips: readonly TimelineClip[],
): RendersCollectionMatch | null {
  for (const clip of clips) {
    if (clip.kind !== "collection") continue;
    if (clip.childTimelineId !== clip.id) continue;
    if (clip.role !== RENDERS_COLLECTION_ROLE) continue;
    return { id: clip.childTimelineId, matchedBy: "role" };
  }
  for (const clip of clips) {
    if (clip.kind !== "collection") continue;
    if (clip.childTimelineId !== clip.id) continue;
    if (clip.title.trim().toLowerCase() !== RENDERS_COLLECTION_NAME.toLowerCase()) continue;
    return { id: clip.childTimelineId, matchedBy: "title" };
  }
  return null;
}

/** The id alone, for callers with nothing to decide. */
export function findRendersCollectionId(clips: readonly TimelineClip[]): string | null {
  return findRendersCollection(clips)?.id ?? null;
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
