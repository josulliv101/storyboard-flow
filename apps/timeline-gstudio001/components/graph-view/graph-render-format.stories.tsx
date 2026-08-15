import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import type { RenderFormat } from "@storyboard/timeline-model/render-format";

import { RenderFormatMenu } from "./graph-render-format";

// The shape a project exports at. The first render setting in the app, and the
// first render UI of any kind — renders still start from the MCP tools.
//
// Driven through the PRESENTATIONAL half: the connected wrapper reads a module
// singleton, which a story could only exercise by seeding global state.

function Harness({ initial }: Readonly<{ initial?: RenderFormat }>) {
  const [format, setFormat] = useState<RenderFormat | undefined>(initial);
  return (
    <div className="graph-view-theme flex min-h-[280px] items-start bg-zinc-950 p-4">
      <RenderFormatMenu
        format={format}
        onChange={(next) => setFormat(next ?? undefined)}
      />
    </div>
  );
}

const meta: Meta<typeof RenderFormatMenu> = {
  title: "graph-view/RenderFormatMenu",
  component: RenderFormatMenu,
};
export default meta;
type Story = StoryObj<typeof RenderFormatMenu>;

/** By the data attribute, not the label — the label is what several of these
 *  stories are ABOUT, and a selector that depended on its shape would stop
 *  finding the control in exactly the case that changes it. */
const trigger = (canvasElement: HTMLElement) =>
  canvasElement.querySelector("[data-render-format]") as HTMLElement;

/** A project that has never chosen shows the DEFAULT, not an empty control —
 *  "what will this export as" always has an answer. */
export const UnsetShowsTheDefault: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    expect(trigger(canvasElement)).toHaveTextContent("16:9 · 720p");
    expect(trigger(canvasElement)).toHaveAttribute("data-render-format", "1280x720");
  },
};

/** Choosing writes the format and the readout follows. */
export const ChoosingAPresetChangesTheFormat: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    await user.click(trigger(canvasElement));

    // The menu is PORTALED, so it is not inside `canvasElement`.
    const menu = within(document.body);
    await waitFor(() => expect(menu.getByText("Scope")).toBeInTheDocument());
    await user.click(menu.getByText("Scope"));

    await waitFor(() =>
      expect(trigger(canvasElement)).toHaveAttribute("data-render-format", "1152x480"),
    );
    expect(trigger(canvasElement)).toHaveTextContent("2.4:1 · Scope");
  },
};

/** A stored format that matches no preset shows its NUMBERS rather than
 *  claiming to be one of them — the render tool takes any size, so this is
 *  reachable without the menu. */
export const ACustomSizeShowsItsNumbers: Story = {
  render: () => <Harness initial={{ width: 1440, height: 810, fps: 30 }} />,
  play: async ({ canvasElement }) => {
    // 1440x810 IS 16:9, so it names the ratio it recognises and gives the size.
    expect(trigger(canvasElement)).toHaveTextContent("16:9 · 1440×810");
  },
};

/** A size matching no known ratio falls back to the bare dimensions. */
export const AnUnknownRatioShowsOnlyTheSize: Story = {
  render: () => <Harness initial={{ width: 1000, height: 700, fps: 24 }} />,
  play: async ({ canvasElement }) => {
    expect(trigger(canvasElement)).toHaveTextContent("1000×700");
  },
};
