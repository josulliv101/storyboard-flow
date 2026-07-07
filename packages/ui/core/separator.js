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
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@/lib/utils";
function Separator(_a) {
    var { className, orientation = "horizontal" } = _a, props = __rest(_a, ["className", "orientation"]);
    return (_jsx(SeparatorPrimitive, Object.assign({ "data-slot": "separator", orientation: orientation, className: cn("shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch", className) }, props)));
}
export { Separator };
