import { jsx as _jsx } from "react/jsx-runtime";
import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";
/**
 * The draggable thumb inside a media strip scrollbar.
 * Renders an unstyled Base UI `ScrollArea.Thumb` element.
 */
export const MediaStripBaseThumb = React.forwardRef(function MediaStripBaseThumb(props, forwardedRef) {
    return _jsx(ScrollArea.Thumb, Object.assign({ ref: forwardedRef }, props));
});
