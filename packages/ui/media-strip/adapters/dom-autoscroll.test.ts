import { afterEach, describe, expect, test, vi } from "vitest";
import { scrollDraggedViewport } from "./dom-autoscroll";

/**
 * `scrollDraggedViewport` only touches a handful of DOM methods
 * (`document.elementFromPoint`, `Element.closest`/`querySelector`,
 * `getBoundingClientRect`, `scrollBy`). The "unit" vitest project runs in a
 * plain Node environment (no jsdom), so rather than pull in a full DOM we
 * stub a minimal fake satisfying just that shape.
 */
function stubDocumentWithViewport({
  viewportRect,
  scrollBy,
  hasScrollArea = true,
  hasViewport = true,
  elementAtPoint = true,
}: {
  viewportRect: { left: number; right: number };
  scrollBy: (opts: { left: number }) => void;
  hasScrollArea?: boolean;
  hasViewport?: boolean;
  elementAtPoint?: boolean;
}) {
  const viewport = {
    getBoundingClientRect: () => viewportRect,
    scrollBy,
  };

  const scrollArea = {
    querySelector: () => (hasViewport ? viewport : null),
  };

  const element = {
    closest: () => (hasScrollArea ? scrollArea : null),
  };

  vi.stubGlobal("document", {
    elementFromPoint: () => (elementAtPoint ? element : null),
  });

  return { viewport, scrollArea, element };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scrollDraggedViewport", () => {
  const viewportRect = { left: 100, right: 500 }; // 400px wide

  test("near the left edge, scrolls left (negative delta)", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    scrollDraggedViewport({ clientX: 110, clientY: 0 }, {});

    expect(scrollBy).toHaveBeenCalledTimes(1);
    const [{ left }] = scrollBy.mock.calls[0];
    expect(left).toBeLessThan(0);
  });

  test("near the right edge, scrolls right (positive delta)", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    scrollDraggedViewport({ clientX: 490, clientY: 0 }, {});

    expect(scrollBy).toHaveBeenCalledTimes(1);
    const [{ left }] = scrollBy.mock.calls[0];
    expect(left).toBeGreaterThan(0);
  });

  test("in the center, beyond the threshold on both sides, does not scroll", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    scrollDraggedViewport({ clientX: 300, clientY: 0 }, {});

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("exactly at the threshold boundary, does not scroll (exclusive)", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    // Default threshold is 48px; distanceFromLeft === 48 is outside the (exclusive) band.
    scrollDraggedViewport({ clientX: viewportRect.left + 48, clientY: 0 }, {});

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("exactly at the edge (distance 0), scrolls at max speed", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    scrollDraggedViewport({ clientX: viewportRect.left, clientY: 0 }, { maxSpeed: 18 });

    expect(scrollBy).toHaveBeenCalledWith({ left: -18 });
  });

  test("respects a custom threshold/maxSpeed", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    // 10px from the right edge, with a 20px threshold and maxSpeed 10:
    // scale = ceil((20-10)/20 * 10) = 5.
    scrollDraggedViewport(
      { clientX: viewportRect.right - 10, clientY: 0 },
      { threshold: 20, maxSpeed: 10 }
    );

    expect(scrollBy).toHaveBeenCalledWith({ left: 5 });
  });

  test("canScroll:false on the resolved viewport prevents scrolling", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    scrollDraggedViewport({ clientX: 110, clientY: 0 }, { canScroll: () => false });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("canScroll:true still allows scrolling near an edge", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    scrollDraggedViewport({ clientX: 110, clientY: 0 }, { canScroll: () => true });

    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  test("no autoScroll options provided is a no-op", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy });

    scrollDraggedViewport({ clientX: 110, clientY: 0 }, undefined);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("no element under the pointer is a no-op", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy, elementAtPoint: false });

    scrollDraggedViewport({ clientX: 110, clientY: 0 }, {});

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("element under the pointer is not inside a scroll area is a no-op", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy, hasScrollArea: false });

    scrollDraggedViewport({ clientX: 110, clientY: 0 }, {});

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("scroll area found but its viewport element is missing is a no-op", () => {
    const scrollBy = vi.fn();
    stubDocumentWithViewport({ viewportRect, scrollBy, hasViewport: false });

    scrollDraggedViewport({ clientX: 110, clientY: 0 }, {});

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("running outside a document (no `document` global) is a no-op and does not throw", () => {
    // Deliberately does not stub `document` — this project's "unit" test
    // environment is plain Node, so `document` is genuinely undefined here.
    expect(() => {
      scrollDraggedViewport({ clientX: 110, clientY: 0 }, {});
    }).not.toThrow();
  });
});
