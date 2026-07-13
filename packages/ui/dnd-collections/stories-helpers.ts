import { expect, waitFor } from "storybook/test";

// Pointer simulation for dnd-kit's PointerSensor. `isPrimary: true` is
// load-bearing: PointerSensor ignores non-primary pointers entirely, and
// PointerEventInit defaults it to false — a sequence without it dispatches
// fine but never activates a drag (a silent-inert bug this repo has hit
// before).

type PointerStep = Readonly<{
  element: EventTarget;
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel";
  clientX: number;
  clientY: number;
  delayAfterMs?: number;
}>;

const POINTER_INIT: PointerEventInit = {
  bubbles: true,
  cancelable: true,
  button: 0,
  buttons: 1,
  pointerId: 1,
  isPrimary: true,
};

export async function dispatchPointerSequence(steps: readonly PointerStep[]): Promise<void> {
  for (const step of steps) {
    step.element.dispatchEvent(
      new PointerEvent(step.type, { ...POINTER_INIT, clientX: step.clientX, clientY: step.clientY })
    );
    if (step.delayAfterMs) {
      await new Promise((resolve) => setTimeout(resolve, step.delayAfterMs));
    }
  }
}

export async function waitForLayout(element: HTMLElement): Promise<void> {
  await waitFor(() => {
    const rect = element.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
}

export type Point = Readonly<{ x: number; y: number }>;

export function rectCenter(element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function rectPoint(element: HTMLElement, xRatio: number, yRatio = 0.5): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width * xRatio, y: rect.top + rect.height * yRatio };
}

/**
 * Full drag from `source` to `point`, with a settle dwell at the target
 * before releasing — dnd-kit recomputes `over` on a measure cadence, and
 * releasing before it settles is the classic only-under-CI-load flake.
 */
export async function dragToPoint(source: HTMLElement, point: Point): Promise<void> {
  await waitForLayout(source);
  const start = rectCenter(source);
  await dispatchPointerSequence([
    { element: source, type: "pointerdown", clientX: start.x, clientY: start.y },
    // Past the 4px activation distance.
    { element: document, type: "pointermove", clientX: start.x + 12, clientY: start.y, delayAfterMs: 50 },
    { element: document, type: "pointermove", clientX: point.x, clientY: point.y, delayAfterMs: 50 },
    // Dwell so collision/intent settle before the drop commits.
    { element: document, type: "pointermove", clientX: point.x, clientY: point.y, delayAfterMs: 150 },
    { element: document, type: "pointerup", clientX: point.x, clientY: point.y, delayAfterMs: 50 },
  ]);
}

/** Starts a drag and holds at `point` WITHOUT releasing. Pair with releaseAt. */
export async function dragHoldAt(source: HTMLElement, point: Point): Promise<void> {
  await waitForLayout(source);
  const start = rectCenter(source);
  await dispatchPointerSequence([
    { element: source, type: "pointerdown", clientX: start.x, clientY: start.y },
    { element: document, type: "pointermove", clientX: start.x + 12, clientY: start.y, delayAfterMs: 50 },
    { element: document, type: "pointermove", clientX: point.x, clientY: point.y, delayAfterMs: 150 },
  ]);
}

export async function moveHeldPointer(point: Point, delayAfterMs = 40): Promise<void> {
  await dispatchPointerSequence([
    { element: document, type: "pointermove", clientX: point.x, clientY: point.y, delayAfterMs },
  ]);
}

export async function releaseAt(point: Point): Promise<void> {
  await dispatchPointerSequence([
    { element: document, type: "pointerup", clientX: point.x, clientY: point.y, delayAfterMs: 50 },
  ]);
}

/** Ordered node ids currently rendered inside a panel's droppable row. */
export function panelOrder(canvasElement: HTMLElement, panelId: string): string[] {
  const panel = canvasElement.querySelector(`[data-panel-droppable="${panelId}"]`);
  if (!panel) return [];
  return [...panel.querySelectorAll<HTMLElement>("[data-node-id]")].map(
    (el) => el.dataset.nodeId ?? ""
  );
}

/** Midpoint of the horizontal gap between two same-row adjacent cards. */
export function gapBetween(left: HTMLElement, right: HTMLElement): Point {
  const a = left.getBoundingClientRect();
  const b = right.getBoundingClientRect();
  return { x: (a.right + b.left) / 2, y: a.top + a.height / 2 };
}

/** The grip bar that starts item drags when NodeCard renders with dragHandle. */
export function nodeHandle(canvasElement: HTMLElement, id: string): HTMLElement {
  const el = canvasElement.querySelector<HTMLElement>(`[data-drag-handle="${id}"]`);
  if (!el) throw new Error(`drag handle not found: ${id}`);
  return el;
}

export function nodeCard(canvasElement: HTMLElement, id: string): HTMLElement {
  const el = canvasElement.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (!el) throw new Error(`node card not found: ${id}`);
  return el;
}
