import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

// The rail's shortcuts to a project's top-level collections.
//
// Pure, and separate from the component, because the rules are all edge cases:
// which id navigates, which frame stands for a collection, and what a project
// with nothing in it yet should show. Each of those is a decision worth a test
// rather than a line buried in JSX.

export type CollectionShortcut = Readonly<{
  /**
   * The CLIP's id, not `childTimelineId`, and the difference matters.
   *
   * `openTimeline` resolves `duplicateOfTimelineId ?? id` from the details
   * store, so the clip id is what lets a collection referenced from two places
   * open the placement you actually clicked. For an ordinary collection the two
   * ids are equal and either would work — which is exactly why this is worth
   * writing down, since the wrong one would look correct until someone made a
   * duplicate.
   */
  nodeId: string;
  title: string;
  /** A frame to stand for the collection, or undefined when it holds nothing
   *  with a picture yet. */
  thumbnail?: string;
  /** Alt text for that frame, from the preview item it came from. */
  thumbnailAlt?: string;
  itemCount: number;
}>;

function isCollection(
  clip: TimelineClip,
): clip is Extract<TimelineClip, { kind: "collection" }> {
  return clip.kind === "collection";
}

/**
 * The frame that stands for a collection: its FIRST preview item.
 *
 * First rather than "first with a poster" — the previews are already in the
 * collection's own order, and skipping one to find a prettier frame would
 * make the rail disagree with the card about which shot opens the collection.
 *
 * `poster` before `src` because a video's src is the whole file: pointing an
 * `<img>` at it downloads a clip to show one frame, times however many
 * collections a project has.
 */
function frameFor(
  clip: Extract<TimelineClip, { kind: "collection" }>,
): Pick<CollectionShortcut, "thumbnail" | "thumbnailAlt"> {
  const first = clip.previewItems?.[0];
  if (!first) return {};
  const thumbnail = first.poster ?? first.src;
  if (typeof thumbnail !== "string" || thumbnail.length === 0) return {};
  return { thumbnail, thumbnailAlt: first.alt };
}

/**
 * Every collection sitting directly in a document, in board order.
 *
 * TOP LEVEL ONLY. It does not walk down: these are shortcuts to the places a
 * project is divided into, and a flattened list of every collection anywhere
 * would be a different feature — a tree — competing with the board for the
 * same job.
 *
 * An empty result is the ordinary state of a new project, and the caller is
 * expected to render NOTHING for it: no group, and no separator above one.
 * A rule with nothing under it reads as something failing to load.
 */
export function collectionShortcuts(
  document: TimelineDocument | undefined | null,
): readonly CollectionShortcut[] {
  if (!document || !Array.isArray(document.clips)) return [];
  return document.clips.filter(isCollection).map((clip) => ({
    nodeId: clip.id,
    // Falls back to the alt text the adapter writes ("<name> collection") and
    // then to a placeholder, because a nameless button is unreachable by voice
    // and unreadable in the expanded rail.
    title: clip.title || clip.alt || "Untitled collection",
    itemCount: clip.itemCount,
    ...frameFor(clip),
  }));
}
