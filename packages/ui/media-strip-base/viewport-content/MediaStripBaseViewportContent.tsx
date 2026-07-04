import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";

/**
 * Contains the scrollable media strip content.
 * Renders an unstyled Base UI `ScrollArea.Content` element.
 */
export const MediaStripBaseViewportContent = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseViewportContent.Props
>(function MediaStripBaseViewportContent(props, forwardedRef) {
  return <ScrollArea.Content ref={forwardedRef} {...props} />;
});

export interface MediaStripBaseViewportContentState
  extends ScrollArea.Content.State {}

export interface MediaStripBaseViewportContentProps
  extends ScrollArea.Content.Props {}

export namespace MediaStripBaseViewportContent {
  export type State = MediaStripBaseViewportContentState;
  export type Props = MediaStripBaseViewportContentProps;
}
