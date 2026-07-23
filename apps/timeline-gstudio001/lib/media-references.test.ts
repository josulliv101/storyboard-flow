import { describe, expect, it } from "vitest";

import {
  cloudinaryPublicId,
  collectCloudinaryUrls,
  isCloudinaryUrl,
  isStillReferenced,
  mediaMatchKeys,
  referenceIndex,
} from "./media-references";

const CDN = "https://res.cloudinary.com/demo";

describe("cloudinaryPublicId", () => {
  it("reads a plain upload URL", () => {
    expect(cloudinaryPublicId(`${CDN}/image/upload/v1712/gstudio/user-a/beach-178.png`)).toBe(
      "gstudio/user-a/beach-178",
    );
  });

  it("reads one with no version stamp", () => {
    expect(cloudinaryPublicId(`${CDN}/image/upload/gstudio/beach-178.png`)).toBe(
      "gstudio/beach-178",
    );
  });

  it("strips a transform chain — the shape this app STORES as a poster", () => {
    // cloudinaryVideoThumbnailUrl / cloudinaryImageThumbnailUrl both emit a
    // chain, so a document's poster and its src name the same asset in two
    // different shapes. They must resolve to the same id or the reference
    // check would clear an asset that is still in use.
    const poster = `${CDN}/video/upload/so_0.35,w_640,h_360,c_fill,q_auto,f_jpg/gstudio/clip-178.jpg`;
    const source = `${CDN}/video/upload/v1712/gstudio/clip-178.mp4`;
    expect(cloudinaryPublicId(poster)).toBe("gstudio/clip-178");
    expect(cloudinaryPublicId(poster)).toBe(cloudinaryPublicId(source));
  });

  it("strips a lone transform, and a transform followed by a version", () => {
    expect(cloudinaryPublicId(`${CDN}/image/upload/w_300/a/b.jpg`)).toBe("a/b");
    expect(cloudinaryPublicId(`${CDN}/video/upload/so_2.5/v9/a/b.mp4`)).toBe("a/b");
  });

  it("keeps interior dots in the name and only drops the extension", () => {
    expect(cloudinaryPublicId(`${CDN}/image/upload/v1/a/name.with.dots.png`)).toBe(
      "a/name.with.dots",
    );
  });

  it("never eats the id itself, even when it looks like a transform", () => {
    // A one-segment id after `/upload/` is the id, whatever its shape.
    expect(cloudinaryPublicId(`${CDN}/image/upload/w_300.png`)).toBe("w_300");
  });

  it("ignores a query string", () => {
    expect(cloudinaryPublicId(`${CDN}/image/upload/v1/a/b.png?_a=cache`)).toBe("a/b");
  });

  it("returns null for anything that isn't a Cloudinary delivery URL", () => {
    expect(cloudinaryPublicId("https://example.test/a/b.png")).toBeNull();
    expect(cloudinaryPublicId("data:image/gif;base64,AAAA")).toBeNull();
    expect(cloudinaryPublicId("")).toBeNull();
    expect(isCloudinaryUrl("https://res.cloudinary.com/demo/image/list/foo.json")).toBe(false);
  });
});

describe("collectCloudinaryUrls", () => {
  it("finds URLs at any depth, not just known fields", () => {
    const document = {
      id: "t1",
      title: "T",
      clips: [
        { id: "c1", kind: "image", src: `${CDN}/image/upload/v1/a/one.png` },
        {
          id: "c2",
          kind: "video",
          src: `${CDN}/video/upload/v1/a/two.mp4`,
          poster: `${CDN}/video/upload/so_0.35,w_640/a/two.jpg`,
        },
        {
          id: "c3",
          kind: "collection",
          previewItems: [{ src: `${CDN}/image/upload/v1/a/three.png` }],
        },
        { id: "c4", kind: "image", src: "https://example.test/local.png" },
      ],
    };
    expect([...collectCloudinaryUrls(document)].sort()).toEqual(
      [
        `${CDN}/image/upload/v1/a/one.png`,
        `${CDN}/image/upload/v1/a/three.png`,
        `${CDN}/video/upload/so_0.35,w_640/a/two.jpg`,
        `${CDN}/video/upload/v1/a/two.mp4`,
      ].sort(),
    );
  });

  it("survives a cyclic record instead of hanging", () => {
    const node: Record<string, unknown> = { src: `${CDN}/image/upload/v1/a/one.png` };
    node.self = node;
    expect([...collectCloudinaryUrls(node)]).toEqual([`${CDN}/image/upload/v1/a/one.png`]);
  });
});

describe("the reference check", () => {
  const live = [
    `${CDN}/image/upload/v1/gstudio/keep-1.png`,
    `${CDN}/video/upload/so_0.35,w_640/gstudio/keep-2.jpg`,
  ];

  it("keeps an asset a live document still points at — in EITHER URL shape", () => {
    const index = referenceIndex(live);
    // Same asset, different shape: the trashed clip holds the plain source
    // while the live document only kept a transformed poster.
    expect(
      isStillReferenced(index, mediaMatchKeys(`${CDN}/video/upload/v1/gstudio/keep-2.mp4`)!),
    ).toBe(true);
    expect(
      isStillReferenced(index, mediaMatchKeys(`${CDN}/image/upload/v1/gstudio/keep-1.png`)!),
    ).toBe(true);
  });

  it("keeps an asset whose folder moved but whose basename is the same", () => {
    // The loose half of the match: a re-foldered copy still counts as a
    // reference, because a wrong DELETE is unrecoverable and a wrong keep
    // is not.
    const index = referenceIndex(live);
    expect(
      isStillReferenced(index, mediaMatchKeys(`${CDN}/image/upload/v1/other/keep-1.png`)!),
    ).toBe(true);
  });

  it("clears an asset nothing points at", () => {
    const index = referenceIndex(live);
    expect(
      isStillReferenced(index, mediaMatchKeys(`${CDN}/image/upload/v1/gstudio/gone-9.png`)!),
    ).toBe(false);
  });

  it("skips non-Cloudinary URLs when indexing", () => {
    const index = referenceIndex(["https://example.test/a.png", ...live]);
    expect(index.publicIds.size).toBe(2);
  });
});
