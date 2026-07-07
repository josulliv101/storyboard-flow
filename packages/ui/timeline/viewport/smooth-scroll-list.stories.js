var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
import { createInitialTimelineDocuments, createTimelineDocumentsState, getTimelineDocumentFromState, } from "../timeline-documents";
import { TimelineDocumentsProvider } from "../timeline-document-store";
import { createInitialClips } from "../hooks/use-timeline-clips";
import { SmoothScrollList } from "./smooth-scroll-list";
function createStoryMediaDataUri(label, hue) {
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">`,
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
        `<stop offset="0" stop-color="hsl(${hue},70%,38%)"/>`,
        `<stop offset="1" stop-color="hsl(${(hue + 52) % 360},75%,18%)"/>`,
        `</linearGradient></defs>`,
        `<rect width="480" height="270" fill="url(#g)"/>`,
        `<circle cx="394" cy="58" r="42" fill="rgba(255,255,255,0.18)"/>`,
        `<rect x="28" y="176" width="320" height="22" rx="11" fill="rgba(255,255,255,0.18)"/>`,
        `<rect x="28" y="210" width="210" height="16" rx="8" fill="rgba(255,255,255,0.12)"/>`,
        `<text x="28" y="74" fill="white" font-family="Arial, sans-serif" font-size="34" font-weight="700">${label}</text>`,
        `</svg>`,
    ].join("");
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function withDeterministicStoryMedia(clips) {
    return clips.map((clip) => {
        var _a;
        const mediaSrc = createStoryMediaDataUri(`${clip.kind === "video" ? "Video" : "Image"} ${clip.index}`, (clip.index * 37 + (clip.kind === "video" ? 210 : 135)) % 360);
        if (clip.kind === "video") {
            return Object.assign(Object.assign({}, clip), { poster: mediaSrc });
        }
        if (clip.kind === "image") {
            return Object.assign(Object.assign({}, clip), { src: mediaSrc });
        }
        return Object.assign(Object.assign({}, clip), { previewItems: (_a = clip.previewItems) === null || _a === void 0 ? void 0 : _a.map((item, itemIndex) => (Object.assign(Object.assign({}, item), { poster: item.kind === "video"
                    ? createStoryMediaDataUri(`Preview ${clip.index}.${itemIndex}`, (clip.index * 37 + itemIndex * 29 + 210) % 360)
                    : item.poster, src: item.kind === "image"
                    ? createStoryMediaDataUri(`Preview ${clip.index}.${itemIndex}`, (clip.index * 37 + itemIndex * 29 + 135) % 360)
                    : item.src }))) });
    });
}
function createSmoothScrollStoryClips(itemCount) {
    return withDeterministicStoryMedia(createInitialClips(itemCount, 100));
}
const storyTimelineDocuments = createInitialTimelineDocuments();
for (const id of Object.keys(storyTimelineDocuments)) {
    storyTimelineDocuments[id] = Object.assign(Object.assign({}, storyTimelineDocuments[id]), { clips: withDeterministicStoryMedia(storyTimelineDocuments[id].clips) });
}
const storyTimelineState = createTimelineDocumentsState(storyTimelineDocuments);
function getStoryTimelineDocument(id) {
    return getTimelineDocumentFromState(storyTimelineState, id);
}
const meta = {
    title: "UI/Timeline/viewport/SmoothScrollList",
    component: SmoothScrollList,
    parameters: {
        layout: "fullscreen",
    },
    decorators: [
        (Story) => (_jsx("main", { className: "min-h-screen bg-zinc-950 p-8 text-white", children: _jsx(TimelineDocumentsProvider, { initialState: storyTimelineState, children: _jsx(Story, {}) }) })),
    ],
    args: {
        initialClips: createSmoothScrollStoryClips(12),
        itemCount: 12,
        onPlayheadTimeChange: fn(),
        pixelsPerSecond: 100,
        viewportWidth: "100%",
        syncMediaDuration: false,
        disablePersistence: true,
        navigate: fn(),
    },
};
export default meta;
export const Default = {};
export const CollectionTimeline = {
    args: {
        initialClips: withDeterministicStoryMedia((_b = (_a = getStoryTimelineDocument("root")) === null || _a === void 0 ? void 0 : _a.clips) !== null && _b !== void 0 ? _b : []),
        itemCount: (_d = (_c = getStoryTimelineDocument("root")) === null || _c === void 0 ? void 0 : _c.clips.length) !== null && _d !== void 0 ? _d : 0,
        initialViewState: {
            showPlayBarArea: true,
            thumbnailMode: true,
        },
        syncMediaDuration: false,
        timelineId: "root",
    },
};
/**
 * Clicking the first thumbnail of a collection tile exposes the first child
 * clip as a separate adjacent item to the LEFT of the collection in the
 * timeline row.
 */
