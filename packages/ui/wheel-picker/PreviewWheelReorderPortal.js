import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createPortal } from 'react-dom';
import { CornerUpLeft, Trash2, Ban, FolderInput } from 'lucide-react';
import { cn } from '../lib/utils';
import { VIDEO_PLACEHOLDER } from './SceneLaunchPreviewWheelV3';
import { PreviewWheelCollectionThumbnail } from './PreviewWheelCollectionThumbnail';
export function PreviewWheelReorderPortal({ reorderPreview, items, collectionItemIds, disabledItemIds, utilityDropTarget, collectionMultiCircleEnabled, getCollectionMediaItems, getCollectionDirectCount, scrubSnapshot, itemSequenceThumbnails, thumbnailSize = 'md', reorderGhostRef, reorderGhostContentRef, }) {
    if (!reorderPreview || typeof document === 'undefined') {
        return null;
    }
    const item = items.find(candidate => candidate.id === reorderPreview.mediaId);
    if (!item) {
        return null;
    }
    return createPortal(_jsxs(_Fragment, { children: [_jsx("div", { "aria-hidden": "true", className: "pointer-events-none fixed left-0 top-0 z-[310] grid w-[360px] grid-cols-4 gap-2 rounded-xl border border-zinc-700/90 bg-zinc-950/95 p-3 shadow-2xl shadow-black/70", style: {
                    transform: `translate3d(${reorderPreview.trayX}px, ${reorderPreview.trayY}px, 0) translate(-50%, -100%)`,
                }, children: [
                    ['parent', 'Parent', CornerUpLeft],
                    ['trash', 'Trash', Trash2],
                    ['disable', 'Disable', Ban],
                    ['directory', 'Directory', FolderInput],
                ].map(([action, label, Icon]) => (_jsxs("div", { "data-wheel-utility-target": action, className: cn('flex h-16 min-w-0 flex-col items-center justify-center rounded-lg border border-dashed text-zinc-300 transition-colors', utilityDropTarget === action
                        ? action === 'trash'
                            ? 'border-red-400 bg-red-500/25 text-red-100'
                            : action === 'disable'
                                ? 'border-amber-400 bg-amber-500/25 text-amber-100'
                                : 'border-indigo-400 bg-indigo-500/25 text-indigo-100'
                        : 'border-zinc-700 bg-zinc-900/90'), children: [_jsx(Icon, { className: "h-5 w-5" }), _jsx("span", { className: "mt-1.5 text-[9px] font-black uppercase tracking-wider", children: action === 'disable' && disabledItemIds.includes(reorderPreview.mediaId) ? 'Enable' : label })] }, action))) }), _jsx("div", { ref: reorderGhostRef, "aria-hidden": "true", className: "pointer-events-none fixed z-[300]", style: {
                    left: 0,
                    top: 0,
                    width: reorderPreview.width,
                    height: reorderPreview.height,
                    transform: `translate3d(${reorderPreview.clientX}px, ${reorderPreview.clientY}px, 0) translate(-50%, -50%) scale(1.03)`,
                    willChange: 'transform',
                }, children: _jsxs("div", { ref: reorderGhostContentRef, className: "relative h-full w-full overflow-hidden rounded-md border-2 border-indigo-300 bg-zinc-900 shadow-2xl shadow-black/70 ring-2 ring-indigo-400/40", style: { transformOrigin: 'center center', willChange: 'transform' }, children: [collectionItemIds.includes(item.id) ? (_jsx(PreviewWheelCollectionThumbnail, { collectionId: item.id, fallbackItem: item, collectionMultiCircleEnabled: collectionMultiCircleEnabled, collectionMediaItems: getCollectionMediaItems(item.id), collectionDirectCount: getCollectionDirectCount(item.id), scrubSnapshot: scrubSnapshot, itemSequenceThumbnails: itemSequenceThumbnails, thumbnailSize: thumbnailSize })) : (item.type === 'video' ? (_jsx("img", { src: item.posterUrl || VIDEO_PLACEHOLDER, alt: "", className: "h-full w-full object-cover" })) : (_jsx("img", { src: item.previewUrl, alt: "", className: "h-full w-full object-cover" }))), _jsx("div", { className: "absolute inset-0 bg-indigo-500/10" })] }) })] }), document.body);
}
