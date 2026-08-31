// Graph — the ingress ceiling.
//
// Its own file because nothing in ./shape reads it: the number is consumed by
// the doors and by the engine, so keeping it in the module that happened to
// declare it put it nowhere near any of its callers.

/**
 * The default ceiling on nodes in one document.
 *
 * Sized from what this engine COSTS, not from a round number — the same
 * mistake `DEFAULT_FOLD_CACHE_LIMIT` was originally made of. Deserialize
 * measures at roughly a microsecond a node on the performance fixtures
 * (9.57 ms for 10,000), so 100,000 is where one document crosses ~100 ms of
 * blocking parse and becomes a visible hitch rather than a load. That is an
 * order of magnitude above the 10,000-node document those fixtures treat as
 * realistic.
 *
 * THIS NUMBER AND `DEFAULT_FOLD_CACHE_LIMIT` DO NOT AGREE, and an earlier
 * version of this comment claimed the opposite — that 100,000 sits "above the
 * 16,384 the fold cache is sized to hold, so the two ceilings cannot
 * contradict each other". The premise was the contradiction. That table holds
 * `foldCacheLimit / folds` NODES, not 16,384 unconditionally: the default is
 * 8 x 16,384 ENTRIES, and ./folds names an 8-fold registry as realistic, so
 * 16,384 nodes IS the default table's capacity and this ceiling admits 6.1x
 * it. MEASURED at 20,001 nodes with 8 folds — five times under this number,
 * and accepted by `deserialize`: 188,944 evictions, zero cache hits on an
 * identical repeat, 5,542 ms against 0.017 ms with the table sized to fit.
 *
 * The two are INDEPENDENT numbers describing one graph, and that is fine as
 * long as somebody notices when they disagree. `createEngine` compares them
 * and says so — see the diagnostic there. They are deliberately not derived
 * from one another: sizing the table from this ceiling would cost ~186 MB by
 * default, and lowering this ceiling to the table's capacity would refuse
 * documents that load today.
 *
 * A ceiling, not a target. It exists so that an unbounded payload cannot
 * decide this process's memory, and it should never fire on real data — a
 * consumer meeting it should raise `EngineConfig.maxNodes` and know what they
 * are buying, which is the whole reason it refuses loudly instead of trimming.
 */
export const DEFAULT_MAX_NODES = 100_000;
