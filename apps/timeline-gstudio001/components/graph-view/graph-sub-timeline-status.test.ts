import { describe, expect, it } from "vitest";

import {
  subTimelineRowStatus,
  subTimelineRowStatusLabel,
} from "./graph-sub-timeline-status";

describe("subTimelineRowStatus", () => {
  it("is idle while collapsed, regardless of hydrated/failed", () => {
    expect(subTimelineRowStatus({ expanded: false, hydrated: false, failed: false })).toBe("idle");
    expect(subTimelineRowStatus({ expanded: false, hydrated: true, failed: false })).toBe("idle");
    expect(subTimelineRowStatus({ expanded: false, hydrated: false, failed: true })).toBe("idle");
  });

  it("is idle once expanded and hydrated (successful path shows no badge)", () => {
    expect(subTimelineRowStatus({ expanded: true, hydrated: true, failed: false })).toBe("idle");
    // A stale `failed` flag never overrides a real hydration.
    expect(subTimelineRowStatus({ expanded: true, hydrated: true, failed: true })).toBe("idle");
  });

  it("is loading while expanded and genuinely in flight", () => {
    expect(subTimelineRowStatus({ expanded: true, hydrated: false, failed: false })).toBe("loading");
  });

  it("is failed when an expanded row's attempt finished without hydrating", () => {
    expect(subTimelineRowStatus({ expanded: true, hydrated: false, failed: true })).toBe("failed");
  });
});

describe("subTimelineRowStatusLabel", () => {
  it("renders the in-flight copy for loading", () => {
    expect(subTimelineRowStatusLabel("loading")).toBe("loading…");
  });

  it("renders a distinct, retry-hinting copy for failed", () => {
    const label = subTimelineRowStatusLabel("failed");
    expect(label).not.toBe("loading…");
    expect(label).toMatch(/retry/i);
  });
});
