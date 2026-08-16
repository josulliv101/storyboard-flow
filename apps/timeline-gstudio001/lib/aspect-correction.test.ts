import { describe, expect, it } from "vitest";

// The corrector runs as a standalone script, so its decisions are a .mjs
// module — but they decide what gets WRITTEN to the user's real documents, so
// they are covered by the app suite rather than only by reading the dry run.
// Same arrangement as lib/render/ffmpeg-plan.test.ts over the render worker.
import {
  aspectOf,
  classify,
  correctableClips,
  scopeFrom,
  updateForDocument,
} from "../scripts/aspect-correction.mjs";

const SIXTEEN_NINE = 16 / 9;

const clip = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  kind: "video",
  src: "https://cdn.test/a.mp4",
  aspect: SIXTEEN_NINE,
  ...over,
});

/** A stored record in the shape `buildSavePayload` writes: the live document
 *  and the denormalized copy of its clips. */
const record = (clips: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({
  title: "A",
  revision: 3,
  document: { id: "d1", title: "A", clips },
  clips,
  ...over,
});

describe("aspectOf", () => {
  // The four real sources in this project, all of which stored 1.778 and none
  // of which is 16:9. This is the measurement that made #417 worth doing — the
  // claim "every source here is 16:9" came from the stored default, not the
  // files.
  it.each([
    [2864, 1204, 2.379],
    [896, 384, 2.333],
    [1152, 480, 2.4],
    [832, 480, 1.733],
  ])("measures %ix%i as %f, not 16:9", (width, height, expected) => {
    expect(aspectOf(width, height)).toBeCloseTo(expected, 3);
    expect(aspectOf(width, height)).not.toBeCloseTo(SIXTEEN_NINE, 3);
  });

  // Declining is the whole point: `aspect` is a DIVISOR, so a zero or a NaN
  // reaching storage is an infinity in layout math later.
  it.each([
    [0, 100],
    [100, 0],
    [-16, 9],
    [Number.NaN, 9],
    [Number.POSITIVE_INFINITY, 9],
  ])("declines %s x %s rather than inventing a ratio", (width, height) => {
    expect(aspectOf(width, height)).toBeUndefined();
  });

  it("declines a non-number, which is what a provider omitting the field sends", () => {
    expect(aspectOf(undefined, 9)).toBeUndefined();
    expect(aspectOf("1920", "1080")).toBeUndefined();
  });
});

describe("scopeFrom", () => {
  const documents = new Map<string, unknown>([
    ["p", record([{ kind: "collection", childTimelineId: "a" }])],
    ["a", record([{ kind: "collection", childTimelineId: "b" }, clip()])],
    ["b", record([clip()])],
    ["elsewhere", record([clip()])],
  ]);

  it("takes the whole subtree and nothing beside it", () => {
    expect(scopeFrom(documents, "p")).toEqual(new Set(["p", "a", "b"]));
  });

  it("returns null for an id that is not there, rather than an empty scope", () => {
    // An empty scope would print the same reassuring "nothing to do" as a
    // clean project, so a typo'd id has to be distinguishable.
    expect(scopeFrom(documents, "typo")).toBeNull();
  });

  it("terminates on a cycle", () => {
    const cyclic = new Map<string, unknown>([
      ["x", record([{ kind: "collection", childTimelineId: "y" }])],
      ["y", record([{ kind: "collection", childTimelineId: "x" }])],
    ]);
    expect(scopeFrom(cyclic, "x")).toEqual(new Set(["x", "y"]));
  });
});

describe("correctableClips", () => {
  it("skips collections — a container has no source file to measure", () => {
    const documents = new Map<string, unknown>([
      [
        "d",
        record([
          { kind: "collection", childTimelineId: "c", id: "col", aspect: SIXTEEN_NINE },
          clip({ id: "v" }),
        ]),
      ],
    ]);
    expect(correctableClips(documents).map((found) => found.clipId)).toEqual(["v"]);
  });

  it("skips a clip with no src, which there is no way to probe", () => {
    const documents = new Map<string, unknown>([["d", record([clip({ id: "v", src: "" })])]]);
    expect(correctableClips(documents)).toEqual([]);
  });

  it("keeps the INDEX from the array it read, which is what the write addresses", () => {
    const documents = new Map<string, unknown>([
      ["d", record([clip({ id: "a" }), clip({ id: "b" }), clip({ id: "c" })])],
    ]);
    expect(correctableClips(documents).map((found) => [found.clipId, found.index])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("tells a clip storing no aspect apart from one storing a wrong one", () => {
    // A snapshot taken before the field was carried has no `aspect` KEY.
    // Reporting those as "wrong" would print every clip in the collection.
    const documents = new Map<string, unknown>([
      ["d", record([clip({ id: "has" }), { id: "none", kind: "video", src: "https://cdn.test/b.mp4" }])],
    ]);
    const found = correctableClips(documents);
    expect(found[0].stored).toBe(SIXTEEN_NINE);
    expect(found[1].stored).toBeUndefined();
  });

  it("reads a record that carries only the denormalized copy", () => {
    const documents = new Map<string, unknown>([
      ["d", { title: "legacy", clips: [clip({ id: "v" })] }],
    ]);
    expect(correctableClips(documents).map((found) => found.clipId)).toEqual(["v"]);
  });
});

describe("classify", () => {
  const measurements = new Map([
    ["https://cdn.test/scope.mp4", { width: 1152, height: 480, aspect: 2.4 }],
  ]);
  const found = (over: Record<string, unknown>) => ({
    documentId: "d",
    title: "A",
    index: 0,
    clipId: "c",
    alt: "",
    src: "https://cdn.test/scope.mp4",
    ...over,
  });

  it("calls a 16:9 default over a 2.4:1 source wrong", () => {
    const { wrong } = classify([found({ stored: SIXTEEN_NINE })], measurements);
    expect(wrong).toHaveLength(1);
    expect(wrong[0].measured.aspect).toBe(2.4);
  });

  it("leaves an already-correct clip alone", () => {
    const { wrong, alreadyRight } = classify([found({ stored: 2.4 })], measurements);
    expect(wrong).toHaveLength(0);
    expect(alreadyRight).toHaveLength(1);
  });

  it("does not call float noise a difference", () => {
    // 1920x1080 and 1280x720 are the same shape, and a stored ratio that came
    // from a divide will not land bit-identical on one that came from another.
    const { alreadyRight } = classify([found({ stored: 2.4000001 })], measurements);
    expect(alreadyRight).toHaveLength(1);
  });

  it("counts an unprobed source as unreadable rather than wrong", () => {
    // Audio, a 404, a timeout. Leaving a clip alone is always safe; writing a
    // number nothing measured is what this exists to undo.
    const { wrong, unreadable } = classify(
      [found({ stored: SIXTEEN_NINE, src: "https://cdn.test/vo.mp3" })],
      measurements,
    );
    expect(wrong).toHaveLength(0);
    expect(unreadable).toHaveLength(1);
  });

  it("corrects a clip that stores no aspect at all", () => {
    const { wrong } = classify([found({ stored: undefined })], measurements);
    expect(wrong).toHaveLength(1);
  });
});

/**
 * Narrow a value the .mjs module returns as nullable, failing the test if it
 * really is absent.
 *
 * `updateForDocument` genuinely returns `null` when nothing is safe to write,
 * and its keys are genuinely optional — the tests below have each just
 * asserted which case they are in, but TypeScript cannot see an `expect`. This
 * carries that knowledge across without reaching for a cast.
 */
function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value, got none");
  return value;
}

describe("updateForDocument", () => {
  const target = (over: Record<string, unknown> = {}) => ({
    documentId: "d",
    title: "A",
    index: 1,
    clipId: "b",
    alt: "",
    src: "https://cdn.test/a.mp4",
    stored: SIXTEEN_NINE,
    measured: { width: 1152, height: 480, aspect: 2.4 },
    ...over,
  });

  it("nests under `document`, because a dotted key in a merge is NOT a path", () => {
    // `set({"document.clips": …}, {merge: true})` writes a top-level field
    // whose NAME contains a dot and leaves the real clips untouched — only
    // `update()` walks a dotted path. It would look like it worked.
    const { update } = updateForDocument(record([clip({ id: "a" }), clip({ id: "b" })]), [target()]);
    expect(Object.keys(present(update))).toEqual(["document", "clips"]);
    expect(present(update)).not.toHaveProperty(["document.clips"]);
    expect(present(present(update).document).clips[1].aspect).toBe(2.4);
  });

  it("writes BOTH copies, so no reader can find them disagreeing", () => {
    const { update, applied } = updateForDocument(record([clip({ id: "a" }), clip({ id: "b" })]), [
      target(),
    ]);
    expect(present(present(update).document).clips[1].aspect).toBe(2.4);
    expect(present(present(update).clips)[1].aspect).toBe(2.4);
    expect(applied).toBe(1);
  });

  it("changes only the aspect, leaving the rest of the clip as it was", () => {
    const original = clip({ id: "b", trimIn: 1.5, tags: ["keeper"], trackIndex: 2 });
    const { update } = updateForDocument(record([clip({ id: "a" }), original]), [target()]);
    expect(present(present(update).clips)[1]).toEqual({ ...original, aspect: 2.4 });
    expect(present(present(update).clips)[0]).toEqual(clip({ id: "a" }));
  });

  it("REFUSES a clip whose index now names something else", () => {
    // The document was re-ordered between the read and the write. Writing a
    // measured aspect onto whatever now sits at that index would corrupt the
    // very field this came to repair.
    const { update, skipped, applied } = updateForDocument(
      record([clip({ id: "a" }), clip({ id: "somethingElse" })]),
      [target()],
    );
    expect(update).toBeNull();
    expect(skipped).toHaveLength(1);
    expect(applied).toBe(0);
  });

  it("writes the clips that still match while refusing the one that does not", () => {
    const { update, skipped, applied } = updateForDocument(
      record([clip({ id: "a" }), clip({ id: "b" }), clip({ id: "moved" })]),
      [target(), target({ index: 2, clipId: "c" })],
    );
    expect(present(present(update).clips)[1].aspect).toBe(2.4);
    expect(present(present(update).clips)[2].aspect).toBe(SIXTEEN_NINE);
    expect(skipped).toHaveLength(1);
    expect(applied).toBe(1);
  });

  it("leaves a drifted denormalized copy alone rather than scrambling it", () => {
    const live = [clip({ id: "a" }), clip({ id: "b" })];
    const drifted = [clip({ id: "b" })];
    const { update } = updateForDocument({ document: { clips: live }, clips: drifted }, [target()]);
    expect(present(present(update).document).clips[1].aspect).toBe(2.4);
    expect(present(update)).not.toHaveProperty("clips");
  });

  it("writes a record that carries only the denormalized copy", () => {
    const { update } = updateForDocument({ clips: [clip({ id: "a" }), clip({ id: "b" })] }, [
      target(),
    ]);
    expect(present(update)).not.toHaveProperty("document");
    expect(present(present(update).clips)[1].aspect).toBe(2.4);
  });

  it("never mutates the record it was given", () => {
    // The caller holds these documents for the whole run and reports from
    // them; a write that edited them in place would make the summary describe
    // a state that was never stored if a later batch failed.
    const stored = record([clip({ id: "a" }), clip({ id: "b" })]);
    updateForDocument(stored, [target()]);
    expect(present(stored.document.clips[1]).aspect).toBe(SIXTEEN_NINE);
    expect(present(stored.clips[1]).aspect).toBe(SIXTEEN_NINE);
  });
});
