// Graph — the memo table.
//
// Split out of the former single-file `folds.ts`; see ./index.ts.

import type {
  FoldCache,
  FoldCacheStats,
  NodeId,
} from "../types";

// 4. The memo table
// ---------------------------------------------------------------------------

/**
 * The default ceiling, written as FOLDS x NODES because that is the shape of
 * the working set. A round number is how the first version of this got it
 * wrong: 2048 reads as "plenty" and is one fold over 2k nodes.
 *
 * `computeFold` commits an entry for EVERY node it walks, so one root-level
 * read of ONE fold over an n-node document occupies n slots, and the k folds a
 * consumer registered all share their store's single cache — k x n.
 *
 * THAT IS THE FLOOR, NOT THE STEADY STATE, and an earlier version of this
 * comment said "at steady state" and was wrong. There is no steady state at
 * k x n. Every edit bumps the edited node's ancestor chain, so the next root
 * read mints k x DEPTH new keys and strands k x depth old ones, and occupancy
 * grows with the session's EDIT COUNT until the limit bites:
 *
 *     occupancy  ~=  k x n  +  k x depth x edits
 *
 * MEASURED, and the fit is exact rather than approximate — at n=1,111, k=4,
 * depth=4 the dead entries came to `16E + 384` to the entry at E = 1, 100, 500,
 * 1,000, 2,000 and 4,000. At E=4,000 that is 15.5x the k x n this comment used
 * to name as the resting size.
 *
 * The stranded entries are NOT a leak, and this is the part that keeps the
 * design sound: a dead-rev entry is never touched again, so the LRU ages it out
 * first — GIVEN HEADROOM. Measured against the ideal of k x depth fold calls
 * per post-edit root read (16 for that fixture):
 *
 *     limit 1.0x k x n   ->  30.4 calls   (1.90x ideal)
 *     limit 1.25x        ->  23.2
 *     limit 2.0x         ->  20.3         (1.27x)
 *     limit 4.0x         ->  16.0         (1.00x, with 131,052 evictions costing nothing)
 *
 * So the cliff is not at k x n, it is just below it. A dead entry is always
 * NEWER than a cold live one — a leaf is only re-touched when a sibling is
 * edited — so at exactly k x n there is no room and every dead admission evicts
 * a live one. Size the table with headroom over the product, not to it;
 * `createStore` warns using the same multiple.
 *
 * Below the product the LRU does not degrade gracefully, it INVERTS:
 * fold k's walk evicts fold 1's entries, fold 1's next read misses at the root,
 * and every mounted card refolds its whole subtree from scratch. That is
 * precisely the un-memoized behaviour this table exists to beat, so the cap
 * being too low does not cost a little speed — it costs the entire mechanism,
 * silently, at exactly the graph size it was built for. `stats()` exists
 * because that failure has no other symptom.
 *
 * 8 x 16384. Eight is a realistic registry (duration, first frame, child count,
 * byte size, a disabled rollup, a missing rollup, and room for two more).
 * 16384 nodes is chosen to clear a ten-thousand-node document — the size this
 * package's own performance fixtures treat as realistic — with headroom, so
 * that what a consumer meets first is their graph's memory cost, not this
 * ceiling silently turning their memo table off.
 *
 * A generous ceiling is cheap because the Map is DEMAND-FILLED: a 200-node
 * document holds 200 x k entries no matter what this number says. The limit
 * only decides when eviction starts. MEASURED on node 22 with `--expose-gc`
 * (200k entries, this module's own `cacheKey`, a `Folded` wrapping a number):
 * ~232 bytes an entry, stable to the byte across three runs, so a table at FULL
 * occupancy is ~30 MB — reachable only by a 16k-node graph that is itself the
 * same order of magnitude in memory.
 *
 * Read that as a FLOOR, not a total. The entry is the key plus the `Folded`,
 * and `Folded<A>`'s `A` is whatever the consumer's fold returns — a duration is
 * a number, a preview-items rollup is an array of objects, and this package
 * cannot know which. A consumer whose folds accumulate anything larger than a
 * scalar should size `foldCacheLimit` against their own `A`, not against this.
 *
 * Still not a universal answer, which is why it is not the only door:
 * `EngineConfig.foldCacheLimit` is how a consumer with 40 folds or 100k nodes
 * raises it without editing this package.
 */
