import { describe, expect, it } from "vitest";

import { barReachWindow, lastBarReach, rememberBarReach } from "./graph-item-details-bar-reach";

const ids = Array.from({ length: 60 }, (_, index) => `clip-${index}`);

describe("the remembered reach", () => {
  it("opens at ten either side", () => {
    // ASSERTED HERE rather than in a story: the value lives at module scope
    // for the session, so in a browser running many stories the "default" a
    // story sees is whoever reached for the picker last. This is the only
    // place nothing can have moved it.
    expect(lastBarReach()).toBe(10);
  });

  it("keeps what it is given", () => {
    rememberBarReach("all");
    expect(lastBarReach()).toBe("all");
    rememberBarReach(10);
  });
});

describe("barReachWindow", () => {
  it("hands back the whole list untouched for 'all'", () => {
    const window = barReachWindow(ids, 30, "all");
    expect(window.ids).toBe(ids);
    expect(window.centre).toBe(30);
  });

  it("takes `reach` either side of the subject", () => {
    const window = barReachWindow(ids, 30, 10);
    expect(window.ids).toHaveLength(21);
    expect(window.ids[0]).toBe("clip-20");
    expect(window.ids[20]).toBe("clip-40");
    // And the subject is still the subject, at its new index.
    expect(window.ids[window.centre]).toBe("clip-30");
  });

  it("keeps the window the same size at the start of the list", () => {
    // Three clips in, there are not ten behind — so the ten it cannot take
    // backwards are made up forwards. A window that shrank instead would
    // change the scale under the playhead as you walked towards the end.
    const window = barReachWindow(ids, 3, 10);
    expect(window.ids).toHaveLength(21);
    expect(window.ids[0]).toBe("clip-0");
    expect(window.centre).toBe(3);
    expect(window.ids[window.centre]).toBe("clip-3");
  });

  it("keeps the window the same size at the end of the list", () => {
    const window = barReachWindow(ids, 58, 10);
    expect(window.ids).toHaveLength(21);
    expect(window.ids[20]).toBe("clip-59");
    expect(window.ids[window.centre]).toBe("clip-58");
  });

  it("does not pad a list shorter than the window", () => {
    const few = ids.slice(0, 9);
    const window = barReachWindow(few, 4, 10);
    expect(window.ids).toBe(few);
    expect(window.centre).toBe(4);
  });

  it("leaves a list exactly the window's size alone", () => {
    const exact = ids.slice(0, 21);
    const window = barReachWindow(exact, 5, 10);
    expect(window.ids).toBe(exact);
    expect(window.centre).toBe(5);
  });

  it("takes five either side", () => {
    const window = barReachWindow(ids, 30, 5);
    expect(window.ids).toHaveLength(11);
    expect(window.ids[0]).toBe("clip-25");
    expect(window.ids[10]).toBe("clip-35");
    expect(window.ids[window.centre]).toBe("clip-30");
  });

  it("survives a subject it cannot find", () => {
    const window = barReachWindow(ids, -1, 10);
    expect(window.ids).toBe(ids);
    expect(window.centre).toBe(-1);
  });
});
