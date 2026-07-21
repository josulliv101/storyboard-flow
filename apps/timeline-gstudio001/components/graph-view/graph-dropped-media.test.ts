import { describe, expect, it } from "vitest";

import { classifyDroppedMedia } from "./graph-dropped-media";

/** A File whose reported MIME type and name are both controlled. */
function fileWith(name: string, type: string): File {
  return new File([new Uint8Array([0])], name, { type });
}

describe("classifyDroppedMedia", () => {
  it("classifies by MIME prefix when the browser supplies one", () => {
    expect(classifyDroppedMedia(fileWith("a.png", "image/png"))).toBe("image");
    expect(classifyDroppedMedia(fileWith("a.mp4", "video/mp4"))).toBe("video");
    // The name is irrelevant when a usable MIME type is present.
    expect(classifyDroppedMedia(fileWith("noext", "image/webp"))).toBe("image");
  });

  it.each([
    ["frame.png", "image"],
    ["frame.PNG", "image"],
    ["photo.jpg", "image"],
    ["photo.jpeg", "image"],
    ["art.webp", "image"],
    ["clip.mp4", "video"],
    ["clip.webm", "video"],
    ["clip.mov", "video"],
  ] as const)("falls back to the %s extension when the MIME type is empty", (name, kind) => {
    expect(classifyDroppedMedia(fileWith(name, ""))).toBe(kind);
  });

  it("falls back to the extension for application/octet-stream", () => {
    expect(classifyDroppedMedia(fileWith("frame.png", "application/octet-stream"))).toBe("image");
    expect(classifyDroppedMedia(fileWith("clip.mp4", "application/octet-stream"))).toBe("video");
  });

  it("ignores unrelated file types", () => {
    // Unrelated MIME type.
    expect(classifyDroppedMedia(fileWith("notes.txt", "text/plain"))).toBeNull();
    // Unresolved MIME type with an unsupported extension.
    expect(classifyDroppedMedia(fileWith("archive.zip", ""))).toBeNull();
    expect(classifyDroppedMedia(fileWith("doc.pdf", "application/octet-stream"))).toBeNull();
    // No extension and no usable MIME type.
    expect(classifyDroppedMedia(fileWith("README", ""))).toBeNull();
  });
});