export const CollectionFirstEndpointExposed = {
    args: {
        initialClips: withDeterministicStoryMedia((_f = (_e = getStoryTimelineDocument("root")) === null || _e === void 0 ? void 0 : _e.clips) !== null && _f !== void 0 ? _f : []),
        itemCount: (_h = (_g = getStoryTimelineDocument("root")) === null || _g === void 0 ? void 0 : _g.clips.length) !== null && _h !== void 0 ? _h : 0,
        initialViewState: {
            showPlayBarArea: true,
            thumbnailMode: true,
        },
        syncMediaDuration: false,
        timelineId: "root",
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        // Click the "first item" endpoint button on the collection tile.
        const firstEndpointBtn = await canvas.findByRole("button", {
            name: "Scene A Selects first item",
        });
        await userEvent.click(firstEndpointBtn);
        // The first child clip from the child timeline now appears as a separate
        // adjacent item to the LEFT of the collection (data-view-endpoint="first").
        await waitFor(() => {
            const endpointClip = canvasElement.querySelector('[data-view-endpoint="first"]');
            expect(endpointClip).toBeTruthy();
            expect(endpointClip === null || endpointClip === void 0 ? void 0 : endpointClip.querySelector('[data-testid="collection-endpoint-accent-bar"]')).toBeTruthy();
            const linkMarker = canvasElement.querySelector('[data-testid="timeline-collection-endpoint-link"][data-endpoint="first"]');
            expect(linkMarker).toBeTruthy();
        });
        await userEvent.click(await canvas.findByRole("button", {
            name: "Hide first collection endpoint",
        }));
        await waitFor(() => {
            expect(canvasElement.querySelector('[data-view-endpoint="first"]')).toBeNull();
            expect(canvasElement.querySelector('[data-testid="timeline-collection-endpoint-link"][data-endpoint="first"]')).toBeNull();
        });
    },
};
/**
 * Clicking the last thumbnail of a collection tile exposes the last child
 * clip as a separate adjacent item to the RIGHT of the collection in the
 * timeline row.
 */
