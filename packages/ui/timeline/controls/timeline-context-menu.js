import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Folder, Image, Video, X } from "lucide-react";
import { formatSeconds } from "../utils";
const addClipItems = [
    { type: "collection", label: "Collection", icon: Folder, color: "text-sky-400" },
    { type: "video", label: "Video Clip", icon: Video, color: "text-amber-400" },
    { type: "image", label: "Image Clip", icon: Image, color: "text-emerald-400" },
];
export function TimelineContextMenu({ insertIndex, onAddClip, onClose, thumbnailMode, timelineTime, x, y, }) {
    return (_jsxs("div", { onPointerDown: (e) => e.stopPropagation(), onMouseDown: (e) => e.stopPropagation(), onClick: (e) => e.stopPropagation(), onContextMenu: (e) => e.stopPropagation(), children: [_jsx("div", { className: "fixed inset-0 z-[99998]", onClick: onClose, onContextMenu: (e) => {
                    e.preventDefault();
                    onClose();
                } }), _jsxs("div", { className: "fixed z-[99999] min-w-56 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/90 p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 ease-out", style: {
                    left: `${x}px`,
                    top: `${y}px`,
                }, children: [_jsxs("div", { className: "px-3.5 py-2 border-b border-zinc-800/40 text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between gap-4", children: [_jsx("span", { children: thumbnailMode
                                    ? `Position: Card #${insertIndex + 1}`
                                    : `Timeline: ${formatSeconds(timelineTime)}` }), _jsx("button", { type: "button", onClick: onClose, className: "p-0.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer", title: "Close menu", "aria-label": "Close menu", children: _jsx(X, { className: "h-3 w-3" }) })] }), _jsx("div", { className: "mt-1 flex flex-col gap-0.5", children: addClipItems.map((item) => {
                            const Icon = item.icon;
                            return (_jsxs("button", { type: "button", onClick: () => {
                                    onAddClip === null || onAddClip === void 0 ? void 0 : onAddClip(insertIndex, item.type);
                                    onClose();
                                }, className: "flex w-full items-center gap-3.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-300 hover:bg-zinc-800/70 hover:text-white transition-colors cursor-pointer", children: [_jsx(Icon, { className: `h-4 w-4 shrink-0 ${item.color}` }), _jsxs("span", { children: ["Add ", item.label] })] }, item.type));
                        }) })] })] }));
}
