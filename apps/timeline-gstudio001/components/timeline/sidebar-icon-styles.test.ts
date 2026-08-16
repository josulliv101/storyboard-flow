import { describe, expect, it } from "vitest";

import {
  RAIL_CLASS,
  RAIL_OPEN_CLASS,
  RAIL_OPEN_WIDTH_PX,
  RAIL_WIDTH_CLASS,
  RAIL_WIDTH_PX,
  SIDEBAR_AVATAR_INSET,
  SIDEBAR_GLYPH,
  SIDEBAR_ICON_BASE,
} from "./sidebar-icon-styles";

// THE RAIL'S TWO WIDTHS ARE WRITTEN TWICE — once as a number, which the CSS
// variable and the drawer offset are published from, and once as a literal
// Tailwind class, because Tailwind scans source text and cannot see a class
// built by template. Nothing in the type system connects them, and the failure
// when they drift is silent: the rail animates to a width nothing beside it
// moved to, or the class compiles to nothing and the toggle looks dead.

describe("rail widths", () => {
  it.each([
    ["collapsed", RAIL_WIDTH_CLASS.collapsed, RAIL_WIDTH_PX],
    ["open", RAIL_WIDTH_CLASS.open, RAIL_OPEN_WIDTH_PX],
  ])("the %s class names the same number the variable publishes", (_name, className, px) => {
    expect(className).toBe(`w-[${px}px]`);
  });

  it("opens wider than it is closed", () => {
    expect(RAIL_OPEN_WIDTH_PX).toBeGreaterThan(RAIL_WIDTH_PX);
  });
});

describe("the glyph never moves", () => {
  // The rail leads its glyphs rather than centring them, and the inset has to
  // reproduce what centring already produced at 72px. That equality is the
  // whole reason the geometry can be state-INDEPENDENT: get it wrong and the
  // icons sit off-centre when closed, tie it back to the open state and they
  // fly across the rail on every collapse.
  const inset = (classes: string) => {
    const match = /\[\.rail_&\]:ml-(?:\[(\d+)px\]|(\d+))/.exec(classes);
    if (!match) throw new Error(`no expanded inset in: ${classes}`);
    // Tailwind's numeric scale is quarter-rem: ml-5 is 20px.
    return match[1] ? Number(match[1]) : Number(match[2]) * 4;
  };

  it.each([
    ["the 28px glyph", SIDEBAR_GLYPH, 28],
    ["the 32px avatar", SIDEBAR_AVATAR_INSET, 32],
  ])("%s keeps the x that centring gave it", (_name, classes, size) => {
    expect(inset(classes)).toBe((RAIL_WIDTH_PX - size) / 2);
  });
});

describe("the expanded tile", () => {
  it("keeps the collapsed tile's HEIGHT, so the rail's rhythm is unchanged", () => {
    // `aspect-square` gives a 72px-tall tile at 72px wide. Dropping the ratio
    // means the height has to be stated — and stated as the same number, or
    // every tile grows taller as the rail widens.
    expect(SIDEBAR_ICON_BASE).toContain(`[.rail_&]:h-[${RAIL_WIDTH_PX}px]`);
    expect(SIDEBAR_ICON_BASE).toContain("[.rail_&]:aspect-auto");
  });

  it("hangs its geometry off the ALWAYS class, never the open one", () => {
    // THE COLLAPSE BUG, pinned. A class flips in one frame and the width takes
    // 200ms, so any layout keyed to `rail-open` is briefly applied against the
    // wrong width: collapsing re-centred every glyph inside a still-232px tile
    // and the icons flew back across the rail. Only the ASIDE'S OWN WIDTH may
    // depend on the open state.
    expect(SIDEBAR_ICON_BASE).not.toContain(RAIL_OPEN_CLASS);
    expect(SIDEBAR_GLYPH).not.toContain(RAIL_OPEN_CLASS);
    expect(SIDEBAR_AVATAR_INSET).not.toContain(RAIL_OPEN_CLASS);
  });

  it("drives its variants off the class the rail actually sets", () => {
    // The variants are literal selectors (Tailwind scans text), so renaming a
    // constant alone would leave them pointing at a class nothing applies —
    // and every tile would stay square while the rail widened.
    expect(RAIL_CLASS).toBe("rail");
    expect(RAIL_OPEN_CLASS).toBe("rail-open");
    expect(SIDEBAR_ICON_BASE).toContain(`[.${RAIL_CLASS}_&]:`);
  });
});
