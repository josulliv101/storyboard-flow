import { LOOKS, SECTIONS, SHOTS } from "./playbar-model";

/**
 * WHAT THE FILM STRIP NEEDS TO DRAW A SHOT (PL15-030).
 *
 * Deliberately small, and deliberately not the app's clip type. The strip is a
 * picture of a sequence — an id to report back, a length to be wide by, some
 * backgrounds to fill with, and the name of the run it belongs to. Everything
 * the graph knows about a clip beyond that is the caller's business.
 *
 * A FRAME IS A CSS BACKGROUND, which is the seam that lets the same component
 * take the reference's procedural gradients and the app's real posters without
 * knowing the difference. `url(…)` and `radial-gradient(…)` are the same kind
 * of value here.
 */
export type FilmStripShot = Readonly<{
  id: string;
  /** Shown on the box. The caller decides what a shot is called. */
  label: string;
  /** How long it runs on the sequence — its width, in seconds. */
  seconds: number;
  /** Backgrounds across the box, in order. One is a still. */
  frames: readonly string[];
  /** The run this shot belongs to; consecutive shots sharing one are a
   *  labelled section on the ruler. `null` is "no section". */
  sectionName: string | null;
  /**
   * WHAT THE STRIP NEEDS TO TRIM THIS SHOT, and its absence is what says the
   * shot cannot be trimmed at all (PL15-030).
   *
   * `seconds` above is the USED length — the box's width. Trimming needs the
   * two things a box cannot show: where in the source the used part begins,
   * and how much source there is to reach into. A still has neither and gets
   * no handle rather than a handle that quietly does nothing; the same
   * condition the store applies, which accepts a window for audio and video
   * and refuses everything else.
   */
  sourceSeconds?: number;
  trimInSeconds?: number;
}>;

/** A shot with its place on the clock worked out. */
export type PlacedShot = FilmStripShot & Readonly<{ start: number; end: number }>;

export type PlacedSection = Readonly<{
  name: string;
  start: number;
  end: number;
}>;

/** Lay shots end to end; the sequence's clock is their cumulative length. */
export function placeShots(shots: readonly FilmStripShot[]): readonly PlacedShot[] {
  let at = 0;
  return shots.map((shot) => {
    const start = at;
    at += shot.seconds;
    return { ...shot, start, end: at };
  });
}

/**
 * The labelled runs on the ruler: consecutive shots that name the same section.
 *
 * BY ADJACENCY, not by grouping — the same collection appearing twice with
 * something else between it is two runs on the ruler, because a label spanning
 * a gap would claim shots that are not its own.
 */
export function placeSections(placed: readonly PlacedShot[]): readonly PlacedSection[] {
  const sections: PlacedSection[] = [];
  for (const shot of placed) {
    if (shot.sectionName === null) continue;
    const last = sections[sections.length - 1];
    if (last !== undefined && last.name === shot.sectionName && last.end === shot.start) {
      sections[sections.length - 1] = { ...last, end: shot.end };
    } else {
      sections.push({ name: shot.sectionName, start: shot.start, end: shot.end });
    }
  }
  return sections;
}

/**
 * The reference's own sequence, as strip shots.
 *
 * The component's default, so the story and any surface without real data still
 * render the design exactly as the reference does.
 */
export const REFERENCE_SHOTS: readonly FilmStripShot[] = SHOTS.map((shot) => {
  const seconds = shot.end - shot.start;
  const section = SECTIONS.find((s) => shot.index >= s.first && shot.index <= s.last);
  return {
    id: String(shot.index),
    label: `SH ${String(shot.index + 1).padStart(2, "0")} · ${seconds.toFixed(1)}s`,
    seconds,
    frames: shot.frames.map((frame) => LOOKS[frame.look] ?? ""),
    sectionName: section?.name ?? null,
  };
});
