import { jsx as _jsx } from "react/jsx-runtime";
export function RepeatedMediaFrames({ children }) {
    return (_jsx("div", { className: "pointer-events-none relative h-full w-full overflow-hidden", children: _jsx("div", { className: "absolute inset-0 flex items-center", children: children }) }));
}
