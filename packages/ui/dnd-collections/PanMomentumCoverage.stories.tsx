import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import {
  usePanWithMomentum,
  type PanWithMomentumOptions,
} from "./react/use-pan-with-momentum";
import { dispatchPointerSequence } from "./stories-helpers";

type SurfaceMode = "defaults" | "disabled" | "guarded";

function PanSurface({
  id,
  mode,
}: {
  id: string;
  mode: SurfaceMode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const options: PanWithMomentumOptions | undefined =
    mode === "defaults"
      ? undefined
      : mode === "disabled"
        ? { disabled: true }
        : {
            shouldStartPan: (target) =>
              target instanceof HTMLElement && target.dataset.panAllowed === "true",
            isGestureClaimed: () => ref.current?.dataset.gestureClaimed === "true",
            slop: 1,
            friction: 0.9,
            minVelocity: 0.01,
            maxVelocity: 2,
          };

  usePanWithMomentum(ref, "y", options);

  return (
    <div
      ref={ref}
      data-gesture-claimed="false"
      data-pan-surface={id}
      style={{
        border: "1px solid currentColor",
        height: 120,
        overflow: "auto",
        width: 180,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, height: 600 }}>
        <button type="button" data-pan-allowed="true">
          Allowed pan target
        </button>
        <button type="button">Blocked pan target</button>
      </div>
    </div>
  );
}

function PanCoverageHarness() {
  return (
    <div style={{ display: "flex", gap: 24 }}>
      <PanSurface id="defaults" mode="defaults" />
      <PanSurface id="disabled" mode="disabled" />
      <PanSurface id="guarded" mode="guarded" />
      <button type="button" data-outside-pan-surfaces="true">
        Outside target
      </button>
    </div>
  );
}

const meta = {
  title: "UI/DndCollections/PanMomentumCoverage",
  render: () => <PanCoverageHarness />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BehaviorBranches: Story = {
  play: async ({ canvasElement }) => {
    const defaults = canvasElement.querySelector<HTMLElement>(
      '[data-pan-surface="defaults"]'
    )!;
    const disabled = canvasElement.querySelector<HTMLElement>(
      '[data-pan-surface="disabled"]'
    )!;
    const guarded = canvasElement.querySelector<HTMLElement>(
      '[data-pan-surface="guarded"]'
    )!;
    const allowed = guarded.querySelector<HTMLElement>('[data-pan-allowed="true"]')!;
    const blocked = guarded.querySelectorAll<HTMLElement>("button")[1]!;
    const outside = canvasElement.querySelector<HTMLElement>(
      '[data-outside-pan-surfaces="true"]'
    )!;

    // Movement below the default slop is still a click, not a pan.
    await dispatchPointerSequence([
      { element: defaults, type: "pointerdown", clientX: 40, clientY: 100 },
      { element: document, type: "pointermove", clientX: 40, clientY: 96 },
      { element: document, type: "pointerup", clientX: 40, clientY: 96 },
    ]);
    expect(defaults.scrollTop).toBe(0);

    // A browser/OS cancellation stops an established pan without starting inertia.
    await dispatchPointerSequence([
      { element: defaults, type: "pointerdown", clientX: 40, clientY: 100 },
      { element: document, type: "pointermove", clientX: 40, clientY: 60 },
      { element: document, type: "pointercancel", clientX: 40, clientY: 60 },
    ]);
    const atCancel = defaults.scrollTop;
    expect(atCancel).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(defaults.scrollTop).toBe(atCancel);

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    });

    try {
      // Reduced-motion users get direct panning but no release glide.
      await dispatchPointerSequence([
        { element: defaults, type: "pointerdown", clientX: 40, clientY: 100 },
        {
          element: document,
          type: "pointermove",
          clientX: 40,
          clientY: 60,
          delayAfterMs: 16,
        },
        {
          element: document,
          type: "pointermove",
          clientX: 40,
          clientY: 20,
          delayAfterMs: 16,
        },
        { element: document, type: "pointerup", clientX: 40, clientY: 20 },
      ]);
      const atReducedMotionRelease = defaults.scrollTop;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(defaults.scrollTop).toBe(atReducedMotionRelease);

      // The post-pan click guard is scoped to the panned element.
      const outsideClick = new MouseEvent("click", { bubbles: true, cancelable: true });
      outside.dispatchEvent(outsideClick);
      expect(outsideClick.defaultPrevented).toBe(false);

      const insideClick = new MouseEvent("click", { bubbles: true, cancelable: true });
      defaults.dispatchEvent(insideClick);
      expect(insideClick.defaultPrevented).toBe(true);
    } finally {
      window.matchMedia = originalMatchMedia;
    }

    // Disabled surfaces never claim or scroll the pointer gesture.
    await dispatchPointerSequence([
      { element: disabled, type: "pointerdown", clientX: 40, clientY: 100 },
      { element: document, type: "pointermove", clientX: 40, clientY: 20 },
      { element: document, type: "pointerup", clientX: 40, clientY: 20 },
    ]);
    expect(disabled.scrollTop).toBe(0);

    // The predicate rejects non-pan targets.
    await dispatchPointerSequence([
      { element: blocked, type: "pointerdown", clientX: 40, clientY: 100 },
      { element: document, type: "pointermove", clientX: 40, clientY: 20 },
      { element: document, type: "pointerup", clientX: 40, clientY: 20 },
    ]);
    expect(guarded.scrollTop).toBe(0);

    // A gesture already claimed before pointer-down keeps panning idle.
    guarded.dataset.gestureClaimed = "true";
    await dispatchPointerSequence([
      { element: allowed, type: "pointerdown", clientX: 40, clientY: 100 },
      { element: document, type: "pointermove", clientX: 40, clientY: 20 },
      { element: document, type: "pointerup", clientX: 40, clientY: 20 },
    ]);
    expect(guarded.scrollTop).toBe(0);

    // A gesture claimed after pointer-down cancels the pending pan at first movement.
    guarded.dataset.gestureClaimed = "false";
    await dispatchPointerSequence([
      { element: allowed, type: "pointerdown", clientX: 40, clientY: 100 },
    ]);
    guarded.dataset.gestureClaimed = "true";
    await dispatchPointerSequence([
      { element: document, type: "pointermove", clientX: 40, clientY: 20 },
      { element: document, type: "pointerup", clientX: 40, clientY: 20 },
    ]);
    expect(guarded.scrollTop).toBe(0);
  },
};
