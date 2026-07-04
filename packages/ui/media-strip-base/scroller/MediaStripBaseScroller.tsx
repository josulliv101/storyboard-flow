import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";

/**
 * Groups the draggable media strip viewport and scrollbar parts.
 * Renders an unstyled Base UI `ScrollArea.Root` element.
 */
export const MediaStripBaseScroller = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseScroller.Props
>(function MediaStripBaseScroller(props, forwardedRef) {
  return <ScrollArea.Root ref={forwardedRef} {...props} />;
});

export interface MediaStripBaseScrollerState extends ScrollArea.Root.State {}

export interface MediaStripBaseScrollerProps
  extends ScrollArea.Root.Props {}

export namespace MediaStripBaseScroller {
  export type State = MediaStripBaseScrollerState;
  export type Props = MediaStripBaseScrollerProps;
}
