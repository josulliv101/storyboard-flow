"use client";

import {
  PointerSensor,
  type PointerActivationConstraint,
  type PointerSensorProps,
} from "@dnd-kit/core";

// Per-target activation constraints in ONE sensor. dnd-kit configures the
// constraint per sensor and — critically — collapses synthetic listeners
// into an object keyed by eventName (useSyntheticListeners), so a second
// PointerSensor's onPointerDown silently REPLACES the first's; two pointer
// sensors cannot coexist. Instead, this single sensor picks its constraint
// at construction time from the pressed target: card bodies marked
// data-drag-activation="hold" (strips in hold-to-drag mode) get
// press-and-hold, everything else (grip bars, panel/grid cards, palette
// items) keeps instant distance activation.
//
// Fast movement on a hold body never becomes a drag: `tolerance` cancels
// the pending activation, which is what hands the gesture to
// pan-to-scroll. A still press past the delay becomes an item drag (and
// the pan hook yields — see isGestureClaimed in use-pan-with-momentum).

const HOLD_MARKER = '[data-drag-activation="hold"]';

const DISTANCE_ACTIVATION: PointerActivationConstraint = { distance: 4 };
const HOLD_ACTIVATION: PointerActivationConstraint = { delay: 250, tolerance: 8 };

export class CollectionsPointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    const target = props.event.target;
    const isHoldTarget = target instanceof Element && target.closest(HOLD_MARKER) !== null;
    super({
      ...props,
      options: {
        ...props.options,
        activationConstraint: isHoldTarget ? HOLD_ACTIVATION : DISTANCE_ACTIVATION,
      },
    });
  }
}
