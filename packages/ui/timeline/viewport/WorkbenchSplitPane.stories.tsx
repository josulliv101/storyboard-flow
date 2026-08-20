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
    // 5 × the 44px button well: jump-to-start, previous, play, next,
    // jump-to-end. It was 132 (three wells) before the two edge buttons were
    // added, and the number is pinned rather than derived because the time
    // readout budgets its own max-width against half of it — the two have to
    // be changed together, and a hard number is what makes that fail loudly.
    expect(buttonGroupBox.width).toBe(220);
    expect(buttonGroupBox.height).toBe(44);
    // THE BAND'S CLEAR WINDOW IS HALF THAT WIDTH, either side of centre.
    //
    // The gradient breaks the divider so no line runs behind the transport's
    // background-free glyphs. Its stops are hand-written and cannot read the
    // sibling's width, so adding the two outer buttons widened the group to
    // five wells and left the window at three — the jump-to-start and
    // jump-to-end glyphs sat in the fade with the line still showing through.
    // The assertion above was updated to 220 at the time; this one did not
    // exist, so nothing caught it.
    //
    // Read off the COMPUTED gradient, which resolves the rem stops to pixels,
    // so the check is against the group's real width rather than against the
    // literal that produced it.
    const bandGradient = getComputedStyle(dividerLine!).backgroundImage;
    const clearHalf = buttonGroupBox.width / 2;
    expect(bandGradient).toContain(`${clearHalf}px`);
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

    // THE EDGE PAIR, outside the clip steppers. Order is asserted by x rather
    // than by DOM position: what matters is that reading outward from play you
    // get "one clip" then "all the way", and a DOM-order check would pass on a
    // layout that visually interleaved them.
    const jumpStart = canvas.getByRole("button", {
      name: "Jump to start of workbench preview",
    });
    const jumpEnd = canvas.getByRole("button", { name: "Jump to end of workbench preview" });
    const x = (el: HTMLElement) => el.getBoundingClientRect().x;
    expect(x(jumpStart)).toBeLessThan(x(canvas.getByRole("button", { name: "Previous workbench clip" })));
    expect(x(jumpEnd)).toBeGreaterThan(x(canvas.getByRole("button", { name: "Next workbench clip" })));
    // Both live inside the button group, so the divider-drag guard on it (a
    // transport press must never begin a resize) covers them too.
    expect(buttonGroup!.contains(jumpStart)).toBe(true);
    expect(buttonGroup!.contains(jumpEnd)).toBe(true);

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

// ── LANES ───────────────────────────────────────────────────────────────────
//
// A timeline shaped like a real one: two shots with the packing gap between
// them, and a bed running underneath across the cut.
//
// CLIP_GAP_SECONDS is 0.12, so shot B starts at 4.12 and the window 4.00-4.12
// is covered by nothing but the bed. That window is the interesting one twice
// over: the bed has to be audible in it, and the surface has to keep showing
// shot A rather than the bed's stand-in.

function laneClip(
  id: string,
  startTime: number,
  duration: number,
  trackIndex: number,
  extra: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: PIXEL,
    alt: id,
    title: id,
    aspect: 16 / 9,
    trackIndex,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
    ...extra,
  } as TimelineClip;
}

const SHOT_A = laneClip("shot-a", 0, 4, 0);
const SHOT_B = laneClip("shot-b", 4.12, 4, 0);
const BED = laneClip("bed", 0, 6, 1);

function LayeredFixture({ time, clips }: { time: number; clips: TimelineClip[] }) {
  const [currentTime, setCurrentTime] = useState(time);

  return (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      <WorkbenchDisplaySurface
        clips={clips}
        currentTime={currentTime}
        onCurrentTimeChange={setCurrentTime}
        className="h-[320px]"
      />
    </main>
  );
}

/** A bed under the picture is LIVE alongside it, not instead of it. The export
 *  has always mixed layered audio; until this, the preview silenced it. */
export const LayeredAudioPlaysUnderThePicture: Story = {
  render: () => <LayeredFixture time={2} clips={[SHOT_A, SHOT_B, BED]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const surface = canvas.getByTestId("workbench-display-surface");

    // Two clips cover t=2: the shot and the bed. The shot supplies the frame…
    expect(canvas.getByLabelText("shot-a preview")).toBeInTheDocument();
    // …and the bed is playing underneath it rather than being paused to zero.
    expect(surface).toHaveAttribute("data-live-layer-count", "1");
  },
};

