import { jsx as _jsx } from "react/jsx-runtime";
import { RepeatedMediaFrame } from "./RepeatedMediaFrame";
import { createStoryMediaDataUri, storyImageSrc, storyVideoPoster, storyVideoSrc, } from "./story-fixtures";
import { getVideoThumbnailUrl } from "../media-thumbnails";
const withFrameWrapper = (Story) => (_jsx("div", { className: "font-sans", style: {
        display: "inline-flex",
        background: "#18181b",
        borderRadius: 8,
        overflow: "clip",
    }, children: _jsx(Story, {}) }));
const meta = {
    title: "UI/Timeline/media/RepeatedMediaTile/RepeatedMediaFrame",
    component: RepeatedMediaFrame,
    decorators: [withFrameWrapper],
    argTypes: {
        variant: {
            control: { type: "radio" },
            options: ["default", "unstyled"],
        },
    },
    args: {
        variant: "default",
        frameWidth: 96,
        frameHeight: 96,
    },
};
export default meta;
export const ImageFrame = {
    args: {
        src: storyImageSrc,
        alt: "Sample image frame",
    },
};
export const VideoFrame = {
    args: {
        src: getVideoThumbnailUrl(storyVideoSrc, 2),
        alt: "Sample video frame 1",
        fallbackSrc: storyVideoPoster,
    },
};
export const NarrowFrame = {
    args: {
        src: createStoryMediaDataUri("Narrow", 155),
        alt: "Narrow image frame",
        frameWidth: 56,
        frameHeight: 56,
    },
};
export const WithFallback = {
    name: "Broken src with fallback poster",
    args: {
        src: "https://example.invalid/broken.mp4?so=2.00&w=480&h=270",
        alt: "Broken video frame",
        fallbackSrc: storyVideoPoster,
        frameWidth: 96,
        frameHeight: 96,
    },
};
// ─── Unstyled variant ───────────────────────────────────────────────────────
export const UnstyledImage = {
    name: "Unstyled / Image",
    args: {
        variant: "unstyled",
        src: storyImageSrc,
        alt: "Unstyled image frame",
    },
};
export const UnstyledVideo = {
    name: "Unstyled / Video",
    args: {
        variant: "unstyled",
        src: getVideoThumbnailUrl(storyVideoSrc, 2),
        alt: "Unstyled video frame 1",
        fallbackSrc: storyVideoPoster,
    },
};
