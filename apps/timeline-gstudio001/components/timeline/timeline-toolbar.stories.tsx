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
}: {
  initialItemSize?: ItemSize;
  initialPinScroll?: boolean;
  initialThumbnailMode?: boolean;
  initialZoom?: number;
}) {
  const [itemSize, setItemSize] = useState<ItemSize>(initialItemSize);
  const [manualOverhangScroll, setManualOverhangScroll] =
    useState(initialPinScroll);
  const [showPlayBarArea, setShowPlayBarArea] = useState(true);
  const [showPassiveFilmstrips, setShowPassiveFilmstrips] = useState(false);
  const [thumbnailMode, setThumbnailMode] = useState(initialThumbnailMode);
  const [gridMode, setGridMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(initialZoom);

  return (
    <TimelineToolbar
      gridMode={gridMode}
      itemSize={itemSize}
      manualOverhangScroll={manualOverhangScroll}
      showPlayBarArea={showPlayBarArea}
      showPassiveFilmstrips={showPassiveFilmstrips}
      onGridModeChange={setGridMode}
      onItemSizeChange={setItemSize}
      onManualOverhangScrollChange={setManualOverhangScroll}
      onPlayBarAreaChange={setShowPlayBarArea}
      onPassiveFilmstripsChange={setShowPassiveFilmstrips}
      onThumbnailModeChange={setThumbnailMode}
      onZoomChange={(event) => setZoomLevel(Number(event.target.value))}
      thumbnailMode={thumbnailMode}
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
    gridMode: false,
    itemSize: "md",
    manualOverhangScroll: true,
    showPlayBarArea: true,
    showPassiveFilmstrips: false,
    onGridModeChange: () => {},
    onItemSizeChange: () => {},
    onManualOverhangScrollChange: () => {},
    onPlayBarAreaChange: () => {},
    onPassiveFilmstripsChange: () => {},
    onThumbnailModeChange: () => {},
    onZoomChange: () => {},
    thumbnailMode: false,
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
    const playBarSwitch = canvas.getByRole("switch", { name: "Play bar" });

    await userEvent.click(thumbnailSwitch);
    await userEvent.click(pinSwitch);
    await userEvent.click(playBarSwitch);
    await userEvent.click(playBarSwitch);
    const filmstripSwitch = canvas.getByRole("switch", { name: "Filmstrips" });
    await userEvent.click(filmstripSwitch);
    await userEvent.selectOptions(canvas.getByLabelText("Size"), "xl");

    await expect(thumbnailSwitch).toHaveAttribute("aria-checked", "true");
    await expect(pinSwitch).toHaveAttribute("aria-checked", "false");
    await expect(playBarSwitch).toHaveAttribute("aria-checked", "true");
    await expect(filmstripSwitch).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByLabelText("Size")).toHaveValue("xl");
  },
};
