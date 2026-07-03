import { useRender } from "@base-ui/react/use-render";
import type { BaseUIComponentProps } from "@base-ui/react/internals/types";
import * as React from "react";

export type MediaStripBaseVideoFrameDetails = {
  src: string;
  timeSeconds: number;
  frameIndex: number;
  frameWidth: number;
  frameHeight: number;
  crop: string;
  quality: string;
  format: string;
};

function getFrameCount({
  durationSeconds,
  frameIntervalSeconds,
  maxFrames,
}: {
  durationSeconds: number;
  frameIntervalSeconds: number;
  maxFrames: number;
}) {
  return Math.max(
    1,
    Math.min(maxFrames, Math.ceil(durationSeconds / frameIntervalSeconds)),
  );
}

function getFrameTime({
  durationSeconds,
  frameIntervalSeconds,
  frameIndex,
}: {
  durationSeconds: number;
  frameIntervalSeconds: number;
  frameIndex: number;
}) {
  return Math.min(
    Math.max(0, durationSeconds - 0.05),
    frameIndex * frameIntervalSeconds,
  );
}

function formatCloudinarySeekTime(timeSeconds: number) {
  const rounded = Number(timeSeconds.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function getCloudinaryVideoFrameSrc({
  src,
  timeSeconds,
  frameWidth,
  frameHeight,
  crop,
  quality,
  format,
}: MediaStripBaseVideoFrameDetails) {
  const uploadMarker = "/video/upload/";
  const uploadIndex = src.indexOf(uploadMarker);

  if (uploadIndex === -1) {
    return src;
  }

  const uploadEnd = uploadIndex + uploadMarker.length;
  const beforeUploadPath = src.slice(0, uploadEnd);
  const videoPath = src.slice(uploadEnd);
  const videoPathWithoutQuery = videoPath.split("?")[0] ?? videoPath;
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
export const MediaStripBaseVideoThumbnails = React.forwardRef<
  HTMLDivElement,
  MediaStripBaseVideoThumbnails.Props
>(function MediaStripBaseVideoThumbnails(
  {
    src,
    durationSeconds,
    frameIntervalSeconds = 1.5,
    maxFrames = 10,
    frameWidth = 480,
    frameHeight = 270,
    crop = "fill",
    quality = "auto",
    format = "jpg",
    getFrameSrc = getCloudinaryVideoFrameSrc,
    loading = "lazy",
    render,
    ...props
  },
  forwardedRef,
) {
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
    } satisfies MediaStripBaseVideoFrameDetails;
  });
  const state = {
    frameCount,
  };

  return useRender({
    defaultTagName: "div",
    render,
    ref: forwardedRef,
    props: {
      ...props,
      "data-frame-count": frameCount,
      children: (
        <>
          {frameDetails.map((frame) => (
            <span
              key={`${frame.src}-${frame.frameIndex}`}
              data-frame-loaded=""
              data-frame-index={frame.frameIndex}
              data-frame-time={frame.timeSeconds}
            >
              <img
                src={getFrameSrc(frame)}
                alt=""
                draggable={false}
                loading={loading}
              />
            </span>
          ))}
        </>
      ),
    },
    state,
  });
});

export interface MediaStripBaseVideoThumbnailsState {
  /**
   * Number of frame images rendered.
   */
  frameCount: number;
}

export interface MediaStripBaseVideoThumbnailsProps
  extends BaseUIComponentProps<
    "div",
    MediaStripBaseVideoThumbnails.State
  > {
  /**
   * Video source used to derive frame image URLs.
   */
  src: string;
  /**
   * Timeline duration represented by this item.
   */
  durationSeconds: number;
  /**
   * Seconds between sampled frame image URLs.
   *
   * @default 1.5
   */
  frameIntervalSeconds?: number | undefined;
  /**
   * Maximum number of frame image URLs to render.
   *
   * @default 10
   */
  maxFrames?: number | undefined;
  /**
   * Requested frame image width.
   *
   * @default 480
   */
  frameWidth?: number | undefined;
  /**
   * Requested frame image height.
   *
   * @default 270
   */
  frameHeight?: number | undefined;
  /**
   * Cloudinary crop mode.
   *
   * @default 'fill'
   */
  crop?: string | undefined;
  /**
   * Cloudinary quality value.
   *
   * @default 'auto'
   */
  quality?: string | undefined;
  /**
   * Frame image format.
   *
   * @default 'jpg'
   */
  format?: string | undefined;
  /**
   * Builds a frame image URL for each interval.
   */
  getFrameSrc?:
    | ((frameDetails: MediaStripBaseVideoFrameDetails) => string)
    | undefined;
  /**
   * Loading behavior applied to each frame image.
   *
   * @default 'lazy'
   */
  loading?: React.ImgHTMLAttributes<HTMLImageElement>["loading"] | undefined;
}

export namespace MediaStripBaseVideoThumbnails {
  export type State = MediaStripBaseVideoThumbnailsState;
  export type Props = MediaStripBaseVideoThumbnailsProps;
}
