import { expect, waitFor } from "storybook/test";

import { type TimelineItemResult } from "./core/media-strip.types";
import { createImageTimelineItem } from "./core/media-strip.validation";

/** Unwraps a `TimelineItemResult`, throwing on failure — story fixtures are static, so a failure is a bug in the story. */
export function unwrapResult<T, E>(result: TimelineItemResult<T, E>): T {
  if (!result.ok) {
    throw new Error(`Failed to construct timeline item: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export const createThumbnail = (color: string, label: string) =>
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" rx="18" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="white" font-family="Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;

export const createPhotoThumbnail = (seed: string) =>
  createThumbnail(
    `#${Array.from(seed)
      .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 0xffffff, 0)
      .toString(16)
      .padStart(6, "0")}`,
    seed
      .split("-")
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join(""),
  );

/** Builds a valid image timeline item with a generated SVG thumbnail. */
export const createImg = (id: string, name: string, color: string, duration: number) => {
  const thumb = createThumbnail(color, name);

  // The factory accepts an unbranded string id and validates it internally.
  return unwrapResult(
    createImageTimelineItem({
      id,
      name,
      src: thumb,
      posterSrcs: [thumb],
      startTimeSeconds: 0,
      durationSeconds: duration,
    })
  );
};

export const waitForLayout = async (element: HTMLElement) => {
  await waitFor(() => {
    const rect = element.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
};

// Helper functions for programmatic PointerEvent simulation in headless story tests

export const simulatePointerDrag = async (handle: HTMLElement, target: HTMLElement) => {
  await waitForLayout(handle);
  await waitForLayout(target);

  const startRect = handle.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // 1. Pointer Down
  handle.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: startRect.left + 5,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  // 2. Drag slightly to trigger dnd-kit pointer sensor activation constraint (> 5px)
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: startRect.left + 20,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  // 3. Drag to target
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  // 4. Release mouse button (Pointer Up)
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
};

export const simulateDragOscillation = async (handle: HTMLElement, target: HTMLElement) => {
  await waitForLayout(handle);
  await waitForLayout(target);

  const startRect = handle.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // 1. Pointer Down
  handle.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: startRect.left + 5,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  // 2. Move past threshold
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: startRect.left + 20,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // 3. Move to target
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // 4. Oscillate back and forth to trigger multiple collision detection runs
  for (let i = 0; i < 5; i++) {
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: targetRect.left + targetRect.width / 2 + (i % 2 === 0 ? 5 : -5),
        clientY: targetRect.top + targetRect.height / 2,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  // 5. Pointer Up
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
};

export const simulateScrollAreaDrag = async (scrollArea: HTMLElement) => {
  await waitForLayout(scrollArea);

  const rect = scrollArea.getBoundingClientRect();

  scrollArea.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: rect.left + 100,
      clientY: rect.top + 50,
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: rect.left + 50,
      clientY: rect.top + 50,
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  document.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: rect.left + 50,
      clientY: rect.top + 50,
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );
};
