/** Demo helper for exercising the review loop. Safe to delete. */
export function average(values: number[]): number {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
