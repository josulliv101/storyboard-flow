import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import type { TimelineClip } from "../types";

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

// A playable clip is REQUIRED for the controlled-playback story, and the
// duration is the whole point: with `clips={[]}` the surface's duration is 0,
// so the end-of-timeline auto-stop fires on the first animation frame and
// pushes `playing` straight back to false. "Pause" then exists for about one
// frame — an assertion that passes on an idle machine and loses the race
// under parallel load. Deterministic data URI, never a network fetch.
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const PLAYABLE_CLIP: TimelineClip = {
  id: "clip-controlled-playback",
  index: 0,
  kind: "image",
  src: PIXEL,
  alt: "Controlled playback fixture",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 30,
  sourceDuration: 30,
  trimIn: 0,
  trimOut: 0,
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
        clips={[PLAYABLE_CLIP]}
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

    // Flip the controlled prop from OUTSIDE the surface; it re-renders as
    // "Pause" and STAYS there — the fixture clip is 30s, so nothing stops
    // playback out from under the assertion.
    await user.click(canvas.getByTestId("external-toggle"));
    expect(
      await canvas.findByRole("button", { name: "Pause workbench preview" }),
    ).toBeInTheDocument();
  },
};

function ClosablePreviewFixture() {
  const [currentTime, setCurrentTime] = useState(0);
  const [open, setOpen] = useState(true);

  return (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      {open ? (
        <WorkbenchSplitPane
          clips={[]}
          currentTime={currentTime}
          onCurrentTimeChange={setCurrentTime}
          onClose={() => setOpen(false)}
        >
          <div className="min-h-24" />
        </WorkbenchSplitPane>
      ) : (
        <p data-testid="preview-closed">Preview closed</p>
      )}
    </main>
  );
}

/** `onClose` adds the corner close button — a second way out of the preview
 *  beside whatever toggle the consumer owns. Without the prop no button is
 *  drawn (see the other stories: none of them have one). */
export const ClosablePreview: Story = {
  render: () => <ClosablePreviewFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await user.click(canvas.getByRole("button", { name: "Close preview" }));
    expect(await canvas.findByTestId("preview-closed")).toBeInTheDocument();
  },
};
