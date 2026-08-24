import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { GraphProjectMenu } from "./graph-project-menu";

// The project `⋮` beside Select: export the project to a JSON file.
//
// Rendered DIRECTLY rather than through a harness — unlike the render-format
// group next door, this owns its own trigger and menu and reads no store, so
// the only thing a wrapper would add is the board's dark surface.
//
// NO NETWORK, per the storybook workspace's rule. Export is a plain `<a
// download>` and is never activated here (a story that clicked it would ask the
// browser to save a file), so the assertion is on the href instead.
//
// LOAD USED TO LIVE HERE and its stories with it (PL15-002). The failure
// coverage did NOT go with the menu item — `loadProjectFromFile` is still live
// code reached from the library page, so `components/projects/
// load-project-button.stories.tsx` carries the refused-load and bad-JSON cases
// now. Deleting them alongside the menu item would have dropped the only
// coverage of a corrupt export.

const meta = {
  title: "Graph view/Project menu",
  component: GraphProjectMenu,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="graph-view-theme flex min-h-[320px] items-start justify-end bg-zinc-950 p-4">
        <Story />
      </div>
    ),
  ],
  args: { projectId: "project-toon-town" },
} satisfies Meta<typeof GraphProjectMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: one 32px ghost square, matching the toggles it sits beside. */
export const Closed: Story = {};

/** Open, showing the one verb it now holds. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Project options" }));
    // Radix portals the content, so it is outside the canvas element.
    const menu = within(document.body);
    await waitFor(() => expect(menu.getByText("Export project…")).toBeInTheDocument());
    // The export item is a real link — that is what makes right-click and
    // middle-click work, and a button would silently lose both.
    await expect(menu.getByText("Export project…").closest("a")).toHaveAttribute(
      "href",
      "/api/timelines/project-toon-town/export",
    );
    // AND NOTHING ELSE. Asserted rather than left implied: the whole of
    // PL15-002 is that this menu holds one verb, and a story that only checks
    // the survivor would pass just as happily with load still listed.
    await expect(menu.queryByText(/Load project/)).toBeNull();
  },
};
