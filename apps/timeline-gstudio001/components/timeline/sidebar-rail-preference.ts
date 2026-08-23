// The rail's width preference, as the two sides of the app share it.
//
// NO `"use client"`, and that is the whole reason this file exists. These
// constants and the parser lived in `timeline-sidebar.tsx`, which is a client
// module — so the root layout importing `railExpandedFromCookies` from there
// typechecked cleanly and then failed at request time with "Attempted to call
// railExpandedFromCookies() from the server but it is on the client". Next
// replaces a client module with a reference proxy for the server graph, so
// every export of one is unusable server-side, not just its components.
//
// A neutral module is the seam: the server reads the cookie through it, the
// rail writes the cookie through it, and there is exactly one spelling of the
// cookie's name for them to agree on.

/**
 * The rail preference as a COOKIE, because the server has to know it.
 *
 * localStorage is invisible to the server, so every load rendered the rail
 * collapsed and expanded it on hydration — a 188px shove of everything beside
 * it, and 0.135 of a 0.16 CLS on its own (#471). No amount of client-side
 * cleverness fixes that: the first paint has to be right, and only something
 * that travels with the REQUEST can make it right.
 *
 * READ AS THE SOURCE OF TRUTH on both sides, rather than mirrored alongside
 * localStorage. Two stores that can disagree are a hydration mismatch waiting
 * for the first person whose copies drift — cleared site data, an old tab, a
 * private window. One store cannot disagree with itself. localStorage is still
 * WRITTEN, and still read as a fallback, purely so a rail already open before
 * this change stays open on the load that introduces it.
 *
 * SEMANTICS ARE UNCHANGED. A cookie is per-browser and so is localStorage, and
 * this is read at LOAD, never live — so two windows still keep their own
 * widths. What a cookie adds is only that the server can see it.
 *
 * `SameSite=Lax` and a year: a display preference, sent on top-level
 * navigations, which is exactly when the server needs it.
 */
export const RAIL_EXPANDED_COOKIE = "sw_rail_expanded";
export const RAIL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Published to the document so surfaces BESIDE the rail can be offset by it.
 *
 * The trash drawer hardcoded `ml-[72px]`, which is correct exactly while the
 * rail cannot change width — so opening the rail would have slid it
 * underneath. A variable is the seam: one writer, and any number of readers
 * that keep working when this number moves again.
 */
export const RAIL_WIDTH_VAR = "--sw-rail-width";

/**
 * Parse the rail cookie out of a `document.cookie` or request header string.
 *
 * One parser for both, because they are the same format and a second one is a
 * second thing to get wrong. Absent means collapsed: no cookie is nobody
 * having toggled it.
 */
export function railExpandedFromCookies(header: string | undefined): boolean {
  if (!header) return false;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === RAIL_EXPANDED_COOKIE) return rest.join("=") === "true";
  }
  return false;
}
