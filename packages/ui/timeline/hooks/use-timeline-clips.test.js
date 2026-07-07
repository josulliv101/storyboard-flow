import { describe, expect, it } from "vitest";
import { CLIP_GAP_SECONDS } from "../constants";
import { editVideoSourceWindowFromBaseline, layoutClipsAroundAnchor, packClipsLeftToRight, resizeClipsFromBaseline, } from "./use-timeline-clips";
function clip(overrides = {}) {
    return Object.assign({ id: "clip-0", index: 0, kind: "video", src: "/fixture.mp4", alt: "Fixture", aspect: 16 / 9, trackIndex: 0, startTime: 0, duration: 4, sourceDuration: 10, trimIn: 3, trimOut: 3 }, overrides);
}
describe("timeline clip math", () => {
    it("packs clips without collisions", () => {
        const packed = packClipsLeftToRight([
            clip(),
            clip({ id: "clip-1", index: 1, startTime: 20, duration: 2 }),
        ], 0, clip());
        expect(packed[0].startTime).toBe(0);
        expect(packed[1].startTime).toBeCloseTo(4 + CLIP_GAP_SECONDS);
    });
    it("lays out both sides of an anchored clip", () => {
        const clips = [
            clip({ id: "clip-0", index: 0, duration: 2 }),
            clip({ id: "clip-1", index: 1, startTime: 2.12, duration: 3 }),
            clip({ id: "clip-2", index: 2, startTime: 5.24, duration: 2 }),
        ];
        const next = layoutClipsAroundAnchor(clips, 1, Object.assign(Object.assign({}, clips[1]), { startTime: 10, duration: 4 }));
        expect(next[0].startTime + next[0].duration + CLIP_GAP_SECONDS).toBeCloseTo(10);
        expect(next[2].startTime).toBeCloseTo(14 + CLIP_GAP_SECONDS);
    });
    it("left trim grows into available source and preserves trim accounting", () => {
        const [resized] = resizeClipsFromBaseline({
            baselineClips: [clip()],
            anchorIndex: 0,
            edge: "left",
            deltaTime: -2,
            minDuration: 0.6,
        });
        expect(resized.duration).toBe(6);
        expect(resized.trimIn).toBe(1);
        expect(resized.trimIn + resized.duration + resized.trimOut).toBe(10);
    });
    it("enforces minimum duration while right trimming", () => {
        const [resized] = resizeClipsFromBaseline({
            baselineClips: [clip()],
            anchorIndex: 0,
            edge: "right",
            deltaTime: -20,
            minDuration: 0.6,
        });
        expect(resized.duration).toBe(0.6);
        expect(resized.trimOut).toBeCloseTo(6.4);
    });
    it("resizes images without source-duration clamping", () => {
        const [resized] = resizeClipsFromBaseline({
            baselineClips: [clip({ kind: "image", duration: 4, sourceDuration: 4, trimIn: 0, trimOut: 0 })],
            anchorIndex: 0,
            edge: "right",
            deltaTime: 2,
            minDuration: 0.6,
        });
        expect(resized.duration).toBe(6);
        expect(resized.sourceDuration).toBe(6);
        expect(resized.trimIn).toBe(0);
        expect(resized.trimOut).toBe(0);
    });
    it("moves a video source window without changing visible duration", () => {
        const [edited] = editVideoSourceWindowFromBaseline({
            baselineClips: [clip()],
            anchorIndex: 0,
            mode: "move",
            deltaTime: 2,
            minDuration: 0.6,
        });
        expect(edited.duration).toBe(4);
        expect(edited.trimIn).toBe(1);
        expect(edited.trimOut).toBe(5);
    });
    it("uses image source handles to resize duration", () => {
        const [edited] = editVideoSourceWindowFromBaseline({
            baselineClips: [clip({ kind: "image", duration: 4, sourceDuration: 4, trimIn: 0, trimOut: 0 })],
            anchorIndex: 0,
            mode: "right",
            deltaTime: 2,
            minDuration: 0.6,
        });
        expect(edited.duration).toBe(6);
        expect(edited.sourceDuration).toBe(6);
        expect(edited.trimIn).toBe(0);
        expect(edited.trimOut).toBe(0);
    });
    it("ignores source-window editing for images", () => {
        const image = clip({ kind: "image" });
        const baseline = [image];
        const result = editVideoSourceWindowFromBaseline({
            baselineClips: baseline,
            anchorIndex: 0,
            mode: "move",
            deltaTime: 2,
            minDuration: 0.6,
        });
        expect(result).toBe(baseline);
        expect(result[0]).toEqual(image);
    });
});
