import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "storybook/test";

import type { RenderFormat } from "@storyboard/timeline-model/render-format";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/core/dropdown-menu";

import { RenderFormatOptions } from "./graph-render-format";

// The shape a project exports at. The first render setting in the app, and the
// first render UI of any kind — renders still start from the MCP tools.
//
// Driven through the PRESENTATIONAL half: the connected wrapper reads a module
// singleton, which a story could only exercise by seeding global state.
//
// WRAPPED IN AN OPEN MENU, because this is a menu GROUP and not a menu. It
// moved into the board's settings menu — every option visible at once, no
// popover of its own — and its Radix group/radio parts need a menu ancestor to
// render at all. The harness supplies the one the board supplies in the app.

function Harness({ initial }: Readonly<{ initial?: RenderFormat }>) {
  const [format, setFormat] = useState<RenderFormat | undefined>(initial);
  return (
    <div className="graph-view-theme flex min-h-[280px] items-start bg-zinc-950 p-4">
      <DropdownMenu open>
        <DropdownMenuContent
          className="w-60 p-2"
          // A story is not a pointer: without this, Radix returns focus to a
          // trigger that does not exist and the content closes itself.
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <RenderFormatOptions
            format={format}
            onChange={(next) => setFormat(next ?? undefined)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const meta: Meta<typeof RenderFormatOptions> = {
  title: "graph-view/RenderFormatOptions",
  component: RenderFormatOptions,
};
export default meta;
type Story = StoryObj<typeof RenderFormatOptions>;

// The menu CONTENT is portaled, so nothing here is inside `canvasElement` —
// every query below goes to the document.

/** By the data attribute, not the label — the label is what several of these
 *  stories are ABOUT, and a selector that depended on its shape would stop
 *  finding the control in exactly the case that changes it. */
const group = () => document.body.querySelector("[data-render-format]") as HTMLElement;

const badge = (id: string) =>
  document.body.querySelector(`[data-render-format-option="${id}"]`) as HTMLElement;

/** A project that has never chosen shows the DEFAULT, not an empty control —
 *  "what will this export as" always has an answer. */
export const UnsetShowsTheDefault: Story = {
  render: () => <Harness />,
  play: async () => {
    await waitFor(() => expect(group()).toBeInTheDocument());
    expect(group()).toHaveTextContent("16:9 · 720p");
    expect(group()).toHaveAttribute("data-render-format", "1280x720");
    // The chosen preset is marked, so the row says which one is on without
    // anyone reading the numbers.
    expect(badge("hd")).toHaveAttribute("data-state", "checked");
  },
};

/** EVERY option is visible at once — the whole point of moving this out of a
 *  menu of its own and into the settings menu. */
export const AllPresetsAreVisibleWithoutOpeningAnything: Story = {
  render: () => <Harness />,
  play: async () => {
    await waitFor(() => expect(group()).toBeInTheDocument());
    for (const id of ["hd", "fhd", "scope", "vertical"]) {
      expect(badge(id)).toBeVisible();
    }
  },
};

/** Choosing writes the format and the readout follows. */
export const ChoosingAPresetChangesTheFormat: Story = {
  render: () => <Harness />,
  play: async () => {
    const user = userEvent.setup();
    await waitFor(() => expect(badge("scope")).toBeInTheDocument());
    await user.click(badge("scope"));

    await waitFor(() =>
      expect(group()).toHaveAttribute("data-render-format", "1152x480"),
    );
    expect(group()).toHaveTextContent("2.4:1 · Scope");
    expect(badge("scope")).toHaveAttribute("data-state", "checked");
  },
};

/** A stored format that matches no preset shows its NUMBERS rather than
 *  claiming to be one of them — the render tool takes any size, so this is
 *  reachable without this control. */
export const ACustomSizeShowsItsNumbers: Story = {
  render: () => <Harness initial={{ width: 1440, height: 810, fps: 30 }} />,
  play: async () => {
    await waitFor(() => expect(group()).toBeInTheDocument());
    // 1440x810 IS 16:9, so it names the ratio it recognises and gives the size.
    expect(group()).toHaveTextContent("16:9 · 1440×810");
    // And NO badge claims it. This is why the numbers are printed beside the
    // label: a badge row alone would show a custom format as nothing selected,
    // which reads as the setting being broken.
    for (const id of ["hd", "fhd", "scope", "vertical"]) {
      expect(badge(id)).toHaveAttribute("data-state", "unchecked");
    }
  },
};

/** A size matching no known ratio falls back to the bare dimensions. */
export const AnUnknownRatioShowsOnlyTheSize: Story = {
  render: () => <Harness initial={{ width: 1000, height: 700, fps: 24 }} />,
  play: async () => {
    await waitFor(() => expect(group()).toBeInTheDocument());
    expect(group()).toHaveTextContent("1000×700");
  },
};

