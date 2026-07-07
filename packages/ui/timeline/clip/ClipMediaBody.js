import { jsx as _jsx } from "react/jsx-runtime";
import { RepeatedMediaTile } from "../media/RepeatedMediaTile";
import { useTimelineClipItemContext } from "./TimelineClipItemContext";
export function ClipMediaBody({ clip, view, onDurationLoaded, collectionHref, onOpenCollection, onCollectionEndpointClick, onCollectionTitleChange, }) {
    var _a;
    const { metrics } = useTimelineClipItemContext();
    return (_jsx(RepeatedMediaTile, { clip: clip, displayWidth: view.displayWidth, previewTime: (_a = view.previewTime) !== null && _a !== void 0 ? _a : clip.trimIn, itemHeight: metrics.itemHeight, onDurationLoaded: onDurationLoaded, collectionEndpointSelection: clip.kind === "collection" ? view.collectionEndpointSelection : undefined, collectionHref: clip.kind === "collection" ? collectionHref : undefined, onOpenCollection: clip.kind === "collection" && onOpenCollection
            ? onOpenCollection
            : undefined, onCollectionEndpointClick: clip.kind === "collection" && onCollectionEndpointClick
            ? onCollectionEndpointClick
            : undefined, onCollectionTitleChange: clip.kind === "collection" && onCollectionTitleChange
            ? onCollectionTitleChange
            : undefined }));
}
