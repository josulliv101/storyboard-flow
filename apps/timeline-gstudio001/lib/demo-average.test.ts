import { describe, expect, it } from "vitest";

import { average } from "./demo-average";

describe("average", () => {
  it("returns the arithmetic mean of the values", () => {
    expect(average([1, 2, 3])).toBe(2);
  });
});
