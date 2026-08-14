/**
 * `Promise.all` with a worker pool. Results stay in INPUT order — a file drop
 * adds nodes in file order, so completion order must not leak through.
 *
 * `run` MUST resolve for every outcome the caller expects to report. A
 * rejection takes down the `Promise.all` while the other workers keep going,
 * unobserved, on a pool the caller has already given up on — so expected
 * failures belong in the result type, not thrown.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      // The bound above already stops at the end; reading the item through a
      // check keeps the worker from calling `run(undefined)` if the list is
      // ever mutated while the pool is draining it.
      if (index >= items.length || item === undefined) return;
      results[index] = await run(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}
