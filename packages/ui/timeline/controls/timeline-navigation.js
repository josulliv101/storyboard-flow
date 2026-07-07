import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../../core/button";
export function TimelineNavigation({ disabled, onScrollToIndex, }) {
    return (_jsxs("div", { className: "grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3", children: [_jsx(Button, { variant: "outline", size: "sm", id: "scroll-to-100", className: "w-full min-w-0", disabled: disabled, onClick: () => onScrollToIndex(100), children: "To 100" }), _jsx(Button, { variant: "outline", size: "sm", id: "scroll-to-800", className: "w-full min-w-0", disabled: disabled, onClick: () => onScrollToIndex(800), children: "To 800" }), _jsx(Button, { variant: "outline", size: "sm", id: "scroll-to-0", className: "w-full min-w-0", disabled: disabled, onClick: () => onScrollToIndex(0), children: "Start" })] }));
}
