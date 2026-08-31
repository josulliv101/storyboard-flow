// Graph — the two commit-time diagnostics, and the once-only flags behind them.
//
// Split out of the former single-file `engine.ts`; see ./index.ts.
//
// A FACTORY, not two free functions, because each warning fires AT MOST ONCE per
// store and the flag enforcing that is per-store state. `createStore` calls this
// once, so the flags keep exactly the lifetime they had as closures inside it.
//
// Neither reads anything from the graph but its node count, so the parameter is
// structural rather than a `Graph<Ts, S>` — these are diagnostics about SIZE and
// have no business being able to see the nodes.

import { DEFAULT_INTERACTIVE_NODE_BUDGET, FOLD_CACHE_HEADROOM } from "./constants";

type SizedGraph = Readonly<{ nodesById: Readonly<{ size: number }> }>;

/** Only `stats().limit` is read — the warning is about the cache's SIZE, and
 *  handing it the whole cache would let a diagnostic touch the memo table. */
type CacheLimitSource = Readonly<{ stats: () => Readonly<{ limit: number }> }>;

type WarningConfig = Readonly<{
  folds: Readonly<Record<string, unknown>>;
  foldCacheLimit?: number | undefined;
  interactiveNodeBudget?: number | undefined;
}>;

export function makeCommitWarnings(
  config: WarningConfig,
  cache: CacheLimitSource,
): Readonly<{
  warnIfCacheCannotCover: (candidate: SizedGraph) => void;
  warnIfCommitCostIsPastInteractive: (candidate: SizedGraph) => void;
}> {
let warnedAboutCacheSize = false;
const warnIfCacheCannotCover = (candidate: SizedGraph): void => {
  if (warnedAboutCacheSize) return;
  // ONLY WHEN THE LIMIT IS THE DEFAULT. A consumer who wrote a number chose
  // it; the failure this exists to catch belongs to the consumer who wrote
  // none and does not know the default stops comfortably covering at
  // `servable` nodes — 8,192 at 8 folds, computed below rather than quoted
  // here. This is the same rule `maxNodes` states a few lines up — "a
  // consumer who names a ceiling has named THE ceiling" — applied to the
  // other one.
  //
  // It is also what makes the diagnostic quiet enough to keep: checking
  // every store took out four of this package's own capacity tests, which
  // set tiny limits deliberately to exercise eviction. Those stores really
  // will thrash, so the warning was true — and useless, because thrashing
  // was the point.
  if (config.foldCacheLimit !== undefined) return;
  const foldCount = Object.keys(config.folds).length;
  if (foldCount === 0) return;
  const limit = cache.stats().limit;
  if (limit <= 0) return;
  const nodeCount = candidate.nodesById.size;
  // HEADROOM, not the bare product — and the first version of this check
  // used the bare product, which is why it is spelled out here.
  //
  // `folds x nodes` is the FLOOR of the working set, not its resting size:
  // every edit strands `folds x depth` entries, so occupancy grows with the
  // session's edit count until the limit reclaims them. Those strays are
  // not a leak, because a dead-rev entry is never touched again and ages
  // out first — but they are always NEWER than a cold live entry, so at
  // exactly `folds x nodes` there is no room and every stray admission
  // evicts something live.
  //
  // MEASURED against the ideal of `folds x depth` fold calls per post-edit
  // root read: 1.90x ideal at a limit of 1x the product, 1.27x at 2x, and
  // exactly 1.00x at 4x. Two is the knee, and it is what this gate uses.
  //
  // A 16,105-node graph with 8 folds passed the old bare-product check
  // silently (128,840 <= 131,072) while doing 2.04x the fold work per
  // rollup after 2,000 edits — at a fixed graph size, driven purely by
  // churn. That is the exact silent degradation this warning exists for,
  // and it sat just under the threshold.
  const want = foldCount * nodeCount * FOLD_CACHE_HEADROOM;
  if (want <= limit) return;
  warnedAboutCacheSize = true;
  const servable = Math.floor(limit / (foldCount * FOLD_CACHE_HEADROOM));
  console.error(
    `graph-core: this graph holds ${nodeCount} nodes and ${foldCount} fold(s) are registered, ` +
      `but foldCacheLimit (${limit}) comfortably covers only ${servable} nodes. Past that ` +
      `the memo table thrashes and every rollup refolds from scratch — measurably slower ` +
      `than no cache at all. Raise EngineConfig.foldCacheLimit to at least ${want} ` +
      `(folds x nodes x ${FOLD_CACHE_HEADROOM} for edit churn). ` +
      `EngineConfig.onFoldCacheStats reports evictions if you want to watch it.`,
  );
};

let warnedAboutCommitCost = false;
const warnIfCommitCostIsPastInteractive = (candidate: SizedGraph): void => {
  if (warnedAboutCommitCost) return;
  const budget = config.interactiveNodeBudget ?? DEFAULT_INTERACTIVE_NODE_BUDGET;
  // A named budget is a choice, and `0` is how that choice says "never".
  if (budget <= 0) return;
  const nodeCount = candidate.nodesById.size;
  if (nodeCount <= budget) return;
  warnedAboutCommitCost = true;
  console.error(
    `graph-core: this graph holds ${nodeCount} live nodes, past the ${budget} this engine ` +
      `treats as interactive. A commit copies whole maps — every mutation copies ` +
      `subtreeRevById, a data change also copies nodesById, an insert or removal copies ` +
      `four — so a commit costs what the DOCUMENT costs, not what the edit costs: ` +
      `measured at 3.3 ms per keystroke at 25,000 nodes and 17.1 ms at 100,000, where ` +
      `one keystroke is a whole 60Hz frame before anything renders. Set ` +
      `EngineConfig.interactiveNodeBudget to silence this once you have priced it.`,
  );
};

  return { warnIfCacheCannotCover, warnIfCommitCostIsPastInteractive };
}
