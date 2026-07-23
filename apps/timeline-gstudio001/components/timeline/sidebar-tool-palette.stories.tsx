import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { SidebarToolPalette } from "./sidebar-tool-palette";

// The palette is the sidebar's insertion surface. It used to be pointer-only:
// `div[role="button"]` tiles whose Enter/Space showed a "drag this" hint while
// real insertion required a native HTML5 drag carrying a custom DataTransfer,
// so keyboard, screen-reader, and touch users could not create anything.
//
// These stories cover the ACTIVATION half. The drag half needs real trusted
// input and lives in the Playwright suite (per the storybook rules), which is
// also where the graph-side effect of an insert is asserted.

const meta = {
  title: "GStudio/Timeline/SidebarToolPalette",
  component: SidebarToolPalette,
  tags: ["autodocs"],
  // The sidebar is a dark, narrow rail; give the tooltips room to sit beside
  // the tiles rather than clipping at the canvas edge.
  decorators: [
    (Story) => (
      <div className="flex w-[280px] justify-start bg-zinc-900/50 p-4">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    canInsert: {
      control: { type: "boolean" },
      description:
        "Whether activating a tool INSERTS it. False off the graph route, where nothing listens for the handoff — the accessible name then promises only what a drag can deliver.",
    },
    onActivate: { description: "Click, Enter, or Space on a tool." },
  },
  args: {
    canInsert: true,
    onActivate: fn(),
    onDragStart: fn(),
    onDragEnd: fn(),
  },
} satisfies Meta<typeof SidebarToolPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** On the graph route: activation appends to the open timeline. */
export const CanInsert: Story = {};

/**
 * Off the graph route (storyboard/workbench), nothing is listening for the
 * handoff. The accessible name drops the "Add …" promise rather than offering
 * an action that would do nothing.
 */
export const DragOnly: Story = {
  args: { canInsert: false },
};

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

/** The tile is a real button, so it is reachable and named as an action.
 *  (Collection is the only tool: the image/video placeholder tools were
 *  removed — media arrives via the Assets drawer or OS file drops.) */
export const AccessibleNames: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tools = canvas.getAllByRole("button");
    await expect(tools).toHaveLength(1);
    await expect(
      canvas.getByRole("button", { name: "Add Collection to the open timeline" }),
    ).toBeInTheDocument();
    // Drag survives the switch to <button> — it is the position affordance.
    await expect(tools[0]).toHaveAttribute("draggable", "true");
  },
};

/** A click reports the activated tool. */
export const ClickActivates: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Add Collection to the open timeline" }),
    );
    await expect(args.onActivate).toHaveBeenCalledTimes(1);
    await expect(args.onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "collection" }),
    );
  },
};

/**
 * The regression this component exists for: Enter and Space must activate.
 * The old `div[role="button"]` hand-rolled these keys and did nothing useful
 * with them; a real <button> gets both from the platform.
 */
export const KeyboardActivates: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const tool = canvas.getByRole("button", { name: "Add Collection to the open timeline" });

    tool.focus();
    await expect(tool).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    await expect(args.onActivate).toHaveBeenCalledTimes(1);

    await userEvent.keyboard(" ");
    await expect(args.onActivate).toHaveBeenCalledTimes(2);
    await expect(args.onActivate).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "collection" }),
    );
  },
};
