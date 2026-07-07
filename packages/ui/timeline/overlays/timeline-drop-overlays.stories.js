import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TimelineDropIndicator, TimelineDropOverlay, } from "./timeline-drop-overlays";
const overlayMeta = {
    title: "UI/Timeline/overlays/TimelineDropOverlay",
    component: TimelineDropOverlay,
    parameters: {
        layout: "padded",
    },
    decorators: [
        (Story) => (_jsxs("div", { className: "relative h-56 w-[640px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950", children: [_jsx("div", { className: "grid h-full grid-cols-4 gap-3 p-4", children: Array.from({ length: 8 }, (_, index) => (_jsx("div", { className: "rounded-md border border-zinc-800 bg-zinc-900/80" }, index))) }), _jsx(Story, {})] })),
    ],
    args: {
        isVisible: true,
    },
};
export default overlayMeta;
export const ActiveDrop = {};
export const Hidden = {
    args: {
        isVisible: false,
    },
};
export const InsertIndicator = {
    render: () => (_jsxs("div", { className: "relative h-28 w-[640px] rounded-lg border border-zinc-800 bg-zinc-950", children: [_jsx("div", { className: "absolute left-8 top-8 h-12 w-28 rounded-md bg-zinc-800" }), _jsx("div", { className: "absolute left-48 top-8 h-12 w-28 rounded-md bg-zinc-800" }), _jsx(TimelineDropIndicator, { itemHeight: 48, itemTop: 32, left: 176 })] })),
};
