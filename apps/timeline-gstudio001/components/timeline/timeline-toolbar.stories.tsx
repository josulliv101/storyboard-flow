import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import type { ItemSize } from "./constants";
import { TimelineToolbar } from "./timeline-toolbar";

function InteractiveToolbar({
  initialItemSize = "md",
  initialPinScroll = true,
  initialThumbnailMode = false,
  initialZoom = 100,
  renderedCount = 12,
  totalCount = 1000,
}: {
  initialItemSize?: ItemSize;
  initialPinScroll?: boolean;
  initialThumbnailMode?: boolean;
  initialZoom?: number;
  renderedCount?: number;
  totalCount?: number;
}) {
  const [itemSize, setItemSize] = useState<ItemSize>(initialItemSize);
  const [manualOverhangScroll, setManualOverhangScroll] =
    useState(initialPinScroll);
  const [thumbnailMode, setThumbnailMode] = useState(initialThumbnailMode);
  const [zoomLevel, setZoomLevel] = useState(initialZoom);

  return (
    <TimelineToolbar
      itemSize={itemSize}
      manualOverhangScroll={manualOverhangScroll}
      onItemSizeChange={setItemSize}
      onManualOverhangScrollChange={setManualOverhangScroll}
      onThumbnailModeChange={setThumbnailMode}
      onZoomChange={(event) => setZoomLevel(Number(event.target.value))}
      renderedCount={renderedCount}
      thumbnailMode={thumbnailMode}
      totalCount={totalCount}
      zoomLevel={zoomLevel}
    />
  );
}

const meta = {
  title: "GStudio/Timeline/TimelineToolbar",
  component: TimelineToolbar,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="min-w-[900px] rounded-xl bg-zinc-900 p-4 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    itemSize: "md",
    manualOverhangScroll: true,
    onItemSizeChange: () => {},
    onManualOverhangScrollChange: () => {},
    onThumbnailModeChange: () => {},
    onZoomChange: () => {},
    renderedCount: 12,
    thumbnailMode: false,
    totalCount: 1000,
    zoomLevel: 100,
  },
} satisfies Meta<typeof TimelineToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <InteractiveToolbar />,
};

export const ThumbnailModeAndPinOff: Story = {
  render: () => (
    <InteractiveToolbar
      initialItemSize="lg"
      initialPinScroll={false}
      initialThumbnailMode
      initialZoom={180}
      renderedCount={8}
      totalCount={12}
    />
  ),
};

export const InteractiveControls: Story = {
  render: () => <InteractiveToolbar />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const thumbnailSwitch = canvas.getByRole("switch", {
      name: "Thumbnail Mode",
    });
    const pinSwitch = canvas.getByRole("switch", { name: "Pin scroll" });

    await userEvent.click(thumbnailSwitch);
    await userEvent.click(pinSwitch);
    await userEvent.selectOptions(canvas.getByLabelText("Size"), "xl");

    await expect(thumbnailSwitch).toHaveAttribute("aria-checked", "true");
    await expect(pinSwitch).toHaveAttribute("aria-checked", "false");
    await expect(canvas.getByLabelText("Size")).toHaveValue("xl");
    await expect(canvas.getByTestId("timeline-rendered-count")).toHaveTextContent(
      "12/1000 rendered",
    );
  },
};
