import { describe, expect, it } from "vitest";

import { ITEM_SIZES, isItemSize } from "./graph-view-config";

describe("isItemSize", () => {
  it.each(ITEM_SIZES)("accepts %s", (size) => {
    expect(isItemSize(size)).toBe(true);
  });

  it("rejects a junk string", () => {
    expect(isItemSize("huge")).toBe(false);
  });
});
