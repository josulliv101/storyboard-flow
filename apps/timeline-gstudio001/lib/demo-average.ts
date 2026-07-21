/** Demo helper for exercising the review loop. Safe to delete. */
export function average(values: number[]): number {
  if (values.length === 0) {
    throw new Error("average: values must be a non-empty array");
  }
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
