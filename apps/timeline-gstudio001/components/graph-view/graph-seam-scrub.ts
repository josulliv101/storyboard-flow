// THE CUT'S OWN CLOCK: one continuous run of time across the clip being worked
// on and a little of each neighbour, so a cut can be scrubbed and played
// THROUGH rather than watched twice from either side.
//
// Pure and framework-free (a .ts, not a .tsx) so the app's vitest can parse it.
// Everything interesting here is arithmetic with edges — a neighbour shorter
// than the run-up, a missing neighbour at the ends of a timeline, a scrub
// landing exactly on a seam — and none of it needs a DOM to be wrong in.

/**
 * A clip as this clock sees it.
 *
 * TWO DURATIONS, because a trimmed clip lives in two spaces at once and the
 * view uses both. `showingSeconds` is what PLAYS — the trimmed length, and the
 * only thing the bar ever reaches. `fullSeconds` is what the trim strip DRAWS:
 * the whole source, with the showing part marked on it. Conflating them puts a
 * playhead in the wrong place while every number involved still looks right.
 */
export type SeamClip = Readonly<{
  id: string;
  /** Trimmed length — what the bar plays. */
  showingSeconds: number;
  /** Where the showing part starts inside the source. Defaults to 0. */
  trimInSeconds?: number;
  /** The whole source length. Defaults to `showingSeconds` — correct for media
   *  with no source window at all, like a still. */
  fullSeconds?: number;
  /**
   * A still of this clip, for the bar to label its own section with.
   *
   * The bar divides into one span per clip, and until this the only thing
   * distinguishing them was a hairline: you could see THAT the run of time was
   * three clips without seeing WHICH. A frame says it at a glance and needs no
   * legend.
   */
  posterSrc?: string;
}>;

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
  /** Carried through from the clip so the bar can label the span. */
  posterSrc?: string;
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
 * Build the bar: a lead into the clip truncated at the left edge, every fully
 * visible clip at its FULL length, then a lead out into the clip truncated at
 * the right edge.
 *
 * WHAT IS WHOLE ON SCREEN IS WHOLE ON THE BAR. That is the rule, and it falls
 * out of what the panels are showing: a clip you can see all of is a clip you
 * can reason about all of, so refusing to scrub past its first two seconds
 * makes the bar disagree with the picture. Only the two clips that are
 * themselves cut off by the edge of the screen get cut off here too.
 *
 * At three panels this is exactly the old behaviour — one whole clip between
 * two leads — which is the point: the rule generalises the three-up case
 * rather than replacing it. At nine it is seven whole clips between two leads.
 *
 * THE LEADS ARE CLAMPED to what the edge clip actually has. A two-second lead
 * into a half-second clip is half a second, not two seconds of nothing: the
 * bar must not contain time that cannot be played.
 *
 * A MISSING EDGE CONTRIBUTES NOTHING rather than empty bar. At the start and
 * end of a timeline the bar is simply shorter, so the playhead cannot be
 * dragged into a void and the clips that do exist keep their full scale.
 */
export function buildSeamTimeline(
  before: SeamClip | null,
  whole: readonly SeamClip[],
  after: SeamClip | null,
  leadSeconds: number,
  /** Which of `whole` is the clip the view was opened on. Only used to say
   *  where the bar should sit before anything has moved it. */
  centreIndex = 0,
): SeamTimeline {
  const playable = whole.filter((clip) => clip.showingSeconds > 0);
  if (playable.length === 0) return EMPTY;
  const lead = Math.max(0, leadSeconds);

  const spans: SeamSpan[] = [];
  let cursor = 0;

  const runUp = before ? Math.min(lead, Math.max(0, before.showingSeconds)) : 0;
  if (before && runUp > 0) {
    spans.push({
      clipId: before.id,
      posterSrc: before.posterSrc,
      from: 0,
      to: runUp,
      // Joined near its END: the last `runUp` seconds of what it shows, which
      // is the approach to the first cut on the bar.
      sourceOffset: before.showingSeconds - runUp,
    });
    cursor = runUp;
  }

  // Where the SUBJECT starts, which is where the bar rests until something
  // moves it. Clamped, because a centre index can outrun the playable list
  // once zero-length clips are dropped.
  let centreStart = cursor;
  const subject = Math.min(Math.max(0, centreIndex), playable.length - 1);

  playable.forEach((clip, index) => {
    if (index === subject) centreStart = cursor;
    spans.push({
      clipId: clip.id,
      posterSrc: clip.posterSrc,
      from: cursor,
      to: cursor + clip.showingSeconds,
      sourceOffset: 0,
    });
    cursor += clip.showingSeconds;
  });

  const runOut = after ? Math.min(lead, Math.max(0, after.showingSeconds)) : 0;
  if (after && runOut > 0) {
    spans.push({
      clipId: after.id,
      posterSrc: after.posterSrc,
      from: cursor,
      to: cursor + runOut,
      sourceOffset: 0,
    });
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
 * Where to draw the playhead on a clip's TRIM STRIP, 0-1 across that strip, or
 * null when the playhead is not inside the clip at all.
 *
 * MEASURED AGAINST THE WHOLE SOURCE, not against what is showing, because that
 * is what the strip is a picture of: `TrimOverviewStrip` renders the full
 * source across its width and marks the showing part as an amber window over
 * it. So the fraction that lands inside that window is
 * `(trimIn + howFarIn) / full` — and the showing fraction, which this returned
 * before, sweeps the ENTIRE strip including the dimmed material either side.
 * That reads exactly like being able to scrub past the trim, because the line
 * says so; the picture is fine and the line is lying about it.
 *
 * The run-up into the previous clip is what makes the offset visible: it covers
 * that clip's last seconds, so the line belongs near the RIGHT-HAND END of its
 * window. Against the raw showing fraction it starts at the window's left edge
 * and claims the shot is beginning.
 *
 * NULL OUTSIDE THE CLIP rather than pinned to an edge. A line parked at a
 * clip's start reads as "playing here, at the very beginning", which is a
 * different and wrong claim from "not playing here".
 */
export function seamStripProgress(
  timeline: SeamTimeline,
  clip: SeamClip,
  barSeconds: number,
): number | null {
  const span = seamSpanFor(timeline, clip.id);
  if (span === null || clip.showingSeconds <= 0) return null;
  if (barSeconds < span.from || barSeconds > span.to) return null;

  const trimIn = Math.max(0, clip.trimInSeconds ?? 0);
  const full = Math.max(clip.showingSeconds, clip.fullSeconds ?? clip.showingSeconds);
  if (full <= 0) return null;

  const withinShowing = span.sourceOffset + (barSeconds - span.from);
  const withinSource = trimIn + Math.min(Math.max(0, withinShowing), clip.showingSeconds);
  return Math.min(1, Math.max(0, withinSource / full));
}
