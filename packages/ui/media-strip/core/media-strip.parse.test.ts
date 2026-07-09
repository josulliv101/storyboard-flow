import { describe, expect, test } from "vitest";
import { type TimelineItem } from "./media-strip.types";
import { validateTimelineItem } from "./media-strip.validation";
import {
  parseTimelineItem,
  parseTimelineCollection,
  parseTimelineCollectionsById,
} from "./media-strip.parse";

describe("parseTimelineItem: structural rejection (never throws)", () => {
  test.each([null, undefined, 42, "a string", true, []])(
    "rejects non-object input %p with reason 'not-an-object'",
    (input) => {
      const result = parseTimelineItem(input);
      expect(result).toEqual({ ok: false, error: { reason: "not-an-object" } });
    }
  );

  test("rejects an object with no 'kind' field at all", () => {
    const result = parseTimelineItem({ id: "x", name: "X" });
    expect(result).toEqual({ ok: false, error: { reason: "missing-kind" } });
  });

  test("rejects an object with kind: undefined the same as a missing kind", () => {
    // `"kind" in input` is true even when the value is undefined, so this
    // must fall through to invalid-kind, not crash trying to look up
    // validators[undefined] the way validateTimelineItem's dispatcher would.
    const result = parseTimelineItem({ kind: undefined, id: "x", name: "X" });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-kind", kind: undefined } });
  });

  test("rejects an unrecognized kind string instead of crashing on dispatch", () => {
    const result = parseTimelineItem({ kind: "audio", id: "x", name: "X" });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-kind", kind: "audio" } });
  });

  test("rejects a non-string kind", () => {
    const result = parseTimelineItem({ kind: 42, id: "x", name: "X" });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-kind", kind: 42 } });
  });

  test("this is exactly the input shape that crashes the raw validateTimelineItem dispatcher", () => {
    // Documents *why* this module exists: validateTimelineItem trusts the
    // discriminated-union shape is already correct, so an invalid `kind`
    // makes its `validators[item.kind]` lookup undefined, and calling
    // `undefined(item)` throws — instead of returning a validation failure.
    const malformed = { kind: "audio", id: "x", name: "X" } as unknown as TimelineItem;
    expect(() => validateTimelineItem(malformed)).toThrow();

    // The parser handles the identical input gracefully.
    expect(() => parseTimelineItem(malformed)).not.toThrow();
  });
});

describe("parseTimelineItem: per-field shape checks", () => {
  const validImageBase = {
    kind: "image",
    id: "img-1",
    name: "Image",
    src: "img.png",
    startTimeSeconds: 0,
    durationSeconds: 5,
  };

  test("rejects a non-string id", () => {
    const result = parseTimelineItem({ ...validImageBase, id: 42 });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-field", field: "id", expected: "string" } });
  });

  test("rejects a non-string name", () => {
    const result = parseTimelineItem({ ...validImageBase, name: null });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-field", field: "name", expected: "string" } });
  });

  test("rejects a non-number startTimeSeconds", () => {
    const result = parseTimelineItem({ ...validImageBase, startTimeSeconds: "0" });
    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-field", field: "startTimeSeconds", expected: "number" },
    });
  });

  test("rejects a non-string src on a media item", () => {
    const result = parseTimelineItem({ ...validImageBase, src: 123 });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-field", field: "src", expected: "string" } });
  });

  test("rejects posterSrcs that isn't an array of strings", () => {
    const result = parseTimelineItem({ ...validImageBase, posterSrcs: ["a", 5, "c"] });
    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-field", field: "posterSrcs", expected: "string[]" },
    });
  });

  test("accepts a missing (undefined) posterSrcs — it's optional", () => {
    const result = parseTimelineItem(validImageBase);
    expect(result.ok).toBe(true);
  });

  test("rejects a non-number itemCount on a collection item", () => {
    const result = parseTimelineItem({
      kind: "collection",
      id: "col-item-1",
      name: "Folder",
      collectionId: "col-1",
      itemCount: "5",
      startTimeSeconds: 0,
      durationSeconds: 5,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-field", field: "itemCount", expected: "number" },
    });
  });

  test("rejects a non-number trimInSeconds on a video item", () => {
    const result = parseTimelineItem({
      kind: "video",
      id: "vid-1",
      name: "Video",
      src: "vid.mp4",
      startTimeSeconds: 0,
      sourceDurationSeconds: 10,
      trimInSeconds: "0",
      trimOutSeconds: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-field", field: "trimInSeconds", expected: "number" },
    });
  });
});

