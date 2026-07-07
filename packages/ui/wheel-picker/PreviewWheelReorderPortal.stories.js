import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PreviewWheelReorderPortal } from './PreviewWheelReorderPortal';
const createColorPlaceholder = (color, label) => {
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};
const mockMedia = {
    id: 'item-1',
    clipId: 'c1',
    name: 'Ocean Coast',
    type: 'image',
    previewUrl: createColorPlaceholder('#3b82f6', 'Ocean Coast'),
};
const meta = {
    title: 'UI/WheelPicker/PreviewWheelReorderPortal',
    component: PreviewWheelReorderPortal,
    parameters: {
        layout: 'centered',
    },
    decorators: [
        (Story) => (_jsxs("div", { className: "relative h-[300px] w-[600px] bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center", children: [_jsx("div", { className: "text-zinc-500 text-xs", children: "Drag Reordering Portal Mock Container" }), _jsx(Story, {})] })),
    ],
};
export default meta;
export const ActiveReorder = {
    args: {
        reorderPreview: {
            mediaId: 'item-1',
            clientX: 300,
            clientY: 150,
            width: 160,
            height: 90,
            liftScale: 1.05,
            trayX: 300,
            trayY: 100,
        },
        items: [mockMedia],
        collectionItemIds: [],
        disabledItemIds: [],
        utilityDropTarget: null,
        collectionMultiCircleEnabled: false,
        getCollectionMediaItems: () => [],
        getCollectionDirectCount: () => 0,
        reorderGhostRef: { current: null },
        reorderGhostContentRef: { current: null },
    },
};
