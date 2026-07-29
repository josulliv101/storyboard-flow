// How long a marked asset has left, as a number and as the words for it.
//
// Pure and isomorphic — the drawer renders these, and they are the one thing on
// that row a user might act on, so the rule they follow is worth stating once
// and testing rather than inlining a `Math.floor` at the call site.

/**
 * Whole days between now and the deadline, rounded UP, never below zero.
 *
 * Up, because the deadline is when deletion becomes ALLOWED and the sweep runs
 * daily: something with nineteen and a half days left is honestly described as
 * "20 days" and dishonestly as "19". Rounding the other way would let a row
 * read "0 days" while the file is still safe, which reads as "gone".
 */
export function daysUntilDeletion(deleteAfterMs: number, now: number = Date.now()): number {
  const remaining = deleteAfterMs - now;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}

/**
 * The words on the row.
 *
 * Zero says "any time now" rather than "0 days left" or "today": a due
 * tombstone is deleted by whenever the sweep next runs, which is a fact about
 * a cron schedule and not a promise anyone should read as a countdown. It is
 * also still recoverable at that point — the re-check spares anything back in
 * use — so the phrasing must not sound final either.
 */
export function deletionWindowLabel(deleteAfterMs: number, now: number = Date.now()): string {
  const days = daysUntilDeletion(deleteAfterMs, now);
  if (days === 0) return "Deletes any time now";
  if (days === 1) return "Deletes in 1 day";
  return `Deletes in ${days} days`;
}
