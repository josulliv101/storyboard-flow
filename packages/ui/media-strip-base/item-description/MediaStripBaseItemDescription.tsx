import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Displays secondary metadata for a media strip item.
 * Renders an unstyled `<span>` element.
 */
export const MediaStripBaseItemDescription = React.forwardRef<
  HTMLSpanElement,
  MediaStripBaseItemDescription.Props
>(function MediaStripBaseItemDescription({ render, ...props }, forwardedRef) {
  return useRender({
    defaultTagName: "span",
    render,
    ref: forwardedRef,
    props,
    state: {},
  });
});

export interface MediaStripBaseItemDescriptionState {}

export interface MediaStripBaseItemDescriptionProps
  extends BaseUIComponentProps<"span", MediaStripBaseItemDescription.State> {}

export namespace MediaStripBaseItemDescription {
  export type State = MediaStripBaseItemDescriptionState;
  export type Props = MediaStripBaseItemDescriptionProps;
}
