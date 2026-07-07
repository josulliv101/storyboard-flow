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
import { ToggleGroup } from "@base-ui/react/toggle-group";
import * as React from "react";
/**
 * Contains media strip items.
 * Renders an unstyled Base UI `ToggleGroup`.
 */
export const MediaStripBaseList = React.forwardRef(function MediaStripBaseList(_a, forwardedRef) {
    var { orientation = "horizontal" } = _a, props = __rest(_a, ["orientation"]);
    return (_jsx(ToggleGroup, Object.assign({ ref: forwardedRef, orientation: orientation }, props)));
});
