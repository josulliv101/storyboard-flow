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
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
const markerVariants = cva("group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground", {
    variants: {
        variant: {
            default: "",
            separator: "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
            border: "border-b border-border pb-2",
        },
    },
});
function Marker(_a) {
    var { className, variant = "default", render } = _a, props = __rest(_a, ["className", "variant", "render"]);
    return useRender({
        defaultTagName: "div",
        props: mergeProps({
            className: cn(markerVariants({ variant, className })),
        }, props),
        render,
        state: {
            slot: "marker",
            variant,
        },
    });
}
function MarkerIcon(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("span", Object.assign({ "data-slot": "marker-icon", "aria-hidden": "true", className: cn("size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4", className) }, props)));
}
function MarkerContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("span", Object.assign({ "data-slot": "marker-content", className: cn("min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground", className) }, props)));
}
export { Marker, MarkerIcon, MarkerContent, markerVariants };