/** THE GAP AT EVERY CUT. Packing leaves 0.12s between shots; a bed covers it.
 *  The surface must hold the outgoing shot — resolving "what covers this time"
 *  would answer "the bed" and flash its stand-in three frames per cut. */
export const APictureGapHoldsTheOutgoingShot: Story = {
  render: () => <LayeredFixture time={4.06} clips={[SHOT_A, SHOT_B, BED]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const surface = canvas.getByTestId("workbench-display-surface");

    expect(canvas.getByLabelText("shot-a preview")).toBeInTheDocument();
    // Still sounding through the cut — the gap is a picture gap, not a hole in
    // the timeline.
    expect(surface).toHaveAttribute("data-live-layer-count", "1");
  },
};

/** A layer that has ENDED is not held the way a frame is. The screen cannot
 *  show nothing, so the picture holds; sound can stop, so it stops. */
export const AFinishedLayerGoesSilent: Story = {
  render: () => <LayeredFixture time={7} clips={[SHOT_A, SHOT_B, BED]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const surface = canvas.getByTestId("workbench-display-surface");

    expect(canvas.getByLabelText("shot-b preview")).toBeInTheDocument();
    expect(surface).toHaveAttribute("data-live-layer-count", "0");
  },
};

/** A disabled layer is silent, while a disabled PICTURE is still drawn (grayed)
 *  because scrubbing can rest inside it. */
export const ADisabledLayerIsNotLive: Story = {
  render: () => (
    <LayeredFixture
      time={2}
      clips={[SHOT_A, SHOT_B, laneClip("bed", 0, 6, 1, { disabled: true })]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("workbench-display-surface")).toHaveAttribute(
      "data-live-layer-count",
      "0",
    );
  },
};

/** Nothing lane-shaped changes for a timeline that uses no lanes. */
export const WithoutLanesNothingIsLive: Story = {
  render: () => <LayeredFixture time={2} clips={[SHOT_A, SHOT_B]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("workbench-display-surface")).toHaveAttribute(
      "data-live-layer-count",
      "0",
    );
    expect(canvas.getByLabelText("shot-a preview")).toBeInTheDocument();
  },
};

// ── PICTURE IN PICTURE ──────────────────────────────────────────────────────
//
// Solid colours, because this is the only assertion in the suite that can read
// the CANVAS rather than a data attribute: a red picture with a blue inset in
// the bottom-right, sampled back with getImageData. Data URIs never taint the
// canvas, so the pixels are readable.

const RED =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mO4IycHAALyARlNudhnAAAAAElFTkSuQmCC";
const BLUE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mOQs7kDAAGyATfBjyy7AAAAAElFTkSuQmCC";

/** The inset the default preset produces, near enough for a fixture: bottom
 *  right, 30% of the frame's width. */
const PIP_FRAME = { x: 0.66, y: 0.6, width: 0.3 };

const PICTURE = laneClip("picture", 0, 10, 0, { src: RED, poster: RED });
const PIP = laneClip("pip", 0, 10, 1, { src: BLUE, poster: BLUE, layerFrame: PIP_FRAME });

/**
 * Sample one pixel as `r,g,b`, in fractions of the PICTURE BOX — not of the
 * canvas.
 *
 * The two are not the same and sampling the canvas gets you the letterbox: the
 * pane fits the source inside the canvas and pads the rest with #050505, and
 * the fixture's source is a 1x1 PNG, so the picture is a centred SQUARE with
 * black bars either side. Compositing is positioned against that box for the
 * same reason — the bars are not part of the frame.
 */
async function pixelAt(canvasElement: HTMLElement, fx: number, fy: number) {
  const canvas = canvasElement.querySelector("canvas")!;
  const context = canvas.getContext("2d")!;
  const side = Math.min(canvas.width, canvas.height);
  const left = (canvas.width - side) / 2;
  const top = (canvas.height - side) / 2;
  const x = Math.floor(left + side * fx);
  const y = Math.floor(top + side * fy);
  const [r, g, b] = context.getImageData(x, y, 1, 1).data;
  return `${r},${g},${b}`;
}

