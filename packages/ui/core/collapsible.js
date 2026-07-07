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
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
function Collapsible(_a) {
    var props = __rest(_a, []);
    return _jsx(CollapsiblePrimitive.Root, Object.assign({ "data-slot": "collapsible" }, props));
}
function CollapsibleTrigger(_a) {
    var props = __rest(_a, []);
    return (_jsx(CollapsiblePrimitive.Trigger, Object.assign({ "data-slot": "collapsible-trigger" }, props)));
}
function CollapsibleContent(_a) {
    var props = __rest(_a, []);
    return (_jsx(CollapsiblePrimitive.Panel, Object.assign({ "data-slot": "collapsible-content" }, props)));
}
export { Collapsible, CollapsibleTrigger, CollapsibleContent };
