// WHERE THE HOVER CARD SITS: under the pointer, or in one place.
//
// `follow` is the ordinary behaviour and the right default. The card names the
// box it is describing by being over it, so pointing at a shot and reading
// about that shot is one gesture with no lookup in the middle.
//
// `pinned` puts it in the centre under the bar and leaves it there. What that
// buys is a STEADY PICTURE: the card is now big enough to actually judge a
// frame in, and a big thing sliding around under a moving pointer is the one
// arrangement in which you cannot judge anything — the eye spends the whole
// sweep re-finding the picture instead of reading it. Pinned, the pointer
// scrubs and the picture changes in place, which is the shape of the task when
// you are hunting for a shot rather than checking one.
//
// The cost is the pairing: a card that is not over the box has to be read
// against a pointer somewhere else, so at a glance it is less obvious WHICH
// box it belongs to. That is why this is a setting and not a replacement —
// the two are better at different jobs and neither is better at both.

export const PREVIEW_ANCHORS = ["follow", "pinned"] as const;
export type PreviewAnchor = (typeof PREVIEW_ANCHORS)[number];

export function isPreviewAnchor(value: string): value is PreviewAnchor {
  return (PREVIEW_ANCHORS as readonly string[]).includes(value);
}

/**
 * The last anchor chosen, kept at module scope.
 *
 * Deliberately NOT persisted, for the same reason as the reach, the view count
 * and the frames style: it is a working posture for a session rather than a
 * preference. Held here rather than in the view that renders the control so
 * that closing the details modal and opening another clip does not reset it —
 * the modal unmounts, and state inside it would go with it.
 */
let remembered: PreviewAnchor = "follow";

export function lastPreviewAnchor(): PreviewAnchor {
  return remembered;
}

export function rememberPreviewAnchor(anchor: PreviewAnchor): void {
  remembered = anchor;
}
