import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { expect, fn, userEvent } from "storybook/test";
import { TimelineContextMenu } from "./timeline-context-menu";
const meta = {
    title: "UI/Timeline/controls/TimelineContextMenu",
    component: TimelineContextMenu,
    parameters: {
        layout: "fullscreen",
    },
    decorators: [
        (Story) => (_jsxs("div", { className: "min-h-96 bg-zinc-950 p-8 text-white", children: [_jsx("div", { className: "h-48 rounded-lg border border-zinc-800 bg-zinc-900" }), _jsx(Story, {})] })),
    ],
    args: {
        insertIndex: 2,
        onAddClip: fn(),
        onClose: fn(),
        thumbnailMode: false,
        timelineTime: 12.4,
        x: 96,
        y: 88,
    },
};
export default meta;
export const TimelineMode = {};
export const ThumbnailMode = {
    args: {
        thumbnailMode: true,
    },
};
export const AddVideoAction = {
    play: async ({ args, canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Add Video Clip" }));
        await expect(args.onAddClip).toHaveBeenCalledWith(2, "video");
        await expect(args.onClose).toHaveBeenCalled();
    },
};
