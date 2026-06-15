export async function localUpload(filename: string, file: Blob): Promise<{ pathname: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', filename);

  const res = await fetch('/api/scenes/media-upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Local upload failed: ${errText}`);
  }

  return res.json();
}

export const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export const runtimeSrcToRenderSrc = async (src?: string) => {
  if (!src) return undefined;
  if (!src.startsWith('blob:')) return src;

  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  }
};

export const captureVideoThumbnail = async (videoBlob: Blob, targetTimeSeconds = 0.35): Promise<Blob | null> => {
  const sourceUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  const waitForVideoReady = () => new Promise<void>((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleReady = () => resolve();
    const handleError = () => reject(new Error('Could not decode the selected video for thumbnail capture.'));
    video.addEventListener('loadeddata', handleReady, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

  const seekTo = (time: number) => new Promise<void>((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleSeek = () => resolve();
    const handleError = () => reject(new Error('Could not seek the selected video for thumbnail capture.'));
    video.addEventListener('seeked', handleSeek, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.currentTime = time;
  });

  try {
    video.src = sourceUrl;
    await waitForVideoReady();

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    await seekTo(Math.min(Math.max(0, targetTimeSeconds), Math.max(0, duration - 0.05)));

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.max(canvas.width / Math.max(1, video.videoWidth), canvas.height / Math.max(1, video.videoHeight));
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
};

export const captureVideoElementThumbnail = async (video: HTMLVideoElement): Promise<Blob | null> => {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(canvas.width / Math.max(1, video.videoWidth), canvas.height / Math.max(1, video.videoHeight));
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
};

export const getPreviewVideoElementForClip = (clipId: string) => (
  Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-preview-clip-id]'))
    .find(video => video.dataset.previewClipId === clipId && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
);
