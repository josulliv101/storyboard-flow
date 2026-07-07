import { jsx as _jsx } from "react/jsx-runtime";
import { Toggle } from "@base-ui/react/toggle";
import * as React from "react";
/**
 * Selects an item in the media strip.
 * Renders an unstyled Base UI `Toggle` button.
 */
export const MediaStripBaseItemButton = React.forwardRef(function MediaStripBaseItemButton(props, forwardedRef) {
    return (_jsx(Toggle, Object.assign({ ref: forwardedRef }, props)));
});
