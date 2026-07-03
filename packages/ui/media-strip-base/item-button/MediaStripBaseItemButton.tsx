import { Toggle } from "@base-ui/react/toggle";
import * as React from "react";

/**
 * Selects an item in the media strip.
 * Renders an unstyled Base UI `Toggle` button.
 */
export const MediaStripBaseItemButton = React.forwardRef<
  HTMLButtonElement,
  MediaStripBaseItemButton.Props
>(function MediaStripBaseItemButton(
  props,
  forwardedRef,
) {
  return (
    <Toggle
      ref={forwardedRef}
      {...props}
    />
  );
});

export interface MediaStripBaseItemButtonState {
  /**
   * Whether the item is selected.
   */
  pressed: boolean;
}

export interface MediaStripBaseItemButtonProps
  extends Toggle.Props<string> {}

export namespace MediaStripBaseItemButton {
  export type State = MediaStripBaseItemButtonState;
  export type Props = MediaStripBaseItemButtonProps;
}
