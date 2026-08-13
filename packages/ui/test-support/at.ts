/**
 * Read an array element in a TEST, asserting it exists.
 *
 * Under `noUncheckedIndexedAccess` an assertion like `packed[1].startTime` no
 * longer type-checks, and the two obvious repairs are both worse than this:
 *
 *   `packed[1]!.startTime` compiles and then fails as "cannot read startTime
 *   of undefined", naming neither the index nor the length — in a test, whose
 *   entire job is to say what went wrong.
 *
 *   `expect(packed[1]).toBeDefined()` before every access doubles the length
 *   of the assertion and still leaves the access unnarrowed.
 *
 * This fails with the index AND the actual length, which is usually the whole
 * diagnosis: the list was shorter than the test expected.
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
