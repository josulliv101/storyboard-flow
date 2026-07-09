import { type MediaStripDndAutoScrollOptions } from "../core/media-strip.dnd-adapter";

/**
 * Shared horizontal autoscroll implementation for the pragmatic and
 * native-html5 adapters, which (unlike dnd-kit) don't provide their own
 * autoscroll behavior and instead drive `viewport.scrollBy` directly from
 * pointer/drag coordinates during a drag.
 */
export function scrollDraggedViewport(
  input: { clientX: number; clientY: number },
  autoScroll: MediaStripDndAutoScrollOptions | undefined
): void {
  if (!autoScroll || typeof document === "undefined") return;

  const element = document.elementFromPoint(input.clientX, input.clientY);
  const scrollArea = element?.closest('[data-scroll-area="true"]');
  const viewport = scrollArea?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  if (!viewport) return;
  if (autoScroll.canScroll && !autoScroll.canScroll(viewport)) return;

  const rect = viewport.getBoundingClientRect();
  const threshold = autoScroll.threshold ?? 48;
  const maxSpeed = autoScroll.maxSpeed ?? 18;
  const distanceFromLeft = input.clientX - rect.left;
  const distanceFromRight = rect.right - input.clientX;

  let delta = 0;
  if (distanceFromLeft >= 0 && distanceFromLeft < threshold) {
    delta = -scaleAutoScrollSpeed(threshold - distanceFromLeft, threshold, maxSpeed);
  } else if (distanceFromRight >= 0 && distanceFromRight < threshold) {
    delta = scaleAutoScrollSpeed(threshold - distanceFromRight, threshold, maxSpeed);
  }

  if (delta !== 0) {
    viewport.scrollBy({ left: delta });
  }
}

function scaleAutoScrollSpeed(distance: number, threshold: number, maxSpeed: number) {
  return Math.max(1, Math.ceil((distance / threshold) * maxSpeed));
}
