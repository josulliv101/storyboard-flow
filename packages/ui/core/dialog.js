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
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/core/button";
import { XIcon } from "lucide-react";
function Dialog(_a) {
    var props = __rest(_a, []);
    return _jsx(DialogPrimitive.Root, Object.assign({ "data-slot": "dialog" }, props));
}
function DialogTrigger(_a) {
    var props = __rest(_a, []);
    return _jsx(DialogPrimitive.Trigger, Object.assign({ "data-slot": "dialog-trigger" }, props));
}
function DialogPortal(_a) {
    var props = __rest(_a, []);
    return _jsx(DialogPrimitive.Portal, Object.assign({ "data-slot": "dialog-portal" }, props));
}
function DialogClose(_a) {
    var props = __rest(_a, []);
    return _jsx(DialogPrimitive.Close, Object.assign({ "data-slot": "dialog-close" }, props));
}
function DialogOverlay(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(DialogPrimitive.Backdrop, Object.assign({ "data-slot": "dialog-overlay", className: cn("fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className) }, props)));
}
function DialogContent(_a) {
    var { className, children, showCloseButton = true } = _a, props = __rest(_a, ["className", "children", "showCloseButton"]);
    return (_jsxs(DialogPortal, { children: [_jsx(DialogOverlay, {}), _jsxs(DialogPrimitive.Popup, Object.assign({ "data-slot": "dialog-content", className: cn("fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className) }, props, { children: [children, showCloseButton && (_jsxs(DialogPrimitive.Close, { "data-slot": "dialog-close", render: _jsx(Button, { variant: "ghost", className: "absolute top-2 right-2", size: "icon-sm" }), children: [_jsx(XIcon, {}), _jsx("span", { className: "sr-only", children: "Close" })] }))] }))] }));
}
function DialogHeader(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "dialog-header", className: cn("flex flex-col gap-2", className) }, props)));
}
function DialogFooter(_a) {
    var { className, showCloseButton = false, children } = _a, props = __rest(_a, ["className", "showCloseButton", "children"]);
    return (_jsxs("div", Object.assign({ "data-slot": "dialog-footer", className: cn("-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end", className) }, props, { children: [children, showCloseButton && (_jsx(DialogPrimitive.Close, { render: _jsx(Button, { variant: "outline" }), children: "Close" }))] })));
}
function DialogTitle(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(DialogPrimitive.Title, Object.assign({ "data-slot": "dialog-title", className: cn("text-base leading-none font-medium", className) }, props)));
}
function DialogDescription(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(DialogPrimitive.Description, Object.assign({ "data-slot": "dialog-description", className: cn("text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground", className) }, props)));
}
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger, };
