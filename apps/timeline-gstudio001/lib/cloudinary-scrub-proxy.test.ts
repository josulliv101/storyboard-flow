import { describe, expect, it } from "vitest";

import { cloudinaryScrubProxySrc } from "./cloudinary-scrub-proxy";

const VIDEO = "https://res.cloudinary.com/drrxyckxi/video/upload/project/S01_briefing.mp4";

describe("cloudinaryScrubProxySrc", () => {
  it("inserts the transform right after the delivery prefix", () => {
    expect(cloudinaryScrubProxySrc(VIDEO)).toBe(
      "https://res.cloudinary.com/drrxyckxi/video/upload/w_480,q_auto:low/project/S01_briefing.mp4",
    );
  });

  it("puts the transform BEFORE a version segment", () => {
    // Cloudinary rejects `upload/v123/w_480/...` — transforms precede the
    // version, and getting this backwards yields a 400 for every scrub.
    expect(
      cloudinaryScrubProxySrc(
        "https://res.cloudinary.com/c/video/upload/v1786244111/project/clip.mp4",
      ),
    ).toBe("https://res.cloudinary.com/c/video/upload/w_480,q_auto:low/v1786244111/project/clip.mp4");
  });

  it("is IDEMPOTENT, so a proxy is never wrapped in a second one", () => {
    const once = cloudinaryScrubProxySrc(VIDEO)!;
    expect(cloudinaryScrubProxySrc(once)).toBe(once);
  });

  it("returns null for anything that is not a Cloudinary VIDEO source", () => {
    // Null is the ordinary answer, and the caller reads it as "scrub the real
    // thing" — which is exactly the behaviour that shipped before proxies
    // existed. A source this cannot transform is never made worse.
    expect(cloudinaryScrubProxySrc("https://res.cloudinary.com/c/image/upload/a.png")).toBeNull();
    expect(cloudinaryScrubProxySrc("blob:http://localhost:3000/abc-123")).toBeNull();
    expect(cloudinaryScrubProxySrc("/fixtures/sample.mp4")).toBeNull();
    expect(cloudinaryScrubProxySrc("")).toBeNull();
  });

  it("keeps the cloud name it was given rather than assuming one", () => {
    expect(cloudinaryScrubProxySrc("https://res.cloudinary.com/other-cloud/video/upload/x.mp4"))
      .toContain("/other-cloud/video/upload/w_480,q_auto:low/");
  });
});
