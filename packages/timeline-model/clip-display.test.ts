import { describe, expect, it } from "vitest";

import {
  CLIP_STRIP_MAX_WIDTH,
  CLIP_STRIP_MIN_WIDTH,
  clipLabel,
  clipPosterUrl,
  clipStripWidths,
  encodeMediaUrl,
  formatClipDuration,
} from "./clip-display";
import type { DisplayClip } from "./clip-display";

function media(overrides: Partial<DisplayClip> = {}): DisplayClip {
  return { kind: "image", src: "https://cdn.test/a.jpg", alt: "a", duration: 4, ...overrides };
}

function collection(overrides: Partial<DisplayClip> = {}): DisplayClip {
  return { kind: "collection", title: "Scene", duration: 10, previewItems: [], ...overrides };
}

describe("encodeMediaUrl", () => {
  it("escapes literal spaces stored in folder names", () => {
    expect(encodeMediaUrl("https://cdn.test/New Collection/a.jpg")).toBe(
      "https://cdn.test/New%20Collection/a.jpg",
    );
  });

  // Bare encodeURI escapes `%` as well, which turned this correct URL into
  // `New%2520Collection` and rendered it broken. Real documents hold both forms
  // for one clip — an encoded `src` beside a space-bearing `poster`.
  it("leaves an already-encoded URL untouched", () => {
    expect(encodeMediaUrl("https://cdn.test/New%20Collection/a.jpg")).toBe(
      "https://cdn.test/New%20Collection/a.jpg",
    );
  });

  it("is idempotent, so repeated repair can't corrupt a URL", () => {
    const raw = "https://cdn.test/Winterhill Gang/New Collection/a.jpg";
    const once = encodeMediaUrl(raw);
    expect(encodeMediaUrl(once)).toBe(once);
    expect(once).toBe("https://cdn.test/Winterhill%20Gang/New%20Collection/a.jpg");
  });

  // A stray `%` is left alone: it cannot be distinguished from a valid escape
  // without parsing, and touching it is what corrupted encoded URLs before.
  it("fixes the space without disturbing a stray percent", () => {
    expect(encodeMediaUrl("https://cdn.test/50% off.jpg")).toBe(
      "https://cdn.test/50%%20off.jpg",
    );
  });

  // The regression that broke every story thumbnail: an inline SVG is escaped
  // with encodeURIComponent, so `%3D` came back as `%253D` and the image died.
  it("leaves a data URI exactly as stored", () => {
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="x"/>')}`;
    expect(encodeMediaUrl(dataUri)).toBe(dataUri);
  });

  it("preserves encodeURIComponent escapes of reserved characters", () => {
    expect(encodeMediaUrl("https://cdn.test/a%3Db%26c.jpg")).toBe(
      "https://cdn.test/a%3Db%26c.jpg",
    );
  });

  it("preserves the query and transform syntax Cloudinary URLs rely on", () => {
    const url = "https://res.cloudinary.com/d/image/upload/w_640,h_360,c_fill,q_auto,f_auto/a.jpg";
    expect(encodeMediaUrl(url)).toBe(url);
  });

  it("returns undefined for a missing URL", () => {
    expect(encodeMediaUrl(undefined)).toBeUndefined();
    expect(encodeMediaUrl("")).toBeUndefined();
  });
});

describe("clipPosterUrl", () => {
  it("prefers a poster over the source", () => {
    expect(
      clipPosterUrl(media({ kind: "video", src: "https://cdn.test/a.mp4", poster: "https://cdn.test/a.jpg" })),
    ).toBe("https://cdn.test/a.jpg");
  });

  it("falls back to the source when there is no poster", () => {
    expect(clipPosterUrl(media({ kind: "video", src: "https://cdn.test/a.mp4" }))).toBe(
      "https://cdn.test/a.mp4",
    );
  });

  it("borrows a collection's first usable preview frame", () => {
    expect(
      clipPosterUrl(
        collection({
          previewItems: [
            { kind: "image", src: "https://cdn.test/first.jpg" },
            { kind: "image", src: "https://cdn.test/second.jpg" },
          ],
        }),
      ),
    ).toBe("https://cdn.test/first.jpg");
  });

  // Reading previewItems[0] blindly rendered the empty placeholder whenever the
  // leading item happened to carry no URL, even with good frames right behind it.
  it("scans past a preview item that carries no URL", () => {
    expect(
      clipPosterUrl(
        collection({
          previewItems: [{ kind: "image" }, { kind: "video", poster: "https://cdn.test/p2.jpg" }],
        }),
      ),
    ).toBe("https://cdn.test/p2.jpg");
  });

  it("encodes the frame it returns", () => {
    expect(
      clipPosterUrl(collection({ previewItems: [{ kind: "image", src: "https://cdn.test/New Collection/a.jpg" }] })),
    ).toBe("https://cdn.test/New%20Collection/a.jpg");
  });

  it("returns undefined when nothing can supply a frame", () => {
    expect(clipPosterUrl(collection({ previewItems: [] }))).toBeUndefined();
    expect(clipPosterUrl(collection({ previewItems: undefined }))).toBeUndefined();
    expect(clipPosterUrl(media({ src: undefined, poster: undefined }))).toBeUndefined();
  });
});

