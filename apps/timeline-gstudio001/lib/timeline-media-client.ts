export type TimelineMediaUploadResult = {
  pathname: string;
  url: string;
  thumbnailPathname?: string;
  thumbnailUrl?: string;
  providerId?: string;
  assetId?: string;
};

// A `Promise<TimelineMediaUploadResult>` annotation on a function that returns
// `response.json()` is a claim, not a check: the value is `any` at runtime and
// TypeScript is happy. A 2xx response missing `url` used to flow straight into
// node construction, and because `src` is OPTIONAL on media nodes the add
// SUCCEEDED — committing and persisting a clip with no source, silently. So
// the boundary validates.

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** `null` when the payload isn't a usable upload result. Optional fields must
 *  be absent or valid — a present-but-malformed thumbnail is a server bug
 *  worth surfacing, not something to quietly drop. */
function parseUploadResult(value: unknown): TimelineMediaUploadResult | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (!nonEmptyString(candidate.pathname) || !nonEmptyString(candidate.url)) return null;
  for (const key of ["thumbnailPathname", "thumbnailUrl", "providerId", "assetId"] as const) {
    if (candidate[key] !== undefined && !nonEmptyString(candidate[key])) return null;
  }
  return {
    pathname: candidate.pathname,
    url: candidate.url,
    ...(candidate.thumbnailPathname !== undefined
      ? { thumbnailPathname: candidate.thumbnailPathname as string }
      : {}),
    ...(candidate.thumbnailUrl !== undefined
      ? { thumbnailUrl: candidate.thumbnailUrl as string }
      : {}),
    ...(candidate.providerId !== undefined
      ? { providerId: candidate.providerId as string }
      : {}),
    ...(candidate.assetId !== undefined ? { assetId: candidate.assetId as string } : {}),
  };
}

function isVideoUpload(filename: string, file: Blob) {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(filename);
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || `upload-${Date.now()}`;
}

// How long ONE media-element step (decode, seek) may hang before we give up.
// A video element that emits neither its success event nor `error` — a
// corrupt file, a codec the browser half-supports — otherwise leaves the drop
// pending forever, with the UI stuck on "Uploading…" and nothing to cancel.
const VIDEO_PROBE_TIMEOUT_MS = 15_000;

/** Fallback source duration when the element never reports a usable one. */
const UNKNOWN_VIDEO_SECONDS = 5;

export type VideoProbe = Readonly<{
  /** Source duration in seconds; `UNKNOWN_VIDEO_SECONDS` when unreadable. */
  durationSeconds: number;
  /** Poster frame, or null when it could not be captured. */
  thumbnail: Blob | null;
}>;

/**
 * Settle an event-driven step, but never later than `timeoutMs`, and abandon
 * it immediately if `signal` aborts. Media element events are the motivating
 * case: they are not promises and have no built-in way to give up.
 */
