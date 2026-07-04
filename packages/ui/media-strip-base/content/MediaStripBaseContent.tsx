import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Groups text content inside a media strip item.
 * Renders an unstyled `<span>` element.
 */
export const MediaStripBaseContent = React.forwardRef<
  HTMLSpanElement,
  MediaStripBaseContent.Props
>(function MediaStripBaseContent({ render, ...props }, forwardedRef) {
  return useRender({
    defaultTagName: "span",
    render,
    ref: forwardedRef,
    props,
    state: {},
  });
});

export interface MediaStripBaseContentState {}

export interface MediaStripBaseContentProps
  extends BaseUIComponentProps<"span", MediaStripBaseContent.State> {}

export namespace MediaStripBaseContent {
  export type State = MediaStripBaseContentState;
  export type Props = MediaStripBaseContentProps;
}
