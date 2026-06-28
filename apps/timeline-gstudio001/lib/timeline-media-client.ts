export type TimelineMediaUploadResult = {
  pathname: string;
  url: string;
  thumbnailPathname?: string;
  thumbnailUrl?: string;
};

function isVideoUpload(filename: string, file: Blob) {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(filename);
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || `upload-${Date.now()}`;
}

export async function captureVideoThumbnail(
  videoBlob: Blob,
  targetTimeSeconds = 0.35,
): Promise<Blob | null> {
  const sourceUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;

  const waitForVideoReady = () =>
    new Promise<void>((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve();
        return;
      }

      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error("Could not decode the selected video for thumbnail capture.")),
        { once: true },
      );
    });

  const seekTo = (time: number) =>
    new Promise<void>((resolve, reject) => {
      if (
        Math.abs(video.currentTime - time) < 0.01 &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        resolve();
        return;
      }

      video.addEventListener("seeked", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error("Could not seek the selected video for thumbnail capture.")),
        { once: true },
      );
      video.currentTime = time;
    });

  try {
    video.src = sourceUrl;
    await waitForVideoReady();

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    await seekTo(Math.min(Math.max(0, targetTimeSeconds), Math.max(0, duration - 0.05)));

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
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function uploadTimelineMedia(
  filename: string,
  file: Blob,
  folderPath?: string,
): Promise<TimelineMediaUploadResult> {
  const safeFilename = sanitizeFilename(filename);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("filename", safeFilename);
  if (folderPath) {
    formData.append("folderPath", folderPath);
  }

  if (isVideoUpload(safeFilename, file)) {
    const thumbnail = await captureVideoThumbnail(file);
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
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Media upload failed: ${message}`);
  }

  return response.json();
}
