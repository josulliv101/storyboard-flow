import { jsx as _jsx } from "react/jsx-runtime";
import { RepeatedMediaFrames } from "./RepeatedMediaFrames";
import { RepeatedMediaFrame } from "./RepeatedMediaFrame";
import { getVideoThumbnailUrl } from "../media-thumbnails";
import { createStoryMediaDataUri, storyVideoSrc, storyVideoPoster, } from "./story-fixtures";
const FRAME_W = 96;
const FRAME_H = 96;
const withTimelineFrame = (_Story, context) => {
    var _a, _b;
    const width = (_a = context.args.storyWidth) !== null && _a !== void 0 ? _a : 500;
    const height = (_b = context.args.storyHeight) !== null && _b !== void 0 ? _b : 160;
    return (_jsx("div", { className: "font-sans text-white", style: {
            width,
            height,
            background: "#18181b",
            borderRadius: 8,
            overflow: "clip",
        }, children: _jsx(_Story, {}) }));
};
const meta = {
    title: "UI/Timeline/media/RepeatedMediaTile/RepeatedMediaFrames",
    component: RepeatedMediaFrames,
    decorators: [withTimelineFrame],
};
export default meta;
export const ImageFrames = {
    render: () => (_jsx(RepeatedMediaFrames, { children: [0, 1, 2, 3, 4].map((i) => (_jsx(RepeatedMediaFrame, { src: createStoryMediaDataUri(`Frame ${i + 1}`, 140 + i * 18), alt: `Image frame ${i + 1}`, frameWidth: FRAME_W, frameHeight: FRAME_H }, i))) })),
};
export const VideoFrames = {
    render: () => (_jsx(RepeatedMediaFrames, { children: [0, 2, 4, 6, 8].map((second, i) => (_jsx(RepeatedMediaFrame, { src: getVideoThumbnailUrl(storyVideoSrc, second), alt: `Video frame ${i + 1}`, fallbackSrc: storyVideoPoster, frameWidth: FRAME_W, frameHeight: FRAME_H }, i))) })),
};
export const NarrowImageFrames = {
    render: () => (_jsx(RepeatedMediaFrames, { children: [0, 1].map((i) => (_jsx(RepeatedMediaFrame, { src: createStoryMediaDataUri(`Narrow ${i + 1}`, 170 + i * 18), alt: `Narrow frame ${i + 1}`, frameWidth: FRAME_W, frameHeight: FRAME_H }, i))) })),
};
export const SingleXSFrame = {
    render: () => (_jsx(RepeatedMediaFrames, { children: _jsx(RepeatedMediaFrame, { src: createStoryMediaDataUri("XS", 205), alt: "XS single frame", frameWidth: 220, frameHeight: 40 }) })),
};