export const CollectionLastEndpointExposed = {
    args: {
        initialClips: withDeterministicStoryMedia((_k = (_j = getStoryTimelineDocument("root")) === null || _j === void 0 ? void 0 : _j.clips) !== null && _k !== void 0 ? _k : []),
        itemCount: (_m = (_l = getStoryTimelineDocument("root")) === null || _l === void 0 ? void 0 : _l.clips.length) !== null && _m !== void 0 ? _m : 0,
        initialViewState: {
            showPlayBarArea: true,
            thumbnailMode: true,
        },
        syncMediaDuration: false,
        timelineId: "root",
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        // Click the "last item" endpoint button on the collection tile.
        const lastEndpointBtn = await canvas.findByRole("button", {
            name: "Scene A Selects last item",
        });
        await userEvent.click(lastEndpointBtn);
        // The last child clip appears to the RIGHT with the matching accent bar.
        await waitFor(() => {
            const endpointClip = canvasElement.querySelector('[data-view-endpoint="last"]');
            expect(endpointClip).toBeTruthy();
            expect(endpointClip === null || endpointClip === void 0 ? void 0 : endpointClip.querySelector('[data-testid="collection-endpoint-accent-bar"]')).toBeTruthy();
            const linkMarker = canvasElement.querySelector('[data-testid="timeline-collection-endpoint-link"][data-endpoint="last"]');
            expect(linkMarker).toBeTruthy();
        });
        await userEvent.click(await canvas.findByRole("button", {
            name: "Hide last collection endpoint",
        }));
        await waitFor(() => {
            expect(canvasElement.querySelector('[data-view-endpoint="last"]')).toBeNull();
            expect(canvasElement.querySelector('[data-testid="timeline-collection-endpoint-link"][data-endpoint="last"]')).toBeNull();
        });
    },
};
export const CollectionSelectedShowsPlayBar = {
    args: {
        initialClips: withDeterministicStoryMedia((_p = (_o = getStoryTimelineDocument("root")) === null || _o === void 0 ? void 0 : _o.clips) !== null && _p !== void 0 ? _p : []),
        itemCount: (_r = (_q = getStoryTimelineDocument("root")) === null || _q === void 0 ? void 0 : _q.clips.length) !== null && _r !== void 0 ? _r : 0,
        initialViewState: {
            showPlayBarArea: true,
            thumbnailMode: true,
        },
        syncMediaDuration: false,
        timelineId: "root",
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const collectionClip = await canvas.findByTestId("timeline-clip-0");
        await userEvent.click(collectionClip);
        const filmstrip = await canvas.findByTestId("timeline-source-filmstrip");
        await expect(filmstrip).toBeVisible();
        await expect(filmstrip).toHaveAttribute("data-clip-index", "0");
    },
};
export const ThumbnailMode = {
    args: {
        initialViewState: {
            thumbnailMode: true,
        },
    },
};
export const FirstClipSelectedAtTimelineStart = {
    args: {
        initialViewState: {
            showPlayBarArea: true,
        },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const clip = await canvas.findByTestId("timeline-clip-0");
        await userEvent.click(clip);
        await expect(clip).toHaveAttribute("data-selected", "true");
        await expect(clip).toHaveAttribute("data-start-time", "0");
        await expect(canvas.getByTestId("timeline-source-filmstrip")).toBeVisible();
    },
};
export const FirstClipSelectedWithThumbnailOverhang = {
    args: {
        initialViewState: {
            showPlayBarArea: true,
            thumbnailMode: true,
        },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const clip = await canvas.findByTestId("timeline-clip-0");
        await userEvent.click(clip);
        await expect(clip).toHaveAttribute("data-selected", "true");
        await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
        await expect(canvas.getByTestId("timeline-source-filmstrip")).toBeVisible();
    },
};
export const LastClipSelectedAtTimelineEnd = {
    args: {
        initialViewState: {
            showPlayBarArea: true,
        },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const viewport = canvas.getByTestId("timeline-scroll-viewport");
        fireEvent.scroll(viewport, { target: { scrollLeft: 2400 } });
        await waitFor(async () => {
            await expect(canvas.getByTestId("timeline-clip-11")).toBeVisible();
        });
        const clip = canvas.getByTestId("timeline-clip-11");
        await userEvent.click(clip);
        await expect(clip).toHaveAttribute("data-selected", "true");
        await expect(canvas.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "11");
    },
};
export const LastClipSelectedWithThumbnailOverhang = {
    args: {
        initialViewState: {
            showPlayBarArea: true,
            thumbnailMode: true,
        },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const viewport = canvas.getByTestId("timeline-scroll-viewport");
        fireEvent.scroll(viewport, { target: { scrollLeft: 3200 } });
        await waitFor(async () => {
            await expect(canvas.getByTestId("timeline-clip-11")).toBeVisible();
        });
        const clip = canvas.getByTestId("timeline-clip-11");
        await userEvent.click(clip);
        await expect(clip).toHaveAttribute("data-selected", "true");
        await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
        await expect(canvas.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "11");
    },
};
export const ZoomedOut = {
    args: {
        pixelsPerSecond: 20,
    },
};
export const ZoomedIn = {
    args: {
        pixelsPerSecond: 250,
    },
};
export const Empty = {
    args: {
        initialClips: [],
        itemCount: 0,
    },
};
export const HundredClips = {
    args: {
        initialClips: createSmoothScrollStoryClips(100),
        itemCount: 100,
    },
};
export const VirtualizedThousandClips = {
    args: {
        initialClips: createSmoothScrollStoryClips(1000),
        itemCount: 1000,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-item-count", "1000");
    },
};
export const VirtualizedThousandClipsThumbnail = {
    args: {
        initialClips: createSmoothScrollStoryClips(1000),
        itemCount: 1000,
        initialViewState: {
            thumbnailMode: true,
        },
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-item-count", "1000");
        await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
    },
};
export const MultipleTimelines = {
    render: (args) => (_jsxs("div", { className: "grid gap-16", children: [_jsx(SmoothScrollList, Object.assign({}, args, { initialClips: createSmoothScrollStoryClips(1000), itemCount: 1000 })), _jsx(SmoothScrollList, Object.assign({}, args, { initialClips: createSmoothScrollStoryClips(1000), itemCount: 1000 }))] })),
};
export const MultipleTimelinesThumbnail = {
    render: (args) => (_jsxs("div", { className: "grid gap-16", children: [_jsx(SmoothScrollList, Object.assign({}, args, { initialClips: createSmoothScrollStoryClips(1000), itemCount: 1000, initialViewState: { thumbnailMode: true } })), _jsx(SmoothScrollList, Object.assign({}, args, { initialClips: createSmoothScrollStoryClips(1000), itemCount: 1000, initialViewState: { thumbnailMode: true } }))] })),
};
