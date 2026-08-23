import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AuthProvider } from "@/components/auth/auth-provider";

import { TimelineSidebar } from "./timeline-sidebar";
import { RAIL_OPEN_WIDTH_PX, RAIL_WIDTH_PX } from "./sidebar-icon-styles";

// THE RAIL ITSELF, opening and closing.
//
// It had no story. Its parts did — the collection shortcuts have one — but the
// thing those parts live in did not, and the one piece of behaviour that
// belongs to the rail rather than to any tile is its WIDTH: the toggle at the
// bottom, the state behind it, and the two widths it moves between. That has
// been reported broken three times (see #429), diagnosed twice, and until now
// there was no test anywhere that pressed the button and looked.
//
// DETERMINISTIC, per the Storybook rule: no Firebase, no live requests. Two
// things reach for the network on mount — the auth provider revalidating its
// session, and the trash drawer's marked-assets read — so `fetch` is stubbed
// for the whole story rather than left to fail quietly and colour the result.
//
// `AuthProvider` is used for real, with the session it would have been handed
// by the server. `useAuth` throws without it, and giving it `initialUser`
// keeps it out of its loading state, which is what the real app does too. The
// alternative was exporting the context purely so a story could fake it —
// production code widened for a test.

const STORAGE_KEY = "sw:sidebar-expanded";

/**
 * FORGET THE RAIL COMPLETELY, both stores.
 *
 * The preference is a COOKIE now, because the server has to render the right
 * width on the first paint (#471) — and a cookie outlives the story that set
 * it, where `localStorage.removeItem` alone does not. Clearing only the old
 * store left a toggled-open rail behind for whatever ran next, which failed as
 * `expected 260 to be 72` in a story that had done nothing wrong.
 *
 * `max-age=0` on the same path it was written with: a cookie is only cleared
 * by a cookie, and only if the path matches.
 */
function forgetRailPreference(): void {
  document.cookie = "sw_rail_expanded=; path=/; max-age=0";
  window.localStorage.removeItem(STORAGE_KEY);
}

const USER = {
  uid: "u-story",
  email: "editor@example.test",
  name: "Story Editor",
  picture: null,
};

/** Everything this component asks the network for, answered locally. */
function stubFetch() {
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.includes("/api/auth/me")
      ? { user: USER }
      : url.includes("/api/assets/marked")
        ? { assets: [] }
        : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof window.fetch;
}

function Harness() {
  return (
    // The rail is `h-screen` and sticky; the frame gives it a page to sit in
    // and the app's ground to be read against.
    <div className="graph-view-theme flex min-h-[560px] bg-zinc-950">
      <AuthProvider initialUser={USER}>
        <TimelineSidebar />
      </AuthProvider>
    </div>
  );
}

const meta: Meta<typeof TimelineSidebar> = {
  title: "timeline/TimelineSidebar",
  component: TimelineSidebar,
  parameters: {
    layout: "fullscreen",
    // `appDirectory` MOUNTS the app router mock. Without it the first hook to
    // ask for a router throws `invariant expected app router to be mounted`
    // and the story renders nothing at all — an empty canvas, which reads as
    // "the component drew nothing" rather than as "it never ran". Here it is
    // `AuthProvider`, before the sidebar is even reached.
    nextjs: { appDirectory: true },
  },
};
export default meta;
type Story = StoryObj<typeof TimelineSidebar>;

const rail = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>("aside[data-sidebar-expanded]")!;

/** The animated width, once it has stopped moving. The class flips at once
 *  but the box takes 200ms to follow, so every width assertion has to wait
 *  for the transition rather than read the frame the click landed on. */
const settledWidth = async (element: HTMLElement, expected: number) => {
  await waitFor(
    () => {
      expect(Math.round(element.getBoundingClientRect().width)).toBe(expected);
    },
    { timeout: 3000 },
  );
};

