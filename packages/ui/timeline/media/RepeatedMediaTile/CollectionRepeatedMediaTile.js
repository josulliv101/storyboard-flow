import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from "react";
import { cva } from "class-variance-authority";
import { Plus } from "lucide-react";
import { getVideoThumbnailUrl } from "../media-thumbnails";
import { getCollectionAccentGradientByIndex } from "../../collection-accent";
import { handleImageFallback } from "./image-fallback";
const collectionRepeatedMediaTile = cva("group relative h-full w-full select-none overflow-hidden rounded-lg border border-sky-500/20 bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 shadow-xl transition-all duration-300 hover:border-sky-500/40 hover:shadow-sky-950/20", {
    variants: {
        density: {
            compact: "p-2.5",
            default: "p-3.5",
        },
    },
    defaultVariants: {
        density: "default",
    },
});
const collectionPreviewSlot = cva("relative h-full w-full overflow-hidden rounded-[4px] border border-zinc-800/40 bg-zinc-900/60 p-0 text-left transition-all duration-200", {
    variants: {
        interactive: {
            true: "cursor-pointer appearance-none hover:border-amber-300/80 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2",
            false: "",
        },
        selected: {
            true: "border-sky-300/35 opacity-45 saturate-50 brightness-75",
            false: "",
        },
    },
    defaultVariants: {
        interactive: false,
        selected: false,
    },
});
const collectionItemCountSlot = cva("relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[4px] border border-sky-500/20 bg-sky-500/10 text-center transition-colors hover:border-sky-300/70 hover:bg-sky-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2", {
    variants: {
        density: {
            compact: "",
            default: "",
        },
    },
    defaultVariants: {
        density: "default",
    },
});
const collectionTileFooter = cva("flex min-w-0 flex-col justify-end", {
    variants: {
        density: {
            compact: "absolute inset-x-2.5 bottom-2.5",
            default: "pointer-events-auto absolute inset-x-3.5 bottom-3.5",
        },
    },
    defaultVariants: {
        density: "default",
    },
});
export function CollectionRepeatedMediaTile({ clip, isXS, collectionEndpointSelection, collectionHref, onOpenCollection, onCollectionEndpointClick, onTitleChange, }) {
    var _a, _b;
    const previewItems = (_a = clip.previewItems) !== null && _a !== void 0 ? _a : [];
    const density = isXS ? "compact" : "default";
    const accentGradient = getCollectionAccentGradientByIndex((_b = clip.viewCollectionAccentIndex) !== null && _b !== void 0 ? _b : clip.index);
    const titleInputId = useId();
    const titleInputRef = useRef(null);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [draftTitle, setDraftTitle] = useState(clip.title);
    useEffect(() => {
        if (!isEditingTitle) {
            setDraftTitle(clip.title);
        }
    }, [clip.title, isEditingTitle]);
    useEffect(() => {
        var _a, _b;
        if (isEditingTitle) {
            (_a = titleInputRef.current) === null || _a === void 0 ? void 0 : _a.focus();
            (_b = titleInputRef.current) === null || _b === void 0 ? void 0 : _b.select();
        }
    }, [isEditingTitle]);
    const commitTitleChange = () => {
        const nextTitle = draftTitle.trim();
        setIsEditingTitle(false);
        setDraftTitle(nextTitle || clip.title);
        if (nextTitle && nextTitle !== clip.title) {
            onTitleChange === null || onTitleChange === void 0 ? void 0 : onTitleChange(nextTitle);
        }
    };
    const cancelTitleChange = () => {
        setIsEditingTitle(false);
        setDraftTitle(clip.title);
    };
    return (_jsxs("div", { className: collectionRepeatedMediaTile({ density }), children: [_jsx("div", { className: "absolute left-0 right-0 top-0 h-[2.5px] opacity-90", "data-testid": "collection-accent-bar", style: { background: accentGradient } }), !isXS && (_jsx("div", { className: "absolute inset-0 flex items-center px-3.5 py-3.5", children: _jsx("div", { className: "grid h-24 max-h-full w-full grid-cols-3 gap-1.5 rounded-lg border border-zinc-900/80 bg-zinc-950/70 p-1.5 shadow-inner", children: ([
                        { endpoint: "first", item: previewItems[0] },
                        { endpoint: null, item: null },
                        {
                            endpoint: "last",
                            item: previewItems.length > 1 ? previewItems[previewItems.length - 1] : null,
                        },
                    ]).map(({ endpoint, item }, index) => {
                        var _a;
                        if (endpoint === null) {
                            const countContent = (_jsxs(_Fragment, { children: [_jsx("span", { className: "text-lg font-black leading-none text-sky-100", children: clip.itemCount }), _jsx("span", { className: "mt-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-400/85", children: clip.itemCount === 1 ? "item" : "items" })] }));
                            if (collectionHref) {
                                return (_jsx("a", { href: collectionHref, className: collectionItemCountSlot({ density }), "aria-label": `Open ${clip.title} timeline (${clip.itemCount} ${clip.itemCount === 1 ? "item" : "items"})`, onPointerDown: (event) => event.stopPropagation(), onClick: (event) => {
                                        event.stopPropagation();
                                        if (!onOpenCollection ||
                                            event.defaultPrevented ||
                                            event.button !== 0 ||
                                            event.metaKey ||
                                            event.ctrlKey ||
                                            event.shiftKey ||
                                            event.altKey) {
                                            return;
                                        }
                                        event.preventDefault();
                                        onOpenCollection(clip.childTimelineId, collectionHref);
                                    }, children: countContent }, `${clip.id}-item-count`));
                            }
                            return (_jsx("div", { className: collectionItemCountSlot({ density }), "aria-label": `${clip.title} contains ${clip.itemCount} ${clip.itemCount === 1 ? "item" : "items"}`, children: countContent }, `${clip.id}-item-count`));
                        }
                        const endpointSelected = endpoint
                            ? Boolean(collectionEndpointSelection === null || collectionEndpointSelection === void 0 ? void 0 : collectionEndpointSelection[endpoint])
                            : false;
                        const previewContent = item ? (item.kind === "video" ? (_jsx("img", { src: getVideoThumbnailUrl(item.src, 0), alt: item.alt, className: "h-full w-full object-cover grayscale-[10%] contrast-[105%] brightness-[95%] transition-transform duration-300 group-hover:scale-105", draggable: false, onError: (event) => handleImageFallback(event, item.poster) })) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        _jsx("img", { src: item.src, alt: item.alt, draggable: false, className: "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" }))) : (_jsx("div", { className: "flex h-full w-full items-center justify-center text-zinc-800", children: _jsx(Plus, { className: "h-3 w-3 opacity-30" }) }));
                        const isInteractiveEndpoint = Boolean(endpoint && onCollectionEndpointClick);
                        const previewSlotClassName = collectionPreviewSlot({
                            interactive: isInteractiveEndpoint,
                            selected: endpointSelected,
                        });
                        if (endpoint && onCollectionEndpointClick && item) {
                            return (_jsx("button", { type: "button", "data-testid": "timeline-collection-preview-endpoint", "data-endpoint": endpoint, "aria-pressed": endpointSelected, "aria-label": `${clip.title} ${endpoint} item`, className: previewSlotClassName, onPointerDown: (event) => {
                                    event.stopPropagation();
                                }, onClick: (event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onCollectionEndpointClick(endpoint);
                                }, children: previewContent }, item.id));
                        }
                        return (_jsx("div", { className: previewSlotClassName, children: previewContent }, (_a = item === null || item === void 0 ? void 0 : item.id) !== null && _a !== void 0 ? _a : `${clip.id}-empty-preview-${index}`));
                    }) }) })), _jsx("div", { className: collectionTileFooter({ density }), children: isEditingTitle ? (_jsxs("div", { className: "grid gap-1", children: [_jsx("label", { htmlFor: titleInputId, className: "sr-only", children: "Collection name" }), _jsx("input", { ref: titleInputRef, id: titleInputId, name: "collection-title", value: draftTitle, maxLength: 80, enterKeyHint: "done", className: "h-6 min-w-0 rounded border border-sky-400/70 bg-zinc-950/95 px-1.5 text-xs font-bold tracking-wide text-zinc-50 outline-none focus-visible:ring-2 focus-visible:ring-amber-300", onChange: (event) => setDraftTitle(event.target.value), onPointerDown: (event) => event.stopPropagation(), onClick: (event) => event.stopPropagation(), onBlur: commitTitleChange, onKeyDown: (event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    commitTitleChange();
                                    return;
                                }
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelTitleChange();
                                }
                            } })] })) : onTitleChange ? (_jsx("button", { type: "button", className: "min-w-0 truncate rounded px-1 py-0.5 text-left text-xs font-bold tracking-wide text-zinc-100 transition-colors hover:bg-zinc-800/80 hover:text-sky-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2", title: "Rename collection", onPointerDown: (event) => event.stopPropagation(), onClick: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraftTitle(clip.title);
                        setIsEditingTitle(true);
                    }, children: clip.title })) : (_jsx("h4", { className: "truncate text-xs font-bold tracking-wide text-zinc-100 transition-colors group-hover:text-sky-300", children: clip.title })) })] }));
}
