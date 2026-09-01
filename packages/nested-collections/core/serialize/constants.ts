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

/**
 * The default ceiling on the LENGTH of one node id.
 *
 * THE THIRD CEILING, and the one the other two do not cover. `maxNodes` bounds
 * how MANY nodes a document may hold and `maxDepth` how deeply they nest;
 * neither says anything about how big one of them may be, and `tryParseNodeId`
 * refuses only the empty and whitespace-only string. So the size of a node id
 * was the sender's to choose, without limit, under ceilings that read as
 * complete.
 *
 * WHERE THAT AMPLIFIES, and it is not where it looks. The graph's four maps key
 * by the id, but a JavaScript string is immutable and shared by reference, so
 * holding one id in four maps costs four pointers and one copy of the bytes.
 * The memo table is different: `cacheKey` CONCATENATES the id into a fresh
 * string per `(foldKey, nodeId, subtreeRev)` entry, and `foldCacheLimit` bounds
 * that table by ENTRY COUNT. At the defaults that is 131,072 entries whose
 * per-entry size the document decides — and ./folds measures ~232 bytes an
 * entry, a figure taken with ordinary ids and, until this ceiling existed,
 * resting on an assumption nothing enforced.
 *
 * 1024, which is not a round number chosen for looking generous: it is ~28x a
 * UUID and ~16x the longest id-shaped string in this repo's own fixtures and
 * app code (a 64-character storage path). Nothing legitimate is within an order
 * of magnitude of it, and it caps the memo table's worst case at a size the
 * `maxNodes` ceiling is already the same order as.
 *
 * A CEILING WITH A DEFAULT, unlike `maxDepth`, and for `maxNodes`' reason: this
 * one can be defended without knowing the consumer's data, because there is no
 * legitimate id near it. `null` opts out, and the refusal names the config to
 * raise — the same escape hatch `maxNodes` offers, and it matters more here,
 * because a read-side ceiling that refuses a STORED document is worse than the
 * hazard it prevents.
 */
export const DEFAULT_MAX_NODE_ID_LENGTH = 1024;
