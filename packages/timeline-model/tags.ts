// Tags: free-form labels on a clip, for finding things again.
//
// The problem they solve is provenance. A generated take carries the tool and
// the checkpoint that made it, and today that information lives in the clip's
// NAME — strings like "S02 van pan — MiniMax H3 ref2va int8, 4 cast refs —
// prompt v8, seed 883". A title doing a database's job cannot be filtered or
// counted, and it breaks the moment someone shortens it for readability.
//
// Deliberately untyped as a set of strings rather than a fixed facet enum. The
// vocabulary in use (generator, checkpoint, shot, status, character) is still
// moving, and an enum would have to be widened by a code change every time a
// new tool enters the pipeline.

/** Upper bound on tags per clip. Generous for real use, low enough that a
 *  runaway writer cannot bloat a stored document. */
export const MAX_TAGS_PER_CLIP = 32;
/** Upper bound on one tag's length, in characters. */
export const MAX_TAG_LENGTH = 48;

/**
 * Clean untrusted tag input into the stored form.
 *
 * Rules, and why each one is here:
 *  - non-strings and blanks are dropped, so a malformed write degrades to
 *    fewer tags rather than to a corrupt document;
 *  - surrounding whitespace is trimmed and internal runs collapse to a single
 *    space, so " flux  dev " and "flux dev" are the same tag;
 *  - duplicates are removed CASE-INSENSITIVELY but the first spelling is kept.
 *    Matching has to ignore case (nobody will type "SCAIL-2" the same way
 *    twice) while display should not, so "SCAIL-2" stays "SCAIL-2" rather than
 *    being flattened to lowercase;
 *  - order is preserved, because the order they were typed in is the only
 *    ordering signal there is;
 *  - over-long tags are truncated and excess tags dropped, at the boundary,
 *    rather than rejected — a paste that is slightly too long should still
 *    save.
 *
 * Returns a new array; never mutates the input.
 */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (tag.length === 0) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_CLIP) break;
  }
  return out;
}

/**
 * True when the value is a legal STORED tag list — already normalized.
 *
 * Stricter than `normalizeTags` accepts, on purpose: normalize is the front
 * door for untrusted input, this is the gate on the write path. A document
 * that reached storage with a blank or duplicate tag is a bug upstream, and
 * waving it through here is what would let it spread.
 */
export function areTagsValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  if (value.length > MAX_TAGS_PER_CLIP) return false;
  const seen = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== "string") return false;
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) return false;
    if (tag !== tag.trim()) return false;
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Spread helper: `...tagsField(tags)` writes the key only when there is
 *  something to write, so clips that never use tags never grow the field —
 *  the same absence-is-the-default rule `disabled` follows. */
export function tagsField(tags: unknown): { tags?: string[] } {
  const normalized = normalizeTags(tags);
  return normalized.length === 0 ? {} : { tags: normalized };
}
