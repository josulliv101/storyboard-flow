import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Wraps one media strip option.
 * Renders an unstyled `<div>` element.
 */
export const MediaStripBaseItem = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseItem.Props
>(function MediaStripBaseItem({ render, ...props }, forwardedRef) {
  return useRender({
    defaultTagName: "div",
    render,
    ref: forwardedRef,
    props,
    state: {},
  });
});

export interface MediaStripBaseItemState {}

export interface MediaStripBaseItemProps
  extends BaseUIComponentProps<"div", MediaStripBaseItem.State> {}

export namespace MediaStripBaseItem {
  export type State = MediaStripBaseItemState;
  export type Props = MediaStripBaseItemProps;
}
