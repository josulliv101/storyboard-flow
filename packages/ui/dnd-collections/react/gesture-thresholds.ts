// A hold remains eligible only inside normal pointer jitter. The very next
// pixel qualifies as a pan, so one movement can never start panning while a
// delayed hold-to-drag activation is still pending.
export const HOLD_DRAG_TOLERANCE_PX = 4;
export const PAN_START_SLOP_PX = HOLD_DRAG_TOLERANCE_PX + 1;
