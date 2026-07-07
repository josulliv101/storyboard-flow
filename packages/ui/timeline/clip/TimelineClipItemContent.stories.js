import { jsx as _jsx } from "react/jsx-runtime";
import { TimelineClipItemContent } from "./TimelineClipItemContent";
import { TimelineClipItemProvider, } from "./TimelineClipItemContext";
const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%23334155'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EImage%3C%2Ftext%3E%3C/svg%3E";
const PLACEHOLDER_POSTER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EPoster%3C%2Ftext%3E%3C/svg%3E";
const imageClip = {
    id: "img-content-1",
    index: 0,
    kind: "image",
    src: PLACEHOLDER_IMG,
    alt: "Mountain landscape",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
};
const videoClip = {
    id: "vid-content-1",
    index: 1,
    kind: "video",
    src: "",
    poster: PLACEHOLDER_POSTER,
    alt: "Sample video",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 3,
    duration: 5,
    sourceDuration: 10,
    trimIn: 2,
    trimOut: 3,
};
const providerValue = {
    metrics: {
        pixelsPerSecond: 100,
        itemTop: 0,
        itemHeight: 160,
    },
    resizeHandlers: {
        onResizeDown: () => { },
        onResizeMove: () => { },
        onResizeUp: () => { },
        onResizeKeyDown: () => { },
    },
};
function makeView({ ring = "default", isSelected = false, isCollectionHovered = false, isGrowingOpposite = false, } = {}) {
    return {
        ring,
        media: {
            displayWidth: 400,
            previewTime: null,
        },
        collection: {
            hasBreadcrumb: false,
            breadcrumbLevels: [],
            href: null,
        },
        trim: {
            isSelected,
            thumbnailMode: false,
            width: 400,
        },
        isGrowingOpposite,
        isCollectionHovered,
    };
}
const meta = {
    title: "UI/Timeline/clip/TimelineClipItemContent",
    component: TimelineClipItemContent,
    decorators: [
        (Story) => (_jsx(TimelineClipItemProvider, { value: providerValue, children: _jsx("div", { className: "font-sans text-white", style: {
                    width: 400,
                    height: 160,
                    background: "#09090b",
                    borderRadius: 8,
                    overflow: "hidden",
                }, children: _jsx(Story, {}) }) })),
    ],
    args: {
        clip: imageClip,
        view: makeView(),
    },
};
export default meta;
export const Default = {
    args: { view: makeView({ ring: "default" }) },
};
export const Selected = {
    args: {
        clip: videoClip,
        view: makeView({ ring: "selected", isSelected: true }),
    },
};
export const Lifted = {
    args: { view: makeView({ ring: "lifted" }) },
};
export const CollectionHovered = {
    args: {
        view: makeView({ ring: "collectionHovered", isCollectionHovered: true }),
    },
};
export const GrowingOpposite = {
    args: {
        view: makeView({
            ring: "selected",
            isSelected: true,
            isGrowingOpposite: true,
        }),
    },
};
export const VideoSelected = {
    args: {
        clip: videoClip,
        view: makeView({ ring: "selected", isSelected: true }),
    },
};
