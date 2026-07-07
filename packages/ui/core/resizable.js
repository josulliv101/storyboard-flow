"use client";
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
import { jsx as _jsx } from "react/jsx-runtime";
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";
function ResizablePanelGroup(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(ResizablePrimitive.Group, Object.assign({ "data-slot": "resizable-panel-group", className: cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className) }, props)));
}
function ResizablePanel(_a) {
    var props = __rest(_a, []);
    return _jsx(ResizablePrimitive.Panel, Object.assign({ "data-slot": "resizable-panel" }, props));
}
function ResizableHandle(_a) {
    var { withHandle, className } = _a, props = __rest(_a, ["withHandle", "className"]);
    return (_jsx(ResizablePrimitive.Separator, Object.assign({ "data-slot": "resizable-handle", className: cn("relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90", className) }, props, { children: withHandle && (_jsx("div", { className: "z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" })) })));
}
export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
