import { jsx as _jsx } from "react/jsx-runtime";
export function MetricSymbol({ name, className, style }) {
    const normalized = name.toLowerCase();
    if (normalized.includes("tension")) {
        // Circle (expanded radius from 5 to 5.5)
        return (_jsx("svg", { viewBox: "0 0 12 12", className: className || "w-3 h-3", style: style, children: _jsx("circle", { cx: "6", cy: "6", r: "5.5", fill: "currentColor" }) }));
    }
    if (normalized.includes("suspense")) {
        // Diamond (expanded from 1.5 margin to 0.5 margin for max visibility)
        return (_jsx("svg", { viewBox: "0 0 12 12", className: className || "w-3 h-3", style: style, children: _jsx("path", { d: "M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z", fill: "currentColor" }) }));
    }
    if (normalized.includes("anticipation") || normalized.includes("stakes")) {
        // Triangle (expanded base and height)
        return (_jsx("svg", { viewBox: "0 0 12 12", className: className || "w-3 h-3", style: style, children: _jsx("path", { d: "M6 0.5 L11.5 11 L0.5 11 Z", fill: "currentColor" }) }));
    }
    // Square (Default - expanded size to 9.5x9.5)
    return (_jsx("svg", { viewBox: "0 0 12 12", className: className || "w-3 h-3", style: style, children: _jsx("rect", { x: "1.25", y: "1.25", width: "9.5", height: "9.5", fill: "currentColor" }) }));
}
