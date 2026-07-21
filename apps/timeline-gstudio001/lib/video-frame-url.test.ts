import { describe, expect, it } from "vitest";

import {
  cloudinaryVideoFrameUrl,
  videoFrameUrls,
  type VideoFrameUrlBuilder,
} from "./video-frame-url";

const CLOUDINARY_FRAME =
  "https://res.cloudinary.com/demo/video/upload/so_0.35,w_640,h_360,c_fill,q_auto,f_jpg/folder/Scene.jpg";

describe("cloudinaryVideoFrameUrl", () => {
  it("rewrites an existing start-offset (so_) to the wanted time", () => {
    expect(cloudinaryVideoFrameUrl(CLOUDINARY_FRAME, 2)).toBe(
      "https://res.cloudinary.com/demo/video/upload/so_2,w_640,h_360,c_fill,q_auto,f_jpg/folder/Scene.jpg",
    );
    // Only the so_ number changes — every other transform is preserved.
    expect(cloudinaryVideoFrameUrl(CLOUDINARY_FRAME, 5.5)).toContain("so_5.5,w_640,h_360");
  });

  it("rewrites so_ even when it is not the first transform", () => {
    const url = "https://res.cloudinary.com/demo/video/upload/w_320,so_1.2,c_fill/x.jpg";
    expect(cloudinaryVideoFrameUrl(url, 4)).toBe(
      "https://res.cloudinary.com/demo/video/upload/w_320,so_4,c_fill/x.jpg",
    );
  });

  it("injects an offset when a video URL has none", () => {
    const url = "https://res.cloudinary.com/demo/video/upload/w_640,f_jpg/x.jpg";
    expect(cloudinaryVideoFrameUrl(url, 3)).toBe(
      "https://res.cloudinary.com/demo/video/upload/so_3,w_640,f_jpg/x.jpg",
    );
  });

  it("rounds to hundredths so sub-frame jitter keeps the CDN cache key stable", () => {
    expect(cloudinaryVideoFrameUrl(CLOUDINARY_FRAME, 1.23456)).toContain("so_1.23,");
    expect(cloudinaryVideoFrameUrl(CLOUDINARY_FRAME, -2)).toContain("so_0,");
  });

  it("passes non-video / non-Cloudinary URLs through unchanged", () => {
    const image = "https://res.cloudinary.com/demo/image/upload/v1/x.jpg";
    expect(cloudinaryVideoFrameUrl(image, 3)).toBe(image);
    expect(cloudinaryVideoFrameUrl("https://example.com/frame.jpg", 3)).toBe(
      "https://example.com/frame.jpg",
    );
  });
});

describe("videoFrameUrls", () => {
  it("samples `count` frames at slot centres across the visible range", () => {
    // A recording builder just captures the times it was asked for.
    const times: number[] = [];
    const record: VideoFrameUrlBuilder = (url, t) => {
      times.push(t);
      return `${url}#${t}`;
    };
    const urls = videoFrameUrls(["poster"], 4, { trimInSeconds: 0, effectiveSeconds: 8 }, record);
    expect(urls).toHaveLength(4);
    // (i + 0.5)/4 * 8 = 1, 3, 5, 7 — centres, never the exact 0 or 8 edge.
    expect(times).toEqual([1, 3, 5, 7]);
  });

  it("offsets sample times by the trim-in so it reads the VISIBLE window", () => {
    const times: number[] = [];
    const record: VideoFrameUrlBuilder = (_url, t) => {
      times.push(t);
      return "x";
    };
    videoFrameUrls(["poster"], 2, { trimInSeconds: 10, effectiveSeconds: 4 }, record);
    // (0.5/2)*4 + 10 = 11 ; (1.5/2)*4 + 10 = 13
    expect(times).toEqual([11, 13]);
  });

  it("returns nothing without a poster or with a non-positive count", () => {
    expect(videoFrameUrls([], 3, { trimInSeconds: 0, effectiveSeconds: 5 })).toEqual([]);
    expect(videoFrameUrls(["p"], 0, { trimInSeconds: 0, effectiveSeconds: 5 })).toEqual([]);
  });

  it("defaults to the Cloudinary builder", () => {
    const urls = videoFrameUrls([CLOUDINARY_FRAME], 1, { trimInSeconds: 0, effectiveSeconds: 4 });
    // count 1 → centre at 2s.
    expect(urls[0]).toContain("so_2,");
  });
});
