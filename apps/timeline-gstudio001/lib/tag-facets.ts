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

/**
 * Words that mark a tag as STATUS rather than description.
 *
 * Matched as substrings of the normalized tag, so `pending-client-approval`
 * and `needs-color-correction` are caught by `pending` and `needs` without
 * either being listed. Substring matching is also why `ok` is not in here: it
 * would claim `smoke-test` and `look-dev`.
 */
const STATUS_WORDS: readonly (readonly [string, TagAccent])[] = [
  ["approved", "ok"],
  ["keeper", "ok"],
  ["final", "ok"],
  ["done", "ok"],
  ["wip", "progress"],
  ["pending", "progress"],
  ["review", "progress"],
  ["draft", "progress"],
  ["needs", "blocked"],
  ["blocked", "blocked"],
  ["locked", "blocked"],
  ["reject", "blocked"],
  ["broken", "blocked"],
];

/** The descriptive families, cycled by hash. Deliberately FEW: colour here
 *  separates tags at a glance, and a unique hue per tag separates nothing. */
const DESCRIPTIVE_ACCENTS = ["place", "role", "source"] as const;

export type TagAccent = "place" | "role" | "source" | "ok" | "progress" | "blocked";

/**
 * Which colour family a tag belongs to.
 *
 * DERIVED, never registered. The design this follows ships a fixed table of
 * fourteen known tags with hand-assigned colours, which works for a mockup and
 * cannot work here: tag vocabulary in this app is emergent — a new checkpoint
 * is a new tag — so every real tag (`scail-2`, `wan2.1`, `S02`) would miss the
 * table and come out the same fallback grey, and the whole point of colour
 * would be lost on exactly the tags that are actually used.
 *
 * So status is recognised by WORD (the one part of the vocabulary that really
 * is shared), and everything else is hashed into a small set of families. A
 * hash is not meaningful — `night` and `hero` may collide — but it is STABLE,
 * which is the property that matters: a tag keeps its colour across cards,
 * across sessions and across renames of its neighbours, so the eye can learn it.
 */
export function tagAccent(tag: string): TagAccent {
  const key = tagKey(tag);
  for (const [word, accent] of STATUS_WORDS) {
    if (key.includes(word)) return accent;
  }
  // FNV-1a, for a stable spread that does not clump on shared prefixes the way
  // a plain character sum does — `shot-01`…`shot-09` would otherwise land in
  // near-adjacent buckets and colour identically.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return DESCRIPTIVE_ACCENTS[hash % DESCRIPTIVE_ACCENTS.length];
}

/** True for the tags that say where something STANDS rather than what it is. */
export function isStatusTag(tag: string): boolean {
  const accent = tagAccent(tag);
  return accent === "ok" || accent === "progress" || accent === "blocked";
}

/**
 * Status first, then original order.
 *
 * Card space runs out before tags do, and what gets dropped is whatever sorted
 * last — so this decides what survives truncation. Status wins because it is
 * what people scan a board for ("what still needs work"), and because a
 * descriptive tag is usually recoverable from the picture itself while
 * "approved" is not visible anywhere else on the card.
 *
 * A STABLE partition, not a comparison sort on a derived key: tags that share a
 * class keep the order they were added in, so a card's chips do not reshuffle
 * when an unrelated one is added.
 */
export function sortTagsStatusFirst(tags: readonly string[]): string[] {
  const status: string[] = [];
  const rest: string[] = [];
  for (const tag of tags) (isStatusTag(tag) ? status : rest).push(tag);
  return [...status, ...rest];
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
