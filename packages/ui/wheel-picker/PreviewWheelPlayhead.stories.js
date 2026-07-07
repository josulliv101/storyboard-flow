import { jsx as _jsx } from "react/jsx-runtime";
import { PreviewWheelPlayhead } from './PreviewWheelPlayhead';
const meta = {
    title: 'UI/WheelPicker/PreviewWheelPlayhead',
    component: PreviewWheelPlayhead,
    parameters: {
        layout: 'centered',
    },
    decorators: [
        (Story) => (_jsx("div", { className: "relative h-64 w-[500px] bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center", children: _jsx(Story, {}) })),
    ],
};
export default meta;
export const DefaultPlayhead = {
    args: {
        renderedPlayheadX: 250,
        itemTop: 20,
        itemHeight: 120,
        rulerPlayheadTimeSeconds: 4.5,
        isPlayheadDragging: false,
        beginPlayheadDrag: () => { },
        movePlayheadDrag: () => { },
        endPlayheadDrag: () => { },
        handlePlayheadKeyDown: () => { },
        shouldShowPlayhead: true,
        isSharedPlayheadPlaying: false,
        sizing: 'duration',
        isGallery: false,
        canNavigateBack: false,
    },
};
export const PlayingPlayhead = {
    args: Object.assign(Object.assign({}, DefaultPlayhead.args), { isSharedPlayheadPlaying: true }),
};
export const PlayheadWithBackButton = {
    args: Object.assign(Object.assign({}, DefaultPlayhead.args), { onNavigateBack: () => { }, canNavigateBack: true, parentCollectionName: 'Project Assets' }),
};