/** COLLAPSED is the default, and the state a new session starts in. */
export const Collapsed: Story = {
  render: () => {
    stubFetch();
    forgetRailPreference();
    return <Harness />;
  },
  play: async ({ canvasElement }) => {
    const aside = rail(canvasElement);
    expect(aside).toHaveAttribute("data-sidebar-expanded", "false");
    await settledWidth(aside, RAIL_WIDTH_PX);
    // The toggle is named for the state it moves you TO, which is also how
    // every test here finds it.
    expect(
      within(canvasElement).getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
  },
};

/**
 * OPENED, so the names sit beside the glyphs — FROM `localStorage` ALONE.
 *
 * Which is now the MIGRATION path rather than the ordinary one. The cookie is
 * the source of truth (#471), and this sets only the old store, so it stands
 * for the rail of someone who last toggled it before the cookie existed: their
 * preference has to survive the upgrade rather than silently reset to
 * collapsed. Cleared first, so the assertion cannot be met by a cookie some
 * earlier story left behind.
 */
export const Expanded: Story = {
  render: () => {
    stubFetch();
    forgetRailPreference();
    window.localStorage.setItem(STORAGE_KEY, "true");
    return <Harness />;
  },
  play: async ({ canvasElement }) => {
    const aside = rail(canvasElement);
    expect(aside).toHaveAttribute("data-sidebar-expanded", "true");
    await settledWidth(aside, RAIL_OPEN_WIDTH_PX);
    // AND THE UPGRADE IS WRITTEN DOWN. The rail backfills the cookie on mount,
    // so this is the LAST load that renders from `localStorage` — without it
    // the server would go on guessing collapsed forever for anyone who never
    // touches the toggle again, and the shift this all exists to remove would
    // survive for exactly the people who had already chosen the open rail.
    await waitFor(() => {
      expect(document.cookie).toContain("sw_rail_expanded=true");
    });
  },
};

/**
 * THE COOKIE WINS, and it is what the first client render reads.
 *
 * The preference moved to a cookie so the SERVER could render the right width
 * on the first paint (#471) — the rail used to read `localStorage`, which the
 * server cannot see, so every load painted it collapsed and widened it on
 * hydration: 188px of `main` moving sideways, and 0.135 of a 0.16 CLS from
 * that one shift.
 *
 * The two stores are set to DISAGREE here. A rail still reading the old one
 * would come up collapsed, which is exactly the state that used to cause the
 * shift, so this fails if the precedence is ever put back.
 *
 * NOT AN ASSERTION ABOUT `initialRailExpanded`, deliberately.
 * `useSyncExternalStore` only consults its server snapshot while hydrating,
 * and a story renders client-only — so a story asserting the prop would be
 * asserting a branch that never runs here. The parse the server actually does
 * is covered in `sidebar-rail-preference.test.ts`, and the rendered markup was
 * measured against the running app.
 */
export const TheCookieDecidesTheWidth: Story = {
  render: () => {
    stubFetch();
    forgetRailPreference();
    window.localStorage.setItem(STORAGE_KEY, "false");
    document.cookie = "sw_rail_expanded=true; path=/; max-age=31536000; samesite=lax";
    return <Harness />;
  },
  play: async ({ canvasElement }) => {
    const aside = rail(canvasElement);
    expect(aside).toHaveAttribute("data-sidebar-expanded", "true");
    await settledWidth(aside, RAIL_OPEN_WIDTH_PX);
  },
};

/**
 * THE TOGGLE OPENS AND CLOSES IT — the behaviour this file exists for.
 *
 * Both directions, from one press each, asserted on the box that actually
 * moves rather than on the class that asks it to: the reported fault is a rail
 * that "looks like it wants to open and then doesn't", which a class assertion
 * would sail straight past. The width is read after the transition settles.
 *
 * The preference survives the press too, because a rail that reopens collapsed
 * on the next navigation is a preference in name only.
 */
export const TheToggleOpensAndCloses: Story = {
  render: () => {
    stubFetch();
    forgetRailPreference();
    return <Harness />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const aside = rail(canvasElement);
    const user = userEvent.setup();

    // Starts closed.
    await settledWidth(aside, RAIL_WIDTH_PX);

    // OPEN.
    await user.click(canvas.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() => {
      expect(aside).toHaveAttribute("data-sidebar-expanded", "true");
    });
    await settledWidth(aside, RAIL_OPEN_WIDTH_PX);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
    // The control now offers the opposite move, and is the same control.
    const collapse = canvas.getByRole("button", { name: "Collapse sidebar" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    // CLOSE.
    await user.click(collapse);
    await waitFor(() => {
      expect(aside).toHaveAttribute("data-sidebar-expanded", "false");
    });
    await settledWidth(aside, RAIL_WIDTH_PX);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
    expect(
      canvas.getByRole("button", { name: "Expand sidebar" }),
    ).toHaveAttribute("aria-expanded", "false");
  },
};

/**
 * IT SURVIVES BEING PRESSED TWICE IN A ROW, which is the shape the reported
 * fault takes: open, close, open again, each landing where it should.
 *
 * Not a timing test — a second press inside the 200ms transition is a
 * different question, and the one open in #429 — but a rail whose state gets
 * out of step with its own button would fail here first, and that costs
 * nothing to rule out.
 */
export const RepeatedTogglingStaysInStep: Story = {
  render: () => {
    stubFetch();
    forgetRailPreference();
    return <Harness />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const aside = rail(canvasElement);
    const user = userEvent.setup();

    for (const round of [1, 2]) {
      await user.click(canvas.getByRole("button", { name: "Expand sidebar" }));
      await settledWidth(aside, RAIL_OPEN_WIDTH_PX);
      expect(aside, `round ${round}: opened`).toHaveAttribute(
        "data-sidebar-expanded",
        "true",
      );

      await user.click(canvas.getByRole("button", { name: "Collapse sidebar" }));
      await settledWidth(aside, RAIL_WIDTH_PX);
      expect(aside, `round ${round}: closed`).toHaveAttribute(
        "data-sidebar-expanded",
        "false",
      );
    }
  },
};
