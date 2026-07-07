import { jsx as _jsx } from "react/jsx-runtime";
import { GalleryCanvasPreview } from './GalleryCanvasPreview';
const createColorPlaceholder = (color, label) => {
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};
const mockImageItem = {
    id: 'img-1',
    clipId: 'c1',
    name: 'Ocean Sunset',
    type: 'image',
    previewUrl: createColorPlaceholder('#3b82f6', 'Ocean Sunset (Image)'),
};
const mockVideoItem = {
    id: 'vid-1',
    clipId: 'c2',
    name: 'Waterfall Clip',
    type: 'video',
    previewUrl: 'https://remotion.media/video.mp4',
    posterUrl: createColorPlaceholder('#10b981', 'Waterfall (Video)'),
    durationSeconds: 15,
};
const meta = {
    title: 'UI/WheelPicker/GalleryCanvasPreview',
    component: GalleryCanvasPreview,
    parameters: {
        layout: 'centered',
    },
    decorators: [
        (Story) => (_jsx("div", { className: "relative h-60 w-96 bg-zinc-950 border border-zinc-800 rounded shadow-2xl p-1", children: _jsx(Story, {}) })),
    ],
};
export default meta;
export const ImagePreview = {
    args: {
        snapshot: {
            media: mockImageItem,
            sourceTimeSeconds: 0,
            timelineTimeSeconds: 0,
        },
        isPlaying: false,
    },
};
export const VideoPreview = {
    args: {
        snapshot: {
            media: mockVideoItem,
            sourceTimeSeconds: 2.5,
            timelineTimeSeconds: 2.5,
        },
        isPlaying: false,
    },
};
export const VideoPlaying = {
    args: {
        snapshot: {
            media: mockVideoItem,
            sourceTimeSeconds: 0,
            timelineTimeSeconds: 0,
        },
        isPlaying: true,
    },
};
