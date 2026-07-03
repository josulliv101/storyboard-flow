import { Toolbar } from "@base-ui/react/toolbar";
import * as React from "react";

/**
 * Groups the media strip parts.
 * Renders an unstyled Base UI `Toolbar.Root` element.
 */
export const MediaStripBaseRoot = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseRoot.Props
>(function MediaStripBaseRoot(
  { orientation = "horizontal", ...props },
  forwardedRef,
) {
  return (
    <Toolbar.Root
      ref={forwardedRef}
      orientation={orientation}
      {...props}
    />
  );
});

export interface MediaStripBaseRootState extends Toolbar.Root.State {}

export interface MediaStripBaseRootProps
  extends Toolbar.Root.Props {}

export namespace MediaStripBaseRoot {
  export type State = MediaStripBaseRootState;
  export type Props = MediaStripBaseRootProps;
}
