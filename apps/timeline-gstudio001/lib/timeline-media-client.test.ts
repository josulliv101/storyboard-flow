import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadTimelineMedia } from "./timeline-media-client";
import { at } from "../lib/test-support/at";

// The upload boundary. `response.json()` is `any`, so the function's
// `Promise<TimelineMediaUploadResult>` annotation proves nothing about what
// the network actually returned — these pin the runtime check that does.
//
// Image uploads only: the video path calls captureVideoThumbnail, which needs
// a DOM this node-env suite doesn't have. The parse it feeds is the same.

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function response(body: unknown, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function stubUpload(result: MockResponse) {
  vi.stubGlobal("fetch", (() => Promise.resolve(result)) as unknown as typeof fetch);
}

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("uploadTimelineMedia", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed result for a well-formed response", async () => {
    stubUpload(response({ pathname: "media/a.png", url: "https://cdn.test/a.png" }));
    await expect(uploadTimelineMedia("a.png", png(), "project-a")).resolves.toEqual({
      pathname: "media/a.png",
      url: "https://cdn.test/a.png",
    });
  });

  it("keeps optional thumbnail fields when they are present and valid", async () => {
    stubUpload(
      response({
        pathname: "media/a.png",
        url: "https://cdn.test/a.png",
        thumbnailPathname: "thumbs/a.jpg",
        thumbnailUrl: "https://cdn.test/thumbs/a.jpg",
      }),
    );
    await expect(uploadTimelineMedia("a.png", png(), "project-a")).resolves.toMatchObject({
      thumbnailPathname: "thumbs/a.jpg",
      thumbnailUrl: "https://cdn.test/thumbs/a.jpg",
    });
  });

  it("keeps provider provenance returned by the upload route", async () => {
    stubUpload(
      response({
        pathname: "media/a.png",
        url: "https://cdn.test/a.png",
        providerId: "firebase",
        assetId: "media/a.png",
      }),
    );
    await expect(uploadTimelineMedia("a.png", png(), "project-a")).resolves.toMatchObject({
      providerId: "firebase",
      assetId: "media/a.png",
    });
  });

  // The F4 case: 2xx, parseable JSON, but not a usable upload result. This
  // used to sail through and build a node with `src: undefined` — which the
  // reducer ACCEPTS (src is optional), so a sourceless clip committed and
  // persisted with no error anywhere.
  it.each([
    ["missing url", { pathname: "media/a.png" }],
    ["missing pathname", { url: "https://cdn.test/a.png" }],
    ["empty url", { pathname: "media/a.png", url: "   " }],
    ["non-string url", { pathname: "media/a.png", url: 42 }],
    ["null body", null],
    ["array body", []],
    [
      "present but malformed thumbnail",
      { pathname: "media/a.png", url: "https://cdn.test/a.png", thumbnailUrl: "" },
    ],
  ])("rejects a 2xx response with %s", async (_label, body) => {
    stubUpload(response(body));
    await expect(
      uploadTimelineMedia("a.png", png(), "project-a"),
    ).rejects.toThrow(/without a usable url/);
  });

  it("rejects a 2xx response whose body is not JSON at all", async () => {
    // A proxy returning an HTML error page with a 200 — .json() itself throws.
    stubUpload(response(new Error("Unexpected token <")));
    await expect(
      uploadTimelineMedia("a.png", png(), "project-a"),
    ).rejects.toThrow(/without a usable url/);
  });

  it("still reports non-2xx responses as upload failures", async () => {
    stubUpload(response("storage is full", 507));
    await expect(
      uploadTimelineMedia("a.png", png(), "project-a"),
    ).rejects.toThrow(/Media upload failed/);
  });

  it("extracts the server error from a failed JSON upload response", async () => {
    stubUpload(
      response(
        {
          error:
            "Cloudinary rejected the file because it exceeds this account's upload-size limit.",
        },
        413,
      ),
    );
    await expect(
      uploadTimelineMedia("a.png", png(), "project-a"),
    ).rejects.toThrow(
      "Media upload failed: Cloudinary rejected the file because it exceeds this account's upload-size limit.",
    );
  });
});

describe("uploadTimelineMedia video thumbnails", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mp4 = () => new Blob([new Uint8Array([0, 0, 0, 24])], { type: "video/mp4" });
  const ok = { pathname: "media/a.mp4", url: "https://cdn.test/a.mp4" };

  /** Records the FormData each upload sent. */
  function stubUploadCapturing(body: unknown = ok) {
    const bodies: FormData[] = [];
    vi.stubGlobal("fetch", ((_url: string, init?: RequestInit) => {
      if (init?.body instanceof FormData) bodies.push(init.body);
      return Promise.resolve(response(body));
    }) as unknown as typeof fetch);
    return bodies;
  }

  // The F5 property. A supplied thumbnail means the upload must NOT decode
  // the video itself — the caller already did. This suite runs in a node
  // environment with no `document`, so an internal decode attempt would
  // throw: the test passing IS the proof that no second decode happened.
  it("uses a caller-supplied thumbnail instead of decoding the video again", async () => {
    const bodies = stubUploadCapturing();
    const poster = new Blob([new Uint8Array([255, 216])], { type: "image/jpeg" });

    await expect(
      uploadTimelineMedia("a.mp4", mp4(), "project-a", undefined, {
        thumbnail: poster,
      }),
    ).resolves.toEqual(ok);

    expect(bodies).toHaveLength(1);
    expect(at(bodies, 0).get("projectId")).toBe("project-a");
    // FormData re-wraps a Blob as a File, so compare content, not identity.
    const sent = at(bodies, 0).get("thumbnail");
    expect(sent).toBeInstanceOf(Blob);
    expect((sent as Blob).type).toBe("image/jpeg");
    expect(await (sent as Blob).arrayBuffer()).toEqual(await poster.arrayBuffer());
    expect(String(at(bodies, 0).get("thumbnailFilename"))).toMatch(/^timeline-thumbnails\/a-thumbnail-/);
  });

  it("treats a supplied null thumbnail as 'already tried, none available'", async () => {
    // Present-but-null must still suppress the internal decode — otherwise a
    // video whose poster capture failed would be decoded a second time here.
    const bodies = stubUploadCapturing();

    await expect(
      uploadTimelineMedia("a.mp4", mp4(), "project-a", undefined, {
        thumbnail: null,
      }),
    ).resolves.toEqual(ok);

    expect(at(bodies, 0).get("thumbnail")).toBeNull();
    expect(at(bodies, 0).get("thumbnailFilename")).toBeNull();
  });

  it("passes an abort signal through to the request", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    vi.stubGlobal("fetch", ((_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return Promise.resolve(response(ok));
    }) as unknown as typeof fetch);
    const controller = new AbortController();

    await uploadTimelineMedia("a.mp4", mp4(), "project-a", undefined, {
      thumbnail: null,
      signal: controller.signal,
    });
    expect(signals[0]).toBe(controller.signal);
  });
});
