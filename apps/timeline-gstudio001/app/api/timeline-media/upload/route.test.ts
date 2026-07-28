import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  firebaseUploads: [] as Array<{
    pathname: string;
    contentType: string | undefined;
    options: unknown;
  }>,
  uploadError: null as Error | null,
  uploadArgs: null as
    | {
        filename: string;
        contentType: string | undefined;
        userId: string | undefined;
        projectId: string | undefined;
        folderPath: string | undefined;
      }
    | null,
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
    requireProjectAssetScope: async (value: unknown) => {
      if (typeof value !== "string" || !value.startsWith("project-")) {
        throw new ProjectAssetScopeError("A valid projectId is required.", 400);
      }
      return value;
    },
  };
});
vi.mock("@/lib/cloudinary-media-store", () => {
  class CloudinaryUploadError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    CloudinaryUploadError,
    hasCloudinaryConfig: () => true,
    uploadCloudinaryMedia: async (
      filename: string,
      _data: Buffer,
      contentType?: string,
      userId?: string,
      projectId?: string,
      folderPath?: string,
    ) => {
      if (state.uploadError) throw state.uploadError;
      state.uploadArgs = { filename, contentType, userId, projectId, folderPath };
      return {
        pathname: `timeline/${userId}/${projectId}/${filename}`,
        url: `https://cdn.test/${filename}`,
      };
    },
  };
});
vi.mock("@/lib/firebase-media-store", () => ({
  createThumbnailPathname: (pathname: string) =>
    `timeline-thumbnails/${pathname.split("/").pop() ?? "video"}-thumbnail.jpg`,
  getMediaContentType: (_filename: string, explicit?: string) =>
    explicit || "application/octet-stream",
  sanitizeStoragePathname: (filename: string, prefix = "timeline-videos") =>
    filename.startsWith("timeline-") ? filename : `${prefix}/${filename}`,
  toMediaUrl: (pathname: string) =>
    `/api/timeline-media?pathname=${encodeURIComponent(pathname)}`,
  uploadMedia: async (
    pathname: string,
    _data: Buffer,
    contentType?: string,
    options?: unknown,
  ) => {
    state.firebaseUploads.push({ pathname, contentType, options });
    return { pathname, url: `/api/timeline-media?pathname=${encodeURIComponent(pathname)}` };
  },
}));
vi.mock("@/lib/assets/cloudinary-provider", () => ({
  CLOUDINARY_PROVIDER_ID: "cloudinary",
}));

import { POST as uploadAsset } from "./route";
import { CloudinaryUploadError } from "@/lib/cloudinary-media-store";

function request(projectId?: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  form.append("filename", "frame.png");
  if (projectId !== undefined) form.append("projectId", projectId);
  form.append("folderPath", "Scenes/Opening");
  return new Request("http://test.local/api/timeline-media/upload", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  state.firebaseUploads = [];
  state.uploadError = null;
  state.uploadArgs = null;
});

describe("POST /api/timeline-media/upload project scope", () => {
  it("threads the authorized project into the provider folder boundary", async () => {
    const response = await uploadAsset(request("project-a"));
    expect(response.status).toBe(200);
    expect(state.uploadArgs).toEqual({
      filename: "frame.png",
      contentType: "image/png",
      userId: "user-a",
      projectId: "project-a",
      folderPath: "Scenes/Opening",
    });
  });

  it("rejects an upload with no project membership", async () => {
    const response = await uploadAsset(request());
    expect(response.status).toBe(400);
    expect(state.uploadArgs).toBeNull();
  });

  it("returns a Cloudinary 413 without storing an overflow original", async () => {
    state.uploadError = new CloudinaryUploadError(
      "Cloudinary rejected the file because it exceeds this account's upload-size limit.",
      413,
    );

    const response = await uploadAsset(request("project-a"));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Cloudinary rejected the file because it exceeds this account's upload-size limit.",
    });
    expect(state.firebaseUploads).toHaveLength(0);
  });
});
