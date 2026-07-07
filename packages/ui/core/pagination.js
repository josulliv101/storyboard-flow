var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "@/lib/utils";
import { Button } from "@/core/button";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
function Pagination(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("nav", Object.assign({ role: "navigation", "aria-label": "pagination", "data-slot": "pagination", className: cn("mx-auto flex w-full justify-center", className) }, props)));
}
function PaginationContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("ul", Object.assign({ "data-slot": "pagination-content", className: cn("flex items-center gap-0.5", className) }, props)));
}
function PaginationItem(_a) {
    var props = __rest(_a, []);
    return _jsx("li", Object.assign({ "data-slot": "pagination-item" }, props));
}
function PaginationLink(_a) {
    var { className, isActive, size = "icon" } = _a, props = __rest(_a, ["className", "isActive", "size"]);
    return (_jsx(Button, { variant: isActive ? "outline" : "ghost", size: size, className: cn(className), nativeButton: false, render: _jsx("a", Object.assign({ "aria-current": isActive ? "page" : undefined, "data-slot": "pagination-link", "data-active": isActive }, props)) }));
}
function PaginationPrevious(_a) {
    var { className, text = "Previous" } = _a, props = __rest(_a, ["className", "text"]);
    return (_jsxs(PaginationLink, Object.assign({ "aria-label": "Go to previous page", size: "default", className: cn("pl-1.5!", className) }, props, { children: [_jsx(ChevronLeftIcon, { "data-icon": "inline-start" }), _jsx("span", { className: "hidden sm:block", children: text })] })));
}
function PaginationNext(_a) {
    var { className, text = "Next" } = _a, props = __rest(_a, ["className", "text"]);
    return (_jsxs(PaginationLink, Object.assign({ "aria-label": "Go to next page", size: "default", className: cn("pr-1.5!", className) }, props, { children: [_jsx("span", { className: "hidden sm:block", children: text }), _jsx(ChevronRightIcon, { "data-icon": "inline-end" })] })));
}
function PaginationEllipsis(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsxs("span", Object.assign({ "aria-hidden": true, "data-slot": "pagination-ellipsis", className: cn("flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4", className) }, props, { children: [_jsx(MoreHorizontalIcon, {}), _jsx("span", { className: "sr-only", children: "More pages" })] })));
}
export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, };
