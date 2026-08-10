// The pure half of filtering the board by tag. Split from the React context so
// it can be tested directly — app vitest cannot parse .tsx, and these are the
// rules worth pinning: what counts as a miss, and how the filter menu is built.

/** The form tags are COMPARED in. Display keeps its own spelling. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * True when a filter is running and these tags do not satisfy it.
 *
 * A MISS rather than a match, because with no filter on every card must read
 * normally — the default has to be "not missed".
 *
 * OR across the active set, not AND. The question is "show me the SCAIL-2 takes
 * and the keepers", and a card carrying either belongs in that answer. Requiring
 * all of them would make a second selection almost always empty, which reads as
 * a bug rather than as a narrower filter.
 */
export function isTagFilterMiss(
  activeTags: ReadonlySet<string>,
  tags: readonly string[] | undefined,
): boolean {
  if (activeTags.size === 0) return false;
  if (!tags || tags.length === 0) return true;
  return !tags.some((tag) => activeTags.has(tagKey(tag)));
}

export type TagCount = Readonly<{ tag: string; count: number }>;

/**
 * Every tag in use with how many items carry it, most used first.
 *
 * Counting is case-insensitive but the FIRST spelling seen is kept for display
 * — the same split between matching and display that storage uses, so the menu
 * shows "SCAIL-2" rather than flattening it to lowercase.
 */
export function tagCounts(
  details: Readonly<Record<string, { tags?: readonly string[] } | undefined>>,
): TagCount[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const detail of Object.values(details)) {
    for (const raw of detail?.tags ?? []) {
      const key = tagKey(raw);
      if (key.length === 0) continue;
      const seen = counts.get(key);
      if (seen) seen.count += 1;
      else counts.set(key, { tag: raw.trim(), count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Toggle one tag in the active set, returning a new set. */
export function toggleTagKey(
  active: ReadonlySet<string>,
  tag: string,
): ReadonlySet<string> {
  const key = tagKey(tag);
  if (key.length === 0) return active;
  const next = new Set(active);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
