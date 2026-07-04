import { ToggleGroup } from "@base-ui/react/toggle-group";
import * as React from "react";

/**
 * Contains media strip items.
 * Renders an unstyled Base UI `ToggleGroup`.
 */
export const MediaStripBaseList = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseList.Props
>(function MediaStripBaseList(
  { orientation = "horizontal", ...props },
  forwardedRef,
) {
  return (
    <ToggleGroup
      ref={forwardedRef}
      orientation={orientation}
      {...props}
    />
  );
});

export interface MediaStripBaseListState extends ToggleGroup.State {}

export interface MediaStripBaseListProps
  extends ToggleGroup.Props<string> {}

export namespace MediaStripBaseList {
  export type State = MediaStripBaseListState;
  export type Props = MediaStripBaseListProps;
}
