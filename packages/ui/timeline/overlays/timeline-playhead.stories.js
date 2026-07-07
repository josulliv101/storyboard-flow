import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TimelinePlayhead } from "./timeline-playhead";
const meta = {
    title: "UI/Timeline/overlays/TimelinePlayhead",
    component: TimelinePlayhead,
    parameters: {
        layout: "padded",
    },
    decorators: [
        (Story) => (_jsxs("div", { className: "relative h-24 w-[520px] rounded-lg border border-zinc-800 bg-zinc-950", children: [_jsx("div", { className: "absolute left-0 top-8 h-10 w-full bg-zinc-900" }), _jsx(Story, {})] })),
    ],
    args: {
        itemHeight: 40,
        itemTop: 32,
        left: 240,
    },
};
export default meta;
export const Default = {};
export const NearStart = {
    args: {
        left: 48,
    },
};
