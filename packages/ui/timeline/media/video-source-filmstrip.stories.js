import { jsx as _jsx } from "react/jsx-runtime";
import { storyVideoSrc } from "./RepeatedMediaTile/story-fixtures";
import { VideoSourceFilmStrip } from './video-source-filmstrip';
function createFilmstripPoster(label, hue) {
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">`,
        `<defs>`,
        `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`,
        `<stop offset="0" stop-color="hsl(${hue},68%,34%)"/>`,
        `<stop offset="1" stop-color="hsl(${(hue + 42) % 360},72%,16%)"/>`,
        `</linearGradient>`,
        `</defs>`,
        `<rect width="480" height="270" fill="url(#bg)"/>`,
        `<rect x="28" y="168" width="300" height="22" rx="11" fill="rgba(255,255,255,0.18)"/>`,
        `<rect x="28" y="204" width="190" height="16" rx="8" fill="rgba(255,255,255,0.12)"/>`,
        `<circle cx="390" cy="70" r="44" fill="rgba(255,255,255,0.16)"/>`,
        `<text x="28" y="76" fill="white" font-family="Arial, sans-serif" font-size="34" font-weight="700">${label}</text>`,
        `</svg>`,
    ].join("");
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const videoClip = {
    id: 'filmstrip-vid-1',
    index: 0,
    kind: 'video',
    src: storyVideoSrc,
    poster: createFilmstripPoster("Source", 215),
    alt: 'Big Buck Bunny',
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 5,
    sourceDuration: 10,
    trimIn: 2,
    trimOut: 3,
};
const untrimmedClip = Object.assign(Object.assign({}, videoClip), { id: 'filmstrip-vid-2', duration: 10, sourceDuration: 10, trimIn: 0, trimOut: 0 });
const meta = {
    title: "UI/Timeline/media/VideoSourceFilmStrip",
    component: VideoSourceFilmStrip,
    decorators: [
        (Story) => (_jsx("div", { style: {
                position: 'relative',
                width: '100%',
                height: 80,
                background: '#09090b',
                borderRadius: 8,
                overflow: 'visible',
                padding: '20px 40px',
            }, children: _jsx(Story, {}) })),
    ],
    args: {
        pixelsPerSecond: 100,
        onSourceWindowPointerDown: () => { },
    },
};
export default meta;
/** Default trimmed clip — selection window is narrower than the full filmstrip. */
export const Default = {
    args: {
        clip: videoClip,
    },
};
/** Untrimmed clip — selection window spans the full filmstrip width. */
export const Untrimmed = {
    args: {
        clip: untrimmedClip,
    },
};
/** Heavily trimmed clip — only 2 s visible out of a 10 s source. */
export const HeavilyTrimmed = {
    args: {
        clip: Object.assign(Object.assign({}, videoClip), { id: 'filmstrip-vid-3', duration: 2, trimIn: 4, trimOut: 4 }),
    },
};
/** Editing in "move" mode — the selection window should show the move cursor style. */
export const EditingMoveMode = {
    args: {
        clip: videoClip,
        editingMode: 'move',
    },
};
/** Thumbnail mode with a wider thumbnail width. */
export const ThumbnailMode = {
    args: {
        clip: videoClip,
        thumbnailMode: true,
        thumbnailWidth: 355,
    },
};
