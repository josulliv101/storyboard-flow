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
import { Toolbar } from "@base-ui/react/toolbar";
import * as React from "react";
/**
 * Groups the media strip parts.
 * Renders an unstyled Base UI `Toolbar.Root` element.
 */
export const MediaStripBaseRoot = React.forwardRef(function MediaStripBaseRoot(_a, forwardedRef) {
    var { orientation = "horizontal" } = _a, props = __rest(_a, ["orientation"]);
    return (_jsx(Toolbar.Root, Object.assign({ ref: forwardedRef, orientation: orientation }, props)));
});
