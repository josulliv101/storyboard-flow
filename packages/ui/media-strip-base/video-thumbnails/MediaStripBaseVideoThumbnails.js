var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";
function getFrameCount({ durationSeconds, frameIntervalSeconds, maxFrames, }) {
    return Math.max(1, Math.min(maxFrames, Math.ceil(durationSeconds / frameIntervalSeconds)));
}
function getFrameTime({ durationSeconds, frameIntervalSeconds, frameIndex, }) {
    return Math.min(Math.max(0, durationSeconds - 0.05), frameIndex * frameIntervalSeconds);
}
function formatCloudinarySeekTime(timeSeconds) {
    const rounded = Number(timeSeconds.toFixed(2));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
export function getCloudinaryVideoFrameSrc({ src, timeSeconds, frameWidth, frameHeight, crop, quality, format, }) {
    var _a;
    const uploadMarker = "/video/upload/";
    const uploadIndex = src.indexOf(uploadMarker);
    if (uploadIndex === -1) {
        return src;
    }
    const uploadEnd = uploadIndex + uploadMarker.length;
    const beforeUploadPath = src.slice(0, uploadEnd);
    const videoPath = src.slice(uploadEnd);
    const videoPathWithoutQuery = (_a = videoPath.split("?")[0]) !== null && _a !== void 0 ? _a : videoPath;
    const withoutExtension = videoPathWithoutQuery.replace(/\.[^/.]+$/, "");
    const transformation = [
        `so_${formatCloudinarySeekTime(timeSeconds)}`,
        `w_${frameWidth}`,
        `h_${frameHeight}`,
        `c_${crop}`,
        `q_${quality}`,
        `f_${format}`,
    ].join(",");
    return `${beforeUploadPath}${transformation}/${withoutExtension}.${format}`;
}
/**
 * Displays video frames at a regular interval.
 * Renders an unstyled `<div>` element whose children are `<img>` frames.
 */
export const MediaStripBaseVideoThumbnails = React.forwardRef(function MediaStripBaseVideoThumbnails(_a, forwardedRef) {
    var { src, durationSeconds, frameIntervalSeconds = 1.5, maxFrames = 10, frameWidth = 480, frameHeight = 270, crop = "fill", quality = "auto", format = "jpg", getFrameSrc = getCloudinaryVideoFrameSrc, loading = "lazy", render } = _a, props = __rest(_a, ["src", "durationSeconds", "frameIntervalSeconds", "maxFrames", "frameWidth", "frameHeight", "crop", "quality", "format", "getFrameSrc", "loading", "render"]);
    const safeDuration = Math.max(0.001, durationSeconds);
    const safeInterval = Math.max(0.1, frameIntervalSeconds);
    const safeMaxFrames = Math.max(1, maxFrames);
    const frameCount = getFrameCount({
        durationSeconds: safeDuration,
        frameIntervalSeconds: safeInterval,
        maxFrames: safeMaxFrames,
    });
    const frameDetails = Array.from({ length: frameCount }, (_, frameIndex) => {
        const timeSeconds = getFrameTime({
            durationSeconds: safeDuration,
            frameIntervalSeconds: safeInterval,
            frameIndex,
        });
        return {
            src,
            timeSeconds,
            frameIndex,
            frameWidth,
            frameHeight,
            crop,
            quality,
            format,
        };
    });
    const state = {
        frameCount,
    };
    return useRender({
        defaultTagName: "div",
        render,
        ref: forwardedRef,
        props: Object.assign(Object.assign({}, props), { "data-frame-count": frameCount, children: (_jsx(_Fragment, { children: frameDetails.map((frame) => (_jsx("span", { "data-frame-loaded": "", "data-frame-index": frame.frameIndex, "data-frame-time": frame.timeSeconds, children: _jsx("img", { src: getFrameSrc(frame), alt: "", draggable: false, loading: loading }) }, `${frame.src}-${frame.frameIndex}`))) })) }),
        state,
    });
});
