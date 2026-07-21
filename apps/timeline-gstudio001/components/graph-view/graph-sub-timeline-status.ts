/**
 * Pure status derivation for a sub-timeline row's pending badge.
 *
 * Split out of `graph-sub-timelines.tsx` (a `.tsx` the app's vitest cannot
 * parse) so the three-way label logic is unit-testable in isolation.
 *
 * A row lazily hydrates its clips on first expand. Three outcomes matter:
 *   - `idle`    — collapsed, or expanded and already hydrated: no badge.
 *   - `loading` — expanded, genuinely in flight (attempt not yet failed).
 *   - `failed`  — expanded, an attempt finished without hydrating. Without
 *                 this the row claimed "loading…" forever on a document that
 *                 could never load (see graph-hydration's failure paths).
 */
export type SubTimelineRowStatus = "idle" | "loading" | "failed";

export function subTimelineRowStatus(
  input: Readonly<{ expanded: boolean; hydrated: boolean; failed: boolean }>,
): SubTimelineRowStatus {
  if (!input.expanded || input.hydrated) return "idle";
  return input.failed ? "failed" : "loading";
}

/** The badge copy for each non-idle status (`idle` renders no badge). */
export function subTimelineRowStatusLabel(
  status: Exclude<SubTimelineRowStatus, "idle">,
): string {
  return status === "failed" ? "couldn't load — collapse and expand to retry" : "loading…";
}
