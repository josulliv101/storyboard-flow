import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { SceneLaunchPreviewWheelV3 } from './SceneLaunchPreviewWheelV3';
// Helper to create colorful SVG image data URIs for offline-capable, instant-loading stories
const createColorPlaceholder = (color, label) => {
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};
const initialItems = [
    {
        id: 'item-1',
        clipId: 'clip-1',
        name: 'Desert Timelapse',
        type: 'video',
        previewUrl: 'https://remotion.media/video.mp4',
        posterUrl: createColorPlaceholder('#f59e0b', 'Desert (Video)'),
        durationSeconds: 5,
        trimStartSeconds: 0,
        mediaDurationSeconds: 15,
    },
    {
        id: 'item-2',
        clipId: 'clip-2',
        name: 'Ocean Waves',
        type: 'image',
        previewUrl: createColorPlaceholder('#3b82f6', 'Ocean Waves (Image)'),
        durationSeconds: 3,
    },
    {
        id: 'item-3',
        clipId: 'clip-3',
        name: 'Forest Flight',
        type: 'video',
        previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        posterUrl: createColorPlaceholder('#10b981', 'Forest (Video)'),
        durationSeconds: 8,
        trimStartSeconds: 2,
        mediaDurationSeconds: 15,
    },
    {
        id: 'collection-1',
        clipId: 'clip-coll-1',
        name: 'Nature Sub-folder',
        type: 'image',
        previewUrl: createColorPlaceholder('#c084fc', 'Folder Collection'),
        durationSeconds: 10,
    },
    {
        id: 'item-4',
        clipId: 'clip-4',
        name: 'City Lights',
        type: 'video',
        previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
        posterUrl: createColorPlaceholder('#6366f1', 'City (Video)'),
        durationSeconds: 6,
        trimStartSeconds: 0,
        mediaDurationSeconds: 14,
    },
    {
        id: 'item-5',
        clipId: 'clip-5',
        name: 'Mountain Peak',
        type: 'image',
        previewUrl: createColorPlaceholder('#8b5cf6', 'Mountain (Image)'),
        durationSeconds: 4,
    }
];
const itemSequences = {
    'collection-1': [
        {
            id: 'nested-1',
            clipId: 'clip-n1',
            name: 'Nested Stream',
            type: 'video',
            previewUrl: 'https://remotion.media/video.mp4',
            posterUrl: createColorPlaceholder('#14b8a6', 'Stream (Nested Video)'),
            durationSeconds: 4,
            trimStartSeconds: 1,
            mediaDurationSeconds: 10,
        },
        {
            id: 'nested-2',
            clipId: 'clip-n2',
            name: 'Nested Leaf',
            type: 'image',
            previewUrl: createColorPlaceholder('#a855f7', 'Leaf (Nested Image)'),
            durationSeconds: 3,
        }
    ]
};
const itemSequenceThumbnails = {
    'collection-1': {
        'nested-1': {
            id: 'nested-1',
            clipId: 'clip-n1',
            name: 'Nested Stream',
            type: 'video',
            previewUrl: 'https://remotion.media/video.mp4',
            posterUrl: createColorPlaceholder('#14b8a6', 'Stream'),
        },
        'nested-2': {
            id: 'nested-2',
            clipId: 'clip-n2',
            name: 'Nested Leaf',
            type: 'image',
            previewUrl: createColorPlaceholder('#a855f7', 'Leaf'),
        }
    }
};
const allCollections = [
    {
        id: 'collection-1',
        name: 'Nature Sub-folder',
        gridOrder: [
            { id: 'nested-1', type: 'media' },
            { id: 'nested-2', type: 'media' }
        ]
    }
];
const getRecursiveMediaItems = (collection) => {
    if (collection.id === 'collection-1') {
        return itemSequences['collection-1'] || [];
    }
    return [];
};
function WheelPickerStoryFrame(props) {
    var _a, _b, _c, _d, _e;
    const [items, setItems] = React.useState(initialItems);
    const [selectedMediaId, setSelectedMediaId] = React.useState('item-1');
    const [effect, setEffect] = React.useState((_a = props.effect) !== null && _a !== void 0 ? _a : 'gallery');
    const [sizing, setSizing] = React.useState((_b = props.sizing) !== null && _b !== void 0 ? _b : 'uniform');
    const [durationScale, setDurationScale] = React.useState((_c = props.durationScale) !== null && _c !== void 0 ? _c : 1);
    const [disabledItemIds, setDisabledItemIds] = React.useState([]);
    const [isPreviewPlaying, setIsPreviewPlaying] = React.useState(false);
    const [loopPreviewPlayback, setLoopPreviewPlayback] = React.useState(false);
    const [timelineWrapped, setTimelineWrapped] = React.useState((_d = props.timelineWrapped) !== null && _d !== void 0 ? _d : false);
    const [gridView, setGridView] = React.useState((_e = props.gridView) !== null && _e !== void 0 ? _e : false);
    const [activePlayingMediaId, setActivePlayingMediaId] = React.useState(null);
    const [activePlayingElapsedSeconds, setActivePlayingElapsedSeconds] = React.useState(0);
    // Trimming states
    const activeItem = React.useMemo(() => {
        var _a;
        const nested = (_a = itemSequences['collection-1']) === null || _a === void 0 ? void 0 : _a.find(i => i.id === selectedMediaId);
        if (nested)
            return nested;
        return items.find(i => i.id === selectedMediaId);
    }, [items, selectedMediaId]);
    const [trimDuration, setTrimDuration] = React.useState(undefined);
    const [trimStart, setTrimStart] = React.useState(undefined);
    React.useEffect(() => {
        var _a;
        if (activeItem) {
            setTrimDuration(activeItem.durationSeconds);
            setTrimStart((_a = activeItem.trimStartSeconds) !== null && _a !== void 0 ? _a : 0);
        }
    }, [selectedMediaId, activeItem]);
    const handleCenteredMediaChange = (id) => {
        var _a;
        setSelectedMediaId(id);
        (_a = props.onCenteredMediaChange) === null || _a === void 0 ? void 0 : _a.call(props, id);
    };
    const handleItemsReorder = (draggedId, targetId, position) => {
        var _a;
        setItems(current => {
            const next = [...current];
            const draggedIndex = next.findIndex(i => i.id === draggedId);
            if (draggedIndex < 0)
                return current;
            const [draggedItem] = next.splice(draggedIndex, 1);
            const targetIndex = next.findIndex(i => i.id === targetId);
            if (targetIndex < 0)
                return current;
            const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
            next.splice(insertIndex, 0, draggedItem);
            return next;
        });
        (_a = props.onItemsReorder) === null || _a === void 0 ? void 0 : _a.call(props, draggedId, targetId, position);
    };
    const handleItemMoveIntoCollection = (draggedId, targetCollectionId) => {
        var _a;
        console.log(`Move ${draggedId} into ${targetCollectionId}`);
        (_a = props.onItemMoveIntoCollection) === null || _a === void 0 ? void 0 : _a.call(props, draggedId, targetCollectionId);
    };
    const handleUtilityDrop = (action, draggedId) => {
        var _a;
        console.log(`Utility Drop: ${action} on ${draggedId}`);
        if (action === 'trash') {
            setItems(current => current.filter(i => i.id !== draggedId));
        }
        else if (action === 'disable') {
            setDisabledItemIds(current => current.includes(draggedId)
                ? current.filter(id => id !== draggedId)
                : [...current, draggedId]);
        }
        (_a = props.onUtilityDrop) === null || _a === void 0 ? void 0 : _a.call(props, action, draggedId);
    };
    // Playback timer simulation
    React.useEffect(() => {
        if (!isPreviewPlaying) {
            setActivePlayingMediaId(null);
            setActivePlayingElapsedSeconds(0);
            return;
        }
        const interval = setInterval(() => {
            setActivePlayingElapsedSeconds(prev => {
                var _a;
                const next = prev + 0.1;
                const limit = (_a = activeItem === null || activeItem === void 0 ? void 0 : activeItem.durationSeconds) !== null && _a !== void 0 ? _a : 5;
                if (next > limit) {
                    return 0;
                }
                return next;
            });
            setActivePlayingMediaId(selectedMediaId);
        }, 100);
        return () => clearInterval(interval);
    }, [isPreviewPlaying, selectedMediaId, activeItem]);
    return (_jsxs("div", { className: "flex h-[600px] w-full flex-col overflow-hidden bg-zinc-950 text-white select-none rounded-lg border border-zinc-800", children: [_jsxs("div", { className: "flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900/60 px-6 py-3 text-xs font-semibold", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("label", { className: "flex items-center gap-2", children: [_jsx("span", { children: "Effect:" }), _jsxs("select", { value: effect, onChange: e => setEffect(e.target.value), className: "rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-bold text-white focus:outline-none", children: [_jsx("option", { value: "gallery", children: "Gallery (Flat)" }), _jsx("option", { value: "cylinder", children: "Cylinder 3D" }), _jsx("option", { value: "cylinder2", children: "Cylinder 2 3D" }), _jsx("option", { value: "coverflow", children: "Coverflow 3D" }), _jsx("option", { value: "stack", children: "Stack 3D" })] })] }), _jsxs("label", { className: "flex items-center gap-2", children: [_jsx("span", { children: "Sizing:" }), _jsxs("select", { value: sizing, onChange: e => setSizing(e.target.value), className: "rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-bold text-white focus:outline-none", children: [_jsx("option", { value: "uniform", children: "Uniform" }), _jsx("option", { value: "duration", children: "Duration Proportional" })] })] }), sizing === 'duration' && (_jsxs("label", { className: "flex items-center gap-2", children: [_jsx("span", { children: "Zoom Scale:" }), _jsx("input", { type: "range", min: "0.5", max: "2.5", step: "0.1", value: durationScale, onChange: e => setDurationScale(Number(e.target.value)), className: "w-20 accent-indigo-500" }), _jsxs("span", { className: "w-8 font-mono", children: [durationScale.toFixed(1), "x"] })] }))] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: gridView, onChange: e => setGridView(e.target.checked), className: "accent-indigo-500" }), _jsx("span", { children: "Grid Layout" })] }), gridView && (_jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: timelineWrapped, onChange: e => setTimelineWrapped(e.target.checked), className: "accent-indigo-500" }), _jsx("span", { children: "Wrap Rows" })] }))] })] }), _jsx("div", { className: "flex-1 min-h-0 relative", children: _jsx(SceneLaunchPreviewWheelV3, Object.assign({ items: items, itemSequences: itemSequences, itemSequenceThumbnails: itemSequenceThumbnails, collectionItemIds: ['collection-1'], collectionMultiCircleEnabled: true, allCollections: allCollections, getRecursiveMediaItems: getRecursiveMediaItems, selectedMediaId: selectedMediaId, onCenteredMediaChange: handleCenteredMediaChange, effect: effect, sizing: sizing, durationScale: durationScale, disabledItemIds: disabledItemIds, selectedItemDurationSeconds: trimDuration, selectedItemTrimStartSeconds: trimStart, onSelectedItemDurationChange: (dur, start) => {
                        setTrimDuration(dur);
                        setTrimStart(start);
                    }, onSelectedItemDurationChangeEnd: (dur, start) => {
                        setItems(current => current.map(i => i.id === selectedMediaId
                            ? Object.assign(Object.assign({}, i), { durationSeconds: dur, trimStartSeconds: start }) : i));
                    }, onItemsReorder: handleItemsReorder, onItemMoveIntoCollection: handleItemMoveIntoCollection, onUtilityDrop: handleUtilityDrop, gridView: gridView, timelineWrapped: timelineWrapped, onTimelineWrappedChange: setTimelineWrapped, isPreviewPlaying: isPreviewPlaying, loopPreviewPlayback: loopPreviewPlayback, onTogglePlayback: () => setIsPreviewPlaying(p => !p), onToggleLoop: () => setLoopPreviewPlayback(l => !l), activePlayingMediaId: activePlayingMediaId, activePlayingElapsedSeconds: activePlayingElapsedSeconds, renderSelectedItemOverlay: (item) => (_jsxs("div", { className: "absolute top-2 right-2 rounded bg-indigo-600/80 px-1.5 py-0.5 text-[9px] font-black uppercase text-white backdrop-blur", children: [item.type, " selected"] })), renderGalleryTrimOverlay: (item) => (_jsxs("div", { className: "flex items-center justify-between rounded bg-zinc-900/90 px-3 py-1.5 text-[9px] font-black uppercase border border-zinc-800 text-zinc-300", children: [_jsxs("span", { children: ["Trim Start: ", trimStart === null || trimStart === void 0 ? void 0 : trimStart.toFixed(1), "s"] }), _jsx("span", { className: "text-zinc-500", children: "|" }), _jsxs("span", { children: ["Trimmed: ", trimDuration === null || trimDuration === void 0 ? void 0 : trimDuration.toFixed(1), "s"] })] })) }, props)) })] }));
}
const meta = {
    title: 'UI/WheelPicker/SceneLaunchPreviewWheelV3',
    component: WheelPickerStoryFrame,
    parameters: {
        layout: 'fullscreen',
    },
};
export default meta;
export const DefaultGallery = {
    render: () => _jsx(WheelPickerStoryFrame, { effect: "gallery", sizing: "uniform" }),
};
export const Cylinder3D = {
    render: () => _jsx(WheelPickerStoryFrame, { effect: "cylinder", sizing: "uniform" }),
};
export const Coverflow3D = {
    render: () => _jsx(WheelPickerStoryFrame, { effect: "coverflow", sizing: "uniform" }),
};
export const Stack3D = {
    render: () => _jsx(WheelPickerStoryFrame, { effect: "stack", sizing: "uniform" }),
};
export const DurationProportional = {
    render: () => _jsx(WheelPickerStoryFrame, { effect: "gallery", sizing: "duration", durationScale: 1.2 }),
};
export const GridLayout = {
    render: () => _jsx(WheelPickerStoryFrame, { gridView: true, timelineWrapped: true }),
};
