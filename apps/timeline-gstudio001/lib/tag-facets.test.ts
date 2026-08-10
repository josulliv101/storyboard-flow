import { describe, expect, it } from "vitest";

import {
  isStatusTag,
  isTagFilterMiss,
  sortTagsStatusFirst,
  tagAccent,
  tagCounts,
  tagKey,
  toggleTagKey,
} from "./tag-facets";

const active = (...tags: string[]) => new Set(tags.map(tagKey));

describe("isTagFilterMiss", () => {
  it("misses nothing when no filter is running", () => {
    // The default has to be "not missed": with the filter off, every card must
    // read normally, including untagged ones.
    expect(isTagFilterMiss(new Set(), undefined)).toBe(false);
    expect(isTagFilterMiss(new Set(), [])).toBe(false);
    expect(isTagFilterMiss(new Set(), ["keeper"])).toBe(false);
  });

  it("misses an untagged item once a filter is on", () => {
    expect(isTagFilterMiss(active("keeper"), undefined)).toBe(true);
    expect(isTagFilterMiss(active("keeper"), [])).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isTagFilterMiss(active("scail-2"), ["SCAIL-2"])).toBe(false);
    expect(isTagFilterMiss(active("SCAIL-2"), ["scail-2"])).toBe(false);
  });

  it("ORs the active set rather than ANDing it", () => {
    // "Show me the SCAIL-2 takes AND the keepers" means either qualifies.
    // Requiring both would make a second selection almost always empty, which
    // reads as a bug rather than as a narrower filter.
    expect(isTagFilterMiss(active("scail-2", "keeper"), ["keeper"])).toBe(false);
    expect(isTagFilterMiss(active("scail-2", "keeper"), ["scail-2"])).toBe(false);
    expect(isTagFilterMiss(active("scail-2", "keeper"), ["h3"])).toBe(true);
  });
});

describe("tagCounts", () => {
  const details = {
    a: { tags: ["SCAIL-2", "S02"] },
    b: { tags: ["scail-2", "keeper"] },
    c: { tags: ["Scail-2"] },
    d: undefined,
    e: {},
  };

  it("counts case-insensitively but keeps the first spelling for display", () => {
    const counts = tagCounts(details);
    expect(counts[0]).toEqual({ tag: "SCAIL-2", count: 3 });
  });

  it("sorts by use, then alphabetically ignoring case", () => {
    // `localeCompare`, so "keeper" precedes "S02" among the ties — a menu is
    // scanned by eye, and ASCII order (every capital before every lowercase)
    // is not how anyone reads an alphabetical list.
    expect(tagCounts(details).map((c) => c.tag)).toEqual(["SCAIL-2", "keeper", "S02"]);
  });

  it("tolerates missing and empty entries", () => {
    expect(tagCounts({ a: undefined, b: {}, c: { tags: [] } })).toEqual([]);
  });
});

describe("toggleTagKey", () => {
  it("adds, removes, and never mutates the input", () => {
    const first = toggleTagKey(new Set(), "SCAIL-2");
    expect([...first]).toEqual(["scail-2"]);
    const empty = toggleTagKey(first, "scail-2");
    expect(empty.size).toBe(0);
    // The original set is untouched — the context stores it in state.
    expect([...first]).toEqual(["scail-2"]);
  });

  it("ignores a blank tag", () => {
    const active = new Set(["keeper"]);
    expect(toggleTagKey(active, "   ")).toBe(active);
  });
});

describe("tagAccent", () => {
  it("recognises status by word, including inside a longer tag", () => {
    // The whole reason status is matched as a SUBSTRING: nobody is going to
    // register "pending-client-approval" anywhere, and it is still a status.
    expect(tagAccent("approved")).toBe("ok");
    expect(tagAccent("pending-client-approval")).toBe("progress");
    expect(tagAccent("needs-color-correction")).toBe("blocked");
    expect(tagAccent("keeper")).toBe("ok");
  });

  it("matches status case-insensitively, like the rest of tag handling", () => {
    expect(tagAccent("  WIP  ")).toBe("progress");
    expect(tagAccent("Locked")).toBe("blocked");
  });

  it("gives a descriptive tag a stable colour", () => {
    // Stability is the property the whole scheme rests on — a tag that changed
    // colour between cards would be worse than no colour at all.
    expect(tagAccent("scail-2")).toBe(tagAccent("scail-2"));
    expect(tagAccent("scail-2")).toBe(tagAccent("SCAIL-2"));
    expect(["place", "role", "source"]).toContain(tagAccent("scail-2"));
  });

  it("spreads tags that share a prefix across families", () => {
    // The reason for FNV-1a rather than a character sum: these differ in one
    // trailing digit, and a summing hash walks them through adjacent buckets.
    const accents = new Set(
      ["shot-01", "shot-02", "shot-03", "shot-04", "shot-05", "shot-06"].map(tagAccent),
    );
    expect(accents.size).toBeGreaterThan(1);
  });

  it("never calls an ordinary word a status", () => {
    expect(isStatusTag("exterior")).toBe(false);
    expect(isStatusTag("wan2.1")).toBe(false);
    // `ok` is deliberately absent from the status words — as a substring it
    // would claim both of these.
    expect(isStatusTag("smoke-test")).toBe(false);
    expect(isStatusTag("look-dev")).toBe(false);
  });
});

describe("sortTagsStatusFirst", () => {
  it("puts status first so it survives truncation", () => {
    expect(sortTagsStatusFirst(["exterior", "night", "approved"])).toEqual([
      "approved",
      "exterior",
      "night",
    ]);
  });

  it("keeps the original order within each class", () => {
    // Stable, so adding one tag cannot reshuffle the chips already on a card.
    expect(sortTagsStatusFirst(["night", "wip", "exterior", "approved"])).toEqual([
      "wip",
      "approved",
      "night",
      "exterior",
    ]);
  });

  it("returns a new array and leaves the input alone", () => {
    const tags = ["night", "approved"];
    expect(sortTagsStatusFirst(tags)).not.toBe(tags);
    expect(tags).toEqual(["night", "approved"]);
  });
});
