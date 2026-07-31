import { describe, expect, it } from "vitest";

import {
  ANCHOR_MIN_VISIBLE_RATIO,
  TOOLBAR_GAP,
  anchorVisibleRatio,
  resolveToolbarPlacement,
  type ToolbarPlacementInput,
  type ToolbarRect,
} from "./selection-toolbar-position";

const VIEWPORT = { width: 1200, height: 900 };
const RAIL = 72;
const HEADER: ToolbarRect = { left: 0, top: 0, width: 1200, height: 48 };
const TOOLBAR = { width: 240, height: 40 };

/** A card in open space: well clear of the header, the rail and both edges. */
function card(overrides: Partial<ToolbarRect> = {}): ToolbarRect {
  return { left: 500, top: 400, width: 128, height: 96, ...overrides };
}

function input(overrides: Partial<ToolbarPlacementInput> = {}): ToolbarPlacementInput {
  return {
    anchorRect: card(),
    toolbarSize: TOOLBAR,
    headerRect: HEADER,
    railWidth: RAIL,
    viewport: VIEWPORT,
    ...overrides,
  };
}

describe("resolveToolbarPlacement", () => {
  it("centres on the anchor and sits one gap above it", () => {
    const placement = resolveToolbarPlacement(input());

    expect(placement.visible).toBe(true);
    expect(placement.side).toBe("above");
    // Card spans 500..628, so its centre is 564; a 240-wide toolbar starts 120 left of that.
    expect(placement.left).toBe(444);
    expect(placement.top).toBe(400 - TOOLBAR.height - TOOLBAR_GAP);
  });

  it("flips below when the header would cover the space above", () => {
    // Top grid row: the card starts just under the header, leaving nowhere to go.
    const placement = resolveToolbarPlacement(input({ anchorRect: card({ top: 60 }) }));

    expect(placement.side).toBe("below");
    expect(placement.top).toBe(60 + 96 + TOOLBAR_GAP);
  });

  it("measures the flip against the HEADER, not the viewport top", () => {
    // 100px down there is room above in raw viewport terms (100 - 40 - 8 = 52),
    // but the header's opaque band ends at 48 and the toolbar needs a gap under
    // it, so 52 < 56 and it must still flip. This is the case a viewport-top
    // check gets wrong, and it is the common one — the first row of a grid.
    const placement = resolveToolbarPlacement(input({ anchorRect: card({ top: 100 }) }));

    expect(placement.side).toBe("below");
  });

  it("keeps clear of the rail rather than centring under it", () => {
    const placement = resolveToolbarPlacement(input({ anchorRect: card({ left: 80 }) }));

    expect(placement.left).toBe(RAIL + TOOLBAR_GAP);
  });

  it("keeps clear of the right edge", () => {
    // Overhanging the edge but still mostly on screen, so it is a clamp case
    // and not a visibility one.
    const placement = resolveToolbarPlacement(input({ anchorRect: card({ left: 1100 }) }));

    expect(placement.left).toBe(VIEWPORT.width - TOOLBAR.width - TOOLBAR_GAP);
  });

  it("prefers the rail bound when the window is too narrow for both", () => {
    // Both clamps cannot hold at once. The rail is opaque and pinned, so
    // sliding under it hides controls outright; overhanging the right edge at
    // a width this small is the lesser failure.
    const placement = resolveToolbarPlacement(
      input({ viewport: { width: 260, height: 900 }, anchorRect: card({ left: 100 }) }),
    );

    expect(placement.left).toBe(RAIL + TOOLBAR_GAP);
  });

  it("uses a larger gap when one is supplied, on both sides of the flip", () => {
    // A finger covers more than a cursor does, so a toolbar that had to flip
    // BELOW its card must clear the hand that just tapped it.
    const above = resolveToolbarPlacement(input({ gap: 20 }));
    expect(above.side).toBe("above");
    expect(above.top).toBe(400 - TOOLBAR.height - 20);

    const below = resolveToolbarPlacement(input({ anchorRect: card({ top: 60 }), gap: 20 }));
    expect(below.side).toBe("below");
    expect(below.top).toBe(60 + 96 + 20);
  });

  it("keeps the EDGE clamps at the base gap regardless", () => {
    // The horizontal clamps are about not colliding with opaque chrome — the
    // rail and the viewport edge — which a bigger fingertip does not move.
    const placement = resolveToolbarPlacement(input({ anchorRect: card({ left: 80 }), gap: 20 }));
    expect(placement.left).toBe(RAIL + TOOLBAR_GAP);
  });

  it("hides when the anchor element is not mounted", () => {
    // A virtualized strip unmounts its off-screen cards; the grid re-creates a
    // card's element when a move re-parents it across rows.
    expect(resolveToolbarPlacement(input({ anchorRect: null })).visible).toBe(false);
  });

  it("hides once the anchor is less than half visible", () => {
    // 96-tall card scrolled to -10, so it clears the header's 48px band by
    // only 38px: 40%.
    const placement = resolveToolbarPlacement(input({ anchorRect: card({ top: -10 }) }));

    expect(placement.visible).toBe(false);
  });

  it("stays visible while the anchor is more than half on screen", () => {
    // The same card at 0 clears the band by exactly 48 of its 96 — the
    // boundary, which counts as visible.
    const placement = resolveToolbarPlacement(input({ anchorRect: card({ top: 0 }) }));

    expect(anchorVisibleRatio(input({ anchorRect: card({ top: 0 }) }))).toBe(0.5);
    expect(placement.visible).toBe(true);
  });
});

describe("anchorVisibleRatio", () => {
  it("counts the header band as covering the card, not as viewport", () => {
    const behindHeader = input({ anchorRect: card({ top: -60 }) });
    // 96-tall card ending at 36, entirely above the header's 48px bottom.
    expect(anchorVisibleRatio(behindHeader)).toBe(0);
  });

  it("counts the rail as covering the card", () => {
    const behindRail = input({ anchorRect: card({ left: -60 }) });
    // 128-wide card ending at 68, entirely left of the 72px rail edge.
    expect(anchorVisibleRatio(behindRail)).toBe(0);
  });

  it("is 1 for a card in open space", () => {
    expect(anchorVisibleRatio(input())).toBe(1);
  });

  it("reports a partially scrolled card proportionally", () => {
    // Bottom edge of the viewport takes half the card's height.
    const half = input({ anchorRect: card({ top: VIEWPORT.height - 48 }) });
    expect(anchorVisibleRatio(half)).toBeCloseTo(0.5, 5);
    expect(anchorVisibleRatio(half)).toBeGreaterThanOrEqual(ANCHOR_MIN_VISIBLE_RATIO);
  });

  it("treats a zero-area rect as invisible instead of dividing by zero", () => {
    expect(anchorVisibleRatio(input({ anchorRect: card({ width: 0 }) }))).toBe(0);
  });
});
