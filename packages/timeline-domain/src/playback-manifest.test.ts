import { describe, expect, it } from "vitest";

import { CLIP_GAP_SECONDS } from "@storyboard/timeline-model";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import { compilePlaybackManifest, manifestToClips } from "./playback-manifest";

function image(id: string, startTime: number, duration: number): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://cdn.test/${id}.jpg`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function video(
  id: string,
  startTime: number,
  duration: number,
  { sourceDuration = duration, trimIn = 0 }: { sourceDuration?: number; trimIn?: number } = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "video",
    src: `https://cdn.test/${id}.mp4`,
    poster: `https://cdn.test/${id}.jpg`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration,
    trimIn,
    trimOut: Math.max(0, sourceDuration - trimIn - duration),
  };
}

function collection(
  id: string,
  childTimelineId: string,
  startTime: number,
  duration: number,
  { sourceDuration = duration, trimIn = 0 }: { sourceDuration?: number; trimIn?: number } = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: id,
    childTimelineId,
    itemCount: 0,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration,
    trimIn,
    trimOut: Math.max(0, sourceDuration - trimIn - duration),
  };
}

function doc(id: string, clips: TimelineClip[]): TimelineDocument {
  return { id, title: id, clips };
}

const AT = "2026-07-18T00:00:00.000Z";

describe("compilePlaybackManifest", () => {
  it("flattens a nested closure into ordered absolute-time media leaves", () => {
    // root: [intro image 0-4][scene collection 4-10 -> scene doc][outro video 10-16]
    // scene: [a image 0-2][b video 2-6]  (natural length 6 = collection span 6)
    const documents = {
      root: doc("root", [
        image("intro", 0, 4),
        collection("scene-ref", "scene", 4, 6),
        video("outro", 10, 6),
      ]),
      scene: doc("scene", [image("a", 0, 2), video("b", 2, 4)]),
    };

    const manifest = compilePlaybackManifest(documents, "root", 7, AT);

    expect(manifest.durationSeconds).toBe(16);
    expect(manifest.projectRevision).toBe(7);
    expect(manifest.leaves.map((leaf) => leaf.id)).toEqual(["intro", "a", "b", "outro"]);
    const a = manifest.leaves[1];
    expect(a.collectionPath).toEqual(["root", "scene"]);
    expect(a.timelineStart).toBeCloseTo(4, 6); // scene starts at 4 in root time
    expect(a.timelineDuration).toBeCloseTo(2, 6); // unscaled: span matches source
    expect(a.playbackRate).toBeCloseTo(1, 6);
    const b = manifest.leaves[2];
    expect(b.timelineStart).toBeCloseTo(6, 6);
    expect(b.sourceStart).toBe(0);
  });

  it("windows leaves under a trimmed collection clip (model invariant: rate 1)", () => {
    // Stored clips keep trimIn + duration + trimOut === sourceDuration, so a
    // trimmed collection shows a WINDOW of its source at rate 1: here the
    // 8s scene trimmed to [2..4], displayed for 2s of root time.
    const documents = {
      root: doc("root", [
        collection("scene-ref", "scene", 0, 2, { sourceDuration: 8, trimIn: 2 }),
      ]),
      scene: doc("scene", [image("a", 0, 4), image("b", 4, 4)]),
    };

    const manifest = compilePlaybackManifest(documents, "root", 1, AT);

    // Only `a` overlaps the [2..4] window; `b` (4..8) is trimmed away.
    expect(manifest.leaves.map((leaf) => leaf.id)).toEqual(["a"]);
    const [a] = manifest.leaves;
    expect(a.timelineStart).toBeCloseTo(0, 6);
    expect(a.timelineDuration).toBeCloseTo(2, 6);
    // `a` starts mid-source: 2s into its own 4s span.
    expect(a.sourceStart).toBeCloseTo(2, 6);
    expect(a.playbackRate).toBeCloseTo(1, 6);
  });

  it("time-scales leaves when a collection clip compresses its source range", () => {
    // Not expressible through the editor today (the invariant keeps rate 1),
    // but the stored model permits it — a 6s source window displayed in 2s
    // must play its content at 3x.
    const compressed: TimelineClip = {
      id: "scene-ref",
      index: 0,
      kind: "collection",
      title: "scene-ref",
      childTimelineId: "scene",
      itemCount: 0,
      alt: "scene-ref",
      aspect: 16 / 9,
      trackIndex: 0,
      startTime: 0,
      duration: 2,
      sourceDuration: 8,
      trimIn: 2,
      trimOut: 0, // window [2..8]: 6s of source in 2s of display
    };
    const documents = {
      root: doc("root", [compressed]),
      scene: doc("scene", [image("a", 0, 4), image("b", 4, 4)]),
    };

    const manifest = compilePlaybackManifest(documents, "root", 1, AT);

    expect(manifest.leaves.map((leaf) => leaf.id)).toEqual(["a", "b"]);
    const [a, b] = manifest.leaves;
    // Window [2..8]: 2s of `a`, 4s of `b`, compressed 3x onto 2s.
    expect(a.timelineDuration).toBeCloseTo(2 / 3, 6);
    expect(b.timelineStart).toBeCloseTo(2 / 3, 6);
    expect(b.timelineDuration).toBeCloseTo(4 / 3, 6);
    expect(a.sourceStart).toBeCloseTo(2, 6);
    expect(a.playbackRate).toBeCloseTo(3, 6);
  });

  it("fails loudly on a missing nested document", () => {
    const documents = {
      root: doc("root", [collection("ref", "ghost", 0, 3)]),
    };
    expect(() => compilePlaybackManifest(documents, "root", 1, AT)).toThrow(
      'Missing nested timeline "ghost".',
    );
  });

  it("fails loudly on a reference cycle", () => {
    const documents = {
      root: doc("root", [collection("ref-a", "a", 0, 3)]),
      a: doc("a", [collection("ref-root", "root", 0, 3)]),
    };
    expect(() => compilePlaybackManifest(documents, "root", 1, AT)).toThrow(
      /Collection cycle detected/,
    );
  });
});

