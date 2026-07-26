/**
 * How long ago a clip was trashed, for the trash drawer's row caption.
 *
 * Coarse on purpose. The question a person asks in the bin is "was this the
 * thing I just deleted, or something from last week?" — minutes matter for the
 * first hour and stop mattering entirely after that, so the resolution drops
 * as the age grows rather than printing "2 days, 4 hours" precision nobody
 * acts on. Past a week it switches to a date, because "23d ago" is arithmetic
 * the reader has to do.
 *
 * Pure and total: it runs against stored data, so a missing or unparseable
 * timestamp returns null and the caller simply prints nothing. A FUTURE
 * timestamp (clock skew between the writing client and the reading one, which
 * is a different machine often enough) reads as "just now" rather than
 * "-3m ago".
 */
export function formatTrashedAgo(
  trashedAt: string | undefined,
  now: Date = new Date(),
): string | null {
  if (!trashedAt) return null;
  const then = new Date(trashedAt);
  const thenMs = then.getTime();
  if (Number.isNaN(thenMs)) return null;

  const seconds = Math.floor((now.getTime() - thenMs) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days}d ago`;

  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The whole caption: where it came from, when it went. Either half may be
 * missing — clips trashed before this was recorded have neither, and a clip
 * trashed from a timeline whose name could not be read has only the time — so
 * the separator is only printed between two halves that both exist.
 */
export function trashRowCaption(
  trashedFrom: { title: string } | undefined,
  trashedAt: string | undefined,
  now?: Date,
): string | null {
  const when = formatTrashedAgo(trashedAt, now);
  const where = trashedFrom?.title ? `from ${trashedFrom.title}` : null;
  if (where && when) return `${where} · ${when}`;
  return where ?? when;
}
