import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { UniformItemProgress } from './UniformItemProgress';
const meta = {
    title: 'UI/WheelPicker/UniformItemProgress',
    component: UniformItemProgress,
    parameters: {
        layout: 'centered',
    },
    decorators: [
        (Story) => (_jsxs("div", { className: "relative h-20 w-80 bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center text-zinc-400 text-xs font-mono", children: [_jsx("span", { children: "Timeline Media Item Container" }), _jsx(Story, {})] })),
    ],
};
export default meta;
export const Paused = {
    args: {
        progress: 0.35,
        durationSeconds: 10,
        isPlaying: false,
        timelineTimeSeconds: 3.5,
    },
};
export const Playing = {
    args: {
        progress: 0.1,
        durationSeconds: 5,
        isPlaying: true,
        timelineTimeSeconds: 0.5,
    },
};
