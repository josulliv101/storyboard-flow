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
function AspectRatio(_a) {
    var { ratio, className } = _a, props = __rest(_a, ["ratio", "className"]);
    return (_jsx("div", Object.assign({ "data-slot": "aspect-ratio", style: {
            "--ratio": ratio,
        }, className: cn("relative aspect-(--ratio)", className) }, props)));
}
export { AspectRatio };
