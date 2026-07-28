import { describe, expect, it } from "vitest";

import {
  cloudinaryVideoFrameUrl,
  collectionPreviewFrameUrl,
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

describe("collectionPreviewFrameUrl", () => {
  it("uses the exact front-trim time for a video collection preview", () => {
    expect(
      collectionPreviewFrameUrl({
        kind: "video",
        src: "https://res.cloudinary.com/demo/video/upload/folder/clip.mp4",
        poster: CLOUDINARY_FRAME,
        trimIn: 6.25,
      }),
    ).toContain("/so_6.25,");
  });

  it("keeps image and untrimmed video previews unchanged", () => {
    const image = "https://cdn.test/image.jpg";
    expect(collectionPreviewFrameUrl({ kind: "image", src: image })).toBe(image);
    expect(
      collectionPreviewFrameUrl({
        kind: "video",
        src: "https://cdn.test/video.mp4",
        poster: CLOUDINARY_FRAME,
      }),
    ).toBe(CLOUDINARY_FRAME);
  });

  it("degrades to the existing poster when a provider cannot address frames", () => {
    const poster = "https://cdn.test/video-poster.jpg";
    expect(
      collectionPreviewFrameUrl({
        kind: "video",
        src: "https://cdn.test/video.mp4",
        poster,
        trimIn: 4,
      }),
    ).toBe(poster);
  });
});

describe("videoFrameUrls", () => {
  it("samples interior frames at slot centres and pins the LAST to the range end", () => {
    // A recording builder just captures the times it was asked for.
    const times: number[] = [];
    const record: VideoFrameUrlBuilder = (url, t) => {
      times.push(t);
      return `${url}#${t}`;
    };
    const urls = videoFrameUrls(["poster"], 4, { trimInSeconds: 0, effectiveSeconds: 8 }, record);
    expect(urls).toHaveLength(4);
    // Interior: (i + 0.5)/4 * 8 = 1, 3, 5 — centres, never the exact 0 edge.
    // Last: the end of the range minus the 0.05s back-off (R7 #3), so the
    // strip finishes on the clip's final frame instead of slot centre 7.
    expect(times).toEqual([1, 3, 5, 7.95]);
  });

  it("offsets sample times by the trim-in so it reads the VISIBLE window", () => {
    const times: number[] = [];
    const record: VideoFrameUrlBuilder = (_url, t) => {
      times.push(t);
      return "x";
    };
    videoFrameUrls(["poster"], 2, { trimInSeconds: 10, effectiveSeconds: 4 }, record);
    // First at centre (0.5/2)*4 + 10 = 11 ; last pinned to 10 + (4 - 0.05).
    expect(times).toEqual([11, 13.95]);
  });

  it("never pins the last slot below the range midpoint on tiny clips", () => {
    const times: number[] = [];
    const record: VideoFrameUrlBuilder = (_url, t) => {
      times.push(t);
      return "x";
    };
    // effective 0.06s: end - 0.05 = 0.01 would land BEFORE the first slot's
    // centre — the midpoint floor keeps the pair ordered.
    videoFrameUrls(["poster"], 2, { trimInSeconds: 0, effectiveSeconds: 0.06 }, record);
    expect(times[1]).toBeGreaterThanOrEqual(times[0]);
    expect(times[1]).toBeCloseTo(0.03);
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
