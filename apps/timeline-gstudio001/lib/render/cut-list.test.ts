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
    // Lane 0 unless a case overrides it — every cut-list test so far is a
    // single sequence.
    trackIndex: 0,
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

  it("defaults to 16:9, and takes an override", () => {
    // The default is a DELIVERABLE decision, not a description of the sources
    // — this project's material is mostly ~2.35:1 — and a project that wants
    // something else stores its own (`TimelineDocument.renderFormat`).
    const manifest = manifestOf(packed([{ id: "a" }]));
    expect(compileCutList(manifest).format).toEqual(DEFAULT_RENDER_FORMAT);
    expect(DEFAULT_RENDER_FORMAT).toEqual({ width: 1280, height: 720, fps: 24 });
    expect(DEFAULT_RENDER_FORMAT.width / DEFAULT_RENDER_FORMAT.height).toBeCloseTo(16 / 9, 6);

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

// ── LANES (phase 2) ─────────────────────────────────────────────────────────
//
// Lane 0 is the picture and concatenates; anything above it runs UNDER and
// must be repositioned, because closing the gaps moves the picture out from
// under it.

describe("compileCutList — layers", () => {
  it("has no layers at all for a timeline that uses none", () => {
    const list = compileCutList(manifestOf(packed([{ id: "a" }, { id: "b" }])));
    expect(list.layers).toEqual([]);
  });

  it("keeps the picture out of the layers, and the layers out of the picture", () => {
    const manifest = manifestOf([
      ...packed([{ id: "shot-1" }, { id: "shot-2" }]),
      leaf({
        id: "bed",
        kind: "audio",
        src: "https://cdn.test/bed.wav",
        trackIndex: 1,
        timelineStart: 0,
        timelineDuration: 30,
      }),
    ]);
    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.src)).toEqual([
      "https://cdn.test/shot-1.mp4",
      "https://cdn.test/shot-2.mp4",
    ]);
    expect(list.layers.map((cut) => cut.src)).toEqual(["https://cdn.test/bed.wav"]);
  });

  it("THE PICTURE decides the length, and a long bed is clipped to it", () => {
    // A 30s bed under 8s of picture makes an 8s film with the bed cut off —
    // which is what a bed is for. Extending to the longest layer would end the
    // film on however much black the bed had left.
    const manifest = manifestOf([
      ...packed([{ id: "shot-1" }, { id: "shot-2" }]),
      leaf({ id: "bed", trackIndex: 1, timelineStart: 0, timelineDuration: 30 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.durationSeconds).toBe(8);
    expect(list.layers[0]).toMatchObject({ outputStart: 0, outputDuration: 8 });
  });

  it("REMAPS a layer through the closed gaps, so it stays on its shot", () => {
    // The bed lines up with shot-2, which starts at board 4.12 and output 4.
    // Positioning by board time would land it 0.12s late — and that error
    // compounds, a second across twenty joins, which is a VO on the wrong shot.
    const shots = packed([{ id: "shot-1" }, { id: "shot-2" }, { id: "shot-3" }]);
    const shot2Start = shots[1]!.timelineStart;
    const manifest = manifestOf([
      ...shots,
      leaf({ id: "vo", trackIndex: 1, timelineStart: shot2Start, timelineDuration: 4 }),
    ]);
    const list = compileCutList(manifest);
    expect(shot2Start).toBeCloseTo(4 + GAP, 6);
    expect(list.layers[0]?.outputStart).toBe(4);
  });

  it("remaps a layer that starts INSIDE a shot to the same offset within it", () => {
    const shots = packed([{ id: "shot-1" }, { id: "shot-2" }]);
    const oneIntoShot2 = shots[1]!.timelineStart + 1;
    const manifest = manifestOf([
      ...shots,
      leaf({ id: "vo", trackIndex: 1, timelineStart: oneIntoShot2, timelineDuration: 2 }),
    ]);
    expect(compileCutList(manifest).layers[0]?.outputStart).toBe(5);
  });

  it("pulls a layer that starts IN A GAP forward to the next shot", () => {
    // The gap does not exist in the output, so there is nowhere else for it.
    const shots = packed([{ id: "shot-1" }, { id: "shot-2" }]);
    const inTheGap = shots[0]!.timelineDuration + GAP / 2;
    const manifest = manifestOf([
      ...shots,
      leaf({ id: "sting", trackIndex: 1, timelineStart: inTheGap, timelineDuration: 2 }),
    ]);
    expect(compileCutList(manifest).layers[0]?.outputStart).toBe(4);
  });

  it("DROPS a layer that starts after the picture ends", () => {
    // A layer is defined by what it runs under; with no picture left there is
    // nothing for it to be under.
    const shots = packed([{ id: "shot-1" }]);
    const manifest = manifestOf([
      ...shots,
      leaf({ id: "tail", trackIndex: 1, timelineStart: 100, timelineDuration: 5 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.layers).toEqual([]);
    expect(list.durationSeconds).toBe(4);
  });

  it("drops a disabled layer like any other disabled leaf", () => {
    const manifest = manifestOf([
      ...packed([{ id: "shot-1" }]),
      leaf({ id: "bed", trackIndex: 1, timelineStart: 0, timelineDuration: 4, disabled: true }),
    ]);
    expect(compileCutList(manifest).layers).toEqual([]);
  });

  it("closes the picture's gaps even when a DISABLED shot sat between them", () => {
    // The layer map is built from the surviving picture, so a dropped shot
    // pulls later layers forward with it rather than leaving them stranded.
    const shots = packed([{ id: "a" }, { id: "b", disabled: true }, { id: "c" }]);
    const cStart = shots[2]!.timelineStart;
    const manifest = manifestOf([
      ...shots,
      leaf({ id: "vo", trackIndex: 1, timelineStart: cStart, timelineDuration: 2 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.cuts.map((cut) => cut.outputStart)).toEqual([0, 4]);
    expect(list.layers[0]?.outputStart).toBe(4);
  });

  it("keeps SEVERAL layers, which is a VO over a bed", () => {
    const manifest = manifestOf([
      ...packed([{ id: "shot-1" }, { id: "shot-2" }]),
      leaf({ id: "bed", trackIndex: 1, timelineStart: 0, timelineDuration: 8 }),
      leaf({ id: "vo", trackIndex: 2, timelineStart: 0, timelineDuration: 3 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.layers.map((cut) => cut.src)).toEqual([
      "https://cdn.test/bed.mp4",
      "https://cdn.test/vo.mp4",
    ]);
  });

  it("has no picture, and therefore no layers, when only lanes above 0 survive", () => {
    // Nothing to run under. An audio-only export is a different feature.
    const manifest = manifestOf([
      leaf({ id: "bed", trackIndex: 1, timelineStart: 0, timelineDuration: 8 }),
    ]);
    const list = compileCutList(manifest);
    expect(list.cuts).toEqual([]);
    expect(list.layers).toEqual([]);
    expect(list.durationSeconds).toBe(0);
  });
});

// COMPOSITING FACTS reach the worker, and only when there is something to
// composite — `layers.some(has a rect)` has to stay an honest test of "does
// this render need a re-encode of the whole film".

const INSET = { x: 0.65, y: 0.6, width: 0.3 };

describe("compileCutList — layer frames", () => {
  it("carries the frame, the lane and the aspect for a framed layer", () => {
    const { layers } = compileCutList(
      manifestOf([
        ...packed([{ id: "shot", timelineDuration: 10 }]),
        leaf({
          id: "pip",
          trackIndex: 2,
          timelineStart: 1,
          timelineDuration: 3,
          layerFrame: INSET,
          aspect: 4 / 3,
        }),
      ]),
    );
    expect(layers[0]).toMatchObject({ layerFrame: INSET, trackIndex: 2, aspect: 4 / 3 });
  });

  it("emits NEITHER for a layer without a frame — sound only, and the copy stays", () => {
    const { layers } = compileCutList(
      manifestOf([
        ...packed([{ id: "shot", timelineDuration: 10 }]),
        leaf({ id: "bed", trackIndex: 1, timelineStart: 0, timelineDuration: 3 }),
      ]),
    );
    expect("layerFrame" in layers[0]!).toBe(false);
    expect("trackIndex" in layers[0]!).toBe(false);
  });

  it("REFUSES A FRAME ON AUDIO, which would paint black over the picture", () => {
    // A normalised audio segment has a SYNTHESISED BLACK video stream —
    // `segmentArgs` builds one so concat stays happy. Composite that and the
    // voiceover draws a black rectangle over the shot for its whole length.
    // Nothing stops a stored document carrying a frame on an audio clip, so
    // the refusal has to be here rather than assumed upstream.
    const { layers } = compileCutList(
      manifestOf([
        ...packed([{ id: "shot", timelineDuration: 10 }]),
        leaf({
          id: "vo",
          kind: "audio",
          trackIndex: 1,
          timelineStart: 0,
          timelineDuration: 3,
          layerFrame: INSET,
        }),
      ]),
    );
    expect("layerFrame" in layers[0]!).toBe(false);
  });

  it("never puts a frame on the PICTURE", () => {
    const { cuts } = compileCutList(
      manifestOf(packed([{ id: "shot", timelineDuration: 10, layerFrame: INSET }])),
    );
    expect("layerFrame" in cuts[0]!).toBe(false);
  });

  it("defaults a missing aspect to widescreen rather than dropping the frame", () => {
    const { layers } = compileCutList(
      manifestOf([
        ...packed([{ id: "shot", timelineDuration: 10 }]),
        leaf({ id: "pip", trackIndex: 1, timelineStart: 0, timelineDuration: 3, layerFrame: INSET }),
      ]),
    );
    expect(layers[0]).toMatchObject({ aspect: 16 / 9 });
  });
});