export const DEFAULT_FOLD_CACHE_LIMIT = 8 * 16384;

/**
 * Counters for the one question a cache cannot answer by working: IS it
 * working? A memo table that has silently stopped helping behaves exactly like
 * one that never helped — same answers, more work — so an undersized `limit`
 * has no symptom a consumer can see from the outside. `evictions` climbing
 * while `hits` stays flat is that symptom, and it is the signal to raise
 * `EngineConfig.foldCacheLimit`.
 *
 * `hits` / `misses` / `evictions` are LIFETIME counts and survive `clear()`;
 * `size` is current occupancy.
 *
 * DECLARED IN ./types and re-exported here, so `EngineConfig.onFoldCacheStats`
 * and `ObservableFoldCache.stats` are the same type rather than two hand-copies
 * that "must stay identical". Re-exported rather than moved outright because
 * this is the module the type belongs to conceptually, and a consumer reading
 * the cache should not have to know it is declared one layer down.
 */
export type { FoldCacheStats };

/**
 * A `FoldCache` that can also be measured. `createFoldCache` always returns
 * one; the plain `FoldCache` in ./types stays the parameter type everywhere a
 * cache is CONSUMED, because `computeFold` has no business reading counters.
 */
export type ObservableFoldCache = FoldCache &
  Readonly<{
    stats(): FoldCacheStats;
    /**
     * Is this slot occupied? WITHOUT counting a hit or a miss, and without
     * moving the entry in the LRU order.
     *
     * For a diagnostic that needs to know whether an answer CAME from the table
     * — the shadow cold refold in ./engine is the only one — and must not
     * change the table or the numbers by asking. `get` cannot serve that: it
     * counts, and `FoldCacheStats` is the one instrument a consumer has for
     * telling a memo table that has silently stopped helping from one that
     * never helped. A probe that inflates `hits` on every read, or `misses` on
     * every read, is a diagnostic corrupting the diagnostic.
     *
     * Deliberately NOT on `FoldCache`. That type is what `computeFold` consumes,
     * and folding has no business asking a question it cannot act on.
     */
    peek(foldKey: string, nodeId: NodeId, subtreeRev: number): boolean;
  }>;

/**
 * Length-prefixed, NOT `[foldKey, nodeId, rev].join(":")`.
 *
 * A `NodeId` may contain ANY character except whitespace-only — ids like
 * `scene/a` and `timeline-e2e,comma` are legal and have shipped. A naive
 * separator makes `("a", "b:c")` and `("a:b", "c")` the same key, and the
 * failure is a fold silently answering with another node's value, which is
 * about as hard to diagnose as bugs get. Prefixing each variable-length part
 * with its length makes the encoding injective for every input.
 */
function cacheKey(foldKey: string, nodeId: NodeId, subtreeRev: number): string {
  return `${foldKey.length}:${foldKey}${nodeId.length}:${nodeId}:${subtreeRev}`;
}

/**
 * Plain LRU keyed by `(foldKey, nodeId, subtreeRev)`.
 *
 * Including the rev is what lets this live BESIDE the store while `Graph` stays
 * a pure value: an entry for a stale rev is UNREACHABLE rather than wrong, so
 * nothing has to invalidate it — eviction is a memory concern only, never a
 * correctness one.
 *
 * `limit` of zero or less disables caching entirely (every `set` is a no-op);
 * a non-finite `limit` falls back to the default rather than growing without
 * bound.
 *
 * NOT what the shadow-refold check uses, which this comment used to recommend.
 * That check wants ONE cold fold beside a cached one, so it omits
 * `computeFold`'s cache argument entirely — a whole disabled cache would also
 * disable the memoisation it exists to audit.
 *
 * Because the key carries the rev, the limit is a COST dial and nothing else —
 * evicting an entry can only make the next read do work it already did, never
 * change what it answers. That is the property `EngineConfig.foldCacheLimit`
 * relies on to be safe to expose, and it is covered by test rather than left as
 * an assertion.
 */
