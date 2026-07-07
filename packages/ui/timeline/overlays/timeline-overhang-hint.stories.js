import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { expect, fn, userEvent, within } from "storybook/test";
import { TimelineOverhangHint } from "./timeline-overhang-hint";
const meta = {
    title: "UI/Timeline/overlays/TimelineOverhangHint",
    component: TimelineOverhangHint,
    parameters: {
        layout: "centered",
    },
    decorators: [
        (Story) => (_jsxs("div", { className: "relative h-48 w-[640px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950", children: [_jsx("div", { className: "absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-amber-400/10 to-transparent" }), _jsx(Story, {})] })),
    ],
    args: {
        onClick: fn(),
    },
};
export default meta;
export const Default = {};
export const RevealsSourceOnClick = {
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement);
        const hint = canvas.getByRole("button", { name: "Source" });
        await expect(hint).toHaveAttribute("title", "Filmstrip extends beyond the visible area. Click to scroll and reveal the full source filmstrip.");
        await userEvent.click(hint);
        await expect(args.onClick).toHaveBeenCalledOnce();
    },
};
