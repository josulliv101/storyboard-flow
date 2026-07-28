import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

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
    // 4px of padding above a 12px band: the box is 16 and the band is
    // BOTTOM-aligned in it, so the gap lands under the preview surface.
    expect(dividerBox.height).toBe(16);
    expect(dividerLineBox.height).toBe(12);
    expect(dividerLineBox.bottom).toBeCloseTo(dividerBox.bottom, 0);
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

    const previewBounds = previewCanvas.getBoundingClientRect();
    await user.pointer({
      target: previewCanvas,
      coords: {
        clientX: previewBounds.left + previewBounds.width / 2,
        clientY: previewBounds.top + previewBounds.height / 2,
      },
    });
    expect(getComputedStyle(previewCanvas).cursor).toBe("pointer");
    expect(primaryControl).toHaveClass("text-white");
    expect(getComputedStyle(primaryControl!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
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

    await user.tab();
    expect(controls.contains(document.activeElement)).toBe(true);
    expect(controls).toHaveAttribute("data-transport-layout", "static");
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
