import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Toaster } from "@/components/core/sonner";

import { GraphProjectMenu } from "./graph-project-menu";

// The project `⋮` beside Select: export the project to a JSON file, load one
// back.
//
// Rendered DIRECTLY rather than through a harness — unlike the render-format
// group next door, this owns its own trigger and menu and reads no store, so
// the only thing a wrapper would add is the board's dark surface.
//
// NO NETWORK, per the storybook workspace's rule. Export is a plain `<a
// download>` and is never activated here (a story that clicked it would ask the
// browser to save a file). Load's fetch is stubbed per story, which is the only
// way to reach the failure toasts — the states worth covering, since a load that
// is refused server-side is the likely outcome until offline mode is set up.
//
// The TOASTER IS MOUNTED HERE because the app mounts it in the root layout, and
// failures are reported through it. Without it the component would appear to do
// nothing on failure and the stories would pass by asserting nothing.

const meta = {
  title: "Graph view/Project menu",
  component: GraphProjectMenu,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="graph-view-theme flex min-h-[320px] items-start justify-end bg-zinc-950 p-4">
        <Story />
        <Toaster />
      </div>
    ),
  ],
  args: { projectId: "project-toon-town" },
} satisfies Meta<typeof GraphProjectMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: one 32px ghost square, matching the toggles it sits beside. */
export const Closed: Story = {};

/** Open, showing both verbs. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Project options" }));
    // Radix portals the content, so it is outside the canvas element.
    const menu = within(document.body);
    await waitFor(() => expect(menu.getByText("Export project…")).toBeInTheDocument());
    await expect(menu.getByText("Load project from file…")).toBeInTheDocument();
    // The export item is a real link — that is what makes right-click and
    // middle-click work, and a button would silently lose both.
    await expect(menu.getByText("Export project…").closest("a")).toHaveAttribute(
      "href",
      "/api/timelines/project-toon-town/export",
    );
  },
};

/**
 * A refused load: the server says no (offline mode off, or the target being a
 * generated fixture) and the reason has to reach the user.
 *
 * This story is why the message is a TOAST. It was first rendered inside the
 * menu, and uploading fires a real pointerdown on the file input — which Radix
 * treats as an outside press and dismisses the content, taking the only report
 * of the failure with it. A toast outlives the control that started it.
 */
export const LoadRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const original = window.fetch;
    window.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "scale-probe.json is a generated fixture and will not be overwritten.",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      )) as typeof window.fetch;

    try {
      await userEvent.click(canvas.getByRole("button", { name: "Project options" }));
      const menu = within(document.body);
      await waitFor(() => expect(menu.getByText("Load project from file…")).toBeInTheDocument());

      // Straight at the input rather than through the menu item: clicking that
      // opens the OS file picker, which a story cannot answer.
      const input = document.querySelector<HTMLInputElement>("[data-project-import-input]");
      await expect(input).not.toBeNull();
      await userEvent.upload(
        input as HTMLInputElement,
        new File(['{"documents":{}}'], "toon-town.json", { type: "application/json" }),
      );

      await waitFor(() =>
        expect(menu.getByText(/generated fixture/)).toBeInTheDocument(),
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Project options" }));
    const menu = within(document.body);
    await waitFor(() => expect(menu.getByText("Load project from file…")).toBeInTheDocument());

    const input = document.querySelector<HTMLInputElement>("[data-project-import-input]");
    await userEvent.upload(
      input as HTMLInputElement,
      new File(["{ truncated…"], "toon-town.json", { type: "application/json" }),
    );

    await waitFor(() => expect(menu.getByText(/is not valid JSON/)).toBeInTheDocument());
  },
};
