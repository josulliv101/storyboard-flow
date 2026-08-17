import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { imageDimensions, writeOfflineMedia } from "./offline-media-store";

// Offline media: files on local disk, so an upload in offline mode makes no
// network call at all.
//
// `writeOfflineMedia` resolves against `process.cwd()`, so these run in a temp
// directory rather than writing into the repo's own public/.

const scratch = mkdtempSync(join(tmpdir(), "gstudio-media-"));
const cwd = process.cwd();

beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(scratch);
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
  expect(process.cwd()).toBe(cwd);
});

/** A real 3x2 PNG. Deliberately NOT 16:9, so a parser that guessed a default
 *  aspect instead of reading the header would be caught rather than flattered. */
const png3x2 = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/** GIF87a, 4x7. */
const gif4x7 = Buffer.concat([
  Buffer.from("GIF87a", "ascii"),
  Buffer.from([4, 0, 7, 0, 0, 0, 0]),
]);

/** A JPEG whose SOF0 sits behind an APP0 segment, so the walk has to skip one
 *  rather than read a fixed offset — which is the only reason this parser is a
 *  loop instead of two `readUInt16BE` calls. */
const jpeg5x9 = Buffer.concat([
  Buffer.from([0xff, 0xd8]), // SOI
  Buffer.from([0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]), // APP0, length 6
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x09, 0x00, 0x05]), // SOF0: h=9, w=5
  Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
]);

describe("imageDimensions", () => {
  it("reads a PNG header", () => {
    expect(imageDimensions(png3x2)).toEqual({ width: 3, height: 2 });
  });

  it("reads a GIF header", () => {
    expect(imageDimensions(gif4x7)).toEqual({ width: 4, height: 7 });
  });

  it("walks past a JPEG's APP0 to the frame header", () => {
    expect(imageDimensions(jpeg5x9)).toEqual({ width: 5, height: 9 });
  });

  it("reads an extended WebP canvas, which stores size minus one", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBPVP8X", "ascii"),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
      // 10x20, each stored as value-1 across three little-endian bytes.
      Buffer.from([9, 0, 0, 19, 0, 0]),
    ]);
    expect(imageDimensions(webp)).toEqual({ width: 10, height: 20 });
  });

  it("returns undefined rather than guessing for anything it cannot read", () => {
    // A clip with no dimensions keeps its default shape; a clip with WRONG ones
    // is drawn wrong. Undefined is the safe answer for video, audio and the
    // simple-VP8 WebP form.
    expect(imageDimensions(Buffer.from("not an image at all", "ascii"))).toBeUndefined();
    expect(imageDimensions(Buffer.alloc(0))).toBeUndefined();
    // Truncated PNG: signature present, header not.
    expect(imageDimensions(png3x2.subarray(0, 12))).toBeUndefined();
  });
});

describe("writeOfflineMedia", () => {
  it("writes the bytes and returns the URL they are served at", () => {
    const stored = writeOfflineMedia("projects/u1/p1/shot.png", png3x2);

    expect(stored.url).toBe("/offline-media/projects/u1/p1/shot.png");
    expect(stored.pathname).toBe("projects/u1/p1/shot.png");
    // Parsed on the way through, so the client can mint a real aspect.
    expect(stored).toMatchObject({ width: 3, height: 2 });

    const onDisk = join(scratch, "public", "offline-media", "projects", "u1", "p1", "shot.png");
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk).equals(png3x2)).toBe(true);
  });

  it("creates nested directories that do not exist yet", () => {
    const stored = writeOfflineMedia("a/deeply/nested/path/frame.gif", gif4x7);
    expect(existsSync(join(scratch, "public", "offline-media", stored.pathname))).toBe(true);
  });

  it("refuses to escape the media directory", () => {
    // `pathname` derives from a client-supplied filename. A `..` that survived
    // sanitising would otherwise write anywhere the dev server can reach.
    expect(() => writeOfflineMedia("../../escaped.png", png3x2)).toThrow(/Refusing to write/);
    expect(existsSync(join(scratch, "escaped.png"))).toBe(false);
    expect(existsSync(join(scratch, "public", "escaped.png"))).toBe(false);
  });

  it("omits dimensions for a non-image, leaving the clip its default shape", () => {
    const stored = writeOfflineMedia("projects/u1/p1/clip.mp4", Buffer.from("not really a video"));
    expect(stored.width).toBeUndefined();
    expect(stored.height).toBeUndefined();
    expect(stored.url).toBe("/offline-media/projects/u1/p1/clip.mp4");
  });
});
