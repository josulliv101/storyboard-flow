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
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/core/button";
function AlertDialog(_a) {
    var props = __rest(_a, []);
    return _jsx(AlertDialogPrimitive.Root, Object.assign({ "data-slot": "alert-dialog" }, props));
}
function AlertDialogTrigger(_a) {
    var props = __rest(_a, []);
    return (_jsx(AlertDialogPrimitive.Trigger, Object.assign({ "data-slot": "alert-dialog-trigger" }, props)));
}
function AlertDialogPortal(_a) {
    var props = __rest(_a, []);
    return (_jsx(AlertDialogPrimitive.Portal, Object.assign({ "data-slot": "alert-dialog-portal" }, props)));
}
function AlertDialogOverlay(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(AlertDialogPrimitive.Backdrop, Object.assign({ "data-slot": "alert-dialog-overlay", className: cn("fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className) }, props)));
}
function AlertDialogContent(_a) {
    var { className, size = "default" } = _a, props = __rest(_a, ["className", "size"]);
    return (_jsxs(AlertDialogPortal, { children: [_jsx(AlertDialogOverlay, {}), _jsx(AlertDialogPrimitive.Popup, Object.assign({ "data-slot": "alert-dialog-content", "data-size": size, className: cn("group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className) }, props))] }));
}
function AlertDialogHeader(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "alert-dialog-header", className: cn("grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]", className) }, props)));
}
function AlertDialogFooter(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "alert-dialog-footer", className: cn("-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end", className) }, props)));
}
function AlertDialogMedia(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "alert-dialog-media", className: cn("mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6", className) }, props)));
}
function AlertDialogTitle(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(AlertDialogPrimitive.Title, Object.assign({ "data-slot": "alert-dialog-title", className: cn("text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2", className) }, props)));
}
function AlertDialogDescription(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(AlertDialogPrimitive.Description, Object.assign({ "data-slot": "alert-dialog-description", className: cn("text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground", className) }, props)));
}
function AlertDialogAction(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(Button, Object.assign({ "data-slot": "alert-dialog-action", className: cn(className) }, props)));
}
function AlertDialogCancel(_a) {
    var { className, variant = "outline", size = "default" } = _a, props = __rest(_a, ["className", "variant", "size"]);
    return (_jsx(AlertDialogPrimitive.Close, Object.assign({ "data-slot": "alert-dialog-cancel", className: cn(className), render: _jsx(Button, { variant: variant, size: size }) }, props)));
}
export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger, };