describe("clipLabel", () => {
  it("uses a collection's title", () => {
    expect(clipLabel(collection({ title: "Bank Heist" }))).toBe("Bank Heist");
  });

  it("uses a media clip's alt text", () => {
    expect(clipLabel(media({ alt: "Woman in alley" }))).toBe("Woman in alley");
  });

  it("never returns an empty caption", () => {
    expect(clipLabel({ kind: "image" })).toBe("image");
    expect(clipLabel({})).toBe("Clip");
    expect(clipLabel(collection({ title: "" }))).toBe("Collection");
  });
});

describe("formatClipDuration", () => {
  it("shows sub-minute durations in seconds", () => {
    expect(formatClipDuration(3.5)).toBe("3.5s");
    expect(formatClipDuration(40.868)).toBe("40.9s");
  });

  it("shows minute durations as m:ss", () => {
    expect(formatClipDuration(103.771667)).toBe("1:44");
    expect(formatClipDuration(60)).toBe("1:00");
  });

  // 59.6s rounds to 60 seconds; carrying avoids rendering "1:60".
  it("carries a rounded-up second into the minute", () => {
    expect(formatClipDuration(119.6)).toBe("2:00");
  });

  it("degrades to 0s for missing or nonsense durations", () => {
    expect(formatClipDuration(0)).toBe("0s");
    expect(formatClipDuration(-5)).toBe("0s");
    expect(formatClipDuration(Number.NaN)).toBe("0s");
  });
});

describe("clipStripWidths", () => {
  // The strip this replaced collapsed to near-equal cards. These durations are
  // a real project ("Foobar"): a 1:44 collection beside a 3.5s still, 30:1.
  const foobar: DisplayClip[] = [
    collection({ title: "Bank Heist", duration: 40.868 }),
    collection({ title: "New Timeline", duration: 9.12 }),
    media({ duration: 3.5 }),
    collection({ title: "FBI Interview", duration: 26.28 }),
    collection({ title: "Car Chase", duration: 11.687 }),
    collection({ title: "Test 002", duration: 103.772 }),
    collection({ title: "My Old Timeline", duration: 18.32 }),
  ];

  it("draws longer clips wider, in clip order", () => {
    const widths = clipStripWidths(foobar);
    expect(widths).toHaveLength(foobar.length);
    // Test 002 (1:44) is the widest; the 3.5s still is the narrowest.
    expect(Math.max(...widths)).toBe(widths[5]);
    expect(Math.min(...widths)).toBe(widths[2]);
  });

  it("keeps width strictly monotonic in duration", () => {
    const widths = clipStripWidths([
      media({ duration: 1 }),
      media({ duration: 10 }),
      media({ duration: 100 }),
    ]);
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[1]).toBeLessThan(widths[2]);
  });

  // The actual regression: the old strip compressed a 30:1 duration range into
  // roughly 3:1 of width AND then shrank it flat. Short clips must stay
  // readable, but the longest must still be visibly dominant.
  it("keeps short clips readable without flattening the strip", () => {
    const widths = clipStripWidths(foobar);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(CLIP_STRIP_MIN_WIDTH);
    expect(Math.max(...widths)).toBeLessThanOrEqual(CLIP_STRIP_MAX_WIDTH);
    // Visibly differentiated: the longest is at least half again the shortest.
    expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(1.5);
  });

  it("spans the full range: the longest clip gets the max width", () => {
    const widths = clipStripWidths(foobar);
    expect(widths[5]).toBe(CLIP_STRIP_MAX_WIDTH);
  });

  it("honours custom bounds", () => {
    const widths = clipStripWidths(foobar, { minWidth: 50, maxWidth: 500 });
    expect(Math.max(...widths)).toBe(500);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(50);
  });

  it("draws a uniform strip when no clip has a usable duration", () => {
    const widths = clipStripWidths([media({ duration: 0 }), media({ duration: undefined })]);
    expect(widths).toEqual([CLIP_STRIP_MIN_WIDTH, CLIP_STRIP_MIN_WIDTH]);
  });

  it("floors a zero-duration clip inside an otherwise sized strip", () => {
    const widths = clipStripWidths([media({ duration: 0 }), media({ duration: 60 })]);
    expect(widths[0]).toBe(CLIP_STRIP_MIN_WIDTH);
    expect(widths[1]).toBe(CLIP_STRIP_MAX_WIDTH);
  });

  it("returns nothing for an empty strip", () => {
    expect(clipStripWidths([])).toEqual([]);
  });
});
