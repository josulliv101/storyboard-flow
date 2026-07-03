import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";

/**
 * The draggable thumb inside a media strip scrollbar.
 * Renders an unstyled Base UI `ScrollArea.Thumb` element.
 */
export const MediaStripBaseThumb = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseThumb.Props
>(function MediaStripBaseThumb(props, forwardedRef) {
  return <ScrollArea.Thumb ref={forwardedRef} {...props} />;
});

export interface MediaStripBaseThumbState extends ScrollArea.Thumb.State {}

export interface MediaStripBaseThumbProps extends ScrollArea.Thumb.Props {}

export namespace MediaStripBaseThumb {
  export type State = MediaStripBaseThumbState;
  export type Props = MediaStripBaseThumbProps;
}
