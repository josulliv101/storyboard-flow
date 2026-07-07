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
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
const alertVariants = cva("group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4", {
    variants: {
        variant: {
            default: "bg-card text-card-foreground",
            destructive: "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
        },
    },
    defaultVariants: {
        variant: "default",
    },
});
function Alert(_a) {
    var { className, variant } = _a, props = __rest(_a, ["className", "variant"]);
    return (_jsx("div", Object.assign({ "data-slot": "alert", role: "alert", className: cn(alertVariants({ variant }), className) }, props)));
}
function AlertTitle(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "alert-title", className: cn("font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground", className) }, props)));
}
function AlertDescription(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "alert-description", className: cn("text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4", className) }, props)));
}
function AlertAction(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "alert-action", className: cn("absolute top-2 right-2", className) }, props)));
}
export { Alert, AlertTitle, AlertDescription, AlertAction };
