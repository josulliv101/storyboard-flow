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
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { MessageScroller as MessageScrollerPrimitive, useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility, } from "@shadcn/react/message-scroller";
import { cn } from "@/lib/utils";
import { Button } from "@/core/button";
import { ArrowDownIcon } from "lucide-react";
function MessageScrollerProvider(props) {
    return _jsx(MessageScrollerPrimitive.Provider, Object.assign({}, props));
}
function MessageScroller(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(MessageScrollerPrimitive.Root, Object.assign({ "data-slot": "message-scroller", className: cn("group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden", className) }, props)));
}
function MessageScrollerViewport(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(MessageScrollerPrimitive.Viewport, Object.assign({ "data-slot": "message-scroller-viewport", className: cn("size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent", className) }, props)));
}
function MessageScrollerContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(MessageScrollerPrimitive.Content, Object.assign({ "data-slot": "message-scroller-content", className: cn("flex h-max min-h-full flex-col gap-6", className) }, props)));
}
function MessageScrollerItem(_a) {
    var { className, scrollAnchor = false } = _a, props = __rest(_a, ["className", "scrollAnchor"]);
    return (_jsx(MessageScrollerPrimitive.Item, Object.assign({ "data-slot": "message-scroller-item", scrollAnchor: scrollAnchor, className: cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]", className) }, props)));
}
function MessageScrollerButton(_a) {
    var { direction = "end", className, children, render, variant = "secondary", size = "icon-sm" } = _a, props = __rest(_a, ["direction", "className", "children", "render", "variant", "size"]);
    return (_jsx(MessageScrollerPrimitive.Button, Object.assign({ "data-slot": "message-scroller-button", "data-direction": direction, "data-variant": variant, "data-size": size, direction: direction, className: cn("absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180", className), render: render !== null && render !== void 0 ? render : _jsx(Button, { variant: variant, size: size }) }, props, { children: children !== null && children !== void 0 ? children : (_jsxs(_Fragment, { children: [_jsx(ArrowDownIcon, {}), _jsx("span", { className: "sr-only", children: direction === "end" ? "Scroll to end" : "Scroll to start" })] })) })));
}
export { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton, useMessageScroller, useMessageScrollerScrollable, useMessageScrollerVisibility, };
