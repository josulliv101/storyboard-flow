import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scopedProject: null as string | null,
  metadataReads: 0,
  cacheControl: "private, no-cache",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () => ({
    user: { uid: "user-a" },
    response: null,
  }),
}));
vi.mock("@/lib/project-asset-scope", () => {
  class ProjectAssetScopeError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ProjectAssetScopeError,
    requireProjectAssetScope: async (projectId: string) => {
      state.scopedProject = projectId;
      return projectId;
    },
  };
});
vi.mock("@/lib/firebase-media-store", () => ({
  createMediaReadStream: () => null,
  getMediaMetadata: async () => {
    state.metadataReads += 1;
    return {
      size: 100,
      contentType: "video/mp4",
      cacheControl: state.cacheControl,
      bucketName: "bucket",
    };
  },
  isAllowedMediaPathname: (pathname: string | null) =>
    pathname?.startsWith("timeline-videos/") === true ||
    pathname?.startsWith("timeline-thumbnails/") === true,
}));

import { GET, HEAD } from "./route";

function request(pathname: string) {
  return new Request(
    `http://test.local/api/timeline-media?pathname=${encodeURIComponent(pathname)}`,
    { method: "HEAD" },
  );
}

const OWNED = "timeline-videos/projects/user-a/project-a/large.mp4";

function rangeRequest(range: string | null) {
  return new Request(
    `http://test.local/api/timeline-media?pathname=${encodeURIComponent(OWNED)}`,
    { method: "GET", headers: range ? { range } : undefined },
  );
}

beforeEach(() => {
  state.scopedProject = null;
  state.metadataReads = 0;
  state.cacheControl = "private, no-cache";
});

describe("project-scoped Firebase media reads", () => {
  it("authorizes the project embedded in an owned media pathname", async () => {
    const response = await HEAD(
      request("timeline-videos/projects/user-a/project-a/large.mp4"),
    );

    expect(response.status).toBe(200);
    expect(state.scopedProject).toBe("project-a");
    expect(state.metadataReads).toBe(1);
  });

  it("hides another user's media before reading storage", async () => {
    const response = await HEAD(
      request("timeline-videos/projects/user-b/project-a/large.mp4"),
    );

    expect(response.status).toBe(404);
    expect(state.scopedProject).toBeNull();
    expect(state.metadataReads).toBe(0);
  });
});

describe("range responses", () => {
  it("serves an explicit range as 206", async () => {
    const response = await GET(rangeRequest("bytes=10-20"));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 10-20/100");
    expect(response.headers.get("content-length")).toBe("11");
  });

  // The regression: this used to answer `bytes 0-500/100` worth of intent —
  // the FIRST bytes rather than the last 30.
  it("serves a suffix range from the end of the resource", async () => {
    const response = await GET(rangeRequest("bytes=-30"));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 70-99/100");
    expect(response.headers.get("content-length")).toBe("30");
  });

  it("runs an open-ended range to the final byte", async () => {
    const response = await GET(rangeRequest("bytes=90-"));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 90-99/100");
  });

  it("answers 416 for a range past the end of the resource", async () => {
    const response = await GET(rangeRequest("bytes=100-200"));

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */100");
  });

  it("serves the full body when there is no range", async () => {
    const response = await GET(rangeRequest(null));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("100");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  // Valid but unimplemented — serving only its first part would hand the
  // client bytes it did not ask for under a 206 that claims otherwise.
  it("serves the full body for an unsupported multi-range request", async () => {
    const response = await GET(rangeRequest("bytes=0-1,5-6"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("100");
  });
});

describe("cache headers", () => {
  it("never lets an authenticated response be stored in a shared cache", async () => {
    // What thumbnails are actually written to storage with.
    state.cacheControl = "public, max-age=31536000, immutable";

    const response = await GET(rangeRequest(null));
    const cacheControl = response.headers.get("cache-control") ?? "";

    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
    // The freshness lifetime itself is still worth keeping — only the
    // shared-cache permission had to go.
    expect(cacheControl).toContain("max-age=31536000");
  });

  it("keeps an already-private directive intact", async () => {
    const response = await GET(rangeRequest(null));

    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("applies the same policy to 206 responses", async () => {
    state.cacheControl = "public, max-age=31536000, immutable";

    const response = await GET(rangeRequest("bytes=0-9"));

    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).not.toContain("public");
  });
});
