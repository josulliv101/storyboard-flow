import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listCloudinaryAssets,
  uploadCloudinaryMedia,
} from "./cloudinary-media-store";

const CLOUDINARY_URL = "cloudinary://key:secret@demo";

beforeEach(() => {
  process.env.CLOUDINARY_URL = CLOUDINARY_URL;
  delete process.env.CLOUDINARY_FOLDER;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLOUDINARY_URL;
  delete process.env.CLOUDINARY_FOLDER;
});

describe("Cloudinary project folders", () => {
  it("lists only the requested user/project prefix and strips it from browse paths", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/resources/search")) {
          return Response.json({ resources: [] });
        }
        return Response.json({
          resources: [
            {
              public_id:
                "timeline-gstudio001/user-project-list/project-a/Scenes/frame-1",
              resource_type: "image",
              secure_url: "https://cdn.test/frame-1.png",
            },
          ],
        });
      }) as typeof fetch,
    );

    const assets = await listCloudinaryAssets("user-project-list", "project-a");
    expect(assets).toHaveLength(1);
    expect(assets[0].relativePath).toBe("Scenes/frame-1");

    const imageRequest = new URL(
      requests.find((request) => request.url.includes("/resources/image/upload"))!.url,
    );
    expect(imageRequest.searchParams.get("prefix")).toBe(
      "timeline-gstudio001/user-project-list/project-a/",
    );
    const searchRequest = requests.find((request) =>
      request.url.endsWith("/resources/search"),
    );
    expect(JSON.parse(String(searchRequest?.init?.body))).toMatchObject({
      expression:
        "public_id:timeline-gstudio001/user-project-list/project-a/* AND resource_type:video",
    });
  });

  it("uploads into the user/project folder before optional subfolders", async () => {
    const sent: FormData[] = [];
    vi.stubGlobal(
      "fetch",
      (async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.body instanceof FormData) sent.push(init.body);
        return Response.json({
          public_id:
            "timeline-gstudio001/user-upload/project-a/Scenes/frame-1",
          resource_type: "image",
          secure_url: "https://cdn.test/frame-1.png",
        });
      }) as typeof fetch,
    );

    await uploadCloudinaryMedia(
      "frame.png",
      Buffer.from([1, 2, 3]),
      "image/png",
      "user-upload",
      "project-a",
      "Scenes",
    );

    expect(sent[0]?.get("folder")).toBe(
      "timeline-gstudio001/user-upload/project-a/Scenes",
    );
  });

  it("uploads large media in Cloudinary-compatible chunks", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      (async (_input: string | URL | Request, init?: RequestInit) => {
        requests.push(init ?? {});
        const isFinal = requests.length === 2;
        return Response.json(
          isFinal
            ? {
                done: true,
                bytes: 20 * 1024 * 1024 + 1,
                public_id: "timeline-gstudio001/user-upload/project-a/large-video",
                resource_type: "video",
                secure_url: "https://cdn.test/large-video.mp4",
              }
            : {
                done: false,
                public_id: "timeline-gstudio001/user-upload/project-a/large-video",
                resource_type: "video",
              },
        );
      }) as typeof fetch,
    );

    await expect(
      uploadCloudinaryMedia(
        "large-video.mp4",
        Buffer.alloc(20 * 1024 * 1024 + 1),
        "video/mp4",
        "user-upload",
        "project-a",
      ),
    ).resolves.toMatchObject({
      pathname: "timeline-gstudio001/user-upload/project-a/large-video",
      url: "https://cdn.test/large-video.mp4",
    });

    expect(requests).toHaveLength(2);
    const firstHeaders = new Headers(requests[0].headers);
    const secondHeaders = new Headers(requests[1].headers);
    expect(firstHeaders.get("Content-Range")).toBe(
      `bytes 0-${20 * 1024 * 1024 - 1}/${20 * 1024 * 1024 + 1}`,
    );
    expect(secondHeaders.get("Content-Range")).toBe(
      `bytes ${20 * 1024 * 1024}-${20 * 1024 * 1024}/${20 * 1024 * 1024 + 1}`,
    );
    expect(firstHeaders.get("X-Unique-Upload-Id")).toBeTruthy();
    expect(secondHeaders.get("X-Unique-Upload-Id")).toBe(
      firstHeaders.get("X-Unique-Upload-Id"),
    );
    expect(((requests[0].body as FormData).get("file") as Blob).size).toBe(
      20 * 1024 * 1024,
    );
    expect(((requests[1].body as FormData).get("file") as Blob).size).toBe(1);
  });
});
