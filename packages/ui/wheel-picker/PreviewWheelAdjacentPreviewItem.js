import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { usePreviewWheelSettings, VIDEO_PLACEHOLDER } from './SceneLaunchPreviewWheelV3';
import { PreviewWheelCollectionThumbnail } from './PreviewWheelCollectionThumbnail';
import { cn } from '../lib/utils';
export function PreviewWheelAdjacentPreviewItem({ item, centerOffset, direction, layout, playback, dragDrop, actions, }) {
    var _a, _b;
    const { collectionItemIds, isGaplessGallery, collectionMultiCircleEnabled, thumbnailSize, itemSequenceThumbnails, } = usePreviewWheelSettings();
    const { itemCenterY, uniformItemWidth, itemHeight, centerX, } = layout;
    const { scrubSnapshot, playheadX, } = playback;
    const { offset, } = dragDrop;
    const { getCollectionMediaItems, getCollectionDirectCount, } = actions;
    const playheadOffsetFromCenter = playheadX - centerX;
    const x = centerOffset + offset + playheadOffsetFromCenter;
    const isCollection = collectionItemIds.includes(item.id);
    const thumbnailItem = scrubSnapshot
        ? (_b = (_a = itemSequenceThumbnails === null || itemSequenceThumbnails === void 0 ? void 0 : itemSequenceThumbnails[item.id]) === null || _a === void 0 ? void 0 : _a[scrubSnapshot.media.id]) !== null && _b !== void 0 ? _b : item
        : item;
    return (_jsx("div", { className: cn("group/nav absolute left-1/2 shrink-0 overflow-hidden border bg-zinc-900 shadow-lg pointer-events-none", isGaplessGallery ? 'rounded-none' : 'rounded-md', "border-zinc-800"), style: {
            top: itemCenterY,
            width: uniformItemWidth,
            height: itemHeight,
            transform: `translate3d(${(x - uniformItemWidth / 2).toFixed(2)}px, ${(-itemHeight / 2).toFixed(2)}px, 0px)`,
            transformOrigin: 'center center',
            zIndex: 55,
            maskImage: direction === 'prev'
                ? 'linear-gradient(to right, transparent, black)'
                : 'linear-gradient(to left, transparent, black)',
            WebkitMaskImage: direction === 'prev'
                ? 'linear-gradient(to right, transparent, black)'
                : 'linear-gradient(to left, transparent, black)',
        }, children: isCollection ? (_jsx(PreviewWheelCollectionThumbnail, { collectionId: item.id, fallbackItem: thumbnailItem, collectionMultiCircleEnabled: collectionMultiCircleEnabled, collectionMediaItems: getCollectionMediaItems(item.id), collectionDirectCount: getCollectionDirectCount(item.id), scrubSnapshot: scrubSnapshot, itemSequenceThumbnails: itemSequenceThumbnails, thumbnailSize: thumbnailSize })) : (_jsxs(_Fragment, { children: [thumbnailItem.type === 'video' ? (_jsx("img", { src: thumbnailItem.posterUrl || VIDEO_PLACEHOLDER, alt: "", className: "h-full w-full object-cover" })) : (_jsx("img", { src: thumbnailItem.previewUrl, alt: "", className: "h-full w-full object-cover" })), _jsx("div", { className: "absolute inset-0 bg-black/40" }), _jsxs("div", { className: "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2.5", children: [_jsx("div", { className: "truncate text-xs font-black uppercase text-zinc-100", children: item.name }), _jsx("div", { className: "mt-1 flex items-center justify-between gap-1 font-mono text-[9px] uppercase tracking-widest text-zinc-400", children: _jsx("span", { children: item.type }) })] })] })) }));
}
