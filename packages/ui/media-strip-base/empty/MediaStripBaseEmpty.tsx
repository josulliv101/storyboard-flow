import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Displays an empty state for a media strip.
 * Renders an unstyled `<div>` element.
 */
export const MediaStripBaseEmpty = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseEmpty.Props
>(function MediaStripBaseEmpty({ render, ...props }, forwardedRef) {
  return useRender({
    defaultTagName: "div",
    render,
    ref: forwardedRef,
    props,
    state: {},
  });
});

export interface MediaStripBaseEmptyState {}

export interface MediaStripBaseEmptyProps
  extends BaseUIComponentProps<"div", MediaStripBaseEmpty.State> {}

export namespace MediaStripBaseEmpty {
  export type State = MediaStripBaseEmptyState;
  export type Props = MediaStripBaseEmptyProps;
}
