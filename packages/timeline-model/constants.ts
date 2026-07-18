// Packing constants — part of the stored model, not the view: startTimes in
// persisted documents are derived from these (see packTimelineClips), so the
// server's read-time summary derivation and every client must agree on them.

export const CLIP_GAP_SECONDS = 0.12;

// Gives the first clips room to grow left before hitting time 0.
export const TIMELINE_LEADING_PADDING_SECONDS = 0;
export const TIMELINE_TRAILING_PADDING_SECONDS = 0;
