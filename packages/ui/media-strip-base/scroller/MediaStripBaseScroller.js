import { jsx as _jsx } from "react/jsx-runtime";
import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";
/**
 * Groups the draggable media strip viewport and scrollbar parts.
 * Renders an unstyled Base UI `ScrollArea.Root` element.
 */
export const MediaStripBaseScroller = React.forwardRef(function MediaStripBaseScroller(props, forwardedRef) {
    return _jsx(ScrollArea.Root, Object.assign({ ref: forwardedRef }, props));
});
