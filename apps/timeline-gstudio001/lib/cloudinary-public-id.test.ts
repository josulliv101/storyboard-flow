import { describe, expect, it } from "vitest";

import { encodePublicIdPath } from "./cloudinary-public-id";

// Regression cover for broken thumbnails: hand-built Cloudinary transformation
// URLs interpolated the raw public id, so any asset in a folder with a space
// ("New Collection") produced a poster URL containing literal spaces, which
// browsers refuse to load. The asset's own `url` was unaffected because it is
// Cloudinary's `secure_url`, already encoded — which is exactly why the bug
// looked like "some thumbnails are broken" rather than an obvious failure.

describe("encodePublicIdPath", () => {
  it("encodes spaces in folder names", () => {
    expect(encodePublicIdPath("timeline/user/New Collection/clip")).toBe(
      "timeline/user/New%20Collection/clip",
    );
  });

  it("preserves `/` separators — the folder path must survive", () => {
    // encodeURIComponent on the WHOLE id would produce %2F and flatten this.
    const encoded = encodePublicIdPath("a/b/c");
    expect(encoded).toBe("a/b/c");
    expect(encoded).not.toContain("%2F");
  });

  it("handles multiple spaced segments", () => {
    expect(encodePublicIdPath("root/Winterhill Gang/New Collection/asset")).toBe(
      "root/Winterhill%20Gang/New%20Collection/asset",
    );
  });

  it("leaves already-safe ids untouched", () => {
    expect(encodePublicIdPath("folder/sub/file-name_1")).toBe("folder/sub/file-name_1");
  });

  it("encodes other path-hostile characters", () => {
    expect(encodePublicIdPath("a b/c#d")).toBe("a%20b/c%23d");
  });
});
