"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { getVideoThumbnailUrl } from "../media-thumbnails";
import { CollectionRepeatedMediaTile } from "./CollectionRepeatedMediaTile";
import { RepeatedMediaFrame } from "./RepeatedMediaFrame";
import { RepeatedMediaFrames } from "./RepeatedMediaFrames";
import { useMediaFrameTimes } from "./useMediaFrameTimes";
import { useVideoDuration } from "./useVideoDuration";
export function RepeatedMediaTile({ clip, displayWidth, previewTime, itemHeight, onDurationLoaded, collectionEndpointSelection, collectionHref, onOpenCollection, onCollectionEndpointClick, onCollectionTitleChange, }) {
    useVideoDuration(clip, onDurationLoaded);
    const isXS = itemHeight === 80;
    if (clip.kind === "collection") {
        return (_jsx(CollectionRepeatedMediaTile, { clip: clip, isXS: isXS, collectionEndpointSelection: collectionEndpointSelection, collectionHref: collectionHref, onOpenCollection: onOpenCollection, onCollectionEndpointClick: onCollectionEndpointClick, onTitleChange: onCollectionTitleChange }));
    }
    const { frameTimes, frameWidth, frameHeight, isVideo, mediaClip } = useMediaFrameTimes(clip, displayWidth, itemHeight, isXS, previewTime);
    return (_jsx(RepeatedMediaFrames, { children: frameTimes.map((tileTime, position) => {
            const frameMedia = {
                src: mediaClip.src,
                alt: mediaClip.alt,
                fallbackSrc: mediaClip.poster,
            };
            if (isVideo) {
                frameMedia.src = getVideoThumbnailUrl(mediaClip.src, tileTime);
                frameMedia.alt = `${mediaClip.alt} frame ${position + 1}`;
            }
            return (_jsx(RepeatedMediaFrame, Object.assign({ frameWidth: frameWidth, frameHeight: frameHeight }, frameMedia), `${clip.id}-repeat-frame-${tileTime}`));
        }) }));
}
