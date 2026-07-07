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
import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react";
const Toaster = (_a) => {
    var props = __rest(_a, []);
    const { theme = "system" } = useTheme();
    return (_jsx(Sonner, Object.assign({ theme: theme, className: "toaster group", icons: {
            success: (_jsx(CircleCheckIcon, { className: "size-4" })),
            info: (_jsx(InfoIcon, { className: "size-4" })),
            warning: (_jsx(TriangleAlertIcon, { className: "size-4" })),
            error: (_jsx(OctagonXIcon, { className: "size-4" })),
            loading: (_jsx(Loader2Icon, { className: "size-4 animate-spin" })),
        }, style: {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
        }, toastOptions: {
            classNames: {
                toast: "cn-toast",
            },
        } }, props)));
};
export { Toaster };
