import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RAIL_WIDTH_VAR } from "@/components/timeline/sidebar-rail-preference";

/**
 * THE RAIL'S SUSPENSE FALLBACK MUST RESERVE THE RAIL'S WIDTH.
 *
 * The rail is server-rendered, but inside a Suspense boundary, so the shell
 * flushes with the boundary pending and the rail's markup arrives later in the
 * same response. While it is pending the fallback is what holds its place — and
 * a `null` fallback holds nothing, so `main` (its `flex-1` sibling) lays out
 * across the whole row and is shoved sideways by the rail's full width when the
 * boundary resolves. Measured at 260px: `main` x:0 w:1385 -> x:260 w:1125, one
 * layout shift of 0.1837, which was the entire CLS of the projects page.
 *
 * WHY A TEST AND NOT JUST THE FIX. This was invisible for as long as the page
 * painted slowly: the shift only counts when a paint lands between the shell
 * and the boundary resolving, so a slow first paint HID it and PL15-027's
 * faster one revealed it. Nothing about that shows up in review, and a future
 * `fallback={null}` would read as tidier rather than as a regression.
 *
 * READ AS SOURCE TEXT because the thing under test is a server component in the
 * root layout: rendering it would need a request, a session and a cookie store,
 * none of which this invariant depends on. The same reasoning the rail's other
 * geometry guards use in `sidebar-icon-styles.test.ts`.
 */
const layoutSource = readFileSync(path.resolve(__dirname, "layout.tsx"), "utf8");

const suspenseBlock = (() => {
  const open = layoutSource.indexOf("<Suspense");
  const close = layoutSource.indexOf("</Suspense>", open);
  return open === -1 || close === -1 ? "" : layoutSource.slice(open, close);
})();

describe("the rail's Suspense boundary", () => {
  it("is present in the root layout at all", () => {
    expect(suspenseBlock).not.toBe("");
    expect(suspenseBlock).toContain("TimelineSidebar");
  });

  it("does not fall back to nothing, which would give the rail zero width", () => {
    expect(suspenseBlock).not.toMatch(/fallback=\{null\}/);
  });

  it("reserves its width from the variable the server publishes before paint", () => {
    // Any hardcoded number would be right for one rail state and wrong for the
    // other; the variable is already correct for both in the server's own
    // markup, which is the whole reason it exists (#471).
    //
    // Matched as the IDENTIFIER rather than its value, because that is what the
    // source says — asserting the literal `--sw-rail-width` here would pass for
    // a layout that spelled the name out by hand and so drifted the moment the
    // constant moved. That the identifier is the real import is the compiler's
    // job, not this test's; the value it carries is pinned below.
    expect(suspenseBlock).toMatch(/width:\s*`var\(\$\{RAIL_WIDTH_VAR\}\)`/);
  });

  it("does not let the reserved box be squeezed by its flex siblings", () => {
    // The row is `flex`; without `shrink-0` a zero-content placeholder is a
    // candidate for shrinking and reserves less than it claims.
    expect(suspenseBlock).toContain("shrink-0");
  });

  it("reserves the SAME variable the layout publishes before paint", () => {
    // The two have to be one variable or the reservation is a guess: the value
    // on `<html>` is what the server computed from the cookie, and the fallback
    // is only correct while it reads that exact name.
    expect(layoutSource).toMatch(/\[RAIL_WIDTH_VAR\]:/);
    expect(RAIL_WIDTH_VAR).toBe("--sw-rail-width");
  });
});
