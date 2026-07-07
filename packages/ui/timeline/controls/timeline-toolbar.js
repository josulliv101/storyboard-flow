import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { ITEM_HEIGHTS } from "../constants";
import { ChevronDown, ChevronRight } from "lucide-react";
export function ToggleSwitch({ checked, id, label, onChange, title, }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { htmlFor: id, className: "cursor-pointer select-none text-[10px] font-semibold uppercase text-zinc-400", title: title, children: label }), _jsx("button", { id: id, type: "button", role: "switch", "aria-checked": checked, title: title, onClick: () => onChange(!checked), className: cn("relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200", checked
                    ? "border-amber-400 bg-amber-400/30"
                    : "border-zinc-600 bg-zinc-800"), children: _jsx("span", { className: cn("pointer-events-none block h-3 w-3 rounded-full shadow-sm transition-transform duration-200", checked
                        ? "translate-x-[18px] bg-amber-400"
                        : "translate-x-[2px] bg-zinc-400") }) })] }));
}
export function TimelineToolbar({ gridMode, itemSize, showPlayBarArea, showPassiveFilmstrips, title = "Timeline", onGridModeChange, onItemSizeChange, onPlayBarAreaChange, onPassiveFilmstripsChange, onZoomChange, thumbnailMode, zoomLevel, hierarchyMode = false, onHierarchyModeChange, hasChildCollections = false, childCollectionsExpanded = false, onToggleChildCollections, onTitleChange, titleMeta, toolbarActions, }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(title || "");
    useEffect(() => {
        setEditValue(title || "");
    }, [title]);
    return (_jsxs("div", { className: "flex w-full min-w-0 items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [hierarchyMode && hasChildCollections && onToggleChildCollections && (_jsx("button", { type: "button", onClick: onToggleChildCollections, className: "p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-zinc-200 shrink-0 flex items-center justify-center", title: childCollectionsExpanded ? "Collapse nested collections" : "Expand nested collections", children: childCollectionsExpanded ? (_jsx(ChevronDown, { className: "h-4 w-4" })) : (_jsx(ChevronRight, { className: "h-4 w-4" })) })), isEditing ? (_jsx("input", { type: "text", value: editValue, onChange: (e) => setEditValue(e.target.value), onBlur: () => {
                            setIsEditing(false);
                            if (editValue && editValue.trim() && editValue.trim() !== title) {
                                onTitleChange === null || onTitleChange === void 0 ? void 0 : onTitleChange(editValue.trim());
                            }
                        }, onKeyDown: (e) => {
                            if (e.key === "Enter") {
                                setIsEditing(false);
                                if (editValue && editValue.trim() && editValue.trim() !== title) {
                                    onTitleChange === null || onTitleChange === void 0 ? void 0 : onTitleChange(editValue.trim());
                                }
                            }
                            else if (e.key === "Escape") {
                                setIsEditing(false);
                                setEditValue(title || "");
                            }
                        }, autoFocus: true, className: "rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs font-semibold text-zinc-100 outline-none focus:border-amber-500 max-w-[200px]" })) : (_jsx("h3", { onClick: () => {
                            if (onTitleChange) {
                                setIsEditing(true);
                                setEditValue(title || "");
                            }
                        }, className: cn("min-w-0 truncate text-sm font-semibold text-zinc-200", onTitleChange && "cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 px-1 rounded transition-colors"), title: onTitleChange ? "Click to rename collection" : undefined, children: title })), titleMeta ? (_jsx("div", { className: "min-w-0 shrink text-xs text-zinc-500", children: titleMeta })) : null] }), _jsxs("div", { className: "flex shrink-0 items-center gap-4", children: [thumbnailMode && (_jsx(ToggleSwitch, { id: "grid-mode", label: "Grid Mode", checked: gridMode, onChange: onGridModeChange })), _jsx(ToggleSwitch, { id: "playbar-area", label: "Play bar", checked: showPlayBarArea, onChange: onPlayBarAreaChange, title: "Show the scrub/play bar above timeline items" }), showPlayBarArea && (_jsx(ToggleSwitch, { id: "passive-filmstrips", label: "Filmstrips", checked: showPassiveFilmstrips, onChange: onPassiveFilmstripsChange, title: "Show read-only filmstrips for inactive video clips" })), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { htmlFor: "size-select", className: "text-[10px] font-semibold uppercase text-zinc-400", children: "Size" }), _jsx("select", { id: "size-select", value: itemSize, onChange: (event) => onItemSizeChange(event.target.value), className: "h-6 rounded border border-zinc-700 bg-zinc-800 px-2 text-xs font-medium text-zinc-200 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400", children: Object.keys(ITEM_HEIGHTS).map((size) => (_jsx("option", { value: size, children: size.toUpperCase() }, size))) })] }), !thumbnailMode && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { htmlFor: "zoom-slider", className: "text-[10px] font-semibold uppercase text-zinc-400", children: "Zoom" }), _jsx("input", { id: "zoom-slider", type: "range", min: "20", max: "300", step: "1", value: zoomLevel, onChange: onZoomChange, className: "w-24 accent-amber-400" })] })), toolbarActions ? (_jsx("div", { className: "flex items-center gap-2", children: toolbarActions })) : null] })] }));
}
