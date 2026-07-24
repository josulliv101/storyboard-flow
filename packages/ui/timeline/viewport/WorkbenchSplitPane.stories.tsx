import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { WorkbenchSplitPane } from "./workbench-display-surface";

function StickyPreviewFixture() {
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <main className="min-h-[1600px] bg-zinc-950 p-4 text-zinc-100">
      <WorkbenchSplitPane
        clips={[]}
        currentTime={currentTime}
        onCurrentTimeChange={setCurrentTime}
      >
        <div className="grid gap-3">
          {Array.from({ length: 18 }, (_, index) => (
            <section
              key={index}
              className="grid min-h-24 place-items-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-400"
            >
              Timeline section {index + 1}
            </section>
          ))}
        </div>
      </WorkbenchSplitPane>
    </main>
  );
}

const meta = {
  title: "UI/Timeline/Viewport/WorkbenchSplitPane",
  component: WorkbenchSplitPane,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    clips: [],
    currentTime: 0,
    onCurrentTimeChange: () => undefined,
    children: null,
  },
} satisfies Meta<typeof WorkbenchSplitPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Scroll the page: the preview and its resize handle remain pinned while
 * the timeline sections continue through the document scrollport. */
export const StickyPreview: Story = {
  render: () => <StickyPreviewFixture />,
};

function ControlledPlaybackFixture() {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  return (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      <button
        type="button"
        data-testid="external-toggle"
        onClick={() => setPlaying((value) => !value)}
        className="mb-3 rounded border border-zinc-700 px-3 py-1 text-sm"
      >
        External play toggle
      </button>
      <WorkbenchSplitPane
        clips={[]}
        currentTime={currentTime}
        onCurrentTimeChange={setCurrentTime}
        playing={playing}
        onPlayingChange={setPlaying}
      >
        <div className="min-h-24" />
      </WorkbenchSplitPane>
    </main>
  );
}

/** Controlled playback: when `playing` is supplied, the surface's play/pause
 *  button REFLECTS that prop rather than owning the state — flipping it from
 *  outside swaps the button from Play to Pause. */
export const ControlledPlayback: Story = {
  render: () => <ControlledPlaybackFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Starts paused → the surface offers "Play".
    expect(canvas.getByRole("button", { name: "Play workbench preview" })).toBeInTheDocument();

    // Flip the controlled prop from OUTSIDE the surface; it re-renders as "Pause".
    await user.click(canvas.getByTestId("external-toggle"));
    expect(
      await canvas.findByRole("button", { name: "Pause workbench preview" }),
    ).toBeInTheDocument();
  },
};
