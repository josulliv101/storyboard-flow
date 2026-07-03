import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Labels the media strip.
 * Renders an unstyled `<h2>` element.
 */
export const MediaStripBaseTitle = React.forwardRef<
  HTMLHeadingElement,
  MediaStripBaseTitle.Props
>(function MediaStripBaseTitle({ render, ...props }, forwardedRef) {
  return useRender({
    defaultTagName: "h2",
    render,
    ref: forwardedRef,
    props,
    state: {},
  });
});

export interface MediaStripBaseTitleState {}

export interface MediaStripBaseTitleProps
  extends BaseUIComponentProps<"h2", MediaStripBaseTitle.State> {}

export namespace MediaStripBaseTitle {
  export type State = MediaStripBaseTitleState;
  export type Props = MediaStripBaseTitleProps;
}
