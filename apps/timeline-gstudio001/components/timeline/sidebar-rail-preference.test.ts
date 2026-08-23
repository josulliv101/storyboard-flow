import { describe, expect, it } from "vitest";

import {
  RAIL_EXPANDED_COOKIE,
  railExpandedFromCookies,
} from "./sidebar-rail-preference";

// THE PARSE THE SERVER DOES, covered where it actually lives.
//
// This runs on both sides of the app from one implementation — the root layout
// hands it a request header, the rail hands it `document.cookie` — and it is
// the only thing standing between the stored preference and the width the
// first paint uses. Get it wrong and the rail renders collapsed for someone
// who left it open, which is #471 all over again.
//
// A UNIT test rather than a story, because `useSyncExternalStore` consults its
// server snapshot only while hydrating and a story renders client-only: the
// branch this feeds cannot be exercised there at all.
describe("railExpandedFromCookies", () => {
  it("reads the preference out of a header carrying nothing else", () => {
    expect(railExpandedFromCookies(`${RAIL_EXPANDED_COOKIE}=true`)).toBe(true);
    expect(railExpandedFromCookies(`${RAIL_EXPANDED_COOKIE}=false`)).toBe(false);
  });

  it("finds it among the other cookies, in any position", () => {
    const first = `${RAIL_EXPANDED_COOKIE}=true; session=abc; theme=dark`;
    const middle = `session=abc; ${RAIL_EXPANDED_COOKIE}=true; theme=dark`;
    const last = `session=abc; theme=dark; ${RAIL_EXPANDED_COOKIE}=true`;
    for (const header of [first, middle, last]) {
      expect(railExpandedFromCookies(header)).toBe(true);
    }
  });

  // ABSENT IS COLLAPSED. No cookie means nobody has ever toggled the rail,
  // which is the narrow default — and it has to be reached without throwing,
  // because it is the state every first-time visitor arrives in.
  it("treats an absent or empty header as collapsed", () => {
    expect(railExpandedFromCookies(undefined)).toBe(false);
    expect(railExpandedFromCookies("")).toBe(false);
    expect(railExpandedFromCookies("session=abc; theme=dark")).toBe(false);
  });

  // ONLY THE EXACT NAME. A prefix match would let an unrelated cookie decide
  // the layout, and the failure would be a rail that opens on its own for the
  // one person whose session happens to carry the wrong key.
  it("does not match a cookie whose name merely contains it", () => {
    expect(railExpandedFromCookies(`not_${RAIL_EXPANDED_COOKIE}=true`)).toBe(false);
    expect(railExpandedFromCookies(`${RAIL_EXPANDED_COOKIE}_other=true`)).toBe(false);
  });

  // Only the literal `true` opens it. Anything else is a value this app did not
  // write, and guessing what it meant is how a display preference turns into a
  // layout that nobody chose.
  it("opens on the literal true and on nothing else", () => {
    for (const value of ["1", "yes", "TRUE", "", "truthy"]) {
      expect(railExpandedFromCookies(`${RAIL_EXPANDED_COOKIE}=${value}`)).toBe(false);
    }
  });

  // Cookies are written `name=value` with optional spaces after the
  // semicolons; `document.cookie` and a request header differ on that, and one
  // parser serves both.
  it("tolerates the spacing of both sources", () => {
    expect(railExpandedFromCookies(`a=1;${RAIL_EXPANDED_COOKIE}=true;b=2`)).toBe(true);
    expect(railExpandedFromCookies(`a=1;   ${RAIL_EXPANDED_COOKIE}=true;   b=2`)).toBe(true);
  });
});
