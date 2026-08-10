import { describe, expect, it } from "vitest";

import {
  MAX_TAGS_PER_CLIP,
  MAX_TAG_LENGTH,
  areTagsValid,
  normalizeTags,
  tagsField,
} from "./tags";

describe("normalizeTags", () => {
  it("keeps ordinary tags in the order they were given", () => {
    expect(normalizeTags(["scail-2", "wan2.1", "S02"])).toEqual(["scail-2", "wan2.1", "S02"]);
  });

  it("trims and collapses whitespace so spacing variants are one tag", () => {
    expect(normalizeTags(["  flux   dev  "])).toEqual(["flux dev"]);
  });

  it("dedupes case-insensitively but keeps the first spelling", () => {
    // Matching has to ignore case or nobody finds anything; DISPLAY must not,
    // or every tag ends up lowercased in the UI.
    expect(normalizeTags(["SCAIL-2", "scail-2", "Scail-2"])).toEqual(["SCAIL-2"]);
  });

  it("drops blanks and non-strings rather than failing the whole write", () => {
    expect(normalizeTags(["keeper", "", "   ", 42, null, undefined, {}])).toEqual(["keeper"]);
  });

  it("returns an empty list for anything that is not an array", () => {
    for (const bad of [undefined, null, "keeper", 7, {}]) {
      expect(normalizeTags(bad)).toEqual([]);
    }
  });

  it("truncates an over-long tag instead of rejecting it", () => {
    const long = "x".repeat(MAX_TAG_LENGTH + 25);
    expect(normalizeTags([long])).toEqual(["x".repeat(MAX_TAG_LENGTH)]);
  });

  it("caps the number of tags", () => {
    const many = Array.from({ length: MAX_TAGS_PER_CLIP + 10 }, (_, i) => `tag-${i}`);
    const out = normalizeTags(many);
    expect(out).toHaveLength(MAX_TAGS_PER_CLIP);
    expect(out[0]).toBe("tag-0");
  });

  it("does not mutate its input", () => {
    const input = ["  b  ", "b", "a"];
    const copy = [...input];
    normalizeTags(input);
    expect(input).toEqual(copy);
  });
});

describe("areTagsValid", () => {
  it("accepts absence and a clean list", () => {
    expect(areTagsValid(undefined)).toBe(true);
    expect(areTagsValid([])).toBe(true);
    expect(areTagsValid(["scail-2", "S02"])).toBe(true);
  });

  it("rejects the shapes normalizeTags would have cleaned", () => {
    // Stricter than the front door on purpose: reaching storage in one of
    // these states means a writer skipped normalization.
    expect(areTagsValid(["", "ok"])).toBe(false);
    expect(areTagsValid([" padded"])).toBe(false);
    expect(areTagsValid(["dup", "DUP"])).toBe(false);
    expect(areTagsValid(["x".repeat(MAX_TAG_LENGTH + 1)])).toBe(false);
    expect(areTagsValid([1, 2])).toBe(false);
    expect(areTagsValid("scail-2")).toBe(false);
    expect(
      areTagsValid(Array.from({ length: MAX_TAGS_PER_CLIP + 1 }, (_, i) => `t${i}`)),
    ).toBe(false);
  });
});

describe("tagsField", () => {
  it("writes nothing when there is nothing to write", () => {
    // Absence is the default: a document that never uses tags must not grow
    // the key, same rule `disabled` follows.
    expect(tagsField(undefined)).toEqual({});
    expect(tagsField([])).toEqual({});
    expect(tagsField(["", "  "])).toEqual({});
  });

  it("writes the cleaned list when there is", () => {
    expect(tagsField([" keeper ", "keeper", "S02"])).toEqual({ tags: ["keeper", "S02"] });
  });
});