describe("parseTimelineItem: happy paths", () => {
  test("parses a valid image item", () => {
    const result = parseTimelineItem({
      kind: "image",
      id: "img-1",
      name: "Image",
      src: "img.png",
      posterSrcs: ["poster.png"],
      startTimeSeconds: 0,
      durationSeconds: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("image");
      expect(result.value.id).toBe("img-1");
    }
  });

  test("parses a valid video item, deriving durationSeconds from trim points", () => {
    const result = parseTimelineItem({
      kind: "video",
      id: "vid-1",
      name: "Video",
      src: "vid.mp4",
      startTimeSeconds: 0,
      sourceDurationSeconds: 20,
      trimInSeconds: 5,
      trimOutSeconds: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "video") {
      expect(result.value.durationSeconds).toBe(10);
    }
  });

  test("parses a valid collection item", () => {
    const result = parseTimelineItem({
      kind: "collection",
      id: "col-item-1",
      name: "Folder",
      collectionId: "col-1",
      itemCount: 3,
      startTimeSeconds: 0,
      durationSeconds: 10,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "collection") {
      expect(result.value.collectionId).toBe("col-1");
    }
  });
});

describe("parseTimelineItem: value-level validation still applies once shape is safe", () => {
  test("propagates an empty-name failure from the underlying smart constructor", () => {
    const result = parseTimelineItem({
      kind: "image",
      id: "img-1",
      name: "   ",
      src: "img.png",
      startTimeSeconds: 0,
      durationSeconds: 5,
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-value", error: { valid: false, reason: "empty-name" } },
    });
  });

  test("propagates a trim-exceeds-source failure for a video item", () => {
    const result = parseTimelineItem({
      kind: "video",
      id: "vid-1",
      name: "Video",
      src: "vid.mp4",
      startTimeSeconds: 0,
      sourceDurationSeconds: 5,
      trimInSeconds: 10,
      trimOutSeconds: 10,
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-value", error: { valid: false, reason: "trim-exceeds-source" } },
    });
  });
});

describe("parseTimelineCollection", () => {
  test("rejects non-object input", () => {
    expect(parseTimelineCollection(null)).toEqual({ ok: false, error: { reason: "not-an-object" } });
  });

  test("rejects a missing/non-string id", () => {
    const result = parseTimelineCollection({ name: "Root", items: [] });
    expect(result).toEqual({ ok: false, error: { reason: "invalid-field", field: "id", expected: "string" } });
  });

  test("rejects items that isn't an array", () => {
    const result = parseTimelineCollection({ id: "col-1", name: "Root", items: "nope" });
    expect(result).toEqual({ ok: false, error: { reason: "items-not-an-array" } });
  });

  test("surfaces a malformed item's error with its index", () => {
    const result = parseTimelineCollection({
      id: "col-1",
      name: "Root",
      items: [
        { kind: "image", id: "img-1", name: "Good", src: "a.png", startTimeSeconds: 0, durationSeconds: 5 },
        { kind: "bogus", id: "img-2" },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-item", index: 1, error: { reason: "invalid-kind", kind: "bogus" } },
    });
  });

  test("rejects duplicate item ids within the collection via validateTimelineCollection", () => {
    const dup = { kind: "image", id: "img-1", name: "Dup", src: "a.png", startTimeSeconds: 0, durationSeconds: 5 };
    const result = parseTimelineCollection({ id: "col-1", name: "Root", items: [dup, dup] });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.reason === "invalid-value") {
      expect(result.error.validation).toMatchObject({ valid: false, reason: "duplicate-item-ids" });
    }
  });

  test("parses a valid collection with mixed item kinds", () => {
    const result = parseTimelineCollection({
      id: "col-1",
      name: "Root",
      items: [
        { kind: "image", id: "img-1", name: "Image", src: "a.png", startTimeSeconds: 0, durationSeconds: 5 },
        {
          kind: "collection", id: "col-item-1", name: "Folder", collectionId: "col-2", itemCount: 0,
          startTimeSeconds: 5, durationSeconds: 5,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items.map((i) => i.id)).toEqual(["img-1", "col-item-1"]);
    }
  });
});

describe("parseTimelineCollectionsById", () => {
  test("rejects non-object input", () => {
    expect(parseTimelineCollectionsById(null)).toEqual({ ok: false, error: { reason: "not-an-object" } });
  });

  test("surfaces a malformed collection's error with its key", () => {
    const result = parseTimelineCollectionsById({
      "col-a": { id: "col-a", name: "A", items: [] },
      "col-b": { id: "col-b", name: "B", items: "not-an-array" },
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: "invalid-collection", key: "col-b", error: { reason: "items-not-an-array" } },
    });
  });

  test("rejects an object key that doesn't match the parsed collection's id", () => {
    // Would otherwise silently key this collection under "col-b" (its parsed
    // id) rather than "col-a" (where the caller wrote it).
    const result = parseTimelineCollectionsById({
      "col-a": { id: "col-b", name: "Drifted", items: [] },
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: "collection-id-key-mismatch", key: "col-a", collectionId: "col-b" },
    });
  });

  test("two keys resolving to the same id surface as a key mismatch, never a silent overwrite", () => {
    // The pre-guard hazard: both entries parse fine and the second's
    // `result.set(id)` clobbers the first. With key===id enforced, the first
    // entry whose key differs from its id is rejected up front.
    const result = parseTimelineCollectionsById({
      "col-a": { id: "shared", name: "First", items: [] },
      "col-b": { id: "shared", name: "Second", items: [] },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("collection-id-key-mismatch");
    }
  });

  test("parses a valid multi-collection project into a Map keyed by parsed CollectionId", () => {
    const result = parseTimelineCollectionsById({
      "col-a": { id: "col-a", name: "A", items: [] },
      "col-b": { id: "col-b", name: "B", items: [] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.from(result.value.keys()).sort()).toEqual(["col-a", "col-b"]);
      expect(result.value.get("col-a" as never)?.name).toBe("A");
    }
  });
});
