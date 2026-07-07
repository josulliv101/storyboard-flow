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
import { cn } from "@/lib/utils";
function Kbd(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("kbd", Object.assign({ "data-slot": "kbd", className: cn("pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3", className) }, props)));
}
function KbdGroup(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("kbd", Object.assign({ "data-slot": "kbd-group", className: cn("inline-flex items-center gap-1", className) }, props)));
}
export { Kbd, KbdGroup };
