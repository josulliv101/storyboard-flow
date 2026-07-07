import { jsx as _jsx } from "react/jsx-runtime";
import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";
/**
 * Contains the scrollable media strip content.
 * Renders an unstyled Base UI `ScrollArea.Content` element.
 */
export const MediaStripBaseViewportContent = React.forwardRef(function MediaStripBaseViewportContent(props, forwardedRef) {
    return _jsx(ScrollArea.Content, Object.assign({ ref: forwardedRef }, props));
});
