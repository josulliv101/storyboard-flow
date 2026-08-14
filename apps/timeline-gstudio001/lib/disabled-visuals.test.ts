import { describe, expect, it } from "vitest";

import { disabledVisualState, disabledVisualsAttr } from "./disabled-visuals";

describe("disabledVisualState", () => {
  it("is none when nothing is off", () => {
    expect(disabledVisualState({ selfDisabled: false, inheritedDisabled: false })).toBe("none");
  });

  it("is self when the item itself is switched off", () => {
    expect(disabledVisualState({ selfDisabled: true, inheritedDisabled: false })).toBe("self");
  });

  it("is inherited when only an ancestor is off", () => {
    expect(disabledVisualState({ selfDisabled: false, inheritedDisabled: true })).toBe("inherited");
  });

  it("SELF WINS when both are true", () => {
    // The ordering is load-bearing, not incidental: switching the ancestor
    // back on must leave this item off, so while both hold it has to keep
    // reading — and rendering — as the explicit choice it is.
    expect(disabledVisualState({ selfDisabled: true, inheritedDisabled: true })).toBe("self");
  });
});

// The CLASSES that each state maps to are asserted in the stories
// (`DisabledCard` / `DisabledByParentCard`), against COMPUTED style in a real
// browser — which is the only place that check means anything. Asserting the
// strings here would have passed while the page rendered unstyled: Tailwind
// does not scan `lib`, so a class named in this directory is never generated.
// That is exactly how the first version of this shipped, and what the story
// caught.

describe("disabledVisualsAttr", () => {
  it("omits the attribute entirely when the card is on", () => {
    expect(disabledVisualsAttr("none")).toBeUndefined();
  });

  it('spells self as "true", matching the data-disabled attribute beside it', () => {
    // Not "self". The pair has been "true"/"inherited" on `data-disabled`
    // since before the visuals diverged, and the e2e already selects on
    // [data-disabled-visuals="true"] — one vocabulary for one concept.
    expect(disabledVisualsAttr("self")).toBe("true");
  });

  it('spells inherited as "inherited"', () => {
    expect(disabledVisualsAttr("inherited")).toBe("inherited");
  });
});
