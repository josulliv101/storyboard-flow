import { jsx as _jsx } from "react/jsx-runtime";
import { expect, fn, userEvent } from "storybook/test";
import { RepeatedMediaTile, } from "./RepeatedMediaTile";
import { collectionClip, imageClip, videoClip } from "./story-fixtures";
const withTimelineFrame = (Story, context) => {
    const args = context.args;
    const frameWidth = typeof args.displayWidth === "number" ? args.displayWidth : 500;
    const frameHeight = typeof args.itemHeight === "number" ? args.itemHeight : 200;
    return (_jsx("div", { className: "font-sans text-white", style: {
            width: frameWidth,
            height: frameHeight,
            background: "#18181b",
            borderRadius: 8,
            overflow: "clip",
        }, children: _jsx(Story, {}) }));
};
const meta = {
    title: "UI/Timeline/media/RepeatedMediaTile",
    component: RepeatedMediaTile,
    decorators: [withTimelineFrame],
    args: {
        onDurationLoaded: fn(),
    },
};
export default meta;
/** Default image clip rendered at full container width. */
export const ImageClip = {
    args: {
        clip: imageClip,
        displayWidth: 300,
        previewTime: 0,
        itemHeight: 100,
    },
};
/** Video clip with a trimmed source, previewed at 2 s. */
export const VideoClip = {
    args: {
        clip: videoClip,
        displayWidth: 500,
        previewTime: 2,
        itemHeight: 200,
    },
};
/** Collection clip rendered through the wrapper branch. */
export const CollectionClip = {
    args: {
        clip: collectionClip,
        displayWidth: 500,
        previewTime: 0,
        itemHeight: 200,
        collectionEndpointSelection: {
            first: true,
        },
        onCollectionEndpointClick: fn(),
    },
    play: async ({ args, canvas }) => {
        const firstEndpoint = canvas.getByRole("button", {
            name: "Scene Selects first item",
        });
        await expect(firstEndpoint).toHaveAttribute("aria-pressed", "true");
        await userEvent.click(firstEndpoint);
        await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("first");
    },
};
/** Narrow container: fewer repeated tiles visible. */
export const NarrowWidth = {
    args: {
        clip: imageClip,
        displayWidth: 200,
        previewTime: 0,
        itemHeight: 200,
    },
};
/** Wide container: more repeated tiles visible. */
export const WideWidth = {
    args: {
        clip: imageClip,
        displayWidth: 800,
        previewTime: 0,
        itemHeight: 200,
    },
};
/** Shorter item height: tiles scale down vertically. */
export const SmallHeight = {
    args: {
        clip: imageClip,
        displayWidth: 500,
        previewTime: 0,
        itemHeight: 120,
    },
};