const isRed = (pixel: string) => Number(pixel.split(",")[0]) > 150;
const isBlue = (pixel: string) => Number(pixel.split(",")[2]) > 150;

/** A video on a lane DRAWS, in the corner it was given — over the picture,
 *  even though its sound is mixed under it. */
export const ALayerWithAFrameIsComposited: Story = {
  render: () => <LayeredFixture time={4} clips={[PICTURE, PIP]} />,
  play: async ({ canvasElement }) => {
    // The pane paints from async image `load` listeners, so wait for the
    // picture to land before sampling anything.
    await waitFor(async () => expect(isRed(await pixelAt(canvasElement, 0.5, 0.5))).toBe(true));

    // The inset spans x 0.66-0.96 and, at 16:9 inside a square picture box,
    // y 0.6-0.77. So its middle is BLUE…
    await waitFor(async () => expect(isBlue(await pixelAt(canvasElement, 0.8, 0.68))).toBe(true));
    // …while the same height on the far side is still the picture. A wash over
    // the whole frame would pass the assertion above and fail this one.
    expect(isRed(await pixelAt(canvasElement, 0.2, 0.68))).toBe(true);
    // And so is directly ABOVE it, which pins the top edge.
    expect(isRed(await pixelAt(canvasElement, 0.8, 0.4))).toBe(true);
  },
};

/** WITHOUT a frame the same clip is sound only — which is what every layered
 *  clip did before compositing, and what keeps stored timelines unchanged. */
export const ALayerWithoutAFrameStaysInvisible: Story = {
  render: () => (
    <LayeredFixture
      time={4}
      clips={[PICTURE, laneClip("bed", 0, 10, 1, { src: BLUE, poster: BLUE })]}
    />
  ),
  play: async ({ canvasElement }) => {
    const surface = within(canvasElement).getByTestId("workbench-display-surface");
    await waitFor(async () => expect(isRed(await pixelAt(canvasElement, 0.5, 0.5))).toBe(true));
    // Live — it is playing…
    expect(surface).toHaveAttribute("data-live-layer-count", "1");
    // …and nowhere on screen: where the framed version drew, this one leaves
    // the picture.
    expect(isRed(await pixelAt(canvasElement, 0.8, 0.68))).toBe(true);
  },
};

/**
 * THE SAME INSET, composed against the RENDER's frame rather than the picture.
 *
 * The stored rectangle is normalized to the output frame, and that is a
 * different box from the picture whenever the source's shape differs from the
 * render's — the export fits the source in and pads the rest. Composing
 * against the picture put the default inset at 22px and 68px of margin where
 * the render gives 40px and 40px; against the output frame the preview agrees
 * with the file.
 *
 * The fixture's source is 1x1, so its picture box is SQUARE and a 2.4:1 output
 * frame extends well past it either side — which is exactly the padding the
 * render would add, and an inset near the edge sits over it on purpose.
 */
export const TheInsetLandsWhereTheRenderPutsIt: Story = {
  render: () => (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      <WorkbenchDisplaySurface
        clips={[PICTURE, PIP]}
        currentTime={4}
        onCurrentTimeChange={() => {}}
        outputAspect={1152 / 480}
        className="h-[320px]"
      />
    </main>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(async () => expect(isRed(await pixelAt(canvasElement, 0.5, 0.5))).toBe(true));

    // The inset is no longer inside the picture SQUARE — the output frame is
    // wider than it, so the bottom-right corner of the frame is out over the
    // padding. What must hold is that it is still drawn, and still to the
    // lower right of the picture's centre.
    const canvas = canvasElement.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    const found: Array<[number, number]> = [];
    for (let x = 0; x < canvas.width; x += 8) {
      for (let y = 0; y < canvas.height; y += 8) {
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        if (b! > 150 && r! < 120) found.push([x, y]);
      }
    }
    expect(found.length).toBeGreaterThan(0);
    const minX = Math.min(...found.map(([x]) => x));
    const minY = Math.min(...found.map(([, y]) => y));
    expect(minX).toBeGreaterThan(canvas.width / 2);
    expect(minY).toBeGreaterThan(canvas.height / 2);
  },
};

