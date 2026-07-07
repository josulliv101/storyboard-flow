import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Folder } from 'lucide-react';
import { VIDEO_PLACEHOLDER } from './SceneLaunchPreviewWheelV3';
export function PreviewWheelCollectionThumbnail({ collectionId, fallbackItem, collectionMultiCircleEnabled, collectionMediaItems, collectionDirectCount, scrubSnapshot, itemSequenceThumbnails, thumbnailSize = 'md', }) {
    var _a, _b, _c;
    const isMultiCircle = collectionMultiCircleEnabled;
    const mainThumbnailItem = scrubSnapshot
        ? (_b = (_a = itemSequenceThumbnails === null || itemSequenceThumbnails === void 0 ? void 0 : itemSequenceThumbnails[fallbackItem.id]) === null || _a === void 0 ? void 0 : _a[scrubSnapshot.media.id]) !== null && _b !== void 0 ? _b : fallbackItem
        : fallbackItem;
    if (thumbnailSize === 'xs') {
        return (_jsxs(_Fragment, { children: [mainThumbnailItem.type === 'video' ? (_jsx("img", { src: mainThumbnailItem.posterUrl || VIDEO_PLACEHOLDER, alt: "", className: "absolute inset-0 h-full w-full object-cover pointer-events-none" })) : (_jsx("img", { src: mainThumbnailItem.previewUrl, alt: "", className: "absolute inset-0 h-full w-full object-cover pointer-events-none" })), _jsx("span", { className: "pointer-events-none absolute left-1/2 top-1/2 z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/80 bg-zinc-950/90 text-[10px] font-black text-indigo-200 shadow-lg shadow-black/60", children: collectionDirectCount })] }));
    }
    if (isMultiCircle && collectionMediaItems.length > 0) {
        const first = collectionMediaItems[0];
        const last = collectionMediaItems[collectionMediaItems.length - 1];
        let longest = collectionMediaItems[0];
        let maxDur = -1;
        for (const m of collectionMediaItems) {
            const d = (_c = m.durationSeconds) !== null && _c !== void 0 ? _c : 3;
            if (d > maxDur) {
                maxDur = d;
                longest = m;
            }
        }
        const durations = collectionMediaItems.map(m => { var _a; return (_a = m.durationSeconds) !== null && _a !== void 0 ? _a : 3; });
        const maxDuration = Math.max(...durations);
        const minDuration = Math.min(...durations);
        const getCircleSizePercent = (duration) => {
            return 45 + ((duration - minDuration) / (maxDuration - minDuration || 1)) * 25;
        };
        const renderCircle = (m, left, top, role) => {
            var _a, _b, _c;
            const d = (_a = m.durationSeconds) !== null && _a !== void 0 ? _a : 3;
            const size = getCircleSizePercent(d);
            const subThumbnail = scrubSnapshot
                ? (_c = (_b = itemSequenceThumbnails === null || itemSequenceThumbnails === void 0 ? void 0 : itemSequenceThumbnails[m.id]) === null || _b === void 0 ? void 0 : _b[scrubSnapshot.media.id]) !== null && _c !== void 0 ? _c : m
                : m;
            return (_jsx("div", { className: "absolute rounded-full border border-zinc-600/50 shadow-lg overflow-hidden bg-zinc-950 flex items-center justify-center", style: {
                    left,
                    top,
                    width: `${size}%`,
                    height: `${size}%`,
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10,
                }, children: subThumbnail.type === 'video' ? (_jsx("img", { src: subThumbnail.posterUrl || VIDEO_PLACEHOLDER, alt: "", className: "h-full w-full object-cover pointer-events-none" })) : (_jsx("img", { src: subThumbnail.previewUrl, alt: "", className: "h-full w-full object-cover pointer-events-none" })) }, `${role}-${m.id}`));
        };
        return (_jsxs("div", { className: "absolute inset-0 bg-zinc-900/40 p-1 select-none pointer-events-none flex items-center justify-center", children: [_jsxs("div", { className: "h-[96%] aspect-square relative", children: [renderCircle(first, '50%', '18%', 'first'), renderCircle(last, '78%', '67%', 'last'), renderCircle(longest, '22%', '67%', 'longest'), _jsx("div", { className: "absolute flex items-center justify-center bg-black/35 rounded-full", style: {
                                left: '50%',
                                top: '50%',
                                transform: 'translate(-50%, -50%)',
                                zIndex: 30,
                            }, children: _jsx("span", { className: "flex min-w-10 h-10 px-2.5 items-center justify-center rounded-full bg-zinc-950 border border-zinc-700/80 text-sm font-black font-sans text-indigo-250 shadow-lg shadow-black/60", children: collectionDirectCount }) })] }), _jsx("div", { className: "absolute top-2 left-2 flex items-center justify-center rounded-full bg-black/60 p-1.5 text-indigo-300 border border-zinc-800/30 z-20", children: _jsx(Folder, { className: "h-2.5 w-2.5" }) })] }));
    }
    return (_jsxs("div", { className: "absolute inset-0 bg-zinc-900/40 p-1 select-none pointer-events-none flex items-center justify-center", children: [_jsxs("div", { className: "h-[96%] aspect-square relative flex items-center justify-center", children: [_jsx("div", { className: "absolute inset-0 rounded-full border border-zinc-800 bg-zinc-900/80 translate-x-[6px] -translate-y-[6px] opacity-50 scale-[0.97] shadow-sm z-0" }), _jsx("div", { className: "absolute inset-0 rounded-full border border-zinc-800/80 bg-zinc-900/90 translate-x-[4px] -translate-y-[4px] opacity-75 scale-[0.98] shadow-sm z-[3]" }), _jsx("div", { className: "absolute inset-0 rounded-full border border-zinc-700 bg-zinc-800 translate-x-[2px] -translate-y-[2px] opacity-90 scale-[0.99] shadow-md z-[6]" }), _jsxs("div", { className: "relative w-full h-full rounded-full border-2 border-zinc-600/70 shadow-lg overflow-hidden bg-zinc-950 z-10 flex items-center justify-center", children: [mainThumbnailItem.type === 'video' ? (_jsx("img", { src: mainThumbnailItem.posterUrl || VIDEO_PLACEHOLDER, alt: "", className: "h-full w-full object-cover" })) : (_jsx("img", { src: mainThumbnailItem.previewUrl, alt: "", className: "h-full w-full object-cover" })), _jsx("div", { className: "absolute inset-0 flex items-center justify-center bg-black/35 z-20", children: _jsx("span", { className: "flex min-w-10 h-10 px-2.5 items-center justify-center rounded-full bg-zinc-950 border border-zinc-700/80 text-sm font-black font-sans text-indigo-250 shadow-lg shadow-black/60", children: collectionDirectCount }) })] })] }), _jsx("div", { className: "absolute top-2 left-2 flex items-center justify-center rounded-full bg-black/60 p-1.5 text-indigo-300 border border-zinc-800/30 z-20", children: _jsx(Folder, { className: "h-2.5 w-2.5" }) })] }));
}
