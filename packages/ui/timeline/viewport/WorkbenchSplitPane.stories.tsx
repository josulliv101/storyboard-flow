import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import type { TimelineClip } from "../types";

import {
  WorkbenchDisplaySurface,
  WorkbenchSplitPane,
} from "./workbench-display-surface";

function StickyPreviewFixture() {
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <main className="min-h-[1600px] bg-zinc-950 p-4 text-zinc-100">
      <WorkbenchSplitPane
        surface={
          <WorkbenchDisplaySurface
            clips={[]}
            currentTime={currentTime}
            onCurrentTimeChange={setCurrentTime}
            className="h-full rounded-b-none border-b-0"
          />
        }
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

/** A consumer toolbar in the `header` slot, above the preview. */
function StickyHeaderFixture() {
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <main className="min-h-[1600px] bg-zinc-950 p-4 text-zinc-100">
      <WorkbenchSplitPane
        header={
          <div
            data-testid="fixture-header"
            className="flex h-14 items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-3 text-sm"
          >
            Home / Scene A
          </div>
        }
        surface={
          <WorkbenchDisplaySurface
            clips={[]}
            currentTime={currentTime}
            onCurrentTimeChange={setCurrentTime}
            className="h-full rounded-b-none border-b-0"
          />
        }
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
    surface: null,
    children: null,
  },
} satisfies Meta<typeof WorkbenchSplitPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Scroll the page: the preview and its resize handle remain pinned while
 * the timeline sections continue through the document scrollport. */
export const StickyPreview: Story = {
  render: () => <StickyPreviewFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const splitPane = canvas.getByTestId("workbench-split-pane");
    const displaySurface = canvas.getByTestId("workbench-display-surface");
    const previewCanvas = canvas.getByTestId("workbench-display-canvas");
    const controls = canvas.getByTestId("workbench-preview-controls");
    const divider = canvas.getByRole("separator", {
      name: "Resize workbench display",
    });
    const lowerPane = canvas.getByTestId("workbench-lower-pane");

    // Timeline overlays can deliberately center a thumb on the content edge.
    // Keep that overhang visible below the preview, while narrow masks on the
    // sticky region prevent it from peeking around the preview itself.
    expect(getComputedStyle(splitPane).overflowX).toBe("visible");
    expect(
      canvasElement.querySelectorAll("[data-preview-edge-occluder]"),
    ).toHaveLength(2);
    expect(getComputedStyle(displaySurface).borderBottomWidth).toBe("0px");
    expect(getComputedStyle(controls).position).toBe("absolute");
    expect(controls.parentElement).toBe(displaySurface);
    const buttonGroup = controls.querySelector<HTMLElement>("[data-transport-button-group]");
    const dividerLine = divider.querySelector<HTMLElement>("[data-divider-line]");
    expect(buttonGroup).not.toBeNull();
    expect(dividerLine).not.toBeNull();
    const buttonGroupBox = buttonGroup!.getBoundingClientRect();
    const dividerBox = divider.getBoundingClientRect();
    const dividerLineBox = dividerLine!.getBoundingClientRect();
    expect(getComputedStyle(dividerLine!).backgroundImage).toContain("linear-gradient");
    expect(buttonGroupBox.width).toBe(132);
    expect(buttonGroupBox.height).toBe(44);
    expect(controls.querySelector("[data-transport-capsule]")).toBeNull();
    // The grip is the coarse-pointer affordance — always in the DOM, painted
    // only at tablet width and below (md:hidden), so presence is what this
    // story can assert without pinning the canvas width.
    expect(divider.querySelector("[data-divider-grip]")).not.toBeNull();
    // The box is the hit target and stays 44 at every breakpoint. The visible
    // band is smaller and CENTERED on one fixed mid-line, so its height can
    // change (8 desktop / 12 coarse-pointer) without moving anything.
    expect(dividerBox.height).toBe(44);
    expect(dividerLineBox.height).toBeLessThan(dividerBox.height);
    expect(dividerLineBox.y + dividerLineBox.height / 2).toBeCloseTo(dividerBox.y + 24, 0);
    // The band sits BELOW centre on purpose: more clearance above it than
    // below. The transport is centred on the same line and overhangs the band
    // far enough to crowd the preview above more than the timeline below, so
    // an even split still read bottom-heavy. Asserted as an inequality rather
    // than a number, so it survives a retune of the exact gap.
    const above = dividerLineBox.y - dividerBox.y;
    const below = dividerBox.y + dividerBox.height - (dividerLineBox.y + dividerLineBox.height);
    expect(above).toBeGreaterThan(below);
    // The transport centers on the BAND, not on the padded box.
    expect(dividerLineBox.y + dividerLineBox.height / 2).toBeCloseTo(
      buttonGroupBox.y + buttonGroupBox.height / 2,
      0,
    );
    expect(controls).toHaveAttribute("data-transport-layout", "static");
    expect(
      canvas.getByRole("button", { name: "Previous workbench clip" }),
    ).toBeVisible();
    expect(canvas.getByRole("button", { name: "Next workbench clip" })).toBeVisible();
    expect(canvas.getByTestId("workbench-preview-time")).toHaveTextContent("0s / 0s");
    expect(previewCanvas.getBoundingClientRect().bottom).toBeCloseTo(dividerBox.y, 0);
    expect(getComputedStyle(lowerPane).zIndex).toBe("0");
  },
};

