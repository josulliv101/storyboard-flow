import "server-only";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

/**
 * Media storage for OFFLINE MODE: files on local disk, served as ordinary
 * static assets.
 *
 * The third leg of the upload route, beside Cloudinary and the Firebase Storage
 * fallback, and the one that makes offline mode actually offline. Uploading with
 * `GSTUDIO_FIXTURE_TIMELINES` set used to reach real Cloudinary — the same shape
 * of leak as the render poller: offline mode covered the timeline store and
 * nothing else, so the part of the app that costs money by the request was never
 * intercepted at all.
 *
 * WHAT DOWNSTREAM SEES IS A URL, exactly as it is for a third party. A clip
 * stores `src` and nothing about where the bytes live, so `/offline-media/…`
 * substitutes for a Cloudinary URL with no other change anywhere — no provider
 * id, no branch in the client, no special case in the model.
 *
 * `public/` rather than a served route, because Next already serves that
 * directory statically in dev and a route would be a second way to do the same
 * thing. Which also means these files are reachable without auth — the same
 * property Cloudinary delivery already has and which is a documented, accepted
 * call in this app.
 *
 * NOT PORTABLE, deliberately. A project exported with local media points at
 * local paths, so loading it elsewhere shows missing images. That is the right
 * trade for testing the UI offline: the alternative — inlining bytes as data
 * URIs — makes exports self-contained and turns a 300-item project into tens of
 * megabytes of fixture that gets parsed on every read. Real usage points at the
 * third party, where a URL travels.
 *
 * DEV ONLY, by construction: the sole caller gates on `fixtureStoreEnabled()`,
 * which is false in production and not overridable. Nothing here should ever run
 * against a read-only serverless filesystem.
 */

/** Where files land, and the URL prefix they are served under. Both halves of
 *  one fact: `public/offline-media/x` is served at `/offline-media/x`. */
const PUBLIC_DIR = "public";
const OFFLINE_SEGMENT = "offline-media";

export type OfflineStoredMedia = Readonly<{
  pathname: string;
  url: string;
  width?: number;
  height?: number;
}>;

/**
 * Intrinsic pixel size, read from the file's own header.
 *
 * The client mints a clip's `aspect` from these, and treats their absence as
 * "keep the default shape" — so returning nothing is safe and returning a wrong
 * number is not. Which is why this parses the container rather than guessing:
 * PNG, GIF, JPEG and the extended WebP form. Anything else — video, audio, a
 * simple-VP8 WebP — reports undefined and the clip keeps 16:9, the same
 * behaviour as the Firebase path when its probe comes back empty.
 */
export function imageDimensions(
  buffer: Buffer,
): { width: number; height: number } | undefined {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  // GIF: little-endian uint16 pair straight after the 6-byte header.
  if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  // WebP, extended form only (VP8X): a 24-bit canvas size, stored minus one.
  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP" &&
    buffer.toString("ascii", 12, 16) === "VP8X"
  ) {
    return {
      width: 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16)),
      height: 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16)),
    };
  }
  // JPEG: walk the segment chain to a start-of-frame marker. Sizes live in the
  // frame header, not at a fixed offset, because any number of application and
  // comment segments can precede it.
  if (buffer.length >= 4 && buffer.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1]!;
      // SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15. The excluded ones are
      // DHT/JPG/DAC, which share the 0xC_ range and are not frame headers.
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      // Standalone markers carry no length; everything else is length-prefixed.
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return undefined;
}

/**
 * Write one file and return where it can be fetched.
 *
 * `pathname` arrives already scoped and uniquified by the route, using the same
 * helpers the Firebase path uses — so offline files sit under the same
 * uid/project/folder layout as hosted ones, and a name collision is impossible
 * for the same reason it is there.
 *
 * The traversal check is not defensive theatre. `pathname` derives from a
 * client-supplied filename, and a `..` that survived sanitising would let an
 * upload write anywhere the dev server can reach. Checked against the resolved
 * prefix rather than by inspecting the string, because that is the check that
 * cannot be fooled by encoding.
 */
export function writeOfflineMedia(
  pathname: string,
  buffer: Buffer,
): OfflineStoredMedia {
  const root = join(process.cwd(), PUBLIC_DIR, OFFLINE_SEGMENT);
  const target = join(root, pathname);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Refusing to write outside ${OFFLINE_SEGMENT}: "${pathname}".`);
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);

  const dimensions = imageDimensions(buffer);
  return {
    pathname,
    // Forward slashes always: this is a URL, and `pathname` may have been joined
    // with a platform separator on the way in.
    url: `/${OFFLINE_SEGMENT}/${pathname.split(sep).join("/")}`,
    ...(dimensions ?? {}),
  };
}
