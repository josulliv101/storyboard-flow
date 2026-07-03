import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Contains title and controls for the media strip.
 * Renders an unstyled `<div>` element.
 */
export const MediaStripBaseHeader = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseHeader.Props
>(function MediaStripBaseHeader({ render, ...props }, forwardedRef) {
  return useRender({
    defaultTagName: "div",
    render,
    ref: forwardedRef,
    props,
    state: {},
  });
});

export interface MediaStripBaseHeaderState {}

export interface MediaStripBaseHeaderProps
  extends BaseUIComponentProps<"div", MediaStripBaseHeader.State> {}

export namespace MediaStripBaseHeader {
  export type State = MediaStripBaseHeaderState;
  export type Props = MediaStripBaseHeaderProps;
}
