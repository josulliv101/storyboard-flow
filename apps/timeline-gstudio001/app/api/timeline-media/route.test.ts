import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scopedProject: null as string | null,
  metadataReads: 0,
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
      cacheControl: "private, no-cache",
      bucketName: "bucket",
    };
  },
  isAllowedMediaPathname: (pathname: string | null) =>
    pathname?.startsWith("timeline-videos/") === true ||
    pathname?.startsWith("timeline-thumbnails/") === true,
}));

import { HEAD } from "./route";

function request(pathname: string) {
  return new Request(
    `http://test.local/api/timeline-media?pathname=${encodeURIComponent(pathname)}`,
    { method: "HEAD" },
  );
}

beforeEach(() => {
  state.scopedProject = null;
  state.metadataReads = 0;
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
