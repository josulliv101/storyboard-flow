// Graph — the engine's tuning constants.
//
// Separated from ./defaults because these are NUMBERS the engine is tuned by,
// while what remains there are default IMPLEMENTATIONS — `defaultMintId`,
// `noop`, `sameIds`. Each carries the measurement that chose it, which is why
// they are worth keeping together and worth keeping out of the factory.

/**
 * How much room over `folds x nodes` a fold cache needs to stop thrashing.
 *
 * The product is the working set's FLOOR. Editing strands `folds x depth`
 * entries per edit, and those strays are newer than a cold live entry, so a
 * table sized exactly to the product evicts something live for every one of
 * them. Measured against the ideal fold-call count per post-edit root read:
 * 1.90x ideal at 1x the product, 1.27x at 2x, 1.00x at 4x. Two is the knee —
 * enough to stop the inversion, not so much that the recommendation reads as
 * absurd for a large board.
 */
export const FOLD_CACHE_HEADROOM = 2;

/**
 * Live-node count past which ONE commit stops fitting an interactive frame.
 *
 * WHY THERE IS A NUMBER HERE AT ALL. A commit copies whole maps: every
 * mutation copies `subtreeRevById` (in `bumpSubtreeRevs`), a data change also
 * copies `nodesById` (in `applyDataChanged`), and an insert or a removal copies
 * four maps rather than two. So commit cost is proportional to how many nodes
 * the document HOLDS and not at all to how small the edit was — one keystroke
 * on one title pays for the whole graph.
 *
 * MEASURED, one `edit-nodes` and one `insert-nodes`, best-of-25, product-shaped
 * fixture (root -> folders of 20 clips):
 *
 *    10,025 nodes   edit  1.21 ms   insert  2.33 ms   0.120 us/node
 *    25,025 nodes   edit  3.26 ms   insert  6.28 ms   0.130 us/node
 *    50,025 nodes   edit  7.59 ms   insert 14.92 ms   0.152 us/node
 *   100,025 nodes   edit 17.06 ms   insert 33.89 ms   0.171 us/node
 *
 * Two things in that table decide this number. The per-node cost RISES with
 * size — 42% worse at 100,000 than at 10,000, as allocation and GC stop being
 * free — so extrapolating the small sizes linearly UNDERSTATES what a large
 * document costs. And `DEFAULT_MAX_NODES` is 100,000, where a single keystroke
 * costs 17 ms: a whole 60Hz frame inside the reducer, before React is asked to
 * render anything. The engine's own default admits documents it cannot serve
 * interactively.
 *
 * 25,000 is where the worst common gesture — an insert, which copies four maps
 * — still costs 6.3 ms, about a third of a frame, leaving the rest for render.
 * Above it the curve bends the wrong way.
 *
 * A DIAGNOSTIC, NOT A GATE, and deliberately not a lowered `maxNodes`. That
 * ceiling is a TRUST boundary: it exists so a hostile payload cannot decide how
 * much memory this process allocates, and lowering it to serve a performance
 * argument would refuse honest documents for the wrong reason. The two numbers
 * answer different questions and both should be sayable — which is the same
 * mistake, in the other direction, that #585 found between `maxNodes` and
 * `foldCacheLimit`. This one is audible instead of enforced.
 */
export const DEFAULT_INTERACTIVE_NODE_BUDGET = 25_000;

/**
 * How many shadow cold refolds one engine will run before switching itself off.
 *
 * A cold fold is O(subtree) — 101ms over 100,000 nodes, measured — so an
 * unbounded shadow turns `devChecks: true` from "slower" into "unusable". A
 * stale entry, if there is one, shows up in the first handful of reads; the
 * thousandth comparison is not where the value is.
 */
export const SHADOW_REFOLD_BUDGET = 1_000;
