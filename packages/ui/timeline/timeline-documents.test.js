import { describe, expect, it } from "vitest";
import { createTimelineDocumentsState, getCollectionClipFramePreviewFromState, isUnsavedProjectPlaceholder, registerTimelineDocumentInState, } from "./timeline-documents";
function mediaClip(overrides = {}) {
    return Object.assign({ id: "media-clip", index: 0, kind: "video", src: "/fixture.mp4", alt: "Fixture", aspect: 16 / 9, trackIndex: 0, startTime: 0, duration: 8, sourceDuration: 8, trimIn: 0, trimOut: 0 }, overrides);
}
function collectionClip(overrides = {}) {
    return Object.assign({ id: "collection-clip", index: 0, kind: "collection", title: "Collection", childTimelineId: "test-collection-source", itemCount: 1, alt: "Collection", aspect: 16 / 9, trackIndex: 0, startTime: 0, duration: 4, sourceDuration: 8, trimIn: 0, trimOut: 0 }, overrides);
}
describe("collection timeline playback mapping", () => {
    it("maps collection clip time onto source timeline time and playback rate", () => {
        const state = registerTimelineDocumentInState(createTimelineDocumentsState({}), {
            id: "test-collection-source",
            title: "Test collection source",
            clips: [mediaClip()],
        });
        const preview = getCollectionClipFramePreviewFromState(state, collectionClip(), 2);
        expect(preview === null || preview === void 0 ? void 0 : preview.id).toBe("media-clip");
        expect(preview === null || preview === void 0 ? void 0 : preview.previewTime).toBeCloseTo(4);
        expect(preview === null || preview === void 0 ? void 0 : preview.playbackRate).toBeCloseTo(2);
    });
    it("holds the previous child frame while scrubbing collection timeline gaps", () => {
        const state = registerTimelineDocumentInState(createTimelineDocumentsState({}), {
            id: "test-collection-source",
            title: "Test collection source",
            clips: [
                mediaClip({
                    id: "first-child",
                    startTime: 0,
                    duration: 1,
                    sourceDuration: 1,
                    alt: "First child",
                }),
                mediaClip({
                    id: "second-child",
                    startTime: 3,
                    duration: 1,
                    sourceDuration: 1,
                    alt: "Second child",
                }),
            ],
        });
        const preview = getCollectionClipFramePreviewFromState(state, collectionClip({ duration: 4, sourceDuration: 4 }), 2.5);
        expect(preview === null || preview === void 0 ? void 0 : preview.id).toBe("first-child");
        expect(preview === null || preview === void 0 ? void 0 : preview.previewTime).toBeCloseTo(0.999);
    });
});
describe("project placeholder detection", () => {
    it("identifies the unloaded project placeholder that must not be saved", () => {
        expect(isUnsavedProjectPlaceholder({
            id: "project-1782921712559-tozg9j",
            title: "Loading Project",
            clips: [],
        })).toBe(true);
    });
    it("allows intentionally empty projects once they have a real title", () => {
        expect(isUnsavedProjectPlaceholder({
            id: "project-1782921712559-tozg9j",
            title: "Untitled Project",
            clips: [],
        })).toBe(false);
    });
});
