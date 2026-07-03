import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";

/**
 * Displays a media strip scrollbar.
 * Renders an unstyled Base UI `ScrollArea.Scrollbar` element.
 */
export const MediaStripBaseScrollbar = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseScrollbar.Props
>(function MediaStripBaseScrollbar(
  { orientation = "horizontal", ...props },
  forwardedRef,
) {
  return (
    <ScrollArea.Scrollbar
      ref={forwardedRef}
      orientation={orientation}
      {...props}
    />
  );
});

export interface MediaStripBaseScrollbarState
  extends ScrollArea.Scrollbar.State {}

export interface MediaStripBaseScrollbarProps
  extends ScrollArea.Scrollbar.Props {}

export namespace MediaStripBaseScrollbar {
  export type State = MediaStripBaseScrollbarState;
  export type Props = MediaStripBaseScrollbarProps;
}
