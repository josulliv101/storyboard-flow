import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

/**
 * Displays a media preview thumbnail.
 * Renders an unstyled `<img>` element.
 */
export const MediaStripBaseThumbnail = React.forwardRef<
  HTMLImageElement,
  MediaStripBaseThumbnail.Props
>(function MediaStripBaseThumbnail(
  { render, loading = "lazy", ...props },
  forwardedRef,
) {
  return useRender({
    defaultTagName: "img",
    render,
    ref: forwardedRef,
    props: {
      loading,
      ...props,
    },
    state: {},
  });
});

export interface MediaStripBaseThumbnailState {}

export interface MediaStripBaseThumbnailProps
  extends BaseUIComponentProps<"img", MediaStripBaseThumbnail.State> {}

export namespace MediaStripBaseThumbnail {
  export type State = MediaStripBaseThumbnailState;
  export type Props = MediaStripBaseThumbnailProps;
}