/**
 * THE REAL CASE: a 16:9 picture in a 2.4:1 render.
 *
 * The fixture above uses a 1x1 source, so its picture box is square and the
 * output frame extends absurdly past it. Every real source here is 16:9, and
 * this is what that actually looks like — the shape to judge the default inset
 * by, and the one that decides whether it sits on the picture or off it.
 */
const RED_169 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR42mO4IydHEmIY1TAoNAAAHVGdgV3m+aoAAAAASUVORK5CYII=";

export const ARealisticSixteenNineSource: Story = {
  render: () => (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      <WorkbenchDisplaySurface
        clips={[
          laneClip("picture", 0, 10, 0, { src: RED_169, poster: RED_169 }),
          laneClip("pip", 0, 10, 1, { src: BLUE, poster: BLUE, layerFrame: PIP_FRAME }),
        ]}
        currentTime={4}
        onCurrentTimeChange={() => {}}
        outputAspect={1152 / 480}
        className="h-[320px]"
      />
    </main>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(async () => expect(isRed(await pixelAt(canvasElement, 0.5, 0.5))).toBe(true));
    expect(isBlue(await pixelAt(canvasElement, 0.5, 0.5))).toBe(false);
  },
};

const GREEN =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mOQ22cDAAIWARkpb7gwAAAAAElFTkSuQmCC";

/**
 * TWO LAYERS, OVERLAPPING: the LOWEST lane ends up on top.
 *
 * The same rule as everywhere else here — `getContainingClip` prefers the
 * lowest lane, the ffmpeg overlay chain draws the highest lane first — so the
 * canvas has to agree or the preview and the render disagree about which of
 * two insets is in front.
 */
