import { jsx as _jsx } from "react/jsx-runtime";
import { expect, fn, userEvent, within } from "storybook/test";
import { TimelineNavigation } from "./timeline-navigation";
const meta = {
    title: "UI/Timeline/controls/TimelineNavigation",
    component: TimelineNavigation,
    parameters: {
        layout: "padded",
    },
    decorators: [
        (Story) => (_jsx("div", { className: "max-w-3xl rounded-xl bg-zinc-900 p-4 text-white", children: _jsx(Story, {}) })),
    ],
    args: {
        disabled: false,
        onScrollToIndex: fn(),
    },
};
export default meta;
export const Default = {};
export const Disabled = {
    args: {
        disabled: true,
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByRole("button", { name: "To 100" })).toBeDisabled();
        await expect(canvas.getByRole("button", { name: "To 800" })).toBeDisabled();
        await expect(canvas.getByRole("button", { name: "Start" })).toBeDisabled();
    },
};
export const JumpActions = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(canvas.getByRole("button", { name: "To 100" }));
        await userEvent.click(canvas.getByRole("button", { name: "To 800" }));
        await userEvent.click(canvas.getByRole("button", { name: "Start" }));
        await expect(args.onScrollToIndex).toHaveBeenNthCalledWith(1, 100);
        await expect(args.onScrollToIndex).toHaveBeenNthCalledWith(2, 800);
        await expect(args.onScrollToIndex).toHaveBeenNthCalledWith(3, 0);
    },
};
