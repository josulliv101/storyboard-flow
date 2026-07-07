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
function Card(_a) {
    var { className, size = "default" } = _a, props = __rest(_a, ["className", "size"]);
    return (_jsx("div", Object.assign({ "data-slot": "card", "data-size": size, className: cn("group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl", className) }, props)));
}
function CardHeader(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "card-header", className: cn("group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)", className) }, props)));
}
function CardTitle(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "card-title", className: cn("text-base leading-snug font-medium group-data-[size=sm]/card:text-sm", className) }, props)));
}
function CardDescription(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "card-description", className: cn("text-sm text-muted-foreground", className) }, props)));
}
function CardAction(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "card-action", className: cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className) }, props)));
}
function CardContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "card-content", className: cn("px-(--card-spacing)", className) }, props)));
}
function CardFooter(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "card-footer", className: cn("flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)", className) }, props)));
}
export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent, };
