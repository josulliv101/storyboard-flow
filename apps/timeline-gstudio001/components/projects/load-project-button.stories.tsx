import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Toaster } from "@/components/core/sonner";

import { LoadProjectButton } from "./load-project-button";

// "Load Project" on the library page — the one home this action has (PL15-002).
//
// THE FAILURE STORIES CAME FROM `graph-view/graph-project-menu.stories.tsx`,
// where load used to live in the board's `⋮`. The menu item went; the code
// behind it did not, so its coverage moved here rather than being deleted with
// it. Both cases below are the same `loadProjectFromFile` they always tested,
// reached from the control that still calls it.
//
// NO NETWORK, per the storybook workspace's rule. The success path is never
// exercised — it would replace the offline board — so what is covered is the
// two ways it is refused, which are the likely outcomes until offline mode is
// set up.
//
// The TOASTER IS MOUNTED HERE because the app mounts it in the root layout, and
// failures are reported through it. Without it the component would appear to do
// nothing on failure and the stories would pass by asserting nothing.

const meta = {
  title: "Projects/Load project button",
  component: LoadProjectButton,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-h-[240px] items-start justify-center bg-zinc-950 p-4">
        <Story />
        <Toaster />
      </div>
    ),
  ],
} satisfies Meta<typeof LoadProjectButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * At rest: an outline button, secondary to "New Project"'s filled blue. Both
 * make a project appear in the list, but one is the everyday verb and the other
 * is recovery.
 */
export const Closed: Story = {};

/**
 * A refused load: the server says no (offline mode off, or the target being a
 * generated fixture) and the reason has to reach the user.
 *
 * This story is why the message is a TOAST. It was first rendered inside the
 * board menu this control replaced, and uploading fires a real pointerdown on
 * the file input — which Radix treated as an outside press, dismissing the
 * content and taking the only report of the failure with it. A toast outlives
 * the control that started it, which is still what makes it right here: this
 * button does not survive a route change either.
 */
export const LoadRefused: Story = {
  play: async () => {
    const original = window.fetch;
    window.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "scale-probe.json is a generated fixture and will not be overwritten.",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      )) as typeof window.fetch;

    try {
      // Straight at the input rather than through the button: clicking that
      // opens the OS file picker, which a story cannot answer.
      const input = document.querySelector<HTMLInputElement>("[data-project-import-input]");
      await expect(input).not.toBeNull();
      await userEvent.upload(
        input as HTMLInputElement,
        new File(['{"documents":{}}'], "toon-town.json", { type: "application/json" }),
      );

      await waitFor(() =>
        expect(within(document.body).getByText(/generated fixture/)).toBeInTheDocument(),
      );
    } finally {
      window.fetch = original;
    }
  },
};

/**
 * A `.json` file whose contents are not JSON — answered locally, with no
 * request made at all.
 *
 * The file is NAMED `.json` on purpose: `userEvent.upload` enforces the input's
 * `accept` list exactly as a browser does, so handing it a `.txt` discarded the
 * file silently and the story asserted against a component that had never been
 * given anything. Which is also the honest scenario — the picker only offers
 * JSON, so the way to arrive here is a corrupt or truncated export, not a text
 * file.
 */
export const LoadNotJson: Story = {
  play: async () => {
    const input = document.querySelector<HTMLInputElement>("[data-project-import-input]");
    await userEvent.upload(
      input as HTMLInputElement,
      new File(["{ truncated…"], "toon-town.json", { type: "application/json" }),
    );

    await waitFor(() =>
      expect(within(document.body).getByText(/is not valid JSON/)).toBeInTheDocument(),
    );
  },
};