describe("manifestToClips", () => {
  it("maps leaves onto player clips with path-qualified ids and exact source windows", () => {
    const documents = {
      root: doc("root", [collection("scene-ref", "scene", 0, 2, { sourceDuration: 8, trimIn: 2 })]),
      scene: doc("scene", [video("v", 0, 8)]),
    };
    const manifest = compilePlaybackManifest(documents, "root", 1, AT);
    const clips = manifestToClips(manifest);

    expect(clips).toHaveLength(1);
    const clip = clips[0];
    expect(clip.id).toBe("root/scene:v");
    expect(clip.kind).toBe("video");
    expect(clip.startTime).toBeCloseTo(0, 6);
    expect(clip.duration).toBeCloseTo(2, 6);
    // The player resolves source time as trimIn + progress * (sourceDuration
    // - trimIn - trimOut): with trimOut 0 this must span exactly
    // duration * playbackRate starting at sourceStart.
    expect(clip.trimIn).toBeCloseTo(2, 6);
    expect(clip.sourceDuration - clip.trimIn).toBeCloseTo(
      manifest.leaves[0].timelineDuration * manifest.leaves[0].playbackRate,
      6,
    );
  });
});

describe("disabled clips", () => {
  it("skips a disabled clip and CLOSES the gap it leaves", () => {
    // The closing is the point. Dropping "b" without repacking would leave
    // 0-4 and 8-12 occupied and 4-8 empty — and the player holds the last
    // drawn frame across an empty span, so "a" would freeze on screen for
    // four seconds instead of "b" being skipped.
    const documents = {
      root: doc("root", [
        image("a", 0, 4),
        { ...image("b", 4, 4), disabled: true },
        image("c", 8, 4),
      ]),
    };

    const manifest = compilePlaybackManifest(documents, "root", 1, AT);

    expect(manifest.leaves.map((leaf) => leaf.id)).toEqual(["a", "c"]);
    // "c" moved up into "b"'s span, and the total lost b's four seconds.
    // Expressed via CLIP_GAP_SECONDS because the survivors are REPACKED, so
    // they sit at the model's canonical spacing, not the fixture's literals.
    expect(manifest.leaves[1].timelineStart).toBeCloseTo(4 + CLIP_GAP_SECONDS, 6);
    expect(manifest.durationSeconds).toBeCloseTo(8 + CLIP_GAP_SECONDS, 6);
    // No hole beyond the standard inter-clip gap — which is what would make
    // the player freeze-frame rather than skip.
    const gap =
      manifest.leaves[1].timelineStart -
      (manifest.leaves[0].timelineStart + manifest.leaves[0].timelineDuration);
    expect(gap).toBeCloseTo(CLIP_GAP_SECONDS, 6);
  });

  it("skips a disabled collection's ENTIRE subtree", () => {
    const documents = {
      root: doc("root", [
        image("intro", 0, 4),
        { ...collection("scene-ref", "scene", 4, 6), disabled: true },
        image("outro", 10, 4),
      ]),
      scene: doc("scene", [image("deep-a", 0, 2), image("deep-b", 2, 4)]),
    };

    const manifest = compilePlaybackManifest(documents, "root", 1, AT);

    expect(manifest.leaves.map((leaf) => leaf.id)).toEqual(["intro", "outro"]);
    expect(manifest.durationSeconds).toBeCloseTo(8 + CLIP_GAP_SECONDS, 6);
  });

  it("skips a disabled clip nested inside a collection, and re-times the parent", () => {
    // The child shrinks from 6s to 2s, so the parent's collection clip has to
    // be re-timed too — otherwise its 6s span would window the child's 2s of
    // content and stretch or truncate it.
    const documents = {
      root: doc("root", [collection("scene-ref", "scene", 0, 2)]),
      scene: doc("scene", [
        image("keep", 0, 2),
        { ...image("drop", 2, 4), disabled: true },
      ]),
    };

    const manifest = compilePlaybackManifest(documents, "root", 1, AT);

    expect(manifest.leaves.map((leaf) => leaf.id)).toEqual(["keep"]);
    expect(manifest.leaves[0].playbackRate).toBeCloseTo(1, 6);
    expect(manifest.leaves[0].timelineDuration).toBeCloseTo(2, 6);
  });

  it("leaves an all-enabled closure byte-identical", () => {
    // The pass must be a no-op when nothing is disabled — it runs on every
    // compile, including for every document that never uses the feature.
    const documents = {
      root: doc("root", [image("a", 0, 4), collection("s", "scene", 4, 4)]),
      scene: doc("scene", [image("x", 0, 4)]),
    };
    const before = JSON.stringify(compilePlaybackManifest(documents, "root", 1, AT));
    const after = JSON.stringify(compilePlaybackManifest(documents, "root", 1, AT));
    expect(after).toBe(before);
    expect(JSON.parse(before).leaves.map((l: { id: string }) => l.id)).toEqual(["a", "x"]);
  });
});
