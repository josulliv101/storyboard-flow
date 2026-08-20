// THE CUT'S OWN CLOCK: one continuous run of time across the clip being worked
// on and a little of each neighbour, so a cut can be scrubbed and played
// THROUGH rather than watched twice from either side.
//
// Pure and framework-free (a .ts, not a .tsx) so the app's vitest can parse it.
// Everything interesting here is arithmetic with edges — a neighbour shorter
// than the run-up, a missing neighbour at the ends of a timeline, a scrub
// landing exactly on a seam — and none of it needs a DOM to be wrong in.

/** A clip as this clock sees it: an id and how long it actually SHOWS. */
export type SeamClip = Readonly<{ id: string; showingSeconds: number }>;

/** One clip's stretch of the bar. */
export type SeamSpan = Readonly<{
  clipId: string;
  /** Bar seconds this span covers, `from` inclusive and `to` exclusive. */
  from: number;
  to: number;
  /**
   * Where inside the clip's SHOWING range this span starts.
   *
   * Zero for the centre clip and for the next one — both are entered at their
   * first frame. Non-zero for the previous clip, which is joined near its END:
   * a two-second run-up into a nine-second shot starts seven seconds in, and
   * that offset is the difference between playing the approach to the cut and
   * playing the wrong part of the shot entirely.
   */
  sourceOffset: number;
}>;

export type SeamTimeline = Readonly<{
  spans: readonly SeamSpan[];
  totalSeconds: number;
  /** Bar time where the centre clip starts — the first seam, and where the bar
   *  should sit when nothing has been scrubbed yet. */
  centreStart: number;
}>;

const EMPTY: SeamTimeline = { spans: [], totalSeconds: 0, centreStart: 0 };

/**
 * Build the bar: a run-up through the end of the previous clip, the whole of
 * the centre clip, then a run-out into the start of the next.
 *
 * THE CENTRE IS WHOLE AND THE NEIGHBOURS ARE NOT, which is the shape the view
 * asks for. The bar is for judging the two seams around one clip, so the clip
 * itself has to be reachable frame by frame while the neighbours only need to
 * supply enough material to hear the cut land. Spanning all three in full would
 * make the bar's scale a hostage to a neighbour's length — a nine-second bed
 * beside a half-second insert, and the insert is three pixels of bar.
 *
 * THE RUN-UP IS CLAMPED to what the neighbour actually has. A two-second lead
 * into a one-second clip is one second, not two seconds of nothing: the bar
 * must not contain time that cannot be played.
 *
 * A MISSING NEIGHBOUR CONTRIBUTES NOTHING rather than empty bar. At the start
 * and end of a timeline the bar is simply shorter, so the playhead cannot be
 * dragged into a void and the seam that does exist keeps its full scale.
 */
export function buildSeamTimeline(
  previous: SeamClip | null,
  centre: SeamClip | null,
  next: SeamClip | null,
  leadSeconds: number,
): SeamTimeline {
  if (centre === null || centre.showingSeconds <= 0) return EMPTY;
  const lead = Math.max(0, leadSeconds);

  const spans: SeamSpan[] = [];
  let cursor = 0;

  const runUp = previous ? Math.min(lead, Math.max(0, previous.showingSeconds)) : 0;
  if (previous && runUp > 0) {
    spans.push({
      clipId: previous.id,
      from: 0,
      to: runUp,
      // Joined near its END: the last `runUp` seconds of what it shows.
      sourceOffset: previous.showingSeconds - runUp,
    });
    cursor = runUp;
  }

  const centreStart = cursor;
  spans.push({
    clipId: centre.id,
    from: cursor,
    to: cursor + centre.showingSeconds,
    sourceOffset: 0,
  });
  cursor += centre.showingSeconds;

  const runOut = next ? Math.min(lead, Math.max(0, next.showingSeconds)) : 0;
  if (next && runOut > 0) {
    spans.push({ clipId: next.id, from: cursor, to: cursor + runOut, sourceOffset: 0 });
    cursor += runOut;
  }

  return { spans, totalSeconds: cursor, centreStart };
}

/** Which clip is on screen at `barSeconds`, and how far into it. */
export type SeamPosition = Readonly<{ clipId: string; clipSeconds: number }>;

/**
 * Resolve a bar time to a clip and a time inside it.
 *
 * A SEAM BELONGS TO THE CLIP THAT STARTS THERE, which is what `from` inclusive
 * and `to` exclusive buys: scrubbing onto the boundary shows the first frame of
 * the incoming clip rather than the last frame of the outgoing one. That is the
 * frame someone dragging to a cut is looking for — the answer to "what do I see
 * when this cut lands" — and picking the other rule makes the cut appear one
 * frame late everywhere it is measured.
 *
 * The very end of the bar is the one exception: there is no next span to hand
 * it to, so it resolves to the last clip's final moment rather than to nothing.
 */
export function seamAt(timeline: SeamTimeline, barSeconds: number): SeamPosition | null {
  if (timeline.spans.length === 0) return null;
  const time = Math.min(Math.max(barSeconds, 0), timeline.totalSeconds);

  for (const span of timeline.spans) {
    if (time >= span.from && time < span.to) {
      return { clipId: span.clipId, clipSeconds: span.sourceOffset + (time - span.from) };
    }
  }

  const last = timeline.spans[timeline.spans.length - 1]!;
  return {
    clipId: last.clipId,
    clipSeconds: last.sourceOffset + (last.to - last.from),
  };
}

/**
 * The stretch of bar a given clip owns, or null if it owns none.
 *
 * What each panel needs to draw its own playhead: a clip knows the bar time,
 * and this says whether that time is inside it and where. A panel outside the
 * run draws no line at all rather than a line pinned to one end, because a
 * playhead parked at a clip's edge reads as "playing here, at the very start",
 * which is a different and wrong claim from "not playing here".
 */
export function seamSpanFor(timeline: SeamTimeline, clipId: string): SeamSpan | null {
  return timeline.spans.find((span) => span.clipId === clipId) ?? null;
}

/**
 * How far through a clip's own SHOWING range the playhead is, 0–1, or null when
 * it is not inside that clip.
 *
 * Expressed against the clip's whole showing range rather than against the
 * span, because it positions a line on the trim strip — which draws the whole
 * trimmed clip, not just the part this bar reaches. A run-up covering the last
 * two seconds of a nine-second shot has to put its line near the RIGHT-HAND
 * END of that strip; measuring against the span would put it across the whole
 * width and claim the shot was being played from its start.
 */
export function seamProgressWithin(
  timeline: SeamTimeline,
  clip: SeamClip,
  barSeconds: number,
): number | null {
  const span = seamSpanFor(timeline, clip.id);
  if (span === null || clip.showingSeconds <= 0) return null;
  if (barSeconds < span.from || barSeconds > span.to) return null;
  const withinClip = span.sourceOffset + (barSeconds - span.from);
  return Math.min(1, Math.max(0, withinClip / clip.showingSeconds));
}
