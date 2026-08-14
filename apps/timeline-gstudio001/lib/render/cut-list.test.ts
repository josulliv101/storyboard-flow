import { describe, expect, it } from "vitest";

import type { PlaybackLeaf, PlaybackManifest } from "@storyboard/timeline-domain";

import { DEFAULT_RENDER_FORMAT, compileCutList } from "./cut-list";

// The board's spacing, baked into every stored startTime. The whole point of
// the compiler is that this never reaches the output.
const GAP = 0.12;

function leaf(over: Partial<PlaybackLeaf> & { id: string }): PlaybackLeaf {
  return {
    collectionPath: ["root"],
    kind: "video",
    src: `https://cdn.test/${over.id}.mp4`,
    timelineStart: 0,
    timelineDuration: 4,
    sourceStart: 0,
    playbackRate: 1,
    ...over,
  };
}

/** Leaves laid out the way the board lays them: each after the last, plus a gap. */
function packed(leaves: (Partial<PlaybackLeaf> & { id: string })[]): PlaybackLeaf[] {
  let start = 0;
  return leaves.map((spec) => {
    const built = leaf({ ...spec, timelineStart: start });
    start += built.timelineDuration + GAP;
    return built;
  });
}

function manifestOf(leaves: readonly PlaybackLeaf[]): PlaybackManifest {
  const durationSeconds = leaves.reduce(
    (total, l) => Math.max(total, l.timelineStart + l.timelineDuration),
    0,
  );
  return {
    projectId: "project-1",
    projectRevision: 3,
    durationSeconds,
    leaves,
    compiledAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("compileCutList", () => {
  it("is empty for an empty timeline", () => {
    const list = compileCutList(manifestOf([]));
    expect(list.cuts).toEqual([]);
    expect(list.durationSeconds).toBe(0);
  });

  it("CLOSES THE GAPS — cuts touch, and the output is shorter than the board", () => {
    const manifest = manifestOf(packed([{ id: "a" }, { id: "b" }, { id: "c" }]));
    // The board spans 3 clips + 2 gaps; a naive export would carry both gaps.
    expect(manifest.durationSeconds).toBeCloseTo(12 + GAP * 2, 6);

    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.outputStart)).toEqual([0, 4, 8]);
    expect(list.durationSeconds).toBe(12);
  });

  it("DROPS DISABLED LEAVES and closes the hole they leave", () => {
    const manifest = manifestOf(
      packed([{ id: "a" }, { id: "b", disabled: true }, { id: "c" }]),
    );

    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.src)).toEqual([
      "https://cdn.test/a.mp4",
      "https://cdn.test/c.mp4",
    ]);
    // c follows a immediately — no silence where b was.
    expect(list.cuts.map((cut) => cut.outputStart)).toEqual([0, 4]);
    expect(list.durationSeconds).toBe(8);
  });

  it("drops a leaf disabled by an ANCESTOR collection the same way", () => {
    // The manifest sets `disabled` on the leaf whether the leaf's own clip or
    // a collection above it was switched off, so the compiler needs no second
    // rule for the inherited case.
    const manifest = manifestOf(packed([{ id: "a", disabled: true }, { id: "b" }]));
    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.src)).toEqual(["https://cdn.test/b.mp4"]);
    expect(list.cuts[0]?.outputStart).toBe(0);
  });

  it("is empty when everything is disabled, rather than emitting black", () => {
    const manifest = manifestOf(packed([{ id: "a", disabled: true }, { id: "b", disabled: true }]));
    const list = compileCutList(manifest);
    expect(list.cuts).toEqual([]);
    expect(list.durationSeconds).toBe(0);
  });

  it("carries the source in-point and rate a trimmed, scaled leaf resolved to", () => {
    const manifest = manifestOf([
      leaf({ id: "a", timelineStart: 0, timelineDuration: 2, sourceStart: 4.2, playbackRate: 2 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.cuts[0]).toMatchObject({
      sourceStart: 4.2,
      playbackRate: 2,
      outputDuration: 2,
      outputStart: 0,
    });
  });

  it("normalises an image's source timing rather than making the worker know", () => {
    // An image has no source timeline to seek into or play at a rate.
    const manifest = manifestOf([
      leaf({
        id: "still",
        kind: "image",
        src: "https://cdn.test/still.png",
        sourceStart: 9,
        playbackRate: 3,
      }),
    ]);
    const list = compileCutList(manifest);
    expect(list.cuts[0]).toMatchObject({ kind: "image", sourceStart: 0, playbackRate: 1 });
  });

  it("keeps audio as an ordinary cut — phase 1 is a sequence", () => {
    // Layered audio is not expressible in the stored model yet (trackIndex is
    // always 0), so an audio leaf occupies its own slot like anything else.
    // Pinned so that changing it is a decision rather than a surprise.
    const manifest = manifestOf(
      packed([{ id: "vo", kind: "audio", src: "https://cdn.test/vo.wav" }, { id: "b" }]),
    );
    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.kind)).toEqual(["audio", "video"]);
    expect(list.cuts.map((cut) => cut.outputStart)).toEqual([0, 4]);
  });

  it("orders by TIME, not by array position", () => {
    const manifest = manifestOf([
      leaf({ id: "late", timelineStart: 10, timelineDuration: 2 }),
      leaf({ id: "early", timelineStart: 0, timelineDuration: 2 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.src)).toEqual([
      "https://cdn.test/early.mp4",
      "https://cdn.test/late.mp4",
    ]);
  });

  it("drops a zero-length leaf rather than emitting a cut no frame can hold", () => {
    const manifest = manifestOf([
      leaf({ id: "a", timelineStart: 0, timelineDuration: 4 }),
      leaf({ id: "sliver", timelineStart: 4, timelineDuration: 0 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.src)).toEqual(["https://cdn.test/a.mp4"]);
  });

  it("defaults to the format the cuts use today, and takes an override", () => {
    const manifest = manifestOf(packed([{ id: "a" }]));
    expect(compileCutList(manifest).format).toEqual(DEFAULT_RENDER_FORMAT);
    expect(DEFAULT_RENDER_FORMAT).toEqual({ width: 1152, height: 480, fps: 24 });

    const square = compileCutList(manifest, { width: 1080, height: 1080, fps: 30 });
    expect(square.format).toEqual({ width: 1080, height: 1080, fps: 30 });
  });

  it("leaves the manifest untouched — the sort must not reorder the input", () => {
    const leaves = [
      leaf({ id: "late", timelineStart: 10 }),
      leaf({ id: "early", timelineStart: 0 }),
    ];
    const manifest = manifestOf(leaves);
    compileCutList(manifest);
    expect(manifest.leaves.map((l) => l.id)).toEqual(["late", "early"]);
  });
});
