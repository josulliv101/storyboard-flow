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
    window.localStorage.removeItem(STORAGE_KEY);
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

/** OPENED, so the names sit beside the glyphs. */
export const Expanded: Story = {
  render: () => {
    stubFetch();
    window.localStorage.setItem(STORAGE_KEY, "true");
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
    window.localStorage.removeItem(STORAGE_KEY);
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
    window.localStorage.removeItem(STORAGE_KEY);
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
