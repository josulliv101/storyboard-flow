import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import {
  DndCollections,
  buildGraph,
  useCollectionsSelector,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { LayerFramePicker } from "./graph-layer-frame-picker";

// The first FORM control for a placement field — lane and placed start are
// drag-only. Deterministic and offline: an in-memory graph, no network, no
// details store beyond the aspect passed in.

const NODE_ID = "pip" as NodeId;

function graphWith(layerFrame?: { x: number; y: number; width: number }): CollectionsGraph {
  const result = buildGraph([
    {
      kind: "collection",
      id: "root",
      name: "Root",
      children: [
        {
          kind: "media",
          id: NODE_ID,
          name: "pip",
          trackIndex: 1,
          ...(layerFrame === undefined ? {} : { layerFrame }),
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Re-reads the node from the store so the picker sees its own commits, and
 *  publishes the stored rectangle for assertions — pixels are not observable
 *  here, but what was written is. */
function Harness() {
  const node = useCollectionsSelector((snapshot) => snapshot.graph.nodesById.get(NODE_ID));
  if (!node) return null;
  return (
    <div className="w-[420px] bg-zinc-950 p-4 text-zinc-100">
      <LayerFramePicker node={node} aspect={16 / 9} disabled={false} />
      <output data-frame={node.layerFrame === undefined ? "none" : JSON.stringify(node.layerFrame)}>
        {node.layerFrame === undefined ? "none" : JSON.stringify(node.layerFrame)}
      </output>
    </div>
  );
}

const meta: Meta<typeof LayerFramePicker> = {
  title: "graph-view/LayerFramePicker",
  component: LayerFramePicker,
};
export default meta;
type Story = StoryObj<typeof LayerFramePicker>;

const frameOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector("[data-frame]")!.getAttribute("data-frame");

/** The default the write path stamps reads back as a preset, so the picker
 *  opens with a button already lit rather than looking untouched. */
export const ShowsTheCurrentPreset: Story = {
  render: () => (
    <DndCollections initialGraph={graphWith({ x: 0.665, y: 0.511, width: 0.3 })}>
      <Harness />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: "Bottom right" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(canvas.getByRole("button", { name: "medium inset" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
};

/** Picking a corner writes the rectangle, and the button follows. */
export const PickingACornerMovesTheInset: Story = {
  render: () => (
    <DndCollections initialGraph={graphWith({ x: 0.665, y: 0.511, width: 0.3 })}>
      <Harness />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const before = frameOf(canvasElement);

    await user.click(canvas.getByRole("button", { name: "Top left" }));

    expect(canvas.getByRole("button", { name: "Top left" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // It really wrote a different rectangle, not just a different highlight.
    expect(frameOf(canvasElement)).not.toBe(before);
    // Top-left, so both coordinates are small — the margin, not the far edge.
    const frame = JSON.parse(frameOf(canvasElement)!);
    expect(frame.x).toBeLessThan(0.2);
    expect(frame.y).toBeLessThan(0.3);
  },
};

/** Size keeps the position. Changing one axis of a preset must not silently
 *  reset the other. */
export const ChangingSizeKeepsThePosition: Story = {
  render: () => (
    <DndCollections initialGraph={graphWith({ x: 0.665, y: 0.511, width: 0.3 })}>
      <Harness />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await user.click(canvas.getByRole("button", { name: "Top left" }));
    await user.click(canvas.getByRole("button", { name: "large inset" }));

    expect(canvas.getByRole("button", { name: "Top left" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(JSON.parse(frameOf(canvasElement)!).width).toBeGreaterThan(0.3);
  },
};

/** "Sound only" is a real choice, not a reset — it puts the clip back to
 *  contributing audio and no picture, which is what a bed wants. */
export const SoundOnlyClearsTheInset: Story = {
  render: () => (
    <DndCollections initialGraph={graphWith({ x: 0.665, y: 0.511, width: 0.3 })}>
      <Harness />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await user.click(canvas.getByRole("button", { name: "sound only" }));

    expect(frameOf(canvasElement)).toBe("none");
    // Nothing is lit, because nothing is set — and the control disables
    // itself rather than offering to clear what is already clear.
    expect(canvas.getByRole("button", { name: "Bottom right" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(canvas.getByRole("button", { name: "sound only" })).toBeDisabled();
  },
};

/** A rectangle no preset produces is named CUSTOM rather than rounded to the
 *  nearest button — which is what a hand-written frame looks like, and what
 *  dragging an inset will produce. */
export const ACustomRectangleSaysSo: Story = {
  render: () => (
    <DndCollections initialGraph={graphWith({ x: 0.123, y: 0.456, width: 0.321 })}>
      <Harness />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("custom")).toBeInTheDocument();
    for (const name of ["Bottom right", "Top left", "Centre"]) {
      expect(canvas.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  },
};

/** A layer with no inset yet: sound only, and every button ready. */
export const NoInsetYet: Story = {
  render: () => (
    <DndCollections initialGraph={graphWith()}>
      <Harness />
    </DndCollections>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("no inset")).toBeInTheDocument();
    expect(frameOf(canvasElement)).toBe("none");
  },
};
