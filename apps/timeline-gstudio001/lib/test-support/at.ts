/**
 * Read an array element in a TEST, asserting it exists.
 *
 * Under `noUncheckedIndexedAccess` an assertion like `writes[1].document` no
 * longer type-checks, and the two obvious repairs are both worse:
 *
 *   `writes[1]!.document` compiles and then fails as "cannot read document of
 *   undefined", naming neither the index nor the length — in a test, whose
 *   whole job is to say what went wrong.
 *
 *   `expect(writes[1]).toBeDefined()` before every access doubles the
 *   assertion and still leaves the access unnarrowed.
 *
 * This fails with the index AND the actual length, which is usually the whole
 * diagnosis: the batch was shorter than the test expected.
 *
 * A twin of `packages/ui/test-support/at.ts`. Deliberately duplicated rather
 * than imported across the package boundary: `@storyboard/ui` is consumed by
 * subpath and does not export test-only modules, and widening its public
 * surface for a five-line test helper is the worse trade.
 */
export function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(
      `expected an element at index ${index}, but the list has ${items.length}`,
    );
  }
  return value;
}
