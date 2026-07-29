"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

/**
 * Labelling props belong on the THUMB, not the root.
 *
 * Radix puts `role="slider"` — and aria-valuenow/valuemin/valuemax — on
 * `Slider.Thumb`; `Slider.Root` is an unlabelled wrapper. So spreading
 * `aria-label` onto Root, which this component used to do (along with every
 * shadcn-derived slider), attaches the name to an element that has no role,
 * and the control a screen reader actually lands on ends up with NO accessible
 * name. It reads as correct in the JSX and is silent in use.
 *
 * These four are therefore split off the rest and forwarded to the thumb.
 * `aria-valuetext` earns its place for the same reason: without it a reader
 * announces a bare number, which on an axis like pixels-per-second says
 * nothing on its own.
 */
type ThumbAriaProps = Pick<
  React.ComponentPropsWithoutRef<"span">,
  "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-valuetext"
>;

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> &
    ThumbAriaProps & {
      /**
       * Tab-order position of the thumb. Pass `-1` where the slider is a
       * POINTER affordance for a control that is exposed some other way — a
       * focusable thumb inside an `aria-hidden` wrapper is itself an
       * accessibility fault, so hiding one means silencing the other too.
       */
      thumbTabIndex?: number;
    }
>(
  (
    {
      className,
      thumbTabIndex,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      "aria-valuetext": ariaValueText,
      ...props
    },
    ref,
  ) => (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-zinc-800">
        <SliderPrimitive.Range className="absolute h-full bg-amber-400/70" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-valuetext={ariaValueText}
        tabIndex={thumbTabIndex}
        className="block h-3 w-3 rounded-full border border-amber-400 bg-zinc-950 shadow transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:pointer-events-none disabled:opacity-50"
      />
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
