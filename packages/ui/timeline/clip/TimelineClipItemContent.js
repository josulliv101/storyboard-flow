import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cva } from "class-variance-authority";
import { ClipMediaBody } from "./ClipMediaBody";
import { ClipKindBadge } from "./ClipKindBadge";
import { ClipDurationLabel } from "./ClipDurationLabel";
import { ClipCollectionControls } from "./ClipCollectionControls";
import { ClipGrowingOppositeOverlay } from "./ClipGrowingOppositeOverlay";
import { ClipTrimOverlay } from "./ClipTrimOverlay";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
import { getCollectionAccentGradientByIndex } from "../collection-accent";
const clipItemContent = cva("relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-all duration-200", {
    variants: {
        ring: {
            lifted: "ring-2 ring-sky-300 shadow-2xl shadow-sky-400/30",
            collectionHovered: "ring-2 ring-sky-400 bg-sky-950/20 shadow-lg shadow-sky-400/40",
            selected: "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20",
            default: "ring-1 ring-zinc-900",
        },
    },
    defaultVariants: {
        ring: "default",
    },
});
export function TimelineClipItemContent({ clip, view, }) {
    const { collectionActions, mediaActions } = useTimelineClipItemContext();
    const onDurationLoaded = (mediaActions === null || mediaActions === void 0 ? void 0 : mediaActions.onDurationLoaded) && !clip.viewRole
        ? (duration) => { var _a; return (_a = mediaActions.onDurationLoaded) === null || _a === void 0 ? void 0 : _a.call(mediaActions, clip.index, duration); }
        : undefined;
    const onCollectionEndpointClick = clip.kind === "collection" && (collectionActions === null || collectionActions === void 0 ? void 0 : collectionActions.onToggleCollectionEndpoint)
        ? (endpoint) => {
            var _a;
            return (_a = collectionActions.onToggleCollectionEndpoint) === null || _a === void 0 ? void 0 : _a.call(collectionActions, clip, endpoint);
        }
        : undefined;
    const onCollectionTitleChange = clip.kind === "collection" && (collectionActions === null || collectionActions === void 0 ? void 0 : collectionActions.onRenameCollection)
        ? (title) => {
            var _a;
            return (_a = collectionActions.onRenameCollection) === null || _a === void 0 ? void 0 : _a.call(collectionActions, clip, title);
        }
        : undefined;
    return (_jsxs("div", { className: clipItemContent({ ring: view.ring }), children: [clip.viewRole === "collection-endpoint" &&
                clip.viewCollectionAccentIndex !== undefined && (_jsx("div", { className: "absolute left-0 right-0 top-0 z-10 h-[2.5px] opacity-90", "data-testid": "collection-endpoint-accent-bar", style: {
                    background: getCollectionAccentGradientByIndex(clip.viewCollectionAccentIndex),
                } })), _jsx(ClipMediaBody, { clip: clip, view: view.media, onDurationLoaded: onDurationLoaded, collectionHref: clip.kind === "collection" ? view.collection.href : undefined, onOpenCollection: collectionActions === null || collectionActions === void 0 ? void 0 : collectionActions.onOpenCollection, onCollectionEndpointClick: onCollectionEndpointClick, onCollectionTitleChange: onCollectionTitleChange }), (clip.kind === "video" || clip.kind === "collection") && (_jsx(ClipKindBadge, { kind: clip.kind })), clip.kind === "collection" && (_jsx(ClipCollectionControls, { clip: clip, hasCollectionBreadcrumb: view.collection.hasBreadcrumb, breadcrumbLevels: view.collection.breadcrumbLevels })), _jsx(ClipDurationLabel, { clip: clip }), view.isGrowingOpposite && _jsx(ClipGrowingOppositeOverlay, {}), _jsx(ClipTrimOverlay, { clip: clip, view: view.trim })] }));
}