function PersistentLowerPaneFixture() {
  const [open, setOpen] = useState(false);

  return (
    <main className="bg-zinc-950 p-4 text-zinc-100">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mb-3 rounded border border-zinc-700 px-3 py-1 text-sm"
      >
        Toggle surface
      </button>
      <WorkbenchSplitPane
        surface={
          open ? (
            <div className="grid h-full place-items-center bg-zinc-900">Preview surface</div>
          ) : null
        }
      >
        <div
          data-testid="persistent-lower-scroller"
          className="w-full overflow-x-auto"
        >
          <div className="h-24 w-[1600px] bg-zinc-800" />
        </div>
      </WorkbenchSplitPane>
    </main>
  );
}

/** Opening the optional surface must not replace the lower-pane DOM node or
 * reset state owned by it, including a virtual timeline's horizontal scroll. */
/**
 * The `header` slot pins ABOVE the preview, and the preview pins beneath it —
 * one sticky stack, in that order. The offset is MEASURED, so a consumer's
 * header of any height lands the surface in the right place.
 */
export const StickyHeaderAbovePreview: Story = {
  render: () => <StickyHeaderFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByTestId("workbench-header-region");
    const preview = canvas.getByTestId("workbench-preview-region");

    // DOM order is the stack order: header first, then the surface.
    expect(header.compareDocumentPosition(preview)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    // The header owns the top; the surface is offset by the header's measured
    // height rather than a constant.
    expect(getComputedStyle(header).top).toBe("0px");
    const headerHeight = header.getBoundingClientRect().height;
    expect(headerHeight).toBeGreaterThan(0);
    await waitFor(() =>
      expect(getComputedStyle(preview).top).toBe(`${headerHeight}px`),
    );

    // Stacked so a playhead marker (z-30) in the timeline scrolling beneath is
    // occluded by both, and the surface never paints over the header.
    expect(Number(getComputedStyle(header).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(preview).zIndex),
    );

    // Neither overlaps the other: the surface starts at or below the header's
    // bottom edge.
    const headerBox = header.getBoundingClientRect();
    const previewBox = preview.getBoundingClientRect();
    expect(previewBox.top).toBeGreaterThanOrEqual(headerBox.bottom - 1);
  },
};

/** Without a `header`, nothing extra is rendered and the surface keeps the top. */
export const NoHeaderKeepsPreviewAtTop: Story = {
  render: () => <StickyPreviewFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByTestId("workbench-header-region")).toBeNull();
    expect(
      getComputedStyle(canvas.getByTestId("workbench-preview-region")).top,
    ).toBe("0px");
  },
};

