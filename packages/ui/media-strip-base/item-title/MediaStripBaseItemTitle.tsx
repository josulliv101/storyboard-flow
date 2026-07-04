import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Displays the primary label for a media strip item.
 * Renders an unstyled `<span>` element.
 */
export const MediaStripBaseItemTitle = React.forwardRef<
  HTMLSpanElement,
  MediaStripBaseItemTitle.Props
>(function MediaStripBaseItemTitle({ render, ...props }, forwardedRef) {
  return useRender({
    defaultTagName: "span",
    render,
    ref: forwardedRef,
    props,
    state: {},
  });
});

export interface MediaStripBaseItemTitleState {}

export interface MediaStripBaseItemTitleProps
  extends BaseUIComponentProps<"span", MediaStripBaseItemTitle.State> {}

export namespace MediaStripBaseItemTitle {
  export type State = MediaStripBaseItemTitleState;
  export type Props = MediaStripBaseItemTitleProps;
}