function settleWithin<T>(
  executor: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  { signal, timeoutMs, label }: { signal?: AbortSignal; timeoutMs: number; label: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish(() => reject(new Error(`${label} was cancelled.`)));
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    function finish(act: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      act();
    }

    if (signal?.aborted) {
      finish(() => reject(new Error(`${label} was cancelled.`)));
      return;
    }
    signal?.addEventListener("abort", onAbort);
    timer = setTimeout(
      () => finish(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`))),
      timeoutMs,
    );
    executor(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/** Poster frame from an already-decoded, already-seeked video element. */
async function drawPosterFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(
    canvas.width / Math.max(1, video.videoWidth),
    canvas.height / Math.max(1, video.videoHeight),
  );
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

  const thumbnail = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.78),
  );
  return thumbnail && thumbnail.size > 0 ? thumbnail : null;
}

/**
 * ONE decode per video: duration AND poster frame come off the same element.
 *
 * These used to be two independent loads of the same file — a duration probe
 * in the drop layer, then a thumbnail capture in here — so every dropped
 * video was decoded twice, doubling the decoder/blob pressure of a multi-file
 * drop for no gain.
 *
 * Best-effort by design: a video that fails to decode still yields a usable
 * duration fallback and a null thumbnail, and the caller decides what that
 * means. The ONE failure it propagates is an abort, because that means the
 * caller has gone away and should stop.
 */
export async function probeVideoFile(
  file: Blob,
  options?: { targetTimeSeconds?: number; signal?: AbortSignal },
): Promise<VideoProbe> {
  const targetTimeSeconds = options?.targetTimeSeconds ?? 0.35;
  const signal = options?.signal;
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;

  const readDuration = () =>
    Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : UNKNOWN_VIDEO_SECONDS;

  try {
    video.src = sourceUrl;
    await settleWithin<void>(
      (resolve, reject) => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          resolve();
          return;
        }
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        video.addEventListener(
          "error",
          () => reject(new Error("Could not decode the selected video.")),
          { once: true },
        );
      },
      { signal, timeoutMs: VIDEO_PROBE_TIMEOUT_MS, label: "Video decode" },
    );

    const durationSeconds = readDuration();
    const seekTo = Math.min(
      Math.max(0, targetTimeSeconds),
      Math.max(0, durationSeconds - 0.05),
    );
    await settleWithin<void>(
      (resolve, reject) => {
        if (
          Math.abs(video.currentTime - seekTo) < 0.01 &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          resolve();
          return;
        }
        video.addEventListener("seeked", () => resolve(), { once: true });
        video.addEventListener(
          "error",
          () => reject(new Error("Could not seek the selected video.")),
          { once: true },
        );
        video.currentTime = seekTo;
      },
      { signal, timeoutMs: VIDEO_PROBE_TIMEOUT_MS, label: "Video seek" },
    );

    return { durationSeconds, thumbnail: await drawPosterFrame(video) };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return { durationSeconds: readDuration(), thumbnail: null };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function uploadTimelineMedia(
  filename: string,
  file: Blob,
  projectId: string,
  folderPath?: string,
  options?: {
    /**
     * A poster frame the caller already captured (via `probeVideoFile`).
     * When the key is PRESENT — including as `null`, meaning "tried, none
     * available" — this function does not decode the video itself. That is
     * what keeps a dropped video to a single decode; callers that omit it
     * keep the original decode-here behavior.
     */
    thumbnail?: Blob | null;
    signal?: AbortSignal;
  },
): Promise<TimelineMediaUploadResult> {
  const safeFilename = sanitizeFilename(filename);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("filename", safeFilename);
  formData.append("projectId", projectId);
  if (folderPath) {
    formData.append("folderPath", folderPath);
  }
  if (isVideoUpload(safeFilename, file)) {
    const thumbnail =
      options && "thumbnail" in options
        ? (options.thumbnail ?? null)
        : (await probeVideoFile(file, { signal: options?.signal })).thumbnail;
    if (thumbnail) {
      const baseName = safeFilename.replace(/\.[^/.]+$/, "").slice(0, 90) || "video";
      formData.append("thumbnail", thumbnail);
      formData.append(
        "thumbnailFilename",
        `timeline-thumbnails/${baseName}-thumbnail-${Date.now()}.jpg`,
      );
    }
  }

  const response = await fetch("/api/timeline-media/upload", {
    method: "POST",
    body: formData,
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let message = responseText.trim();
    try {
      const payload: unknown = JSON.parse(responseText);
      if (
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
      ) {
        message = payload.error.trim();
      }
    } catch {
      // Plain-text and proxy responses remain useful as-is.
    }
    throw new Error(
      `Media upload failed: ${message || `the server returned ${response.status}`}`,
    );
  }

  // `.json()` itself rejects on a 2xx body that isn't JSON at all (an HTML
  // error page from a proxy is the classic one).
  const payload = await response.json().catch(() => null);
  const parsed = parseUploadResult(payload);
  if (!parsed) {
    // THROWING, not returning a broken result: every caller already wraps
    // this in a try/catch that turns a failure into a per-file message, and
    // an upload whose location we can't read has failed in every sense that
    // matters to them.
    throw new Error(
      `Media upload for "${safeFilename}" returned a response without a usable url.`,
    );
  }
  return parsed;
}