export const PersistentLowerPane: Story = {
  render: () => <PersistentLowerPaneFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const scroller = canvas.getByTestId("persistent-lower-scroller");

    scroller.scrollLeft = 480;
    const scrollBeforeToggle = scroller.scrollLeft;
    expect(scrollBeforeToggle).toBeGreaterThan(0);
    scroller.dataset.identityWitness = "same-node";
    await user.click(canvas.getByRole("button", { name: "Toggle surface" }));

    expect(canvas.getByTestId("workbench-preview-region")).toBeVisible();
    expect(scroller).toHaveAttribute("data-identity-witness", "same-node");
    expect(scroller.scrollLeft).toBe(scrollBeforeToggle);
  },
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
        surface={
          <WorkbenchDisplaySurface
            clips={[PLAYABLE_CLIP]}
            currentTime={currentTime}
            onCurrentTimeChange={setCurrentTime}
            playing={playing}
            onPlayingChange={setPlaying}
            className="h-full rounded-b-none border-b-0"
          />
        }
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
    const controls = canvas.getByTestId("workbench-preview-controls");
    const previewCanvas = canvas.getByTestId("workbench-display-canvas");
    const primaryControl = controls.querySelector<HTMLElement>(
      "[data-transport-primary-control]",
    );
    expect(primaryControl).not.toBeNull();

    // Starts paused → the surface offers "Play".
    expect(canvas.getByRole("button", { name: "Play workbench preview" })).toBeInTheDocument();
    expect(controls).toHaveAttribute("data-transport-layout", "static");
    expect(
      canvas.getByRole("button", { name: "Previous workbench clip" }),
    ).toBeVisible();
    expect(canvas.getByRole("button", { name: "Next workbench clip" })).toBeVisible();
    expect(previewCanvas).not.toHaveAttribute("tabindex");

    // RESTING: background-free, so the mark reads straight off the divider.
    expect(getComputedStyle(primaryControl!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const restingColor = getComputedStyle(primaryControl!).color;

    const previewBounds = previewCanvas.getBoundingClientRect();
    await user.pointer({
      target: previewCanvas,
      coords: {
        clientX: previewBounds.left + previewBounds.width / 2,
        clientY: previewBounds.top + previewBounds.height / 2,
      },
    });
    expect(getComputedStyle(previewCanvas).cursor).toBe("pointer");
    // ACTIVE: the control INVERTS — solid white disc, mark punched black out
    // of it — rather than just brightening the glyph.
    // POLLED, not read once: the control carries `transition-colors`, so an
    // immediate getComputedStyle returns a value part-way through the fade —
    // which read as "still transparent" and looked exactly like the class not
    // applying at all.
    await waitFor(() =>
      expect(getComputedStyle(primaryControl!).backgroundColor).toBe("rgb(255, 255, 255)"),
    );
    // The glyph color is not pinned to a literal: the token serializes as
    // oklch, and which color space a browser reports is not what this story is
    // about. What matters is that it left the resting zinc for the dark mark
    // the new white disc needs.
    expect(getComputedStyle(primaryControl!).color).not.toBe(restingColor);
    expect(controls).toHaveAttribute("data-transport-layout", "static");
    await user.unhover(previewCanvas);

    // Flip the controlled prop from OUTSIDE the surface; it re-renders as
    // "Pause" and STAYS there — the fixture clip is 30s, so nothing stops
    // playback out from under the assertion.
    await user.click(canvas.getByTestId("external-toggle"));
    expect(
      await canvas.findByRole("button", { name: "Pause workbench preview" }),
    ).toBeInTheDocument();
    expect(canvas.getByTestId("workbench-preview-time")).toHaveTextContent(
      /0(?:\.\d+)?s \/ 30\.0s/,
    );

    // Tab order follows the DOM: the audio controls overlay the picture, so
    // they come BEFORE the divider transport. Walk past them and the transport
    // is still reachable, which is what this ever asserted.
    await user.tab();
    expect(canvas.getByTestId("workbench-preview-mute")).toHaveFocus();
    await user.tab();
    expect(canvas.getByTestId("workbench-preview-volume")).toHaveFocus();
    await user.tab();
    expect(controls.contains(document.activeElement)).toBe(true);
    expect(controls).toHaveAttribute("data-transport-layout", "static");
  },
};

function ControlledAudioFixture() {
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  return (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      <p data-testid="audio-readout" className="mb-3 font-mono text-sm">
        {`volume=${volume} muted=${muted}`}
      </p>
      <WorkbenchSplitPane
        surface={
          <WorkbenchDisplaySurface
            clips={[PLAYABLE_CLIP]}
            currentTime={currentTime}
            onCurrentTimeChange={setCurrentTime}
            volume={volume}
            onVolumeChange={setVolume}
            muted={muted}
            onMutedChange={setMuted}
            className="h-full rounded-b-none border-b-0"
          />
        }
      >
        <div className="min-h-24" />
      </WorkbenchSplitPane>
    </main>
  );
}

/** Audio is controlled on the same contract as `playing`: supply `volume` and
 *  `muted` and the transport REFLECTS them, reporting intent back out. The
 *  surface also publishes both as `data-*`, because sound itself is not
 *  observable from a test. */
export const ControlledAudio: Story = {
  render: () => <ControlledAudioFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const surface = canvas.getByTestId("workbench-display-surface");

    // Audible by default — a preview that opens silent looks broken.
    expect(surface).toHaveAttribute("data-preview-muted", "false");
    expect(surface).toHaveAttribute("data-preview-volume", "1");
    expect(canvas.getByTestId("audio-readout")).toHaveTextContent("volume=1 muted=false");

    const mute = canvas.getByRole("button", { name: "Mute workbench preview" });
    expect(mute).toHaveAttribute("aria-pressed", "false");

    await user.click(mute);

    // The controlled prop round-trips through the fixture and comes back.
    expect(await canvas.findByRole("button", { name: "Unmute workbench preview" })).toBeInTheDocument();
    expect(surface).toHaveAttribute("data-preview-muted", "true");
    expect(canvas.getByTestId("audio-readout")).toHaveTextContent("muted=true");

    // A muted preview shows the slider at zero regardless of the held volume,
    // so the control never claims to be audible while it is not.
    const slider = canvas.getByRole("slider", { name: "Workbench preview volume" });
    expect(slider).toHaveValue("0");

    await user.click(canvas.getByRole("button", { name: "Unmute workbench preview" }));
    expect(surface).toHaveAttribute("data-preview-muted", "false");
    expect(slider).toHaveValue("1");
  },
};

function ClosablePreviewFixture() {
  const [currentTime, setCurrentTime] = useState(0);
  const [open, setOpen] = useState(true);

  return (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      {open ? (
        <WorkbenchSplitPane
          surface={
            <WorkbenchDisplaySurface
              clips={[]}
              currentTime={currentTime}
              onCurrentTimeChange={setCurrentTime}
              onClose={() => setOpen(false)}
              className="h-full rounded-b-none border-b-0"
            />
          }
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