export function createFoldCache(
  limit: number = DEFAULT_FOLD_CACHE_LIMIT,
): ObservableFoldCache {
  const max = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_FOLD_CACHE_LIMIT;
  // Map iteration order is insertion order, which is the whole LRU mechanism:
  // re-inserting on read moves an entry to the back, so the front is the least
  // recently used.
  const entries = new Map<string, unknown>();

  // Lifetime counters, deliberately NOT reset by `clear()` — a consumer that
  // clears on every document swap would otherwise see a permanently healthy
  // cache no matter how badly the limit was thrashing between swaps.
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  /**
   * ONE long-lived eviction cursor, advanced rather than re-created.
   *
   * `entries.keys().next()` per eviction reads as O(1) and is not. V8 backs a
   * Map with an ordered entry array and `delete` writes a TOMBSTONE into it,
   * compacting only on rehash. This LRU always deletes from the FRONT, so
   * tombstones pile up there and every fresh iterator has to scan past all of
   * them to reach the first live entry — the cost of one eviction scales with
   * the cache LIMIT, and the default limit (131,072) is the worst case.
   *
   * MEASURED, 50,000 evictions in every row, so the work is identical:
   *     limit   1,000     25 ms
   *     limit  10,000    274 ms
   *     limit  50,000    400 ms
   *     limit 131,072    682 ms      <- the DEFAULT
   *
   * This also re-attributes the number in ./engine's cache-pressure comment,
   * which treated the eviction loop as a constant and blamed refold work: an
   * over-capacity cache reading 8 root rollups measured 8,220 ms with 0 hits,
   * and 295 ms with this cursor and byte-identical eviction/hit/miss counts.
   * A correctly-sized cache pays too — 8 folds x 8,000 nodes under the default
   * limit still stranded 92,928 stale-rev entries over 2,000 edits, 2,304 ms
   * of pure loop overhead against 55 ms.
   *
   * SAFE because a Map iterator is live: an entry deleted before the cursor
   * reaches it is skipped rather than yielded, and one promoted by `get`
   * (delete + re-set) is re-appended BEHIND the cursor, so it is offered again
   * only after everything older — which is exactly LRU order. Once a Map
   * iterator reports `done` it detaches permanently, so it is re-created then,
   * and on `clear()`.
   */
  let evictionCursor: Iterator<string> | null = null;

  return {
    get(foldKey, nodeId, subtreeRev) {
      const key = cacheKey(foldKey, nodeId, subtreeRev);
      // `has`, not `get() !== undefined`. The hit/miss union exists precisely
      // so a legitimately cached `undefined` is a hit; testing the value would
      // throw that away and silently recompute forever.
      if (!entries.has(key)) {
        misses += 1;
        return { hit: false };
      }
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      hits += 1;
      return { hit: true, value };
    },
    set(foldKey, nodeId, subtreeRev, value) {
      // A disabled cache records no eviction: nothing was ever admitted, and
      // counting these would read as capacity pressure a bigger limit fixes.
      // `stats().limit` is what explains a zero hit rate here.
      if (max <= 0) return;
      const key = cacheKey(foldKey, nodeId, subtreeRev);
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > max) {
        if (evictionCursor === null) evictionCursor = entries.keys();
        let step = evictionCursor.next();
        if (step.done === true) {
          // Exhausted, which is permanent for a Map iterator. Everything it
          // ever held has been evicted, so start again from the current front —
          // rare by construction, and the only path that pays the scan.
          evictionCursor = entries.keys();
          step = evictionCursor.next();
          // Nothing left to evict. Unreachable while `size > max >= 0`, but it
          // is what keeps the loop provably terminating without a `!`.
          if (step.done === true) break;
        }
        entries.delete(step.value);
        evictions += 1;
      }
    },
    peek(foldKey, nodeId, subtreeRev) {
      // `has`, and nothing else. No counter, no re-insertion — see the doc on
      // `ObservableFoldCache`.
      return entries.has(cacheKey(foldKey, nodeId, subtreeRev));
    },
    clear() {
      entries.clear();
      // The cursor belongs to the emptied map and would report `done` forever.
      evictionCursor = null;
    },
    size() {
      return entries.size;
    },
    stats() {
      return { hits, misses, evictions, size: entries.size, limit: max };
    },
  };
}

// ---------------------------------------------------------------------------