export const TheLowestLaneDrawsOnTop: Story = {
  render: () => (
    <LayeredFixture
      time={4}
      clips={[
        PICTURE,
        // Same rectangle on both, so whichever is drawn LAST wins the pixels.
        laneClip("under", 0, 10, 2, { src: GREEN, poster: GREEN, layerFrame: PIP_FRAME }),
        laneClip("over", 0, 10, 1, { src: BLUE, poster: BLUE, layerFrame: PIP_FRAME }),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(async () => expect(isRed(await pixelAt(canvasElement, 0.5, 0.5))).toBe(true));
    // Lane 1 over lane 2: blue, not green.
    await waitFor(async () => expect(isBlue(await pixelAt(canvasElement, 0.8, 0.68))).toBe(true));
    const pixel = await pixelAt(canvasElement, 0.8, 0.68);
    expect(Number(pixel.split(",")[1])).toBeLessThan(150);
  },
};

/**
 * A DISABLED PICTURE is drawn grayed — and the inset over it is NOT.
 *
 * `drawDrawable` sets `context.filter` for the disabled treatment, and the
 * composite runs in the same function. Resetting the filter BEFORE compositing
 * rather than only after is what keeps a perfectly ordinary layer from being
 * grayed for the picture's sake; nothing but a pixel can prove it.
 */
export const ADisabledPictureDoesNotGrayItsInset: Story = {
  render: () => (
    <LayeredFixture
      time={4}
      clips={[
        laneClip("picture", 0, 10, 0, { src: RED, poster: RED, disabled: true }),
        PIP,
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    // The picture is grayed, so its red is washed out — no longer "red" by the
    // saturation test the other stories use.
    await waitFor(async () =>
      expect(await pixelAt(canvasElement, 0.5, 0.5)).not.toBe("5,5,5"),
    );
    expect(isRed(await pixelAt(canvasElement, 0.5, 0.5))).toBe(false);
    // The inset keeps its own colour at full strength.
    await waitFor(async () => expect(isBlue(await pixelAt(canvasElement, 0.8, 0.68))).toBe(true));
  },
};

// ── THE REVEAL ──────────────────────────────────────────────────────────────

function TogglingPreviewFixture() {
  const [currentTime, setCurrentTime] = useState(0);
  const [open, setOpen] = useState(false);

  return (
    <main className="min-h-[900px] bg-zinc-950 p-4 text-zinc-100">
      <button type="button" data-testid="toggle-preview" onClick={() => setOpen((was) => !was)}>
        {open ? "Hide preview" : "Show preview"}
      </button>
      {/* The pane itself stays mounted either way — only the SURFACE comes and
          goes, which is how the real board drives it (the lower pane keeps its
          DOM identity, and with it the strip's scroll position). */}
      <WorkbenchSplitPane
        surface={
          open ? (
            <WorkbenchDisplaySurface
              clips={[]}
              currentTime={currentTime}
              onCurrentTimeChange={setCurrentTime}
              className="h-full rounded-b-none border-b-0"
            />
          ) : null
        }
      >
        <div className="min-h-24" data-testid="lower-pane" />
      </WorkbenchSplitPane>
    </main>
  );
}

/**
 * THE PREVEW IS UNCOVERED, NOT INSERTED — and covered again on the way out.
 *
 * Opening used to be a mount at full size: the pane appeared and the board
 * jumped down by a few hundred pixels in one frame. What is pinned here is the
 * two facts that make it a reveal instead.
 *
 * ON THE WAY IN it must exist at zero height BEFORE it has any, because a
 * height animates only from a style the browser has already seen — an element
 * mounted at its final size never had one and would simply appear, which is
 * the behaviour being replaced.
 *
 * ON THE WAY OUT it must outlive the consumer's `surface`, which goes null the
 * instant the toggle flips. Without that the close animates an empty box shut
 * — a blank gap collapsing rather than the board sliding back over a picture —
 * and it is invisible in a screenshot, because the end state is identical
 * either way.
 */
export const ThePreviewIsUncoveredRatherThanInserted: Story = {
  render: () => <TogglingPreviewFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const region = () => canvasElement.querySelector<HTMLElement>('[data-testid="workbench-preview-region"]');

    expect(region()).toBeNull();

    await user.click(canvas.getByTestId("toggle-preview"));
    // Present, and not yet revealed: this is the frame that gives the
    // transition something to start from.
    const opening = region();
    expect(opening).not.toBeNull();
    expect(opening).not.toHaveAttribute("data-preview-revealed");

    // Generous, because the slide deliberately waits for the surface to settle
    // before it starts — and under a full suite there is nothing settled about
    // the machine.
    await waitFor(() => expect(region()).toHaveAttribute("data-preview-revealed"), {
      timeout: 3000,
    });
    expect(region()!.querySelector('[data-testid="workbench-display-surface"]')).not.toBeNull();

    await user.click(canvas.getByTestId("toggle-preview"));
    // Still here, still showing the picture the board is sliding back over.
    const closing = region();
    expect(closing).not.toBeNull();
    expect(closing).not.toHaveAttribute("data-preview-revealed");
    expect(closing!.querySelector('[data-testid="workbench-display-surface"]')).not.toBeNull();

    // And gone once the slide is done — never left mounted at zero height,
    // invisible and still holding a video element.
    await waitFor(() => expect(region()).toBeNull(), { timeout: 2000 });
  },
};

/**
 * THE CHROME ARRIVES AFTER THE PICTURE, and only on the way in.
 *
 * The divider and the transport are controls for something that is not there
 * yet while the pane is opening — a play button on a two-inch sliver of video
 * — so they wait for it. Coming back out they stay visible and ride the close
 * down, which reads as the board covering them rather than as two separate
 * departures, and a second open fades them in again.
 */
export const TheChromeFadesInOnceThePreviewIsOpen: Story = {
  render: () => <TogglingPreviewFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const region = () => canvasElement.querySelector<HTMLElement>('[data-testid="workbench-preview-region"]');

    await user.click(canvas.getByTestId("toggle-preview"));
    // Opening: hidden, so nothing is drawn over a half-open pane.
    expect(region()).toHaveAttribute("data-preview-chrome", "out");
    await waitFor(() => expect(region()).toHaveAttribute("data-preview-chrome", "in"), {
      timeout: 2000,
    });

    // Closing: still visible. It is going away with the pane, not before it.
    await user.click(canvas.getByTestId("toggle-preview"));
    expect(region()).toHaveAttribute("data-preview-chrome", "in");
    await waitFor(() => expect(region()).toBeNull(), { timeout: 2000 });

    // And hidden again on the next open, rather than only ever fading once.
    await user.click(canvas.getByTestId("toggle-preview"));
    expect(region()).toHaveAttribute("data-preview-chrome", "out");
    await waitFor(() => expect(region()).toHaveAttribute("data-preview-chrome", "in"), {
      timeout: 2000,
    });
  },
};
