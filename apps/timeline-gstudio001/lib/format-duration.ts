// ONE duration vocabulary for the graph view (PL11-009).
//
// There were four near-copies of the same rule — the board's aggregate, the
// collection card's badge, the ruler's tick labels, and a scatter of raw
// `toFixed(2)` — so the same timeline could read "52.9s" in one place, "6:32"
// in another and "1m 24s" in a third within one glance. Numbers that change
// shape between neighbouring pixels stop feeling like measurements.
//
// Two registers, and the split is deliberate rather than an oversight:
//
//   READING  — "how long is this?" Rounded, clock-like past a minute, and
//              never more precision than the eye can use.
//   EDITING  — "what exactly am I setting?" Hundredths, always in seconds,
//              because an in-point of 1:02 is not something you can type back.
//
// Anything a user can EDIT gets the editing form; anything they merely read
// gets the reading form.

/**
 * Reading: "0:04", "0:25", "1:23", "1:02:03".
 *
 * CLOCK NOTATION AT EVERY LENGTH. This used to switch to "25.3s" below a
 * minute, which put two vocabularies on one board: a project read
 * "Scenes 1:29 / Locations 25.3s" and the eye had to change units between
 * neighbouring cards to compare them. The split was meant to keep short
 * durations precise, but precision is the EDITING register's job — anything a
 * user can type back gets `formatSeconds`, in hundredths, always in seconds.
 * What is merely read gets one shape.
 */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = Math.round(safe % 60);
  // Rounding 59.6s up must not print ":60".
  const carried = rest === 60;
  const shownRest = carried ? 0 : rest;
  const shownMinutes = carried ? minutes + 1 : minutes;
  if (hours > 0) {
    return `${hours}:${String(shownMinutes).padStart(2, "0")}:${String(shownRest).padStart(2, "0")}`;
  }
  return `${shownMinutes}:${String(shownRest).padStart(2, "0")}`;
}

/** Editing: "12.40s" — hundredths, always seconds, never clock notation. */
export function formatSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) ? seconds : 0;
  return `${safe.toFixed(2)}s`;
}

/**
 * Ruler ticks: the reading form, minus the trailing ".0" on whole seconds.
 * A tick every second reading "1.0s 2.0s 3.0s" is a column of noise; the
 * fractional tiers (½s, ¼s) still need their decimal.
 */
export function formatTick(seconds: number): string {
  if (seconds < 60) {
    return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
  }
  return formatDuration(seconds);
}
