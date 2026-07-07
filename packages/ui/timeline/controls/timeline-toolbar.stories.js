import { jsx as _jsx } from "react/jsx-runtime";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { TimelineToolbar } from "./timeline-toolbar";
function InteractiveToolbar({ initialItemSize = "md", initialThumbnailMode = false, initialZoom = 100, }) {
    const [itemSize, setItemSize] = useState(initialItemSize);
    const [showPlayBarArea, setShowPlayBarArea] = useState(true);
    const [showPassiveFilmstrips, setShowPassiveFilmstrips] = useState(false);
    const [gridMode, setGridMode] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(initialZoom);
    return (_jsx(TimelineToolbar, { gridMode: gridMode, itemSize: itemSize, showPlayBarArea: showPlayBarArea, showPassiveFilmstrips: showPassiveFilmstrips, onGridModeChange: setGridMode, onItemSizeChange: setItemSize, onPlayBarAreaChange: setShowPlayBarArea, onPassiveFilmstripsChange: setShowPassiveFilmstrips, onZoomChange: (event) => setZoomLevel(Number(event.target.value)), thumbnailMode: initialThumbnailMode, zoomLevel: zoomLevel }));
}
const meta = {
    title: "UI/Timeline/controls/TimelineToolbar",
    component: TimelineToolbar,
    parameters: {
        layout: "padded",
    },
    decorators: [
        (Story) => (_jsx("div", { className: "min-w-[900px] rounded-xl bg-zinc-900 p-4 text-white", children: _jsx(Story, {}) })),
    ],
    args: {
        gridMode: false,
        itemSize: "md",
        showPlayBarArea: true,
        showPassiveFilmstrips: false,
        onGridModeChange: () => { },
        onItemSizeChange: () => { },
        onPlayBarAreaChange: () => { },
        onPassiveFilmstripsChange: () => { },
        onZoomChange: () => { },
        thumbnailMode: false,
        zoomLevel: 100,
    },
};
export default meta;
export const Default = {
    render: () => _jsx(InteractiveToolbar, {}),
};
export const ThumbnailModeAndPinOff = {
    render: () => (_jsx(InteractiveToolbar, { initialItemSize: "lg", initialThumbnailMode: true, initialZoom: 180 })),
};
export const InteractiveControls = {
    render: () => _jsx(InteractiveToolbar, {}),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const playBarSwitch = canvas.getByRole("switch", { name: "Play bar" });
        await userEvent.click(playBarSwitch);
        await userEvent.click(playBarSwitch);
        const filmstripSwitch = canvas.getByRole("switch", { name: "Filmstrips" });
        await userEvent.click(filmstripSwitch);
        await userEvent.selectOptions(canvas.getByLabelText("Size"), "xl");
        await expect(playBarSwitch).toHaveAttribute("aria-checked", "true");
        await expect(filmstripSwitch).toHaveAttribute("aria-checked", "true");
        await expect(canvas.getByLabelText("Size")).toHaveValue("xl");
    },
};
